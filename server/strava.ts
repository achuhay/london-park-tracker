import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { stravaTokens, stravaActivities, parkVisits } from "@shared/schema";
import { eq, and, lt, desc, sql, isNotNull } from "drizzle-orm";
import { isAuthenticated } from "./replit_integrations/auth";
import { storage } from "./storage";
import crypto from "crypto";
import { haversineDistance } from "@shared/coordinates";

// Distance threshold in meters - if a runner passes within this distance of a park center, 
// the park is considered "visited"
const PARK_PROXIMITY_METERS = 100;

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

// State storage for CSRF protection (in production, use Redis/DB)
const oauthStates = new Map<string, { userId: string; expiresAt: number }>();

// Auth middleware that works in both dev and production
const authMiddleware = process.env.NODE_ENV === 'production' 
  ? isAuthenticated 
  : (req: any, res: any, next: any) => {
      // Mock user for dev
      req.user = { claims: { sub: 'dev-user' } };
      next();
    };

interface StravaTokenResponse {
  token_type: string;
  expires_at: number;
  expires_in: number;
  refresh_token: string;
  access_token: string;
  athlete: {
    id: number;
    firstname: string;
    lastname: string;
  };
}

interface StravaActivity {
  id: number;
  name: string;
  type: string;
  start_date: string;
  distance: number;
  moving_time: number;
  map?: {
    summary_polyline?: string;
    polyline?: string;
  };
}

// Decode Google polyline to array of [lat, lng]
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;

  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    points.push([lng / 1e5, lat / 1e5]);
  }

  return points;
}

// Simple point-in-polygon check using ray casting
function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

// Check if two line segments intersect
function segmentsIntersect(
  p1: [number, number], p2: [number, number],
  p3: [number, number], p4: [number, number]
): boolean {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const [x4, y4] = p4;

  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (Math.abs(denom) < 1e-10) return false; // Parallel lines

  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

// Check if a line segment crosses any polygon edge
function segmentIntersectsPolygon(
  p1: [number, number], p2: [number, number],
  polygon: [number, number][]
): boolean {
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (segmentsIntersect(p1, p2, polygon[j], polygon[i])) {
      return true;
    }
  }
  return false;
}

// Check if a polyline intersects with a polygon (point-in-polygon OR segment crossing)
function polylineIntersectsPolygon(polyline: [number, number][], polygon: [number, number][]): boolean {
  // Check if any point of the polyline is inside the polygon
  for (const point of polyline) {
    if (pointInPolygon(point, polygon)) {
      return true;
    }
  }
  
  // Check if any segment of the polyline crosses the polygon boundary
  for (let i = 0; i < polyline.length - 1; i++) {
    if (segmentIntersectsPolygon(polyline[i], polyline[i + 1], polygon)) {
      return true;
    }
  }
  
  return false;
}

// Check if a polyline passes within proximity of a point (for parks with only center coordinates)
function polylinePassesNearPoint(polyline: [number, number][], lat: number, lng: number, thresholdMeters: number): boolean {
  for (const [pointLat, pointLng] of polyline) {
    const distance = haversineDistance(pointLat, pointLng, lat, lng);
    if (distance <= thresholdMeters) {
      return true;
    }
  }
  return false;
}

// Check if a route passes through a park (either via polygon or proximity)
function routePassesThroughPark(
  routePoints: [number, number][],
  park: { latitude?: number | null; longitude?: number | null; polygon?: any }
): boolean {
  // First try polygon-based check if polygon exists (handles MultiPolygon)
  const polygonRings = extractPolygonRings(park.polygon);
  if (polygonRings.length > 0) {
    // Check each ring for intersection (important for MultiPolygon)
    for (const ring of polygonRings) {
      if (ring.length >= 3 && polylineIntersectsPolygon(routePoints, ring)) {
        return true;
      }
    }
    // If we had polygon data but no intersection, don't fall back to proximity
    if (polygonRings.some(r => r.length >= 3)) {
      return false;
    }
  }
  
  // Fall back to proximity check if we have lat/lng but no valid polygon
  if (park.latitude && park.longitude) {
    return polylinePassesNearPoint(routePoints, park.latitude, park.longitude, PARK_PROXIMITY_METERS);
  }
  
  return false;
}

async function getValidAccessToken(userId: string): Promise<string | null> {
  const [token] = await db.select().from(stravaTokens).where(eq(stravaTokens.userId, userId));
  
  if (!token) return null;

  const now = new Date();
  const expiresAt = new Date(token.expiresAt);

  // If token is still valid, return it
  if (now < expiresAt) {
    return token.accessToken;
  }

  // Token expired, refresh it
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    console.error("Strava credentials not configured");
    return null;
  }

  try {
    const response = await fetch("https://www.strava.com/api/v3/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    });

    if (!response.ok) {
      console.error("Failed to refresh Strava token");
      return null;
    }

    const data: StravaTokenResponse = await response.json();

    // Update token in database
    await db.update(stravaTokens)
      .set({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(data.expires_at * 1000),
        updatedAt: new Date(),
      })
      .where(eq(stravaTokens.userId, userId));

    return data.access_token;
  } catch (error) {
    console.error("Error refreshing Strava token:", error);
    // Delete invalid token to avoid infinite loop
    await db.delete(stravaTokens).where(eq(stravaTokens.userId, userId));
    return null;
  }
}

// Extract all polygon rings from GeoJSON (handles Polygon and MultiPolygon)
function extractPolygonRings(polygon: any): [number, number][][] {
  if (!polygon) return [];
  
  // GeoJSON Polygon format: { type: "Polygon", coordinates: [[[lng, lat], ...]] }
  if (polygon.type === "Polygon" && Array.isArray(polygon.coordinates)) {
    // coordinates[0] is the outer ring, each coord is [lng, lat]
    const ring = polygon.coordinates[0].map((coord: number[]) => [coord[1], coord[0]] as [number, number]);
    return [ring];
  }
  
  // GeoJSON MultiPolygon format: { type: "MultiPolygon", coordinates: [[[[lng, lat], ...]], ...] }
  if (polygon.type === "MultiPolygon" && Array.isArray(polygon.coordinates)) {
    return polygon.coordinates.map((poly: number[][][]) => 
      poly[0].map((coord: number[]) => [coord[1], coord[0]] as [number, number])
    );
  }
  
  // Simple array format: [[lat, lng], ...] or [[[lat, lng], ...], ...]
  if (Array.isArray(polygon) && polygon.length > 0) {
    // Check if it's a single ring [[lat, lng], ...]
    if (Array.isArray(polygon[0]) && typeof polygon[0][0] === "number") {
      return [polygon as [number, number][]];
    }
    // Check if it's multiple rings [[[lat, lng], ...], ...]
    if (Array.isArray(polygon[0]) && Array.isArray(polygon[0][0])) {
      return polygon as [number, number][][];
    }
  }
  
  return [];
}

// Extract coordinates from GeoJSON polygon (handles nested structure) - returns first ring for backwards compatibility
function extractPolygonCoords(polygon: any): [number, number][] {
  const rings = extractPolygonRings(polygon);
  return rings.length > 0 ? rings[0] : [];
}

export function registerStravaRoutes(app: Express) {
  // Check if Strava is connected for current user
  app.get("/api/strava/status", authMiddleware, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ connected: false });

    const [token] = await db.select().from(stravaTokens).where(eq(stravaTokens.userId, userId));
    
    res.json({ 
      connected: !!token,
      configured: !!(STRAVA_CLIENT_ID && STRAVA_CLIENT_SECRET)
    });
  });

  // Start Strava OAuth flow
  app.get("/api/strava/connect", authMiddleware, (req: any, res) => {
    if (!STRAVA_CLIENT_ID) {
      return res.status(500).json({ error: "Strava not configured" });
    }

    const userId = req.user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString("hex");
    oauthStates.set(state, { 
      userId, 
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    });

    // Build redirect URI from the actual request host (works for both dev and production)
    const host = req.get("host");
    // Use X-Forwarded-Proto header (set by Replit's reverse proxy) or default to https
    const protocol = req.get("x-forwarded-proto") || (host?.includes("localhost") ? "http" : "https");
    const redirectUri = `${protocol}://${host}/api/strava/callback`;
    console.log("[Strava] Connect redirect URI:", redirectUri);
    const scope = "activity:read_all";
    
    const authUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}&approval_prompt=force`;
    
    res.redirect(authUrl);
  });

  // Strava OAuth callback - doesn't require auth, validates via state
  app.get("/api/strava/callback", async (req: any, res) => {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const error = req.query.error as string;

    if (error) {
      console.error("Strava OAuth denied:", error);
      return res.redirect("/?strava=denied");
    }

    if (!code || !state) {
      return res.redirect("/?strava=error");
    }

    // Validate state for CSRF protection
    const storedState = oauthStates.get(state);
    if (!storedState || storedState.expiresAt < Date.now()) {
      oauthStates.delete(state);
      return res.redirect("/?strava=expired");
    }
    
    const userId = storedState.userId;
    oauthStates.delete(state);

    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
      return res.redirect("/?strava=not_configured");
    }

    try {
      // Use same redirect URI as connect (based on actual request host)
      const host = req.get("host");
      // Use X-Forwarded-Proto header (set by Replit's reverse proxy) or default to https
      const protocol = req.get("x-forwarded-proto") || (host?.includes("localhost") ? "http" : "https");
      const redirectUri = `${protocol}://${host}/api/strava/callback`;
      console.log("[Strava] Callback redirect URI:", redirectUri);

      const response = await fetch("https://www.strava.com/api/v3/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: STRAVA_CLIENT_ID,
          client_secret: STRAVA_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Strava token exchange failed:", errText);
        return res.redirect("/?strava=error");
      }

      const data: StravaTokenResponse = await response.json();

      // Upsert token (userId is unique, so use conflict handling)
      const [existing] = await db.select().from(stravaTokens).where(eq(stravaTokens.userId, userId));
      
      if (existing) {
        await db.update(stravaTokens)
          .set({
            athleteId: String(data.athlete.id),
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: new Date(data.expires_at * 1000),
            updatedAt: new Date(),
          })
          .where(eq(stravaTokens.userId, userId));
      } else {
        await db.insert(stravaTokens).values({
          userId,
          athleteId: String(data.athlete.id),
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: new Date(data.expires_at * 1000),
        });
      }

      res.redirect("/?strava=connected");
    } catch (error) {
      console.error("Strava OAuth error:", error);
      res.redirect("/?strava=error");
    }
  });

  // Disconnect Strava
  app.post("/api/strava/disconnect", authMiddleware, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    await db.delete(stravaTokens).where(eq(stravaTokens.userId, userId));
    res.json({ success: true });
  });

  // Fetch recent activities from Strava
  app.get("/api/strava/activities", authMiddleware, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return res.status(401).json({ error: "Strava not connected" });
    }

    try {
      const response = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=30", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: "Failed to fetch activities" });
      }

      const activities: StravaActivity[] = await response.json();
      
      // Filter for run activities only
      const runs = activities.filter(a => a.type === "Run");
      
      res.json(runs);
    } catch (error) {
      console.error("Error fetching Strava activities:", error);
      res.status(500).json({ error: "Failed to fetch activities" });
    }
  });

  // Sync a specific activity - check which parks it intersects
  app.post("/api/strava/sync/:activityId", authMiddleware, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    const stravaActivityId = req.params.activityId;
    
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return res.status(401).json({ error: "Strava not connected" });
    }

    try {
      // Get activity details with streams
      const activityResponse = await fetch(
        `https://www.strava.com/api/v3/activities/${stravaActivityId}?include_all_efforts=false`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!activityResponse.ok) {
        return res.status(activityResponse.status).json({ error: "Failed to fetch activity" });
      }

      const activity: StravaActivity = await activityResponse.json();
      
      // Get the polyline
      const polylineEncoded = activity.map?.polyline || activity.map?.summary_polyline;
      if (!polylineEncoded) {
        return res.json({ parksCompleted: [], message: "No route data available for this activity" });
      }

      const routePoints = decodePolyline(polylineEncoded);
      const activityDate = new Date(activity.start_date);
      
      // Store the activity in our database
      const [existingActivity] = await db.select().from(stravaActivities)
        .where(eq(stravaActivities.stravaId, String(activity.id)));
      
      let storedActivityId: number;
      if (existingActivity) {
        storedActivityId = existingActivity.id;
      } else {
        const [inserted] = await db.insert(stravaActivities).values({
          stravaId: String(activity.id),
          userId,
          name: activity.name,
          activityType: activity.type,
          startDate: activityDate,
          distance: activity.distance,
          movingTime: activity.moving_time,
          polyline: polylineEncoded,
        }).returning();
        storedActivityId = inserted.id;
      }
      
      // Get all parks
      const allParks = await storage.getParks();
      const parksCompleted: number[] = [];
      const parksVisited: number[] = [];

      for (const park of allParks) {
        // Skip parks without any location data
        if (!park.polygon && !park.latitude) continue;

        if (routePassesThroughPark(routePoints, park)) {
          parksVisited.push(park.id);
          
          // Check if we already have a visit record for this park+activity
          const [existingVisit] = await db.select().from(parkVisits)
            .where(and(
              eq(parkVisits.parkId, park.id),
              eq(parkVisits.activityId, storedActivityId)
            ));
          
          if (!existingVisit) {
            // Create a visit record
            await db.insert(parkVisits).values({
              parkId: park.id,
              activityId: storedActivityId,
              visitDate: activityDate,
            });
          }
          
          // Mark park as complete if not already
          if (!park.completed) {
            await storage.updatePark(park.id, {
              completed: true,
              completedDate: activityDate,
            });
            parksCompleted.push(park.id);
          }
        }
      }

      res.json({ 
        parksCompleted,
        parksVisited,
        activityId: storedActivityId,
        activityName: activity.name,
        message: parksCompleted.length > 0 
          ? `Marked ${parksCompleted.length} new park(s) as completed! (${parksVisited.length} total parks visited)` 
          : parksVisited.length > 0
            ? `Visited ${parksVisited.length} park(s) (already completed)`
            : "No parks were run through in this activity"
      });
    } catch (error) {
      console.error("Error syncing activity:", error);
      res.status(500).json({ error: "Failed to sync activity" });
    }
  });

  // Sync the single most recent activity and return full details for the summary modal
  app.post("/api/strava/sync-latest", authMiddleware, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return res.status(401).json({ error: "Strava not connected" });
    }

    try {
      // Fetch only the most recent activity from the list
      const listResponse = await fetch(
        "https://www.strava.com/api/v3/athlete/activities?per_page=1&page=1",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!listResponse.ok) {
        return res.status(listResponse.status).json({ error: "Failed to fetch activities" });
      }
      const activities: StravaActivity[] = await listResponse.json();
      if (!activities.length) {
        return res.json({ activity: null, parksCompleted: [], parksVisited: [], message: "No activities found" });
      }

      // Fetch full activity detail (includes full polyline, not just summary)
      const activityResponse = await fetch(
        `https://www.strava.com/api/v3/activities/${activities[0].id}?include_all_efforts=false`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!activityResponse.ok) {
        return res.status(activityResponse.status).json({ error: "Failed to fetch activity details" });
      }
      const activity: StravaActivity = await activityResponse.json();

      const polylineEncoded = activity.map?.polyline || activity.map?.summary_polyline;
      const activitySummary = {
        id: activity.id,
        name: activity.name,
        distance: activity.distance,
        moving_time: activity.moving_time,
        start_date: activity.start_date,
        summaryPolyline: polylineEncoded || null,
      };

      if (!polylineEncoded) {
        return res.json({ activity: activitySummary, parksCompleted: [], parksVisited: [], message: "No route data for this activity" });
      }

      const routePoints = decodePolyline(polylineEncoded);
      const activityDate = new Date(activity.start_date);

      // Store activity in DB
      const [existingActivity] = await db.select().from(stravaActivities)
        .where(eq(stravaActivities.stravaId, String(activity.id)));
      let storedActivityId: number;
      if (existingActivity) {
        storedActivityId = existingActivity.id;
      } else {
        const [inserted] = await db.insert(stravaActivities).values({
          stravaId: String(activity.id),
          userId,
          name: activity.name,
          activityType: activity.type,
          startDate: activityDate,
          distance: activity.distance,
          movingTime: activity.moving_time,
          polyline: polylineEncoded,
        }).returning();
        storedActivityId = inserted.id;
      }

      // Check all parks for intersection
      const allParks = await storage.getParks();
      const parksCompletedData: (typeof allParks[0])[] = [];
      const parksVisitedData: (typeof allParks[0])[] = [];

      for (const park of allParks) {
        if (!park.polygon && !park.latitude) continue;
        if (routePassesThroughPark(routePoints, park)) {
          parksVisitedData.push(park);
          const [existingVisit] = await db.select().from(parkVisits)
            .where(and(eq(parkVisits.parkId, park.id), eq(parkVisits.activityId, storedActivityId)));
          if (!existingVisit) {
            await db.insert(parkVisits).values({ parkId: park.id, activityId: storedActivityId, visitDate: activityDate });
          }
          if (!park.completed) {
            await storage.updatePark(park.id, { completed: true, completedDate: activityDate });
            parksCompletedData.push({ ...park, completed: true });
          }
        }
      }

      res.json({
        activity: activitySummary,
        parksCompleted: parksCompletedData,
        parksVisited: parksVisitedData,
        message: parksCompletedData.length > 0
          ? `Marked ${parksCompletedData.length} new park(s) as completed!`
          : parksVisitedData.length > 0
            ? `Visited ${parksVisitedData.length} park(s) (already completed)`
            : "No parks detected on this route",
      });
    } catch (error) {
      console.error("Error syncing latest activity:", error);
      res.status(500).json({ error: "Failed to sync latest activity" });
    }
  });

  // Update a Strava activity's title and/or description (used by the post-run Strava post page)
  app.put("/api/strava/activity/:activityId/description", authMiddleware, async (req: any, res) => {
    const userId = req.user?.claims?.sub || req.user?.id || "dev-user";
    const { activityId } = req.params;
    const { description, name } = req.body;

    if (!description && !name) {
      return res.status(400).json({ error: "description or name is required" });
    }

    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return res.status(401).json({ error: "Strava not connected" });
    }

    // Build update payload with only the fields that were provided
    const updatePayload: Record<string, string> = {};
    if (name) updatePayload.name = name;
    if (description) updatePayload.description = description;

    try {
      const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updatePayload),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Strava activity update failed:", errText);
        return res.status(response.status).json({ error: "Failed to update Strava activity" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error updating Strava activity description:", error);
      res.status(500).json({ error: "Failed to update activity" });
    }
  });

  // Sync all recent activities at once
  app.post("/api/strava/sync-all", authMiddleware, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return res.status(401).json({ error: "Strava not connected" });
    }

    try {
      // Get recent activities
      const response = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=50", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: "Failed to fetch activities" });
      }

      const activities: StravaActivity[] = await response.json();
      const runs = activities.filter(a => a.type === "Run");
      
      // Get all parks
      const allParks = await storage.getParks();
      const parksCompleted = new Set<number>();
      const parksVisited = new Set<number>();
      let activitiesProcessed = 0;
      let activitiesStored = 0;

      for (const activity of runs) {
        const polylineEncoded = activity.map?.summary_polyline;
        if (!polylineEncoded) continue;

        const routePoints = decodePolyline(polylineEncoded);
        const activityDate = new Date(activity.start_date);
        activitiesProcessed++;

        // Store the activity
        const [existingActivity] = await db.select().from(stravaActivities)
          .where(eq(stravaActivities.stravaId, String(activity.id)));
        
        let storedActivityId: number;
        if (existingActivity) {
          storedActivityId = existingActivity.id;
        } else {
          const [inserted] = await db.insert(stravaActivities).values({
            stravaId: String(activity.id),
            userId,
            name: activity.name,
            activityType: activity.type,
            startDate: activityDate,
            distance: activity.distance,
            movingTime: activity.moving_time,
            polyline: polylineEncoded,
          }).returning();
          storedActivityId = inserted.id;
          activitiesStored++;
        }

        for (const park of allParks) {
          // Skip parks without any location data
          if (!park.polygon && !park.latitude) continue;

          if (routePassesThroughPark(routePoints, park)) {
            parksVisited.add(park.id);
            
            // Check if we already have a visit record for this park+activity
            const [existingVisit] = await db.select().from(parkVisits)
              .where(and(
                eq(parkVisits.parkId, park.id),
                eq(parkVisits.activityId, storedActivityId)
              ));
            
            if (!existingVisit) {
              await db.insert(parkVisits).values({
                parkId: park.id,
                activityId: storedActivityId,
                visitDate: activityDate,
              });
            }
            
            if (!park.completed && !parksCompleted.has(park.id)) {
              await storage.updatePark(park.id, {
                completed: true,
                completedDate: activityDate,
              });
              parksCompleted.add(park.id);
            }
          }
        }
      }

      res.json({
        activitiesProcessed,
        activitiesStored,
        parksCompleted: Array.from(parksCompleted),
        parksVisited: Array.from(parksVisited),
        message: `Processed ${activitiesProcessed} runs (${activitiesStored} new), marked ${parksCompleted.size} new park(s) as completed, visited ${parksVisited.size} total parks`
      });
    } catch (error) {
      console.error("Error syncing all activities:", error);
      res.status(500).json({ error: "Failed to sync activities" });
    }
  });

  // Get stored activities with routes
  app.get("/api/strava/stored-activities", authMiddleware, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const activities = await db.select().from(stravaActivities)
        .where(eq(stravaActivities.userId, userId))
        .orderBy(stravaActivities.startDate);
      
      res.json(activities);
    } catch (error) {
      console.error("Error fetching stored activities:", error);
      res.status(500).json({ error: "Failed to fetch activities" });
    }
  });

  // List all synced runs for the current user, most recent first, with park visit counts
  app.get("/api/strava/runs", authMiddleware, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const activities = await db.select().from(stravaActivities)
        .where(eq(stravaActivities.userId, userId))
        .orderBy(desc(stravaActivities.startDate));

      // Single aggregate query — count park visits per activity in one DB round-trip
      // (avoids the N-query problem that overloads the connection pool)
      const visitCounts = await db.select({
        activityId: parkVisits.activityId,
        count: sql<number>`cast(count(*) as int)`,
      })
        .from(parkVisits)
        .where(isNotNull(parkVisits.activityId))
        .groupBy(parkVisits.activityId);

      const countMap = new Map(visitCounts.map((v) => [v.activityId, v.count]));

      const withCounts = activities.map((act) => ({
        ...act,
        parkCount: countMap.get(act.id) ?? 0,
      }));

      res.json(withCounts);
    } catch (error) {
      console.error("Error fetching runs:", error);
      res.status(500).json({ error: "Failed to fetch runs" });
    }
  });

  // Reconstruct a full run summary from stored data (for the history view)
  app.get("/api/strava/activity/:stravaId/summary", authMiddleware, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { stravaId } = req.params;

    try {
      // Find the stored activity
      const [activity] = await db.select().from(stravaActivities)
        .where(and(
          eq(stravaActivities.stravaId, stravaId),
          eq(stravaActivities.userId, userId)
        ));

      if (!activity) {
        return res.status(404).json({ error: "Activity not found" });
      }

      // Get all parks visited during this activity
      const visits = await db.select({ parkId: parkVisits.parkId })
        .from(parkVisits)
        .where(eq(parkVisits.activityId, activity.id));

      const parkIds = visits.map((v) => v.parkId);

      // Fetch full park objects
      const parksVisitedData = (
        await Promise.all(parkIds.map((id) => storage.getPark(id)))
      ).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof storage.getPark>>>[];

      // Determine which parks were first visited on this activity:
      // A park is "completed this run" if no earlier activity has a parkVisit for it.
      const parksCompletedData: typeof parksVisitedData = [];
      for (const park of parksVisitedData) {
        const [earlierVisit] = await db.select()
          .from(parkVisits)
          .where(and(
            eq(parkVisits.parkId, park.id),
            lt(parkVisits.activityId, activity.id)
          ))
          .limit(1);
        if (!earlierVisit) {
          parksCompletedData.push(park);
        }
      }

      res.json({
        activity: {
          id: Number(activity.stravaId),
          name: activity.name,
          distance: activity.distance ?? 0,
          moving_time: activity.movingTime ?? 0,
          start_date: activity.startDate.toISOString(),
          summaryPolyline: activity.polyline ?? null,
        },
        parksCompleted: parksCompletedData,
        parksVisited: parksVisitedData,
        message: `${parksVisitedData.length} park(s) on this run`,
      });
    } catch (error) {
      console.error("Error fetching run summary:", error);
      res.status(500).json({ error: "Failed to fetch run summary" });
    }
  });

  // Get visits for a specific park
  app.get("/api/parks/:id/visits", async (req: any, res) => {
    const parkId = Number(req.params.id);
    if (isNaN(parkId)) {
      return res.status(400).json({ error: "Invalid park ID" });
    }

    try {
      const visits = await db.select({
        id: parkVisits.id,
        visitDate: parkVisits.visitDate,
        activityId: parkVisits.activityId,
        activityName: stravaActivities.name,
        distance: stravaActivities.distance,
      })
        .from(parkVisits)
        .leftJoin(stravaActivities, eq(parkVisits.activityId, stravaActivities.id))
        .where(eq(parkVisits.parkId, parkId))
        .orderBy(parkVisits.visitDate);
      
      res.json(visits);
    } catch (error) {
      console.error("Error fetching park visits:", error);
      res.status(500).json({ error: "Failed to fetch visits" });
    }
  });
}

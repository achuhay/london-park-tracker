import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { stravaTokens, parks } from "@shared/schema";
import { eq } from "drizzle-orm";
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

    points.push([lat / 1e5, lng / 1e5]);
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

// Check if a polyline intersects with a polygon
function polylineIntersectsPolygon(polyline: [number, number][], polygon: [number, number][]): boolean {
  // Check if any point of the polyline is inside the polygon
  for (const point of polyline) {
    if (pointInPolygon(point, polygon)) {
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
  // First try polygon-based check if polygon exists
  const polygonCoords = extractPolygonCoords(park.polygon);
  if (polygonCoords.length >= 3) {
    return polylineIntersectsPolygon(routePoints, polygonCoords);
  }
  
  // Fall back to proximity check if we have lat/lng
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

// Extract coordinates from GeoJSON polygon (handles nested structure)
function extractPolygonCoords(polygon: any): [number, number][] {
  if (!polygon) return [];
  
  // GeoJSON polygon format: { type: "Polygon", coordinates: [[[lng, lat], ...]] }
  if (polygon.type === "Polygon" && Array.isArray(polygon.coordinates)) {
    // coordinates[0] is the outer ring, each coord is [lng, lat]
    return polygon.coordinates[0].map((coord: number[]) => [coord[1], coord[0]] as [number, number]);
  }
  
  // Simple array format: [[lat, lng], ...]
  if (Array.isArray(polygon) && polygon.length > 0) {
    if (Array.isArray(polygon[0]) && typeof polygon[0][0] === "number") {
      return polygon as [number, number][];
    }
  }
  
  return [];
}

export function registerStravaRoutes(app: Express) {
  // Check if Strava is connected for current user
  app.get("/api/strava/status", isAuthenticated, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ connected: false });

    const [token] = await db.select().from(stravaTokens).where(eq(stravaTokens.userId, userId));
    
    res.json({ 
      connected: !!token,
      configured: !!(STRAVA_CLIENT_ID && STRAVA_CLIENT_SECRET)
    });
  });

  // Start Strava OAuth flow
  app.get("/api/strava/connect", isAuthenticated, (req: any, res) => {
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

    // Use REPLIT_DEV_DOMAIN or hostname for redirect
    const host = process.env.REPLIT_DEV_DOMAIN || req.get("host");
    const protocol = host?.includes("localhost") ? "http" : "https";
    const redirectUri = `${protocol}://${host}/api/strava/callback`;
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
      return res.redirect("/admin?strava=denied");
    }

    if (!code || !state) {
      return res.redirect("/admin?strava=error");
    }

    // Validate state for CSRF protection
    const storedState = oauthStates.get(state);
    if (!storedState || storedState.expiresAt < Date.now()) {
      oauthStates.delete(state);
      return res.redirect("/admin?strava=expired");
    }
    
    const userId = storedState.userId;
    oauthStates.delete(state);

    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
      return res.redirect("/admin?strava=not_configured");
    }

    try {
      // Use same redirect URI as connect
      const host = process.env.REPLIT_DEV_DOMAIN || req.get("host");
      const protocol = host?.includes("localhost") ? "http" : "https";
      const redirectUri = `${protocol}://${host}/api/strava/callback`;

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
        return res.redirect("/admin?strava=error");
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

      res.redirect("/admin?strava=connected");
    } catch (error) {
      console.error("Strava OAuth error:", error);
      res.redirect("/admin?strava=error");
    }
  });

  // Disconnect Strava
  app.post("/api/strava/disconnect", isAuthenticated, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    await db.delete(stravaTokens).where(eq(stravaTokens.userId, userId));
    res.json({ success: true });
  });

  // Fetch recent activities from Strava
  app.get("/api/strava/activities", isAuthenticated, async (req: any, res) => {
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
  app.post("/api/strava/sync/:activityId", isAuthenticated, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    const activityId = req.params.activityId;
    
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return res.status(401).json({ error: "Strava not connected" });
    }

    try {
      // Get activity details with streams
      const activityResponse = await fetch(
        `https://www.strava.com/api/v3/activities/${activityId}?include_all_efforts=false`,
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
      
      // Get all parks
      const allParks = await storage.getParks();
      const parksCompleted: number[] = [];

      for (const park of allParks) {
        if (park.completed) continue; // Skip already completed parks
        
        // Skip parks without any location data
        if (!park.polygon && !park.latitude) continue;

        if (routePassesThroughPark(routePoints, park)) {
          // Mark park as complete
          await storage.updatePark(park.id, {
            completed: true,
            completedDate: new Date(),
          });
          parksCompleted.push(park.id);
        }
      }

      res.json({ 
        parksCompleted,
        activityName: activity.name,
        message: parksCompleted.length > 0 
          ? `Marked ${parksCompleted.length} park(s) as completed!` 
          : "No new parks were run through in this activity"
      });
    } catch (error) {
      console.error("Error syncing activity:", error);
      res.status(500).json({ error: "Failed to sync activity" });
    }
  });

  // Sync all recent activities at once
  app.post("/api/strava/sync-all", isAuthenticated, async (req: any, res) => {
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
      let activitiesProcessed = 0;

      for (const activity of runs) {
        const polylineEncoded = activity.map?.summary_polyline;
        if (!polylineEncoded) continue;

        const routePoints = decodePolyline(polylineEncoded);
        activitiesProcessed++;

        for (const park of allParks) {
          if (park.completed || parksCompleted.has(park.id)) continue;
          
          // Skip parks without any location data
          if (!park.polygon && !park.latitude) continue;

          if (routePassesThroughPark(routePoints, park)) {
            await storage.updatePark(park.id, {
              completed: true,
              completedDate: new Date(),
            });
            parksCompleted.add(park.id);
          }
        }
      }

      res.json({
        activitiesProcessed,
        parksCompleted: Array.from(parksCompleted),
        message: `Processed ${activitiesProcessed} runs, marked ${parksCompleted.size} new park(s) as completed`
      });
    } catch (error) {
      console.error("Error syncing all activities:", error);
      res.status(500).json({ error: "Failed to sync activities" });
    }
  });
}

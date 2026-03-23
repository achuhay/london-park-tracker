import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { stravaTokens, stravaActivities, parkVisits } from "@shared/schema";
import { eq, and, lt, desc, sql, isNotNull, gte, inArray } from "drizzle-orm";
import { storage } from "./storage";
import crypto from "crypto";
import { haversineDistance } from "@shared/coordinates";

// Distance threshold in meters - if a runner passes within this distance of a park center,
// the park is considered "visited"
const PARK_PROXIMITY_METERS = 100;

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
// Derive the public URL for OAuth redirects.
// Priority: APP_URL (explicit override) > request Host header (from reverse proxy)
// Note: RAILWAY_PUBLIC_DOMAIN often contains Railway's internal domain, not custom domains,
// so we don't use it — we rely on the Host header instead (requires trust proxy).
const APP_URL = process.env.APP_URL || undefined;

// State storage for CSRF protection (in production, use Redis/DB)
// No userId stored — the athlete ID from Strava becomes the userId after OAuth
const oauthStates = new Map<string, { expiresAt: number }>();

// Auth middleware: checks for a valid session (set after Strava OAuth login).
// Returns 401 if no session — the frontend shows a "Connect Strava" prompt.
const authMiddleware = (req: any, res: any, next: any) => {
  if (req.session?.userId) {
    req.user = { claims: { sub: req.session.userId } };
    next();
  } else {
    res.status(401).json({ error: "Not logged in" });
  }
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
  
  // Plain array format from DB: [[lng, lat], [lng, lat], ...] — needs swap to [lat, lng]
  if (Array.isArray(polygon) && polygon.length > 0) {
    // Check if it's a single ring [[lng, lat], ...]
    if (Array.isArray(polygon[0]) && typeof polygon[0][0] === "number") {
      // Data is stored as [lng, lat] (like GeoJSON convention), swap to [lat, lng]
      const ring = (polygon as number[][]).map(coord => [coord[1], coord[0]] as [number, number]);
      return [ring];
    }
    // Check if it's multiple rings [[[lng, lat], ...], ...]
    if (Array.isArray(polygon[0]) && Array.isArray(polygon[0][0])) {
      return (polygon as number[][][]).map(ring =>
        ring.map(coord => [coord[1], coord[0]] as [number, number])
      );
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
  // Check if Strava is connected — works without auth (needed for initial page load)
  app.get("/api/strava/status", async (req: any, res) => {
    const userId = req.session?.userId;
    console.log("[Strava] Status check — session userId:", userId, "sessionID:", req.sessionID, "cookie:", req.headers.cookie?.substring(0, 80));
    if (!userId) {
      return res.json({
        connected: false,
        configured: !!(STRAVA_CLIENT_ID && STRAVA_CLIENT_SECRET),
        athleteName: null,
      });
    }

    const [token] = await db.select().from(stravaTokens).where(eq(stravaTokens.userId, userId));

    res.json({
      connected: !!token,
      configured: !!(STRAVA_CLIENT_ID && STRAVA_CLIENT_SECRET),
      athleteName: token?.athleteName ?? req.session?.athleteName ?? null,
    });
  });

  // Debug endpoint — shows config + auto-creates missing tables/columns (remove after debugging)
  app.get("/api/strava/debug", async (req: any, res) => {
    const migrations: string[] = [];

    // Create session table if missing
    try {
      await db.execute(sql`CREATE TABLE IF NOT EXISTS session (
        sid VARCHAR NOT NULL PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      )`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire)`);
      migrations.push("session table: OK");
    } catch (e: any) {
      migrations.push("session table error: " + e?.message);
    }

    // Add athlete_name column if missing
    try {
      await db.execute(sql`ALTER TABLE strava_tokens ADD COLUMN IF NOT EXISTS athlete_name text`);
      migrations.push("athlete_name column: OK");
    } catch (e: any) {
      migrations.push("athlete_name error: " + e?.message);
    }

    // Check session table contents
    let sessionCount = 0;
    try {
      const result = await db.execute(sql`SELECT COUNT(*) as cnt FROM session`);
      sessionCount = Number((result as any).rows?.[0]?.cnt ?? (result as any)[0]?.cnt ?? 0);
    } catch (e: any) {
      migrations.push("session count error: " + e?.message);
    }

    const host = req.get("host");
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const baseUrl = APP_URL || `${protocol}://${host}`;
    const redirectUri = `${baseUrl}/api/strava/callback`;
    res.json({
      sessionCount,
      host,
      protocol,
      xForwardedProto: req.get("x-forwarded-proto"),
      xForwardedHost: req.get("x-forwarded-host"),
      APP_URL: APP_URL || "(not set)",
      RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN || "(not set)",
      computedBaseUrl: baseUrl,
      redirectUri,
      clientIdSet: !!STRAVA_CLIENT_ID,
      session: {
        userId: req.session?.userId || null,
        athleteName: req.session?.athleteName || null,
        sessionID: req.sessionID,
        hasCookie: !!req.headers.cookie,
        cookieSecure: req.session?.cookie?.secure,
        cookieSameSite: req.session?.cookie?.sameSite,
      },
      dbHost: process.env.DATABASE_URL ? process.env.DATABASE_URL.split("@")[1]?.split("/")[0] : "(not set)",
      migrations,
    });
  });

  // Start Strava OAuth flow — no auth required (Strava IS the login)
  app.get("/api/strava/connect", (req: any, res) => {
    if (!STRAVA_CLIENT_ID) {
      return res.status(500).json({ error: "Strava not configured" });
    }

    // Generate state for CSRF protection (userId comes from Strava after OAuth)
    const state = crypto.randomBytes(32).toString("hex");
    oauthStates.set(state, {
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    });

    // Build redirect URI — use APP_URL env var if set, otherwise derive from request headers
    const host = req.get("host");
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const baseUrl = APP_URL || `${protocol}://${host}`;
    const redirectUri = `${baseUrl}/api/strava/callback`;
    console.log("[Strava] Connect — host:", host, "proto:", protocol, "APP_URL:", APP_URL, "→ redirectUri:", redirectUri);
    const scope = "activity:read_all";
    
    const authUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}&approval_prompt=force`;
    
    res.redirect(authUrl);
  });

  // Strava OAuth callback - doesn't require auth, validates via state
  app.get("/api/strava/callback", async (req: any, res) => {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const error = req.query.error as string;

    // Log everything we received so we can debug
    console.log("[Strava] Callback received — query params:", JSON.stringify(req.query));
    console.log("[Strava] Callback — host:", req.get("host"), "proto:", req.get("x-forwarded-proto"), "APP_URL:", APP_URL);

    if (error) {
      console.error("Strava OAuth denied:", error);
      return res.redirect(`/?strava=denied&strava_error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      const missing = !code ? "code" : "state";
      console.error("[Strava] Missing param:", missing);
      return res.redirect(`/?strava=error&strava_error=${encodeURIComponent(`Missing ${missing} parameter`)}`);
    }

    // Validate state for CSRF protection
    const storedState = oauthStates.get(state);
    if (!storedState || storedState.expiresAt < Date.now()) {
      oauthStates.delete(state);
      console.error("[Strava] State expired or invalid");
      return res.redirect(`/?strava=expired&strava_error=${encodeURIComponent("OAuth state expired — please try again")}`);
    }
    oauthStates.delete(state);

    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
      return res.redirect("/?strava=not_configured");
    }

    try {
      // Build redirect URI — must match exactly what was sent in /connect
      const host = req.get("host");
      const protocol = req.get("x-forwarded-proto") || req.protocol;
      const baseUrl = APP_URL || `${protocol}://${host}`;
      const redirectUri = `${baseUrl}/api/strava/callback`;
      console.log("[Strava] Callback — host:", host, "proto:", protocol, "APP_URL:", APP_URL, "→ redirectUri:", redirectUri);

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
        console.error("Strava token exchange failed:", response.status, errText);
        return res.redirect(`/?strava=error&strava_error=${encodeURIComponent(`Token exchange failed (${response.status}): ${errText}`)}`);
      }

      const data: StravaTokenResponse = await response.json();

      // The Strava athlete ID IS the userId in our system
      const userId = String(data.athlete.id);
      const athleteName = `${data.athlete.firstname} ${data.athlete.lastname}`;

      // Set session so subsequent requests know who this user is
      req.session.userId = userId;
      req.session.athleteName = athleteName;

      // Upsert token (userId is unique, so use conflict handling)
      const [existing] = await db.select().from(stravaTokens).where(eq(stravaTokens.userId, userId));

      if (existing) {
        await db.update(stravaTokens)
          .set({
            athleteId: userId,
            athleteName,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: new Date(data.expires_at * 1000),
            updatedAt: new Date(),
          })
          .where(eq(stravaTokens.userId, userId));
      } else {
        await db.insert(stravaTokens).values({
          userId,
          athleteId: userId,
          athleteName,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: new Date(data.expires_at * 1000),
        });
      }

      // Wait for session to be saved to PostgreSQL before redirecting,
      // otherwise the redirect fires before the cookie is persisted
      req.session.save(async (err: any) => {
        if (err) {
          console.error("Session save error:", err);
          return res.redirect(`/?strava=error&strava_error=${encodeURIComponent(`Session save failed: ${err.message}`)}`);
        }
        console.log(`[Strava] Session saved for athlete ${userId} (${athleteName}), sessionID: ${req.sessionID}`);

        // Verify the session was actually written to the database
        try {
          const [row] = await db.execute(sql`SELECT sid, sess FROM session WHERE sid = ${req.sessionID}`);
          console.log(`[Strava] Session DB check: ${row ? 'FOUND' : 'NOT FOUND'}`);
        } catch (dbErr: any) {
          console.error("[Strava] Session DB check error:", dbErr.message);
        }

        res.redirect("/?strava=connected");
      });
    } catch (error: any) {
      console.error("Strava OAuth error:", error);
      const errMsg = error?.message || String(error);
      res.redirect(`/?strava=error&strava_error=${encodeURIComponent(`OAuth error: ${errMsg}`)}`);
    }
  });

  // Disconnect Strava
  app.post("/api/strava/disconnect", authMiddleware, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    await db.delete(stravaTokens).where(eq(stravaTokens.userId, userId));
    // Destroy session so user is fully logged out
    req.session.destroy((err: any) => {
      if (err) console.error("Session destroy error:", err);
      res.json({ success: true });
    });
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
          averagePace: (activity.distance && activity.moving_time)
            ? Math.round(activity.moving_time / (activity.distance / 1000))
            : null,
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
      // Fetch the 10 most recent activities so we catch any that were missed
      const RUN_TYPES = new Set(["Run", "TrailRun", "Walk", "Hike"]);
      const listResponse = await fetch(
        "https://www.strava.com/api/v3/athlete/activities?per_page=10&page=1",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!listResponse.ok) {
        return res.status(listResponse.status).json({ error: "Failed to fetch activities" });
      }
      const recentActivities: StravaActivity[] = await listResponse.json();
      if (!recentActivities.length) {
        return res.json({ activity: null, parksCompleted: [], parksVisited: [], message: "No activities found" });
      }

      // Filter to supported activity types with route data
      const supportedActivities = recentActivities.filter(a => RUN_TYPES.has(a.type) && a.map?.summary_polyline);
      if (!supportedActivities.length) {
        return res.json({ activity: null, parksCompleted: [], parksVisited: [], message: "No run activities found" });
      }

      // Find which of these are already stored in DB
      const existingActivities = await db.select({ stravaId: stravaActivities.stravaId, id: stravaActivities.id })
        .from(stravaActivities)
        .where(eq(stravaActivities.userId, userId));
      const existingMap = new Map(existingActivities.map(a => [a.stravaId, a.id]));

      // Also find which stored activities already have park visits (already processed)
      const activitiesWithVisits = await db.select({ activityId: parkVisits.activityId })
        .from(parkVisits).groupBy(parkVisits.activityId);
      const processedActivityIds = new Set(activitiesWithVisits.map(v => v.activityId));

      // Identify new/unprocessed activities
      const unprocessedActivities = supportedActivities.filter(a => {
        const dbId = existingMap.get(String(a.id));
        // New (not stored yet) or stored but never park-matched
        return !dbId || !processedActivityIds.has(dbId);
      });

      // Use the MOST RECENT activity for the response card (even if already processed)
      const latestActivity = supportedActivities[0];

      // Fetch full detail for the latest (for better polyline resolution)
      const activityResponse = await fetch(
        `https://www.strava.com/api/v3/activities/${latestActivity.id}?include_all_efforts=false`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      let fullLatest = latestActivity;
      if (activityResponse.ok) {
        fullLatest = await activityResponse.json();
      }

      const latestPolyline = fullLatest.map?.polyline || fullLatest.map?.summary_polyline;
      const activitySummary = {
        id: fullLatest.id,
        name: fullLatest.name,
        distance: fullLatest.distance,
        moving_time: fullLatest.moving_time,
        start_date: fullLatest.start_date,
        summaryPolyline: latestPolyline || null,
      };

      // Store and park-match ALL unprocessed activities
      const allParks = await storage.getParks();
      const allParksCompletedData: (typeof allParks[0])[] = [];
      const allParksVisitedData: (typeof allParks[0])[] = [];

      for (const activity of unprocessedActivities) {
        const polylineEncoded = activity.map?.summary_polyline;
        if (!polylineEncoded) continue;

        const routePoints = decodePolyline(polylineEncoded);
        const activityDate = new Date(activity.start_date);

        // Store activity in DB if not already there
        let storedActivityId: number;
        const existingId = existingMap.get(String(activity.id));
        if (existingId) {
          storedActivityId = existingId;
        } else {
          try {
            const [inserted] = await db.insert(stravaActivities).values({
              stravaId: String(activity.id),
              userId,
              name: activity.name,
              activityType: activity.type,
              startDate: activityDate,
              distance: activity.distance,
              movingTime: activity.moving_time,
              polyline: polylineEncoded,
              averagePace: (activity.distance && activity.moving_time)
                ? Math.round(activity.moving_time / (activity.distance / 1000))
                : null,
            }).returning();
            storedActivityId = inserted.id;
            existingMap.set(String(activity.id), inserted.id);
          } catch {
            continue; // Skip if insert fails (e.g. duplicate)
          }
        }

        // Check all parks for intersection
        for (const park of allParks) {
          if (!park.polygon && !park.latitude) continue;
          if (routePassesThroughPark(routePoints, park)) {
            allParksVisitedData.push(park);
            try {
              const [existingVisit] = await db.select().from(parkVisits)
                .where(and(eq(parkVisits.parkId, park.id), eq(parkVisits.activityId, storedActivityId)));
              if (!existingVisit) {
                await db.insert(parkVisits).values({ parkId: park.id, activityId: storedActivityId, visitDate: activityDate });
              }
            } catch { /* skip duplicate */ }
            if (!park.completed) {
              await storage.updatePark(park.id, { completed: true, completedDate: activityDate });
              allParksCompletedData.push({ ...park, completed: true });
            }
          }
        }
      }

      // If the latest activity was already processed, also fetch its full polyline for response
      if (!unprocessedActivities.some(a => a.id === latestActivity.id) && latestPolyline) {
        const routePoints = decodePolyline(latestPolyline);
        for (const park of allParks) {
          if (!park.polygon && !park.latitude) continue;
          if (routePassesThroughPark(routePoints, park)) {
            allParksVisitedData.push(park);
          }
        }
      }

      // Deduplicate parks visited/completed (same park can appear from multiple activities)
      const uniqueVisited = [...new Map(allParksVisitedData.map(p => [p.id, p])).values()];
      const uniqueCompleted = [...new Map(allParksCompletedData.map(p => [p.id, p])).values()];

      res.json({
        activity: activitySummary,
        parksCompleted: uniqueCompleted,
        parksVisited: uniqueVisited,
        message: uniqueCompleted.length > 0
          ? `Marked ${uniqueCompleted.length} new park(s) as completed!`
          : uniqueVisited.length > 0
            ? `Visited ${uniqueVisited.length} park(s) (already completed)`
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
  // Two-phase approach:
  //   Phase 1 (fast): Fetch from Strava API + bulk-store activities in DB → respond immediately
  //   Phase 2 (background): Match activities against parks → runs after response is sent
  app.post("/api/strava/sync-all", authMiddleware, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return res.status(401).json({ error: "Strava not connected" });
    }

    try {
      // ── Phase 1: Fetch all activities from Strava and store them in DB ──
      const allActivities: StravaActivity[] = [];
      const PER_PAGE = 200;
      const MAX_PAGES = 20;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const response = await fetch(
          `https://www.strava.com/api/v3/athlete/activities?per_page=${PER_PAGE}&page=${page}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!response.ok) {
          if (page === 1) return res.status(response.status).json({ error: "Failed to fetch activities" });
          break;
        }
        const pageActivities: StravaActivity[] = await response.json();
        allActivities.push(...pageActivities);
        console.log(`[Strava sync-all] Page ${page}: fetched ${pageActivities.length} activities (total: ${allActivities.length})`);
        if (pageActivities.length < PER_PAGE) break;
      }

      const RUN_TYPES = new Set(["Run", "TrailRun", "Walk", "Hike"]);
      const runs = allActivities.filter(a => RUN_TYPES.has(a.type) && a.map?.summary_polyline);

      // Get existing stored activity Strava IDs to avoid re-inserting
      const existingActivities = await db.select({
        stravaId: stravaActivities.stravaId,
        id: stravaActivities.id,
      }).from(stravaActivities).where(eq(stravaActivities.userId, userId));
      const existingMap = new Map(existingActivities.map(a => [a.stravaId, a.id]));

      // Bulk-insert new activities (fast — just DB inserts, no park matching)
      const newRuns = runs.filter(r => !existingMap.has(String(r.id)));
      let activitiesStored = 0;
      const storedActivityMap = new Map(existingMap); // stravaId → DB id

      for (const activity of newRuns) {
        const activityDate = new Date(activity.start_date);
        try {
          // Check if already exists first to avoid any constraint issues
          const [alreadyExists] = await db.select({ id: stravaActivities.id, userId: stravaActivities.userId })
            .from(stravaActivities)
            .where(eq(stravaActivities.stravaId, String(activity.id)));

          if (alreadyExists) {
            // If the activity exists but belongs to a different user (e.g. from old auth system),
            // update it to the current user so it shows up in their routes
            if (alreadyExists.userId !== userId) {
              await db.update(stravaActivities)
                .set({ userId })
                .where(eq(stravaActivities.id, alreadyExists.id));
            }
            storedActivityMap.set(String(activity.id), alreadyExists.id);
          } else {
            const [inserted] = await db.insert(stravaActivities).values({
              stravaId: String(activity.id),
              userId,
              name: activity.name,
              activityType: activity.type,
              startDate: activityDate,
              distance: activity.distance,
              movingTime: activity.moving_time,
              polyline: activity.map!.summary_polyline!,
            }).returning();
            storedActivityMap.set(String(activity.id), inserted.id);
            activitiesStored++;
          }
        } catch (insertErr) {
          console.error(`[Strava sync-all] Failed to insert activity ${activity.id}:`, insertErr);
        }
      }

      console.log(`[Strava sync-all] Phase 1 done — ${runs.length} runs found, ${activitiesStored} newly stored, ${existingMap.size} already existed`);

      // ── Respond immediately so routes appear on the frontend ──
      res.json({
        activity: null,
        activitiesProcessed: runs.length,
        activitiesStored,
        parksCompleted: [],
        parksVisited: [],
        message: `Stored ${activitiesStored} new run(s). Park matching is running in the background.`
      });

      // ── Phase 2: Match activities against parks (background, fire-and-forget) ──
      // Only process activities that don't already have parkVisit records
      (async () => {
        try {
          const allParks = await storage.getParks();
          // Get all activities that already have visits, so we skip them
          const activitiesWithVisits = await db.select({
            activityId: parkVisits.activityId,
          }).from(parkVisits).groupBy(parkVisits.activityId);
          const processedActivityIds = new Set(activitiesWithVisits.map(v => v.activityId));

          let parksNewlyCompleted = 0;
          let parksVisitedCount = 0;
          let activitiesMatched = 0;

          for (const activity of runs) {
            const dbId = storedActivityMap.get(String(activity.id));
            if (!dbId || processedActivityIds.has(dbId)) continue;

            const polylineEncoded = activity.map!.summary_polyline!;
            const routePoints = decodePolyline(polylineEncoded);
            const activityDate = new Date(activity.start_date);
            activitiesMatched++;

            for (const park of allParks) {
              if (!park.polygon && !park.latitude) continue;

              if (routePassesThroughPark(routePoints, park)) {
                parksVisitedCount++;

                // Insert visit (ignore duplicates via a check)
                try {
                  await db.insert(parkVisits).values({
                    parkId: park.id,
                    activityId: dbId,
                    visitDate: activityDate,
                  });
                } catch {
                  // Duplicate visit, skip
                }

                if (!park.completed) {
                  await storage.updatePark(park.id, {
                    completed: true,
                    completedDate: activityDate,
                  });
                  parksNewlyCompleted++;
                }
              }
            }
          }

          console.log(`[Strava sync-all] Phase 2 done — ${activitiesMatched} activities matched against parks, ${parksNewlyCompleted} parks newly completed, ${parksVisitedCount} park visits recorded`);
        } catch (error) {
          console.error("[Strava sync-all] Phase 2 error:", error);
        }
      })();
    } catch (error: any) {
      console.error("Error syncing all activities:", error);
      res.status(500).json({ error: "Failed to sync activities", detail: error?.message || String(error) });
    }
  });

  // Re-match all stored activities against parks (after fixing matching bugs)
  app.post("/api/strava/rematch-parks", authMiddleware, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const activities = await db.select().from(stravaActivities)
        .where(eq(stravaActivities.userId, userId));
      const allParks = await storage.getParks();

      // Step 1: Delete ALL existing park visits for this user's activities so we
      // start clean. This prevents duplicate rows building up each time rematch runs.
      const activityIds = activities.map(a => a.id);
      if (activityIds.length > 0) {
        const deleted = await db.delete(parkVisits)
          .where(inArray(parkVisits.activityId, activityIds));
        console.log(`[Strava rematch] Cleared existing visits for ${activityIds.length} activities`);
      }

      // Step 2: Re-run park matching with the corrected algorithm
      let totalVisits = 0;
      let parksNewlyCompleted = 0;

      for (const activity of activities) {
        if (!activity.polyline) continue;

        const routePoints = decodePolyline(activity.polyline);
        const activityDate = activity.startDate || new Date();
        // Track which parks we've already recorded for this activity (prevents duplicates
        // if the same park_id appears in allParks more than once, or if two concurrent
        // rematch calls race each other before the unique constraint fires)
        const visitedParkIds = new Set<number>();

        for (const park of allParks) {
          if (!park.polygon && !park.latitude) continue;
          if (visitedParkIds.has(park.id)) continue; // Already recorded this park

          if (routePassesThroughPark(routePoints, park)) {
            totalVisits++;
            visitedParkIds.add(park.id);
            await db.insert(parkVisits).values({
              parkId: park.id,
              activityId: activity.id,
              visitDate: activityDate,
            }).onConflictDoNothing();
          }
        }
      }

      // Derive newly completed parks from fresh visit data
      const freshVisits = await db.select({ parkId: parkVisits.parkId })
        .from(parkVisits)
        .innerJoin(stravaActivities, eq(parkVisits.activityId, stravaActivities.id))
        .where(eq(stravaActivities.userId, userId))
        .groupBy(parkVisits.parkId);
      parksNewlyCompleted = freshVisits.length;

      console.log(`[Strava rematch] Done — ${activities.length} activities, ${totalVisits} total matches, ${parksNewlyCompleted} unique parks visited`);
      res.json({ activitiesProcessed: activities.length, totalMatches: totalVisits, uniqueParksVisited: parksNewlyCompleted });
    } catch (error: any) {
      console.error("[Strava rematch] Error:", error);
      res.status(500).json({ error: error?.message || String(error) });
    }
  });

  // Diagnostic endpoint: debug park matching for a specific activity
  app.get("/api/strava/debug-activity/:activityDbId", authMiddleware, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const activityDbId = parseInt(req.params.activityDbId, 10);
    if (isNaN(activityDbId)) return res.status(400).json({ error: "Invalid activity ID" });

    try {
      const [activity] = await db.select().from(stravaActivities).where(
        and(eq(stravaActivities.id, activityDbId), eq(stravaActivities.userId, userId))
      );
      if (!activity) return res.status(404).json({ error: "Activity not found" });

      const hasPolyline = !!activity.polyline;
      const polylineLength = activity.polyline?.length || 0;

      if (!hasPolyline) {
        return res.json({
          activity: { id: activity.id, name: activity.name, startDate: activity.startDate, distance: activity.distance },
          hasPolyline: false,
          message: "No polyline stored for this activity",
        });
      }

      const routePoints = decodePolyline(activity.polyline!);
      const allParks = await storage.getParks();

      // Find existing visits for this activity
      const existingVisits = await db.select({ parkId: parkVisits.parkId })
        .from(parkVisits).where(eq(parkVisits.activityId, activityDbId));
      const visitedParkIds = new Set(existingVisits.map(v => v.parkId));

      const matchedParks: any[] = [];
      let parksWithPolygon = 0;
      let parksWithLatLngOnly = 0;
      let parksSkipped = 0;

      // Debug: sample a park in the route area to check polygon format
      const samplePark = allParks.find(p =>
        p.polygon && p.latitude &&
        p.latitude >= 51.53 && p.latitude <= 51.56
      );
      const samplePolygonDebug = samplePark ? {
        parkName: samplePark.name,
        polygonType: typeof samplePark.polygon,
        isArray: Array.isArray(samplePark.polygon),
        hasTypeField: !!(samplePark.polygon as any)?.type,
        typeFieldValue: (samplePark.polygon as any)?.type,
        firstEntry: Array.isArray(samplePark.polygon) ? (samplePark.polygon as any)[0] : null,
        extractedRingsCount: extractPolygonRings(samplePark.polygon).length,
        extractedFirstRingLength: extractPolygonRings(samplePark.polygon)[0]?.length,
        extractedFirstPoint: extractPolygonRings(samplePark.polygon)[0]?.[0],
      } : null;

      for (const park of allParks) {
        if (!park.polygon && !park.latitude) { parksSkipped++; continue; }
        if (park.polygon) parksWithPolygon++;
        else parksWithLatLngOnly++;

        if (routePassesThroughPark(routePoints, park)) {
          matchedParks.push({
            id: park.id,
            name: park.name,
            borough: park.borough,
            hasPolygon: !!park.polygon,
            completed: park.completed,
            alreadyVisited: visitedParkIds.has(park.id),
          });
        }
      }

      // Bounding box of the route
      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      for (const [lat, lng] of routePoints) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }

      res.json({
        activity: {
          id: activity.id,
          stravaId: activity.stravaId,
          name: activity.name,
          startDate: activity.startDate,
          distance: activity.distance,
          type: activity.activityType,
        },
        hasPolyline: true,
        polylineLength,
        routePointCount: routePoints.length,
        routeBounds: { minLat, maxLat, minLng, maxLng },
        samplePolygonDebug,
        parkStats: { total: allParks.length, withPolygon: parksWithPolygon, withLatLngOnly: parksWithLatLngOnly, skipped: parksSkipped },
        matchedParks,
        existingVisitCount: existingVisits.length,
      });
    } catch (error: any) {
      console.error("Debug activity error:", error);
      res.status(500).json({ error: error?.message || String(error) });
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

  // Annual 500-parks challenge stats: total visits this year + weekly cumulative breakdown
  // Works without auth — returns empty data for unauthenticated users
  app.get("/api/stats/year-challenge", async (req: any, res) => {
    const userId = req.session?.userId;
    if (!userId) {
      const year = new Date().getFullYear();
      return res.json({ totalVisits: 0, weekly: [], year, target: 500 });
    }

    try {
      const year = new Date().getFullYear();
      const yearStart = new Date(`${year}-01-01`);

      // Unique parks visited this year — grouped by parkId so revisits don't inflate the count.
      // firstVisitDate is the earliest visit in the year, used to slot the park into the
      // correct week on the progress chart.
      const visits = await db
        .select({
          parkId: parkVisits.parkId,
          firstVisitDate: sql<string>`min(${parkVisits.visitDate})`,
        })
        .from(parkVisits)
        .innerJoin(stravaActivities, eq(parkVisits.activityId, stravaActivities.id))
        .where(and(
          eq(stravaActivities.userId, userId),
          gte(parkVisits.visitDate, yearStart)
        ))
        .groupBy(parkVisits.parkId);

      // Also include parks completed this year via the global flag (legacy data)
      // but exclude any already counted via parkVisits to avoid double-counting
      const { parks: parksTable } = await import("@shared/schema");
      const globalCompletions = await db.select({
        id: parksTable.id,
        completedDate: parksTable.completedDate,
      })
        .from(parksTable)
        .where(and(
          eq(parksTable.completed, true),
          isNotNull(parksTable.completedDate),
          gte(parksTable.completedDate, yearStart)
        ));

      const visitParkIds = new Set(visits.map(v => v.parkId));

      // Merge: first-visit dates for unique parks + global completedDates not already in parkVisits
      const allVisitDates: Date[] = visits.map(v => new Date(v.firstVisitDate));
      for (const g of globalCompletions) {
        if (!visitParkIds.has(g.id) && g.completedDate) {
          allVisitDates.push(new Date(g.completedDate));
        }
      }

      // Helper: week-of-year (1-indexed, Jan 1 = week 1)
      function weekOfYear(d: Date): number {
        const start = new Date(d.getFullYear(), 0, 1);
        return Math.ceil(((d.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
      }

      // Group into weekly buckets
      const weekMap = new Map<number, number>();
      for (const d of allVisitDates) {
        const w = weekOfYear(d);
        weekMap.set(w, (weekMap.get(w) ?? 0) + 1);
      }

      // Build cumulative weekly array up to the current week
      const currentWeek = weekOfYear(new Date());
      const weekly: { week: number; visits: number }[] = [];
      let cumulative = 0;
      for (let w = 1; w <= currentWeek; w++) {
        cumulative += weekMap.get(w) ?? 0;
        weekly.push({ week: w, visits: cumulative });
      }

      res.json({ totalVisits: allVisitDates.length, weekly, year, target: 500 });
    } catch (error) {
      console.error("Error fetching year challenge stats:", error);
      res.status(500).json({ error: "Failed to fetch challenge stats" });
    }
  });
}

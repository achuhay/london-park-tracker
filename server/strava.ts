import type { Express } from "express";
import { db } from "./db";
import { stravaTokens, parks } from "@shared/schema";
import { eq } from "drizzle-orm";
import { isAuthenticated } from "./replit_integrations/auth";
import { storage } from "./storage";

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_REDIRECT_URI = process.env.STRAVA_REDIRECT_URI || "/api/strava/callback";

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
    return null;
  }
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

    const redirectUri = `https://${req.hostname}/api/strava/callback`;
    const scope = "activity:read_all";
    
    const authUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&approval_prompt=force`;
    
    res.redirect(authUrl);
  });

  // Strava OAuth callback
  app.get("/api/strava/callback", isAuthenticated, async (req: any, res) => {
    const code = req.query.code as string;
    const userId = req.user?.claims?.sub;

    if (!code || !userId) {
      return res.redirect("/admin?strava=error");
    }

    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
      return res.redirect("/admin?strava=not_configured");
    }

    try {
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
        console.error("Strava token exchange failed");
        return res.redirect("/admin?strava=error");
      }

      const data: StravaTokenResponse = await response.json();

      // Upsert token
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
        
        const polygon = park.polygon as unknown as [number, number][];
        if (!Array.isArray(polygon) || polygon.length < 3) continue;

        if (polylineIntersectsPolygon(routePoints, polygon)) {
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
          
          const polygon = park.polygon as unknown as [number, number][];
          if (!Array.isArray(polygon) || polygon.length < 3) continue;

          if (polylineIntersectsPolygon(routePoints, polygon)) {
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

import type { Express } from "express";
import { stravaRuns, parkVisits, parkWishlist } from "../shared/schema";

// In-memory token storage (for single user)
// In production/multi-user, store in database
let stravaTokens: {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
} | null = null;

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_REDIRECT_URI = process.env.STRAVA_REDIRECT_URI || "http://127.0.0.1:5000/api/strava/callback";

export function registerStravaRoutes(app: Express) {
  // Step 1: Redirect user to Strava for authorization
  app.get("/api/strava/connect", (req, res) => {
    const authUrl = `https://www.strava.com/oauth/authorize?` +
      `client_id=${STRAVA_CLIENT_ID}&` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent(STRAVA_REDIRECT_URI)}&` +
      `scope=activity:read_all&` +
      `approval_prompt=auto`;
    
    res.redirect(authUrl);
  });

  // Step 2: Handle OAuth callback from Strava
  app.get("/api/strava/callback", async (req, res) => {
    const { code, error } = req.query;

    if (error) {
      return res.redirect("/?strava_error=" + error);
    }

    if (!code) {
      return res.status(400).json({ error: "No authorization code received" });
    }

    try {
      // Exchange code for tokens
      const tokenResponse = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: STRAVA_CLIENT_ID,
          client_secret: STRAVA_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
        }),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        throw new Error(tokenData.message || "Failed to get tokens");
      }

      // Store tokens
      stravaTokens = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: tokenData.expires_at * 1000, // Convert to milliseconds
      };

      // Redirect back to app with success
      res.redirect("/?strava_connected=true");
    } catch (error) {
      console.error("Strava OAuth error:", error);
      res.redirect("/?strava_error=token_exchange_failed");
    }
  });

  // Check if user is connected to Strava
  app.get("/api/strava/status", (req, res) => {
    res.json({
      connected: !!stravaTokens,
      expiresAt: stravaTokens?.expiresAt,
    });
  });

  // Disconnect from Strava
  app.post("/api/strava/disconnect", (req, res) => {
    stravaTokens = null;
    res.json({ success: true });
  });

  // Helper function to get valid access token (refresh if needed)
  async function getValidAccessToken(): Promise<string> {
    if (!stravaTokens) {
      throw new Error("Not connected to Strava");
    }

    // Check if token is expired or about to expire (within 5 minutes)
    const now = Date.now();
    const expiresIn = stravaTokens.expiresAt - now;

    if (expiresIn < 5 * 60 * 1000) {
      // Refresh the token
      const refreshResponse = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: STRAVA_CLIENT_ID,
          client_secret: STRAVA_CLIENT_SECRET,
          grant_type: "refresh_token",
          refresh_token: stravaTokens.refreshToken,
        }),
      });

      const refreshData = await refreshResponse.json();

      if (!refreshResponse.ok) {
        throw new Error("Failed to refresh token");
      }

      stravaTokens = {
        accessToken: refreshData.access_token,
        refreshToken: refreshData.refresh_token,
        expiresAt: refreshData.expires_at * 1000,
      };
    }

    return stravaTokens.accessToken;
  }

  // Fetch activities from Strava (2026 only)
  app.get("/api/strava/activities", async (req, res) => {
    try {
      const accessToken = await getValidAccessToken();

      // Get activities from Jan 1, 2026 onwards
      const after = Math.floor(new Date("2026-01-01").getTime() / 1000);
      
      const response = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=200`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      const activities = await response.json();

      if (!response.ok) {
        throw new Error(activities.message || "Failed to fetch activities");
      }

      // Filter to only runs
      const runs = activities.filter((a: any) => a.type === "Run");

      res.json(runs);
    } catch (error) {
      console.error("Error fetching Strava activities:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to fetch activities" 
      });
    }
  });

  // Download GPX for a specific activity
  app.get("/api/strava/activity/:id/gpx", async (req, res) => {
    try {
      const accessToken = await getValidAccessToken();
      const activityId = req.params.id;

      const response = await fetch(
        `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=latlng&key_by_type=true`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      const streams = await response.json();

      if (!response.ok) {
        throw new Error(streams.message || "Failed to fetch activity stream");
      }

      // Convert Strava stream to simple coordinate array
      const coordinates = streams.latlng?.data || [];

      res.json({ coordinates });
    } catch (error) {
      console.error("Error fetching activity stream:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to fetch activity data" 
      });
    }
  });
}

// Export for use in other files
export { getValidAccessToken };

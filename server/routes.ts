import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { registerStravaRoutes, routePassesThroughPark } from "./strava";
import Anthropic from "@anthropic-ai/sdk";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Auth Setup - only runs when ENABLE_REPLIT_AUTH=true is explicitly set.
  // This must be manually set on Replit deployments only.
  // Dynamic import prevents openid-client (ESM-only) from being loaded in CJS bundle.
  if (process.env.ENABLE_REPLIT_AUTH === 'true') {
    const { setupAuth, registerAuthRoutes } = await import("./replit_integrations/auth");
    await setupAuth(app);
    registerAuthRoutes(app);
  }
  
  // Strava Integration
  registerStravaRoutes(app);

  // === Park Routes ===

  app.get(api.parks.list.path, async (req: any, res) => {
    try {
      const input = api.parks.list.input?.parse(req.query);
      // Per-user: derive completion from their Strava synced activities
      if (req.session?.userId) {
        const parks = await storage.getParksForUser(req.session.userId, input);
        return res.json(parks);
      }
      // Not logged in: return all parks with completed=false
      const parks = await storage.getParks(input);
      res.json(parks.map(p => ({ ...p, completed: false, completedDate: null })));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid query parameters" });
      }
      throw err;
    }
  });

  app.get(api.parks.stats.path, async (req: any, res) => {
    // Per-user stats when logged in
    if (req.session?.userId) {
      const stats = await storage.getStatsForUser(req.session.userId, req.query as any);
      return res.json(stats);
    }
    // Not logged in: return global stats with 0 completed
    const stats = await storage.getParkStats(req.query as any);
    res.json({ ...stats, completed: 0, percentage: 0 });
  });

  // Borough achievement tiers for the logged-in user
  // Returns an array of BoroughAchievement objects — one per borough.
  // Returns 401 if not logged in (achievements are per-user).
  app.get("/api/stats/borough-achievements", async (req: any, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Login required" });
    }
    try {
      const achievements = await storage.getBoroughAchievementsForUser(req.session.userId);
      res.setHeader("Cache-Control", "private, max-age=60");
      res.json(achievements);
    } catch (err) {
      console.error("Error fetching borough achievements:", err);
      res.status(500).json({ error: "Failed to fetch borough achievements" });
    }
  });

  // Full gamification data for the logged-in user
  app.get("/api/gamification", async (req: any, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Login required" });
    }
    try {
      const data = await storage.getGamificationForUser(req.session.userId);
      res.setHeader("Cache-Control", "private, max-age=30");
      res.json(data);
    } catch (err) {
      console.error("Error fetching gamification data:", err);
      res.status(500).json({ error: "Failed to fetch gamification data" });
    }
  });

  app.get(api.parks.filterOptions.path, async (req, res) => {
    const options = await storage.getFilterOptions();
    res.json(options);
  });

  // Get ambiguous parks for review (must be before :id route)
  app.get("/api/parks/ambiguous", async (req, res) => {
    try {
      const parks = await storage.getAmbiguousParks();
      res.json(parks);
    } catch (err) {
      console.error("Error fetching ambiguous parks:", err);
      res.status(500).json({ message: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  app.get(api.parks.get.path, async (req, res) => {
    const park = await storage.getPark(Number(req.params.id));
    if (!park) {
      return res.status(404).json({ message: 'Park not found' });
    }
    res.json(park);
  });

  // Protected Routes - Authentication disabled for local development
  
  app.post(api.parks.create.path, async (req, res) => {
    try {
      const input = api.parks.create.input.parse(req.body);
      const park = await storage.createPark(input);
      res.status(201).json(park);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.put(api.parks.update.path, async (req, res) => {
    try {
      const input = api.parks.update.input.parse(req.body);
      const park = await storage.updatePark(Number(req.params.id), input);
      if (!park) {
        return res.status(404).json({ message: 'Park not found' });
      }
      res.json(park);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.delete(api.parks.delete.path, async (req, res) => {
    const park = await storage.getPark(Number(req.params.id));
    if (!park) {
      return res.status(404).json({ message: 'Park not found' });
    }
    await storage.deletePark(Number(req.params.id));
    res.status(204).send();
  });

  app.patch(api.parks.toggleComplete.path, async (req: any, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Connect Strava to track park completions" });
    }

    const id = Number(req.params.id);
    const { completed } = req.body;

    const park = await storage.getPark(id);
    if (!park) {
      return res.status(404).json({ message: 'Park not found' });
    }

    // Per-user: toggle by inserting/removing a parkVisit row
    if (completed) {
      // Find or create a "manual" activity for this user so we can link the visit
      const { db } = await import("./db");
      const { parkVisits, stravaActivities } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      // Check if visit already exists
      const existingVisits = await db.select().from(parkVisits)
        .innerJoin(stravaActivities, eq(parkVisits.activityId, stravaActivities.id))
        .where(and(eq(parkVisits.parkId, id), eq(stravaActivities.userId, req.session.userId)));

      if (existingVisits.length === 0) {
        // Create a manual activity placeholder
        const [activity] = await db.insert(stravaActivities).values({
          stravaId: `manual-${req.session.userId}-${Date.now()}`,
          userId: req.session.userId,
          name: "Manual completion",
          activityType: "Run",
          startDate: new Date(),
          distance: 0,
          movingTime: 0,
        }).returning();

        await db.insert(parkVisits).values({
          parkId: id,
          activityId: activity.id,
          visitDate: new Date(),
        });
      }
    } else {
      // Remove all visits for this user to this park
      const { db } = await import("./db");
      const { parkVisits, stravaActivities } = await import("@shared/schema");
      const { eq, and, inArray } = await import("drizzle-orm");

      const userActivityIds = await db.select({ id: stravaActivities.id })
        .from(stravaActivities)
        .where(eq(stravaActivities.userId, req.session.userId));

      if (userActivityIds.length > 0) {
        await db.delete(parkVisits).where(
          and(
            eq(parkVisits.parkId, id),
            inArray(parkVisits.activityId, userActivityIds.map(a => a.id))
          )
        );
      }
    }

    // Return the park with updated per-user completion status
    const updatedParks = await storage.getParksForUser(req.session.userId);
    const updatedPark = updatedParks.find(p => p.id === id);
    res.json(updatedPark || park);
  });

  // Confirm polygon selection for a park
  app.post("/api/parks/:id/confirm-polygon", async (req, res) => {
    const id = Number(req.params.id);
    const { polygonIndex, noMatch } = req.body;
    
    const park = await storage.getPark(id);
    if (!park) {
      return res.status(404).json({ message: 'Park not found' });
    }

    if (noMatch) {
      // Mark as no match - remove polygon data
      await storage.updatePark(id, {
        polygon: null,
        osmMatchStatus: 'no_match',
        alternativePolygons: null,
      } as any);
      return res.json({ success: true });
    }

    const alternatives = park.alternativePolygons as any[] || [];
    
    if (polygonIndex === 0) {
      // Keep current polygon, just confirm it
      await storage.updatePark(id, {
        osmMatchStatus: 'matched',
        alternativePolygons: null,
      } as any);
    } else if (polygonIndex > 0 && polygonIndex <= alternatives.length) {
      // Select alternative polygon
      const selected = alternatives[polygonIndex - 1];
      await storage.updatePark(id, {
        polygon: selected.polygon,
        osmId: selected.osmId,
        osmMatchScore: selected.nameScore,
        osmMatchStatus: 'matched',
        alternativePolygons: null,
      } as any);
    }
    
    res.json({ success: true });
  });

  // Refresh a park's polygon from OpenStreetMap (Overpass API)
  // POST /api/admin/parks/:id/polygon-from-osm
  // Queries OSM for the park's boundary by name + centroid, then saves the best match
  app.post("/api/admin/parks/:id/polygon-from-osm", async (req, res) => {
    const id = Number(req.params.id);
    const park = await storage.getPark(id);
    if (!park) return res.status(404).json({ error: "Park not found" });

    const lat = park.latitude ? Number(park.latitude) : null;
    const lng = park.longitude ? Number(park.longitude) : null;
    if (lat === null || lng === null) {
      return res.status(400).json({ error: "Park has no centroid coordinates" });
    }

    // Search radius in metres — wide enough to catch offset centroids
    const radiusMetres = 800;

    // Overpass QL query: find ways and relations named like this park near its centroid
    // We escape the name to avoid injection into the Overpass query string
    const safeName = park.name.replace(/["\\\n]/g, " ").trim();
    const overpassQuery = `
[out:json][timeout:25];
(
  way["leisure"="park"]["name"~"${safeName}",i](around:${radiusMetres},${lat},${lng});
  relation["leisure"="park"]["name"~"${safeName}",i](around:${radiusMetres},${lat},${lng});
  way["leisure"="nature_reserve"]["name"~"${safeName}",i](around:${radiusMetres},${lat},${lng});
  relation["leisure"="nature_reserve"]["name"~"${safeName}",i](around:${radiusMetres},${lat},${lng});
  way["landuse"="recreation_ground"]["name"~"${safeName}",i](around:${radiusMetres},${lat},${lng});
  relation["landuse"="recreation_ground"]["name"~"${safeName}",i](around:${radiusMetres},${lat},${lng});
  way["leisure"="common"]["name"~"${safeName}",i](around:${radiusMetres},${lat},${lng});
  relation["leisure"="common"]["name"~"${safeName}",i](around:${radiusMetres},${lat},${lng});
);
out geom;
    `.trim();

    let osmData: any;
    try {
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(overpassQuery)}`,
      });
      if (!response.ok) {
        throw new Error(`Overpass API returned ${response.status}`);
      }
      osmData = await response.json();
    } catch (err: any) {
      console.error("[OSM polygon] Overpass fetch failed:", err.message);
      return res.status(502).json({ error: "Could not reach Overpass API", detail: err.message });
    }

    const elements: any[] = osmData.elements || [];
    if (elements.length === 0) {
      return res.status(404).json({ error: "No OSM features found near this park", name: park.name });
    }

    // Helper: extract a polygon ring from an OSM element's geometry
    // OSM gives us nodes as {lat, lng}; our DB stores [lng, lat] pairs
    function geometryToRing(geom: { lat: number; lon: number }[]): [number, number][] | null {
      if (!geom || geom.length < 3) return null;
      const ring: [number, number][] = geom.map((n) => [n.lon, n.lat]);
      // Close the ring if needed
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
        ring.push(ring[0]);
      }
      return ring;
    }

    // Score function: exact name match scores highest, partial matches score lower
    function nameScore(osmName: string, target: string): number {
      const a = osmName.toLowerCase().trim();
      const b = target.toLowerCase().trim();
      if (a === b) return 1.0;
      if (a.includes(b) || b.includes(a)) return 0.7;
      return 0.3;
    }

    // Process each element into a candidate polygon
    const candidates: { polygon: [number, number][][]; osmId: string; score: number; name: string }[] = [];

    for (const el of elements) {
      const elName = el.tags?.name || "";
      const score = nameScore(elName, park.name);

      if (el.type === "way" && el.geometry) {
        const ring = geometryToRing(el.geometry);
        if (ring) {
          candidates.push({ polygon: [ring], osmId: `way/${el.id}`, score, name: elName });
        }
      } else if (el.type === "relation") {
        // Relations can be multipolygons; each member with role "outer" is one ring
        const outerMembers = (el.members || []).filter((m: any) => m.role === "outer" && m.geometry);
        const rings: [number, number][][] = [];
        for (const member of outerMembers) {
          const ring = geometryToRing(member.geometry);
          if (ring) rings.push(ring);
        }
        if (rings.length > 0) {
          candidates.push({ polygon: rings, osmId: `relation/${el.id}`, score, name: elName });
        }
      }
    }

    if (candidates.length === 0) {
      return res.status(404).json({ error: "OSM features found but none had usable geometry", name: park.name });
    }

    // Pick the best candidate (highest name score, then most rings = most complete)
    candidates.sort((a, b) => b.score - a.score || b.polygon.length - a.polygon.length);
    const best = candidates[0];

    // Save to DB — polygon column stores the outer ring array (same format as existing data)
    await storage.updatePark(id, {
      polygon: best.polygon,
      osmId: best.osmId,
      osmMatchScore: best.score,
      osmMatchStatus: "matched",
    } as any);

    console.log(`[OSM polygon] Updated park ${id} (${park.name}) from ${best.osmId} — ${best.polygon.length} ring(s), score ${best.score}`);

    res.json({
      success: true,
      parkId: id,
      parkName: park.name,
      osmId: best.osmId,
      rings: best.polygon.length,
      score: best.score,
      osmName: best.name,
      pointsInFirstRing: best.polygon[0]?.length ?? 0,
      allCandidates: candidates.map((c) => ({ osmId: c.osmId, name: c.name, score: c.score, rings: c.polygon.length })),
    });
  });

  // Import AI verification results
  app.post("/api/import-ai-results", async (req, res) => {
    try {
      const results = req.body;
      console.log(`📥 Importing ${results.length} AI verification results...`);

      let updated = 0;
      let skipped = 0;

      for (const result of results) {
        // Map recommendation to osmMatchStatus
        let status = "ambiguous";
        if (result.recommendation === "confirm") status = "verified";
        if (result.recommendation === "alternative_found") status = "verified_alternative";
        if (result.recommendation === "reject") status = "rejected";
        if (result.recommendation === "manual_review") status = "manual_review";

        // Check if already verified
        const existing = await storage.getPark(result.parkId);
        if (existing && existing.osmMatchStatus === "verified") {
          skipped++;
          continue;
        }

        // Update the park
        await storage.updatePark(result.parkId, {
          osmMatchStatus: status,
          adminNotes: result.reasoning,
        } as any);

        updated++;

        if (updated % 100 === 0) {
          console.log(`  Processed ${updated}/${results.length}...`);
        }
      }

      console.log(`✅ Import complete: ${updated} updated, ${skipped} skipped`);
      res.json({ success: true, updated, skipped });
    } catch (error) {
      console.error("Import error:", error);
      res.status(500).json({ error: "Import failed" });
    }
  });

  // Generate AI fun facts + 3 Strava caption variations + 3 title suggestions
  // Used by the post-run summary modal (Share page)
  app.post("/api/parks/fun-facts", async (req, res) => {
    try {
      const { parkIds, activityData } = req.body;
      if (!Array.isArray(parkIds) || parkIds.length === 0) {
        return res.status(400).json({ error: "parkIds array required" });
      }

      // Fetch park details (cap at 10 to keep AI prompt manageable)
      const parkDetails = await Promise.all(
        parkIds.slice(0, 10).map((id: number) => storage.getPark(Number(id)))
      );
      const validParks = parkDetails.filter(Boolean) as Awaited<ReturnType<typeof storage.getPark>>[];

      if (validParks.length === 0) {
        return res.json({ facts: [], captions: [], titles: [] });
      }

      const client = new Anthropic();
      const parkDescriptions = validParks.map(p => {
        const parts = [`ID: ${p!.id}\nName: ${p!.name}\nBorough: ${p!.borough}\nType: ${p!.siteType}`];
        if (p!.gardensTrustInfo) parts.push(`Gardens Trust info: ${p!.gardensTrustInfo}`);
        if (p!.address) parts.push(`Address: ${p!.address}`);
        return parts.join('\n');
      }).join('\n\n');

      // Detect milestone (10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500)
      const MILESTONES = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500];
      const totalVisited = activityData?.totalParksVisited ?? 0;
      const milestone = MILESTONES.find(m => totalVisited >= m && (totalVisited - (activityData?.newParksCount ?? 0)) < m);

      const runContext = activityData
        ? [
            `Activity: "${activityData.name}"`,
            `Distance: ${(activityData.distance / 1000).toFixed(1)} km`,
            `Duration: ${Math.floor(activityData.moving_time / 60)} min`,
            `New parks this run: ${activityData.newParksCount}`,
            `Total parks ever visited: ${activityData.totalParksVisited}`,
            milestone ? `🎉 Milestone reached: ${milestone} parks total!` : "",
          ].filter(Boolean).join("\n")
        : "";

      const boroughs = [...new Set(validParks.map(p => p!.borough))].join(", ");

      const message = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1400,
        messages: [{
          role: "user",
          content: `You are a London runner who tracks green spaces at challenge.detour.food.
${runContext ? `\nRun context:\n${runContext}` : ""}
Boroughs: ${boroughs}

Parks visited:
${parkDescriptions}

Produce two clearly separated sections — FACTS_JSON then CAPTIONS_JSON.

FACTS_JSON:
{"facts":[{"parkId":<id>,"parkName":"<name>","facts":["interesting fact 1","interesting fact 2"]}]}

CAPTIONS_JSON:
{"captions":["caption 1","caption 2","caption 3"],"titles":["title 1","title 2","title 3"]}

Caption rules (write all 3):
- Caption 1: milestone or number angle — e.g. "That's my 47th London park ticked off" or celebrate a round number if there's a milestone
- Caption 2: focus on the specific parks/boroughs visited today
- Caption 3: a quirky or unexpected observation about one of the parks or the run

All captions must:
- Be 2–3 sentences, first person, casual — like a real runner posting, not a press release
- NOT start with "Just" or "Amazing"
- NOT use hashtags
- At least one caption must naturally include the URL challenge.detour.food

Title rules (write all 3, keep under 60 chars each):
- Title 1: "Green Loop: N parks in [borough]" style
- Title 2: feature the most interesting park name
- Title 3: milestone title if relevant, otherwise a personal challenge angle

Format rules:
- FACTS_JSON must be valid JSON only
- CAPTIONS_JSON must be valid JSON only
- No extra text outside the two sections`,
        }],
      });

      const content = message.content[0];
      if (content.type !== "text") {
        return res.status(500).json({ error: "Unexpected AI response format" });
      }

      const raw = content.text;
      const factsMatch = raw.match(/FACTS_JSON:\s*(\{[\s\S]*?\})\s*(?:CAPTIONS_JSON:|$)/);
      const captionsMatch = raw.match(/CAPTIONS_JSON:\s*(\{[\s\S]*?\})\s*$/);

      let facts: unknown[] = [];
      if (factsMatch) {
        try { facts = JSON.parse(factsMatch[1]).facts || []; } catch (e) {
          console.error("Failed to parse facts JSON:", e);
        }
      }

      let captions: string[] = [];
      let titles: string[] = [];
      if (captionsMatch) {
        try {
          const parsed = JSON.parse(captionsMatch[1]);
          captions = parsed.captions || [];
          titles = parsed.titles || [];
        } catch (e) {
          console.error("Failed to parse captions JSON:", e);
        }
      }

      // Legacy field: keep stravaPost = first caption for backwards compat
      res.json({ facts, captions, titles, stravaPost: captions[0] ?? "" });
    } catch (error) {
      console.error("Error generating fun facts:", error);
      res.status(500).json({ error: "Failed to generate fun facts" });
    }
  });

  // Marathon training coach chat
  app.post("/api/marathon/chat", async (req, res) => {
    try {
      const { question, context } = req.body;
      if (!question || typeof question !== "string") {
        return res.status(400).json({ error: "question is required" });
      }

      const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

      let prompt = `You are a personal marathon running coach with deep knowledge of training science. Answer in 3–5 sentences. Be specific and direct. Reference the runner's actual numbers when relevant. Plain text only — no markdown, no bullet points, no asterisks.

Runner's training data (today: ${today}):
- Last 4 weeks: ${context.total4wk} km total (avg ${(context.total4wk / 4).toFixed(1)} km/week)
- 8-week average: ${context.avg8wk} km/week
- Longest run ever: ${context.longestEver} km
- Recent long run (last 4 weeks): ${context.currentLongRun} km`;

      if (context.last4Weeks?.length) {
        prompt += `\n- Last 4 weekly totals: ${context.last4Weeks.join(", ")} km`;
      }

      if (context.goal) {
        const { raceDate, goalHours, goalMinutes, weeksLeft, targetLongRun, racePaceSec } = context.goal;
        const paceMin = Math.floor(racePaceSec / 60);
        const paceSec = Math.round(racePaceSec % 60);
        const paceStr = `${paceMin}:${String(paceSec).padStart(2, "0")} /km`;
        prompt += `\n- Target race: ${new Date(raceDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} (${weeksLeft} weeks away)`;
        prompt += `\n- Goal finish time: ${goalHours}h ${String(goalMinutes).padStart(2, "0")}m (${paceStr} pace)`;
        prompt += `\n- Long run: ${context.currentLongRun} km vs ${targetLongRun} km target`;
      }

      prompt += `\n\nQuestion: ${question}`;

      const client = new Anthropic();
      const message = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      });

      const content = message.content[0];
      if (content.type !== "text") {
        return res.status(500).json({ error: "Unexpected AI response format" });
      }

      res.json({ answer: content.text });
    } catch (error) {
      console.error("Error in marathon chat:", error);
      res.status(500).json({ error: "Failed to get coaching response" });
    }
  });

  // Komoot Route Preview — check which parks a GPX-derived route passes through
  app.post("/api/route-preview", async (req, res) => {
    try {
      const { coordinates } = req.body;
      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        return res.status(400).json({ message: "At least 2 coordinates required" });
      }

      const routePoints: [number, number][] = coordinates.map((c: any) => [
        Number(c[0]),
        Number(c[1]),
      ]);

      const allParks = await storage.getParks({});
      const matchedParks = allParks.filter((park) =>
        routePassesThroughPark(routePoints, park)
      );

      res.json({
        matchedParks: matchedParks.map((p) => ({
          id: p.id,
          name: p.name,
          borough: p.borough,
          siteType: p.siteType,
        })),
        totalChecked: allParks.length,
      });
    } catch (err) {
      console.error("[route-preview]", err);
      res.status(500).json({ message: "Failed to check route" });
    }
  });

  // Seed Data
  // await seedDatabase();

  return httpServer;
}

async function seedDatabase() {
  const existing = await storage.getParks();
  if (existing.length === 0) {
    console.log("Seeding database with example parks...");
    
    const exampleParks = [
      {
        name: "Hyde Park",
        borough: "Westminster",
        siteType: "Park",
        openToPublic: "Yes",
        completed: false,
        // Simplified rectangle for Hyde Park roughly
        polygon: [
          [51.511, -0.175],
          [51.511, -0.155],
          [51.503, -0.155],
          [51.503, -0.175]
        ]
      },
      {
        name: "Regent's Park",
        borough: "Camden",
        siteType: "Park",
        openToPublic: "Yes",
        completed: true,
        completedDate: new Date(),
        // Simplified polygon
        polygon: [
          [51.536, -0.166],
          [51.536, -0.146],
          [51.526, -0.146],
          [51.526, -0.166]
        ]
      },
      {
        name: "Greenwich Park",
        borough: "Greenwich",
        siteType: "Park",
        openToPublic: "Yes",
        completed: false,
        polygon: [
          [51.480, -0.005],
          [51.480, 0.010],
          [51.472, 0.010],
          [51.472, -0.005]
        ]
      }
    ];

    for (const p of exampleParks) {
      await storage.createPark(p as any);
    }
    console.log("Seeding complete.");
  }
}
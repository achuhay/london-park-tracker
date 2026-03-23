import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { registerStravaRoutes } from "./strava";
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

  // Generate AI fun facts + Strava post about a list of parks (used by post-run summary modal)
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
        return res.json({ facts: [], stravaPost: "" });
      }

      const client = new Anthropic();
      const parkDescriptions = validParks.map(p => {
        const parts = [`ID: ${p!.id}\nName: ${p!.name}\nBorough: ${p!.borough}\nType: ${p!.siteType}`];
        if (p!.gardensTrustInfo) parts.push(`Gardens Trust info: ${p!.gardensTrustInfo}`);
        if (p!.address) parts.push(`Address: ${p!.address}`);
        return parts.join('\n');
      }).join('\n\n');

      // Build optional run context for the Strava post
      const runContext = activityData
        ? `Run: ${activityData.name}, ${(activityData.distance / 1000).toFixed(1)}km, ${Math.floor(activityData.moving_time / 60)}min, ${activityData.newParksCount} new park(s), ${activityData.totalParksVisited} total park(s) visited.`
        : "";

      const message = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        messages: [{
          role: "user",
          content: `You are a knowledgeable guide to London's green spaces. A runner just completed a run through some London parks.

${runContext}

Parks visited:\n\n${parkDescriptions}

Do two things and format your response EXACTLY as shown — two clearly separated sections:

FACTS_JSON:
{"facts":[{"parkId":<id>,"parkName":"<name>","facts":["fact 1","fact 2"]}]}

STRAVA_POST:
<A short, fun, first-person Strava caption. 2-3 sentences. Mention the parks and boroughs by name. Enthusiastic but natural, like something a real runner would post.>

Rules:
- The FACTS_JSON section must be valid JSON, nothing else
- The STRAVA_POST section is plain text, no quotes around it
- Do not add any other text`,
        }],
      });

      const content = message.content[0];
      if (content.type !== "text") {
        return res.status(500).json({ error: "Unexpected AI response format" });
      }

      // Parse the two sections separately so a complex stravaPost can't break JSON parsing
      const raw = content.text;
      const factsMatch = raw.match(/FACTS_JSON:\s*(\{[\s\S]*?\})\s*(?:STRAVA_POST:|$)/);
      const postMatch = raw.match(/STRAVA_POST:\s*([\s\S]+)/);

      let facts: unknown[] = [];
      if (factsMatch) {
        try {
          const parsed = JSON.parse(factsMatch[1]);
          facts = parsed.facts || [];
        } catch (e) {
          console.error("Failed to parse facts JSON:", e);
        }
      }

      const stravaPost = postMatch ? postMatch[1].trim() : "";

      res.json({ facts, stravaPost });
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
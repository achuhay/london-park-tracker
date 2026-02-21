import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { registerStravaRoutes } from "./strava";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Auth Setup - disabled for local development
  if (process.env.NODE_ENV === 'production') {
    await setupAuth(app);
    registerAuthRoutes(app);
  }
  
  // Strava Integration
  registerStravaRoutes(app);

  // === Park Routes ===

  app.get(api.parks.list.path, async (req, res) => {
    try {
      const input = api.parks.list.input?.parse(req.query);
      const parks = await storage.getParks(input);
      res.json(parks);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid query parameters" });
      }
      throw err;
    }
  });

  app.get(api.parks.stats.path, async (req, res) => {
    const parks = await storage.getParkStats(req.query as any); 
    res.json(parks);
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

  app.patch(api.parks.toggleComplete.path, async (req, res) => {
    const id = Number(req.params.id);
    const { completed } = req.body;
    
    // We can reuse updatePark
    const park = await storage.updatePark(id, { 
      completed, 
      completedDate: completed ? new Date() : null 
    });
    
    if (!park) {
      return res.status(404).json({ message: 'Park not found' });
    }
    res.json(park);
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
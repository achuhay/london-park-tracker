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
  // Auth Setup
  await setupAuth(app);
  registerAuthRoutes(app);
  
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

  app.get(api.parks.get.path, async (req, res) => {
    const park = await storage.getPark(Number(req.params.id));
    if (!park) {
      return res.status(404).json({ message: 'Park not found' });
    }
    res.json(park);
  });

  // Protected Routes - Require Authentication
  
  app.post(api.parks.create.path, isAuthenticated, async (req, res) => {
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

  app.put(api.parks.update.path, isAuthenticated, async (req, res) => {
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

  app.delete(api.parks.delete.path, isAuthenticated, async (req, res) => {
    const park = await storage.getPark(Number(req.params.id));
    if (!park) {
      return res.status(404).json({ message: 'Park not found' });
    }
    await storage.deletePark(Number(req.params.id));
    res.status(204).send();
  });

  // Toggle complete - Allowed for authenticated users (owner)
  // In a multi-user app, this would be per-user. For now, single user (owner) tracks progress.
  // The requirement says "A private admin page for the owner only... Acts as the single source of truth for the main Park Tracker page."
  // Wait, does the public view see the OWNER's progress? 
  // "My goal is to run... The app should visually track progress... A park is not automatically marked complete... user must explicitly click"
  // It implies the user (owner) marks it.
  // If I make toggle protected, then visitors can't toggle it. That seems correct for a "Personal Tracker" site.
  app.patch(api.parks.toggleComplete.path, isAuthenticated, async (req, res) => {
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

  // Get ambiguous parks for review
  app.get("/api/parks/ambiguous", isAuthenticated, async (req, res) => {
    try {
      const parks = await storage.getAmbiguousParks();
      res.json(parks);
    } catch (err) {
      console.error("Error fetching ambiguous parks:", err);
      res.status(500).json({ message: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  // Confirm polygon selection for a park
  app.post("/api/parks/:id/confirm-polygon", isAuthenticated, async (req, res) => {
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

  // Seed Data
  await seedDatabase();

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

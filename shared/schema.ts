import { pgTable, text, serial, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
// Auth tables are imported here but defined in their own file to be clean
export * from "./models/auth";

// === TABLE DEFINITIONS ===

// Strava OAuth tokens for authenticated users
export const stravaTokens = pgTable("strava_tokens", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(), // Links to auth user - one per user
  athleteId: text("athlete_id").notNull(), // Strava athlete ID
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type StravaToken = typeof stravaTokens.$inferSelect;
export type InsertStravaToken = typeof stravaTokens.$inferInsert;

export const parks = pgTable("parks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  borough: text("borough").notNull(),
  siteType: text("site_type").notNull(),
  openToPublic: text("open_to_public").notNull(), // "Yes", "No", "Occasionally"
  // GeoJSON Polygon coordinates stored as JSON. 
  // Simplified for now, but ready for future PostGIS integration if needed.
  polygon: jsonb("polygon").notNull(), 
  completed: boolean("completed").default(false).notNull(),
  completedDate: timestamp("completed_date"),
}, (table) => [
  index("park_name_borough_idx").on(table.name, table.borough)
]);

// === BASE SCHEMAS ===

export const insertParkSchema = createInsertSchema(parks).omit({ 
  id: true, 
  completed: true, 
  completedDate: true 
});

// === EXPLICIT API CONTRACT TYPES ===

export type Park = typeof parks.$inferSelect;
export type InsertPark = z.infer<typeof insertParkSchema>;

// Request types
export type CreateParkRequest = InsertPark;
export type UpdateParkRequest = Partial<InsertPark>;

// Response types
export type ParkResponse = Park;
export type ParksListResponse = Park[];

// Query/filter types
export interface ParksQueryParams {
  borough?: string;
  siteType?: string;
  openToPublic?: string;
  search?: string;
}

// Stats
export interface ParkStats {
  total: number;
  completed: number;
  percentage: number;
  byBorough: Record<string, { total: number; completed: number }>;
}

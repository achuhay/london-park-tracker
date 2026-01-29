import { pgTable, text, serial, boolean, timestamp, jsonb, index, integer, doublePrecision } from "drizzle-orm/pg-core";
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
  openToPublic: text("open_to_public").notNull(), // Original: "Yes", "No", "Partially", etc.
  accessCategory: text("access_category"), // Simplified: "Public", "Partial", "Not Public"
  // British National Grid coordinates (OSGB36)
  easting: integer("easting"),
  northing: integer("northing"),
  // WGS84 coordinates (computed from easting/northing)
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  // Optional: GeoJSON Polygon for parks with boundary data
  polygon: jsonb("polygon"),
  // Alternative polygon options when match is unclear
  alternativePolygons: jsonb("alternative_polygons"),
  // OSM matching metadata
  osmId: text("osm_id"),
  osmMatchScore: doublePrecision("osm_match_score"),
  osmMatchStatus: text("osm_match_status"), // 'matched', 'ambiguous', 'no_match'
  // Wikidata verification
  wikidataId: text("wikidata_id"),
  wikidataVerified: boolean("wikidata_verified").default(false),
  wikidataScore: doublePrecision("wikidata_score"),
  // Additional metadata
  address: text("address"),
  postcode: text("postcode"),
  openingTimes: text("opening_times"),
  siteRef: text("site_ref"),
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
}).extend({
  // Make polygon optional (can be null if only using point data)
  polygon: z.any().optional().nullable(),
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
  accessCategory?: string;
  search?: string;
}

// Stats
export interface ParkStats {
  total: number;
  completed: number;
  percentage: number;
  byBorough: Record<string, { total: number; completed: number }>;
}

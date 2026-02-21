import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import * as schema from "./shared/schema";
import { parks } from "./shared/schema";
import { eq, or, and } from "drizzle-orm";
import * as fs from "fs";

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

interface ExportResult {
  parkId: number;
  parkName: string;
  parkLat?: number;
  parkLng?: number;
  currentPolygon?: [number, number][];
  alternatives?: Array<{
    osmId: string;
    name: string;
    polygon: [number, number][];
    distance: number;
    area: number;
    nameScore: number;
  }>;
  recommendation: string;
  confidence: number;
  reasoning: string;
  selectedOsmId?: string;
  alternativesFound: number;
}

async function exportVerificationResults() {
  console.log("📊 Exporting verification results from database...\n");

  // Get all parks that have been AI verified
  const verifiedParks = await db
    .select()
    .from(parks)
    .where(
      or(
        eq(parks.osmMatchStatus, "verified"),
        eq(parks.osmMatchStatus, "verified_alternative"),
        eq(parks.osmMatchStatus, "manual_review"),
        eq(parks.osmMatchStatus, "rejected")
      )
    );

  console.log(`Found ${verifiedParks.length} verified parks`);

  const results: ExportResult[] = verifiedParks.map((park) => {
    // Parse alternative polygons from JSONB
    const alternatives = park.alternativePolygons ? 
      (Array.isArray(park.alternativePolygons) ? park.alternativePolygons : []) : [];

    // Get current polygon coordinates
    const currentPolygon = park.polygon?.coordinates?.[0] as [number, number][] | undefined;

    // Determine recommendation from status
    let recommendation = "manual_review";
    if (park.osmMatchStatus === "verified") recommendation = "confirm";
    if (park.osmMatchStatus === "verified_alternative") recommendation = "alternative_found";
    if (park.osmMatchStatus === "rejected") recommendation = "reject";

    // Extract AI reasoning if stored in admin notes
    const reasoning = park.adminNotes || 
      (park.osmMatchStatus === "manual_review" ? "Flagged for manual review" :
       park.osmMatchStatus === "verified" ? "Current polygon verified" :
       park.osmMatchStatus === "verified_alternative" ? "Alternative polygon selected" :
       "Polygon rejected");

    return {
      parkId: park.id,
      parkName: park.name,
      parkLat: park.latitude ?? undefined,
      parkLng: park.longitude ?? undefined,
      currentPolygon,
      alternatives: alternatives.map((alt: any) => ({
        osmId: alt.osmId || "",
        name: alt.name || "Unnamed",
        polygon: alt.polygon || [],
        distance: alt.distance || 0,
        area: alt.area || 0,
        nameScore: alt.nameScore || 0,
      })),
      recommendation,
      confidence: 75, // Default since we don't store this
      reasoning,
      selectedOsmId: park.osmId || undefined,
      alternativesFound: alternatives.length,
    };
  });

  // Write to JSON file
  const filename = "./verification-results-export.json";
  fs.writeFileSync(filename, JSON.stringify(results, null, 2));

  console.log(`\n✅ Exported ${results.length} parks to ${filename}`);
  console.log("\nBreakdown:");
  console.log(`  - Verified: ${results.filter(r => r.recommendation === "confirm").length}`);
  console.log(`  - Alternatives: ${results.filter(r => r.recommendation === "alternative_found").length}`);
  console.log(`  - Manual Review: ${results.filter(r => r.recommendation === "manual_review").length}`);
  console.log(`  - Rejected: ${results.filter(r => r.recommendation === "reject").length}`);
  console.log(`\nTotal parks with polygon data: ${results.filter(r => r.currentPolygon || r.alternatives?.length).length}`);
  console.log(`Total parks with alternatives: ${results.filter(r => r.alternatives && r.alternatives.length > 0).length}`);

  await pool.end();
}

exportVerificationResults().catch(console.error);

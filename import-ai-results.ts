import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./shared/schema";
import { parks } from "./shared/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function importVerificationResults() {
  console.log("📥 Importing AI verification results into database...\n");

  // Read the JSON file
  const data = JSON.parse(fs.readFileSync("./ai-verification-enhanced-results.json", "utf8"));
  console.log(`Found ${data.length} verification results`);

  let updated = 0;
  let skipped = 0;

  for (const result of data) {
    // Map recommendation to osmMatchStatus
    let status = "ambiguous";
    if (result.recommendation === "confirm") status = "verified";
    if (result.recommendation === "alternative_found") status = "verified_alternative";
    if (result.recommendation === "reject") status = "rejected";
    if (result.recommendation === "manual_review") status = "manual_review";

    // Only update if not already verified (don't overwrite manual changes)
    const existing = await db.select().from(parks).where(eq(parks.id, result.parkId)).limit(1);
    
    if (existing.length > 0 && existing[0].osmMatchStatus === "verified") {
      skipped++;
      continue; // Already verified, skip
    }

    // Update the park
    await db
      .update(parks)
      .set({
        osmMatchStatus: status,
        adminNotes: result.reasoning,
      })
      .where(eq(parks.id, result.parkId));

    updated++;
    
    if (updated % 100 === 0) {
      console.log(`  Processed ${updated}/${data.length}...`);
    }
  }

  console.log(`\n✅ Complete!`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped} (already verified)`);
}

importVerificationResults().catch(console.error);

import "dotenv/config";
import { db } from "./server/db.js";
import { parks } from "./shared/schema.js";
import { sql, eq, inArray } from "drizzle-orm";

async function cleanupDuplicates() {
  console.log("🧹 Duplicate Parks Cleanup Script");
  console.log("==================================\n");

  const DRY_RUN = false; // Set to false to actually delete
  
  if (DRY_RUN) {
    console.log("⚠️  DRY RUN MODE - No deletions will occur\n");
  } else {
    console.log("🔥 LIVE MODE - Duplicates will be deleted\n");
  }

  // Find all duplicate park names
  const duplicateNames = await db.execute(sql`
    SELECT name, COUNT(*) as count
    FROM parks
    GROUP BY name
    HAVING COUNT(*) > 1
  `);

  console.log(`Found ${duplicateNames.rows.length} park names with duplicates\n`);

  let toDelete: number[] = [];
  let kept: number[] = [];
  const deletionReasons: Record<number, string> = {};

  for (const row of duplicateNames.rows) {
    const parkName = row.name as string;
    
    // Get all entries for this park name
    const entries = await db
      .select()
      .from(parks)
      .where(eq(parks.name, parkName))
      .orderBy(parks.id);

    // Categorize entries
    const originals = entries.filter(e => 
      e.siteRef && 
      e.siteRef !== 'OSM_IMPORT' && 
      e.siteRef !== 'OSM_IMPORT_MANUAL'
    );
    const osmImports = entries.filter(e => 
      e.siteRef === 'OSM_IMPORT' || 
      e.siteRef === 'OSM_IMPORT_MANUAL'
    );

    if (originals.length > 0) {
      // Strategy 1: Keep originals, delete OSM imports
      const original = originals[0]; // Keep the first original
      kept.push(original.id);

      // Delete all OSM imports
      for (const osmImport of osmImports) {
        toDelete.push(osmImport.id);
        deletionReasons[osmImport.id] = `OSM import duplicate of original (ID ${original.id})`;
      }

      // If multiple originals exist (cross-borough), keep all originals for now
      // We'll handle these separately
      for (let i = 1; i < originals.length; i++) {
        kept.push(originals[i].id);
      }

    } else if (osmImports.length > 1) {
      // Strategy 2: All are OSM imports, keep earliest
      const earliest = osmImports[0];
      kept.push(earliest.id);

      // Delete the rest
      for (let i = 1; i < osmImports.length; i++) {
        toDelete.push(osmImports[i].id);
        deletionReasons[osmImports[i].id] = `OSM import duplicate (keeping ID ${earliest.id})`;
      }
    }
  }

  // Remove duplicates from toDelete array
  toDelete = [...new Set(toDelete)];

  console.log("📊 SUMMARY");
  console.log("=" .repeat(60));
  console.log(`Parks to keep: ${kept.length}`);
  console.log(`Parks to delete: ${toDelete.length}`);
  console.log(`Database size after cleanup: ${3362 - toDelete.length}\n`);

  // Show sample deletions
  console.log("🔍 SAMPLE DELETIONS (first 20):");
  console.log("=" .repeat(60));
  
  const sampleIds = toDelete.slice(0, 20);
  const sampleParks = await db
    .select()
    .from(parks)
    .where(inArray(parks.id, sampleIds));

  for (const park of sampleParks) {
    console.log(`ID ${park.id}: ${park.name} (${park.borough})`);
    console.log(`  Site ref: ${park.siteRef || 'null'}`);
    console.log(`  Reason: ${deletionReasons[park.id]}`);
    console.log('');
  }

  if (toDelete.length > 20) {
    console.log(`... and ${toDelete.length - 20} more\n`);
  }

  // Export detailed report
  const report = {
    summary: {
      totalDuplicates: duplicateNames.rows.length,
      parksToKeep: kept.length,
      parksToDelete: toDelete.length,
      finalDatabaseSize: 3362 - toDelete.length,
    },
    toDelete: toDelete,
    deletionReasons: deletionReasons,
  };

  const fs = await import('fs/promises');
  await fs.writeFile('./cleanup-plan.json', JSON.stringify(report, null, 2));
  console.log("📄 Cleanup plan exported to: cleanup-plan.json\n");

  // Perform deletion if not dry run
  if (!DRY_RUN && toDelete.length > 0) {
    console.log("🔥 Deleting duplicates...\n");
    
    // Delete in batches of 100
    const batchSize = 100;
    let deleted = 0;

    for (let i = 0; i < toDelete.length; i += batchSize) {
      const batch = toDelete.slice(i, i + batchSize);
      
      await db.delete(parks).where(inArray(parks.id, batch));
      deleted += batch.length;
      
      console.log(`  Deleted ${deleted}/${toDelete.length}...`);
    }

    console.log(`\n✅ Successfully deleted ${deleted} duplicate parks`);
    console.log(`Database now contains ${3362 - deleted} parks\n`);

  } else if (DRY_RUN) {
    console.log("💡 Set DRY_RUN = false in the script to perform actual deletion\n");
  }
}

cleanupDuplicates().catch(console.error);

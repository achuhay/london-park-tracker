import "dotenv/config";
import { db } from "./server/db.js";
import { sql } from "drizzle-orm";

async function findDuplicates() {
  console.log("🔍 Duplicate Parks Detector");
  console.log("===========================\n");

  // Find parks with duplicate names
  const duplicateNames = await db.execute(sql`
    SELECT 
      name,
      COUNT(*) as count,
      STRING_AGG(DISTINCT borough, ', ') as boroughs,
      STRING_AGG(DISTINCT site_ref, ', ') as site_refs
    FROM parks
    GROUP BY name
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, name
  `);

  console.log(`Found ${duplicateNames.rows.length} park names with duplicates\n`);

  // Categorize duplicates
  const categories = {
    osmImportDuplicates: [] as any[],
    crossBoroughDuplicates: [] as any[],
    sameBoroughDuplicates: [] as any[],
  };

  for (const row of duplicateNames.rows) {
    const name = row.name as string;
    const count = row.count as number;
    const boroughs = row.boroughs as string;
    const siteRefs = row.site_ref as string;

    // Get detailed info for this park name
    const details = await db.execute(sql`
      SELECT id, name, borough, site_ref, osm_id, latitude, longitude
      FROM parks
      WHERE name = ${name}
      ORDER BY id
    `);

    const hasOsmImport = siteRefs?.includes('OSM_IMPORT');
    const boroughList = boroughs?.split(', ').filter(Boolean) || [];
    const uniqueBoroughs = [...new Set(boroughList)];

    if (hasOsmImport) {
      categories.osmImportDuplicates.push({
        name,
        count,
        boroughs: uniqueBoroughs,
        details: details.rows,
      });
    } else if (uniqueBoroughs.length > 1) {
      categories.crossBoroughDuplicates.push({
        name,
        count,
        boroughs: uniqueBoroughs,
        details: details.rows,
      });
    } else {
      categories.sameBoroughDuplicates.push({
        name,
        count,
        boroughs: uniqueBoroughs,
        details: details.rows,
      });
    }
  }

  // Report OSM Import Duplicates
  console.log("📦 OSM IMPORT DUPLICATES");
  console.log("=" .repeat(60));
  console.log(`Total: ${categories.osmImportDuplicates.length} park names\n`);

  const topOsmDuplicates = categories.osmImportDuplicates.slice(0, 10);
  for (const dup of topOsmDuplicates) {
    console.log(`${dup.name} (${dup.count} entries)`);
    console.log(`  Boroughs: ${dup.boroughs.join(', ')}`);
    console.log(`  IDs: ${dup.details.map((d: any) => d.id).join(', ')}`);
    console.log(`  Site refs: ${dup.details.map((d: any) => d.site_ref || 'null').join(', ')}`);
    console.log('');
  }

  if (categories.osmImportDuplicates.length > 10) {
    console.log(`... and ${categories.osmImportDuplicates.length - 10} more\n`);
  }

  // Report Cross-Borough Duplicates
  console.log("\n🌍 CROSS-BOROUGH DUPLICATES (Non-OSM)");
  console.log("=" .repeat(60));
  console.log(`Total: ${categories.crossBoroughDuplicates.length} park names\n`);

  for (const dup of categories.crossBoroughDuplicates) {
    console.log(`${dup.name} (${dup.count} entries)`);
    console.log(`  Boroughs: ${dup.boroughs.join(', ')}`);
    console.log(`  IDs: ${dup.details.map((d: any) => d.id).join(', ')}`);
    console.log('');
  }

  // Report Same-Borough Duplicates
  console.log("\n⚠️  SAME BOROUGH DUPLICATES (Potential Data Issues)");
  console.log("=" .repeat(60));
  console.log(`Total: ${categories.sameBoroughDuplicates.length} park names\n`);

  for (const dup of categories.sameBoroughDuplicates.slice(0, 10)) {
    console.log(`${dup.name} (${dup.count} entries in ${dup.boroughs[0]})`);
    console.log(`  IDs: ${dup.details.map((d: any) => d.id).join(', ')}`);
    console.log(`  Site refs: ${dup.details.map((d: any) => d.site_ref || 'null').join(', ')}`);
    console.log('');
  }

  // Summary Statistics
  console.log("\n📊 SUMMARY");
  console.log("=" .repeat(60));
  console.log(`Total duplicate park names: ${duplicateNames.rows.length}`);
  console.log(`  OSM import duplicates: ${categories.osmImportDuplicates.length}`);
  console.log(`  Cross-borough duplicates: ${categories.crossBoroughDuplicates.length}`);
  console.log(`  Same-borough duplicates: ${categories.sameBoroughDuplicates.length}`);

  // Calculate total duplicate entries
  const totalDuplicateEntries = duplicateNames.rows.reduce((sum, row) => sum + (row.count as number) - 1, 0);
  console.log(`\nTotal duplicate entries (can be removed): ${totalDuplicateEntries}`);
  console.log(`Parks after deduplication: ${3362 - totalDuplicateEntries}\n`);

  // Export detailed report
  const report = {
    summary: {
      totalDuplicateNames: duplicateNames.rows.length,
      osmImportDuplicates: categories.osmImportDuplicates.length,
      crossBoroughDuplicates: categories.crossBoroughDuplicates.length,
      sameBoroughDuplicates: categories.sameBoroughDuplicates.length,
      totalDuplicateEntries,
    },
    osmImportDuplicates: categories.osmImportDuplicates,
    crossBoroughDuplicates: categories.crossBoroughDuplicates,
    sameBoroughDuplicates: categories.sameBoroughDuplicates,
  };

  const fs = await import('fs/promises');
  await fs.writeFile('./duplicate-parks-report.json', JSON.stringify(report, null, 2));
  console.log("📄 Detailed report exported to: duplicate-parks-report.json");
}

findDuplicates().catch(console.error);

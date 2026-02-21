import "dotenv/config";
import { db } from "./server/db.js";
import { parks } from "./shared/schema.js";
import { eq, isNotNull, or, sql } from "drizzle-orm";

/**
 * Fetch park information from London Gardens Trust inventory
 */
async function fetchGardensTrustInfo(siteRef: string): Promise<string | null> {
  const url = `https://londongardenstrust.org/conservation/inventory/site-record/?ID=${siteRef}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    
    const html = await response.text();
    
    // Extract key information from the HTML
    
    // Brief Description
    const briefMatch = html.match(/Brief Description\s*<\/\w+>\s*<\w+[^>]*>([\s\S]*?)<\/\w+>/i);
    const briefDesc = briefMatch ? briefMatch[1].replace(/<[^>]*>/g, '').trim() : '';
    
    // Previous/Other names
    const namesMatch = html.match(/Previous \/ Other name:\s*<\/\w+>\s*<\w+[^>]*>([\s\S]*?)<\/\w+>/i);
    const altNames = namesMatch ? namesMatch[1].replace(/<[^>]*>/g, '').trim() : '';
    
    // Size in hectares
    const sizeMatch = html.match(/Size in hectares:\s*<\/\w+>\s*<\w+[^>]*>([\s\S]*?)<\/\w+>/i);
    const size = sizeMatch ? sizeMatch[1].replace(/<[^>]*>/g, '').trim() : '';
    
    // Type of site
    const typeMatch = html.match(/Type of site:\s*<\/\w+>\s*<\w+[^>]*>([\s\S]*?)<\/\w+>/i);
    const siteType = typeMatch ? typeMatch[1].replace(/<[^>]*>/g, '').trim() : '';
    
    // Full description
    const fullDescMatch = html.match(/Full Site Description\s*<\/\w+>\s*<\w+[^>]*>([\s\S]*?)<\/\w+>/i);
    const fullDesc = fullDescMatch ? fullDescMatch[1].replace(/<[^>]*>/g, '').trim().substring(0, 500) : '';
    
    // Compile useful info
    let info = '';
    if (briefDesc) info += `Description: ${briefDesc}\n`;
    if (altNames && altNames !== 'None') info += `Alternative names: ${altNames}\n`;
    if (size) info += `Size: ${size} hectares\n`;
    if (siteType) info += `Type: ${siteType}\n`;
    if (fullDesc) info += `Historical context: ${fullDesc}...\n`;
    
    return info.length > 0 ? info : null;
  } catch (error) {
    console.error(`  ✗ Error fetching ${siteRef}:`, error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

async function main() {
  console.log("🌳 London Gardens Trust Data Fetcher");
  console.log("====================================\n");

  // Get all parks with siteRef (excluding OSM imports)
  const parksWithSiteRef = await db
    .select()
    .from(parks)
    .where(
      isNotNull(parks.siteRef)
    );

  // Filter out OSM imports
  const validParks = parksWithSiteRef.filter(
    p => p.siteRef !== 'OSM_IMPORT' && p.siteRef !== 'OSM_IMPORT_MANUAL'
  );

  console.log(`Found ${validParks.length} parks with valid siteRef\n`);

  if (validParks.length === 0) {
    console.log("No parks to fetch data for.");
    return;
  }

  let fetched = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < validParks.length; i++) {
    const park = validParks[i];
    
    // Skip if already has Gardens Trust data
    if (park.gardensTrustInfo) {
      skipped++;
      if (i % 50 === 0) {
        console.log(`[${i + 1}/${validParks.length}] Skipped: ${park.name} (already has data)`);
      }
      continue;
    }

    console.log(`[${i + 1}/${validParks.length}] Fetching: ${park.name} (${park.siteRef})`);

    const info = await fetchGardensTrustInfo(park.siteRef!);

    if (info) {
      // Update database with fetched info using Drizzle sql
      try {
        await db.execute(sql`
          UPDATE parks 
          SET gardens_trust_info = ${info}
          WHERE id = ${park.id}
        `);
        
        fetched++;
        console.log(`  ✓ Data stored (${info.length} chars)`);
      } catch (error) {
        console.error(`  ✗ Failed to store data:`, error);
        failed++;
      }
    } else {
      console.log(`  ⚠️  No data found at Gardens Trust`);
      failed++;
    }

    // Rate limiting - wait 2 seconds between requests
    if (i < validParks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total parks checked: ${validParks.length}`);
  console.log(`✓ Successfully fetched: ${fetched}`);
  console.log(`⚠️  Failed or no data: ${failed}`);
  console.log(`⏭️  Skipped (already had data): ${skipped}`);
  console.log(`\n✅ Gardens Trust data is now stored in the database!`);
  console.log(`   Run ai-verify-polygons-enhanced.ts to use this data for verification.`);
}

main().catch(console.error);

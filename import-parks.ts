import "dotenv/config";
import { db, pool } from "./server/db";
import { parks } from "./shared/schema";
import * as fs from "fs";
import Papa from "papaparse";

async function importParks() {
  try {
    console.log("Reading CSV file...");
    const csvContent = fs.readFileSync("parks master.csv", "utf-8");
    
    console.log("Parsing CSV...");
    const parsed = Papa.parse(csvContent, {
      header: true,
      skipEmptyLines: true,
    });

    console.log(`Found ${parsed.data.length} parks in CSV`);

    // Clear existing parks
    console.log("Clearing existing parks...");
    await db.delete(parks);

    console.log("Importing parks...");
    let imported = 0;
    
    for (const row of parsed.data as any[]) {
      try {
        // Parse polygon if it exists (stored as JSON in the CSV)
        let polygon = null;
        if (row.polygon) {
          try {
            polygon = JSON.parse(row.polygon);
          } catch (e) {
            // polygon is invalid JSON, skip it
          }
        }

        await db.insert(parks).values({
          name: row.name,
          borough: row.borough || null,
          siteType: row.site_type || null,
          openToPublic: row.open_to_public || null,
          accessCategory: row.access_category || null,
          easting: row.easting ? parseInt(row.easting) : null,
          northing: row.northing ? parseInt(row.northing) : null,
          latitude: row.latitude ? parseFloat(row.latitude) : null,
          longitude: row.longitude ? parseFloat(row.longitude) : null,
          address: row.address || null,
          postcode: row.postcode || null,
          openingTimes: row.opening_times || null,
          siteRef: row.site_ref || null,
          completed: row.completed === 't' || row.completed === 'true',
          completedDate: row.completed_date ? new Date(row.completed_date) : null,
          polygon: polygon,
          osmId: row.osm_id || null,
          osmMatchScore: row.osm_match_score ? parseFloat(row.osm_match_score) : null,
          osmMatchStatus: row.osm_match_status || null,
          wikidataId: row.wikidata_id || null,
          wikidataVerified: row.wikidata_verified === 't' || row.wikidata_verified === 'true',
          wikidataScore: row.wikidata_score ? parseFloat(row.wikidata_score) : null,
        });
        
        imported++;
        if (imported % 100 === 0) {
          console.log(`Imported ${imported} parks...`);
        }
      } catch (err) {
        console.error(`Error importing park ${row.name}:`, err);
      }
    }

    console.log(`\n✅ Successfully imported ${imported} parks!`);
  } catch (error) {
    console.error("Error importing parks:", error);
  } finally {
    await pool.end();
  }
}

importParks();

/**
 * osm-mismatch-check.ts
 *
 * For every non-public park in the DB that has coordinates, query the OSM
 * Overpass API to see what OSM says is actually at that location.
 *
 * If OSM says the location is a public park/garden/recreation area, the park
 * is likely mislabelled in our data (correct polygon, wrong name/type).
 *
 * Output: a CSV of suspect mismatches + a summary printed to stdout.
 *
 * Usage:
 *   npx tsx scripts/osm-mismatch-check.ts
 *   npx tsx scripts/osm-mismatch-check.ts --apply   (auto-fix clear-cut matches)
 */

import { pool } from "../server/db";
import { writeFileSync } from "fs";

const APPLY = process.argv.includes("--apply");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const SLEEP_MS = 1200; // stay well within Overpass rate limits

// OSM tags that indicate a publicly accessible green space
const PUBLIC_LEISURE = new Set([
  "park", "garden", "nature_reserve", "recreation_ground",
  "common", "pitch", "playground", "dog_park", "green",
]);
const PUBLIC_LANDUSE = new Set([
  "recreation_ground", "village_green", "cemetery", "grass",
]);

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function queryOSM(lat: number, lng: number): Promise<{
  name: string | null;
  leisure: string | null;
  landuse: string | null;
  access: string | null;
  isPublicGreenSpace: boolean;
} | null> {
  // Use is_in to find OSM areas that CONTAIN this point — works for large polygons
  const query = `
    [out:json][timeout:15];
    is_in(${lat},${lng})->.a;
    (
      way(pivot.a)[leisure];
      way(pivot.a)[landuse~"^(recreation_ground|village_green|cemetery|grass|meadow|park)$"];
      relation(pivot.a)[leisure];
      relation(pivot.a)[landuse~"^(recreation_ground|village_green|cemetery|grass|meadow|park)$"];
    );
    out tags 3;
  `;

  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!res.ok) return null;
    const json = await res.json() as any;
    const elements: any[] = json.elements ?? [];
    if (elements.length === 0) return null;

    // Pick the best match (prefer leisure over landuse)
    const el = elements.find(e => e.tags?.leisure) ?? elements[0];
    const tags = el.tags ?? {};
    const leisure = tags.leisure ?? null;
    const landuse = tags.landuse ?? null;
    const access = tags.access ?? null;
    const name = tags.name ?? null;

    const isPublicGreenSpace =
      (leisure && PUBLIC_LEISURE.has(leisure) && access !== "private") ||
      (landuse && PUBLIC_LANDUSE.has(landuse) && access !== "private");

    return { name, leisure, landuse, access, isPublicGreenSpace };
  } catch {
    return null;
  }
}

async function main() {
  const client = await pool.connect();

  try {
    // Get all non-public parks that have coordinates
    const { rows } = await client.query(`
      SELECT id, name, borough, site_type, open_to_public, access_category,
             latitude, longitude
      FROM parks
      WHERE access_category != 'Public'
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      ORDER BY access_category, site_type, name
    `);

    console.log(`\nChecking ${rows.length} non-public parks against OSM...\n`);

    const mismatches: any[] = [];
    const noMatch: any[] = [];
    let checked = 0;

    for (const park of rows) {
      checked++;
      process.stdout.write(`\r  ${checked}/${rows.length} — ${park.name.substring(0, 50).padEnd(50)}`);

      const osm = await queryOSM(park.latitude, park.longitude);
      await sleep(SLEEP_MS);

      if (!osm) {
        noMatch.push(park);
        continue;
      }

      if (osm.isPublicGreenSpace) {
        mismatches.push({
          ...park,
          osm_name: osm.name,
          osm_leisure: osm.leisure,
          osm_landuse: osm.landuse,
          osm_access: osm.access,
        });
      }
    }

    console.log(`\n\nDone.\n`);
    console.log(`  ✅ Likely mismatches (OSM says public green space): ${mismatches.length}`);
    console.log(`  ❓ No OSM green space found nearby:                 ${noMatch.length}`);
    console.log(`  Total checked: ${rows.length}\n`);

    // Print mismatches to console
    if (mismatches.length > 0) {
      console.log("── LIKELY MISMATCHES ─────────────────────────────────────────────");
      console.log("ID    | DB Name                              | DB Type              | Access       | OSM Name                    | OSM Type");
      console.log("------|--------------------------------------|----------------------|--------------|-----------------------------|---------");
      for (const m of mismatches) {
        console.log(
          `${String(m.id).padEnd(6)}| ${m.name.substring(0,37).padEnd(38)}| ${m.site_type.substring(0,21).padEnd(22)}| ${m.open_to_public.substring(0,13).padEnd(14)}| ${(m.osm_name ?? "(no name)").substring(0,28).padEnd(28)} | ${m.osm_leisure ?? m.osm_landuse ?? ""}`
        );
      }
    }

    // Write CSV
    const csvRows = [
      ["id","db_name","borough","db_site_type","db_open_to_public","db_access_category","osm_name","osm_leisure","osm_landuse","osm_access"].join(","),
      ...mismatches.map(m => [
        m.id, `"${m.name}"`, `"${m.borough}"`, `"${m.site_type}"`,
        `"${m.open_to_public}"`, `"${m.access_category}"`,
        `"${m.osm_name ?? ""}"`, `"${m.osm_leisure ?? ""}"`,
        `"${m.osm_landuse ?? ""}"`, `"${m.osm_access ?? ""}"`
      ].join(","))
    ];
    const csvPath = "scripts/osm-mismatches.csv";
    writeFileSync(csvPath, csvRows.join("\n"));
    console.log(`\nCSV saved to ${csvPath}`);

    // --apply: fix clear-cut cases where OSM name matches a well-known public park
    if (APPLY && mismatches.length > 0) {
      console.log("\n── APPLYING FIXES ────────────────────────────────────────────────");
      let fixed = 0;
      for (const m of mismatches) {
        if (!m.osm_name) continue;
        // Only auto-fix if OSM has a name (i.e. it's a named public park)
        // Update: set access_category=Public, open_to_public=Yes, name=OSM name
        await client.query(`
          UPDATE parks
          SET access_category = 'Public',
              open_to_public  = 'Yes',
              name            = $1,
              admin_notes     = 'Auto-fixed by osm-mismatch-check: was ' || name || ' (' || open_to_public || ')'
          WHERE id = $2
        `, [m.osm_name, m.id]);
        console.log(`  Fixed #${m.id}: "${m.name}" → "${m.osm_name}"`);
        fixed++;
      }
      console.log(`\n  ${fixed} parks updated.`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

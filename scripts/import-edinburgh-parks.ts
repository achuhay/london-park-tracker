import "dotenv/config";
import { db } from "../server/db.js";
import { parks } from "../shared/schema.js";
import { eq } from "drizzle-orm";

/**
 * Imports Edinburgh parks from OpenStreetMap via the Overpass API, one query per
 * electoral ward (Edinburgh's borough-equivalent — see shared/cities.ts).
 *
 * Modeled on hybrid-import.ts's OSM query/dedup pipeline, but simplified: there's no
 * existing CSV/JSON dataset to reconcile against (unlike London's original import),
 * so every result here is a fresh insert with city='edinburgh'.
 *
 * Ward bounding boxes are rough approximations (Edinburgh's 17 wards aren't
 * rectangles) — a park near a ward border may get assigned to the wrong
 * neighbour. Spot-check results against the City of Edinburgh Council's own
 * ward map before treating `borough` values as authoritative.
 *
 * Run with: npx tsx scripts/import-edinburgh-parks.ts           (dry run — no DB writes)
 *           npx tsx scripts/import-edinburgh-parks.ts --import  (actually inserts)
 */

const EDINBURGH_WARDS: Record<string, [number, number, number, number]> = {
  // [minLat, minLon, maxLat, maxLon]
  Leith: [55.96, -3.19, 55.985, -3.14],
  "Leith Walk": [55.955, -3.19, 55.975, -3.16],
  Forth: [55.97, -3.23, 55.99, -3.19],
  Inverleith: [55.955, -3.23, 55.975, -3.19],
  "City Centre": [55.945, -3.22, 55.96, -3.17],
  "Southside/Newington": [55.93, -3.19, 55.95, -3.16],
  "Craigentinny/Duddingston": [55.94, -3.14, 55.96, -3.10],
  "Portobello/Craigmillar": [55.94, -3.13, 55.96, -3.08],
  "Liberton/Gilmerton": [55.90, -3.16, 55.93, -3.12],
  Morningside: [55.92, -3.22, 55.945, -3.19],
  "Fountainbridge/Craiglockhart": [55.92, -3.24, 55.945, -3.20],
  "Colinton/Fairmilehead": [55.895, -3.24, 55.925, -3.19],
  "Sighthill/Gorgie": [55.925, -3.26, 55.95, -3.22],
  "Corstorphine/Murrayfield": [55.93, -3.30, 55.955, -3.25],
  "Drum Brae/Gyle": [55.945, -3.33, 55.97, -3.28],
  Almond: [55.94, -3.40, 55.98, -3.33],
  "Pentland Hills": [55.85, -3.28, 55.90, -3.20],
};

interface OSMPark {
  osmId: string;
  name: string;
  type: string;
  tags: Record<string, string>;
  center: [number, number]; // [lon, lat]
  polygon: [number, number][];
  area: number;
  ward: string;
  access: string;
  openToPublic: string;
}

function calculatePolygonArea(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  const latToMeters = 111320;
  const lonToMeters = 69172;
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const x1 = coords[i][0] * lonToMeters;
    const y1 = coords[i][1] * latToMeters;
    const x2 = coords[i + 1][0] * lonToMeters;
    const y2 = coords[i + 1][1] * latToMeters;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

async function getOSMParksInBounds(
  ward: string,
  bounds: [number, number, number, number],
  retryCount = 0
): Promise<OSMPark[]> {
  const [minLat, minLon, maxLat, maxLon] = bounds;
  const query = `
    [out:json][timeout:90];
    (
      way["leisure"="park"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      way["leisure"="garden"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      way["leisure"="nature_reserve"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      way["leisure"="common"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      way["landuse"="recreation_ground"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      way["landuse"="village_green"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      relation["leisure"="park"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      relation["leisure"="garden"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      relation["leisure"="nature_reserve"]["name"](${minLat},${minLon},${maxLat},${maxLon});
    );
    out geom;
  `;

  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query,
    });

    if (!response.ok) {
      if (response.status === 504 && retryCount < 2) {
        console.log(`    Timeout, retrying (${retryCount + 1}/2)...`);
        await new Promise((resolve) => setTimeout(resolve, 15000));
        return getOSMParksInBounds(ward, bounds, retryCount + 1);
      }
      throw new Error(`Overpass API error: ${response.statusText}`);
    }

    const data = await response.json();
    const osmParks: OSMPark[] = [];

    for (const element of data.elements) {
      if (!element.tags?.name) continue;

      let coords: [number, number][] = [];
      let elementType = "";

      if (element.type === "way" && element.geometry) {
        elementType = "way";
        coords = element.geometry.map((node: any) => [node.lon, node.lat]);
      } else if (element.type === "relation" && element.members) {
        elementType = "relation";
        for (const member of element.members) {
          if (member.role === "outer" && member.geometry) {
            coords = coords.concat(member.geometry.map((node: any) => [node.lon, node.lat]));
          }
        }
      }

      if (coords.length === 0) continue;

      const area = calculatePolygonArea(coords);
      if (area < 5000) continue;
      if (area > 10000000) {
        console.log(`    ⚠️  Skipping "${element.tags.name}" - unrealistic size: ${(area / 1000000).toFixed(1)} million m²`);
        continue;
      }

      const excludeTags = ["playground", "dog_park", "pitch", "sports_centre"];
      if (excludeTags.some((tag) => element.tags[tag])) continue;

      const suspiciousNames = ["the point", "estate", "development", "play area", "natural play area", "podium garden"];
      const nameLower = element.tags.name.toLowerCase();
      if (suspiciousNames.some((sus) => nameLower === sus || nameLower.includes("unnamed"))) {
        console.log(`    ⚠️  Skipping suspicious park: "${element.tags.name}"`);
        continue;
      }

      const lats = coords.map((c) => c[1]);
      const lons = coords.map((c) => c[0]);
      const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;

      const accessTag = element.tags.access || "yes";
      const openToPublic = accessTag === "yes" || accessTag === "permissive" || !element.tags.access ? "Yes" : "No";

      osmParks.push({
        osmId: `${elementType}/${element.id}`,
        name: element.tags.name,
        type: element.tags.leisure || element.tags.landuse || "unknown",
        tags: element.tags,
        center: [centerLon, centerLat],
        polygon: coords,
        area,
        ward,
        access: accessTag,
        openToPublic,
      });
    }

    return osmParks;
  } catch (error) {
    console.error(`    Error querying ${ward}:`, error);
    return [];
  }
}

function mapOSMTypeToSiteType(osmType: string): string {
  const mapping: Record<string, string> = {
    park: "Public Park",
    garden: "Public Gardens",
    nature_reserve: "Nature Reserve",
    common: "Common Land",
    recreation_ground: "Recreation Ground",
    village_green: "Village Green",
  };
  return mapping[osmType] || "Public Park";
}

function areSimilarNames(name1: string, name2: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().trim().replace(/^the\s+/i, "").replace(/'/g, "").replace(/[*]/g, "").replace(/\s+/g, " ").trim();

  const n1 = normalize(name1);
  const n2 = normalize(name2);
  if (n1 === n2) return true;
  if (n1.includes(n2) || n2.includes(n1)) return true;

  const words1 = n1.split(" ").filter((w) => w.length > 0);
  const words2 = n2.split(" ").filter((w) => w.length > 0);

  if (words1.length <= 3 || words2.length <= 3) {
    const shorterWords = words1.length < words2.length ? words1 : words2;
    const longerWords = words1.length < words2.length ? words2 : words1;
    const allWordsPresent = shorterWords.every((word) => longerWords.some((w) => w.includes(word) || word.includes(w)));
    if (allWordsPresent && shorterWords.length >= 2) return true;
  }

  const words1Set = new Set(words1);
  const words2Set = new Set(words2);
  const intersection = new Set([...words1Set].filter((x) => words2Set.has(x)));
  const union = new Set([...words1Set, ...words2Set]);
  if (intersection.size / union.size > 0.7) return true;

  return false;
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Dedup against parks already claimed by an earlier ward's bounding box (overlapping boxes
// can otherwise cause the same park to be queued for import twice) and against anything
// already in the DB for Edinburgh.
function findDuplicate(osmPark: OSMPark, seen: OSMPark[]): boolean {
  for (const other of seen) {
    if (other.osmId === osmPark.osmId) return true;
    const distance = calculateDistance(osmPark.center[1], osmPark.center[0], other.center[1], other.center[0]);
    if (distance < 30 && areSimilarNames(osmPark.name, other.name)) return true;
  }
  return false;
}

async function main() {
  const ACTUALLY_IMPORT = process.argv.includes("--import");
  console.log("🏴󠁧󠁢󠁳󠁣󠁴󠁿 Edinburgh Parks Import (OpenStreetMap, by ward)");
  console.log("=================================================\n");
  console.log(ACTUALLY_IMPORT ? "✅ IMPORT MODE - Will add to database\n" : "🔍 DRY RUN MODE - No database changes (pass --import to write)\n");

  const existingEdinburghParks = await db.select().from(parks).where(eq(parks.city, "edinburgh"));
  if (existingEdinburghParks.length > 0) {
    console.log(`⚠️  ${existingEdinburghParks.length} Edinburgh parks already exist in the DB — they'll be used for dedup but not re-imported.\n`);
  }

  const collected: OSMPark[] = [];
  const wardNames = Object.keys(EDINBURGH_WARDS);

  for (let i = 0; i < wardNames.length; i++) {
    const ward = wardNames[i];
    console.log(`[${i + 1}/${wardNames.length}] Querying ${ward}...`);

    const bounds = EDINBURGH_WARDS[ward];
    const osmParks = await getOSMParksInBounds(ward, bounds);
    console.log(`  Found ${osmParks.length} candidate parks in OSM`);

    const fresh = osmParks.filter((osmPark) => {
      if (findDuplicate(osmPark, collected)) return false;
      const dbDupe = existingEdinburghParks.some((dbPark) => {
        if (dbPark.osmId === osmPark.osmId) return true;
        if (dbPark.latitude != null && dbPark.longitude != null) {
          const distance = calculateDistance(osmPark.center[1], osmPark.center[0], dbPark.latitude, dbPark.longitude);
          if (distance < 50 && areSimilarNames(osmPark.name, dbPark.name)) return true;
        }
        return false;
      });
      return !dbDupe;
    });

    console.log(`  New: ${fresh.length} parks`);
    fresh.forEach((p, idx) => {
      console.log(`    ${idx + 1}. ${p.name} (${mapOSMTypeToSiteType(p.type)}, ${(p.area / 1000).toFixed(1)}k m², ${p.openToPublic === "Yes" ? "Public" : "Private"})`);
    });

    collected.push(...fresh);

    if (i < wardNames.length - 1) {
      console.log(`  ⏱️  Waiting 5 seconds (Overpass rate limit)...\n`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("📊 SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total new parks to import: ${collected.length}`);

  const byWard = collected.reduce<Record<string, number>>((acc, p) => {
    acc[p.ward] = (acc[p.ward] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nBy ward:`);
  for (const [ward, count] of Object.entries(byWard)) {
    console.log(`  ${ward}: ${count}`);
  }

  const byAccess = {
    public: collected.filter((p) => p.openToPublic === "Yes").length,
    private: collected.filter((p) => p.openToPublic === "No").length,
  };
  console.log(`\nAccess:`);
  console.log(`  Public: ${byAccess.public}`);
  console.log(`  Private/Restricted: ${byAccess.private}`);

  if (ACTUALLY_IMPORT && collected.length > 0) {
    console.log(`\n📥 Importing ${collected.length} parks to database...`);

    let imported = 0;
    for (const osmPark of collected) {
      try {
        await db.insert(parks).values({
          name: osmPark.name,
          city: "edinburgh",
          borough: osmPark.ward,
          siteType: mapOSMTypeToSiteType(osmPark.type),
          openToPublic: osmPark.openToPublic,
          accessCategory: osmPark.openToPublic === "Yes" ? "Public" : "Private",
          latitude: osmPark.center[1],
          longitude: osmPark.center[0],
          polygon: osmPark.polygon,
          osmId: osmPark.osmId,
          osmMatchStatus: "matched",
          osmMatchScore: 1.0,
          siteRef: "OSM_IMPORT",
          completed: false,
        });
        imported++;
        if (imported % 25 === 0) {
          console.log(`  Imported ${imported}/${collected.length}...`);
        }
      } catch (error) {
        console.error(`  ❌ Failed to import ${osmPark.name}:`, error);
      }
    }

    console.log(`\n✅ Successfully imported ${imported}/${collected.length} parks`);
  } else if (!ACTUALLY_IMPORT) {
    console.log(`\n💡 Run with --import to actually write these parks to the database`);
  }
}

main().catch(console.error);

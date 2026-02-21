import "dotenv/config";
import { db } from "./server/db.js";
import { parks } from "./shared/schema.js";
import { readFile } from "fs/promises";

/**
 * Missing boroughs that failed during initial scan
 */
const MISSING_BOROUGHS: Record<string, [number, number, number, number]> = {
  Kensington: [51.49, -0.21, 51.52, -0.17],
  Barnet: [51.58, -0.24, 51.67, -0.13],
  Havering: [51.52, 0.16, 51.62, 0.28],
  Hounslow: [51.44, -0.43, 51.50, -0.35],
  Redbridge: [51.54, 0.03, 51.62, 0.11],
  Sutton: [51.33, -0.22, 51.39, -0.15],
  "Waltham Forest": [51.56, -0.04, 51.62, 0.03],
};

interface OSMPark {
  osmId: string;
  name: string;
  type: string;
  tags: Record<string, string>;
  center: [number, number];
  polygon: [number, number][];
  area: number;
  borough: string;
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
  borough: string,
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
        return getOSMParksInBounds(borough, bounds, retryCount + 1);
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

      const lats = coords.map((c) => c[1]);
      const lons = coords.map((c) => c[0]);
      const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
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
        borough,
        access: accessTag,
        openToPublic,
      });
    }

    return osmParks;
  } catch (error) {
    console.error(`    Error querying ${borough}:`, error);
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

  const commonWords = new Set(["park", "gardens", "garden", "green", "space", "open", "playing", "field", "fields", "recreation", "ground"]);
  const significantWords1 = words1.filter((w) => !commonWords.has(w));
  const significantWords2 = words2.filter((w) => !commonWords.has(w));

  if (significantWords1.length > 0 && significantWords2.length > 0) {
    const sigIntersection = significantWords1.filter((w) => significantWords2.includes(w));
    if (sigIntersection.length >= 2 && sigIntersection.length >= Math.min(significantWords1.length, significantWords2.length)) {
      return true;
    }
  }

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

function doPolygonsOverlap(poly1: [number, number][], poly2: any): number {
  if (!poly2 || !Array.isArray(poly2) || poly2.length === 0) return 0;
  if (!poly1 || poly1.length === 0) return 0;

  const getCentroid = (poly: [number, number][]) => {
    const lats = poly.map((c) => c[1]);
    const lons = poly.map((c) => c[0]);
    return [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  };

  try {
    const c1 = getCentroid(poly1);
    const c2 = getCentroid(poly2);
    const distance = calculateDistance(c1[1], c1[0], c2[1], c2[0]);
    if (distance < 10) return 1.0;
    if (distance < 50) return 0.8;
    if (distance < 100) return 0.5;
    return 0;
  } catch (error) {
    return 0;
  }
}

function findMatchInDatabase(osmPark: OSMPark, dbParks: any[]): boolean {
  for (const dbPark of dbParks) {
    if (dbPark.osmId === osmPark.osmId) return true;
    if (dbPark.polygon && Array.isArray(dbPark.polygon) && dbPark.polygon.length > 0) {
      const overlapScore = doPolygonsOverlap(osmPark.polygon, dbPark.polygon);
      if (overlapScore > 0.8) return true;
    }
    if (dbPark.latitude && dbPark.longitude) {
      const distance = calculateDistance(osmPark.center[1], osmPark.center[0], dbPark.latitude, dbPark.longitude);
      if (distance < 50 && areSimilarNames(osmPark.name, dbPark.name)) return true;
      if (distance < 20) return true;
    }
    if (areSimilarNames(osmPark.name, dbPark.name)) {
      const distance = dbPark.latitude && dbPark.longitude ? calculateDistance(osmPark.center[1], osmPark.center[0], dbPark.latitude, dbPark.longitude) : null;
      if (distance && distance < 200) return true;
    }
  }
  return false;
}

async function main() {
  console.log("🌳 Hybrid Parks Import & Missing Borough Scanner");
  console.log("=================================================\n");

  const ACTUALLY_IMPORT = true; // SET TO TRUE TO IMPORT
  console.log(ACTUALLY_IMPORT ? "✅ IMPORT MODE - Will add to database\n" : "🔍 DRY RUN MODE - No database changes\n");

  // STEP 1: Import from existing JSON
  console.log("STEP 1: Loading parks from existing JSON report...\n");

  let jsonParks: OSMPark[] = [];
  try {
    const jsonData = await readFile("./missing-parks-full-report.json", "utf-8");
    const report = JSON.parse(jsonData);
    jsonParks = report.parks || [];
    console.log(`✅ Loaded ${jsonParks.length} parks from JSON\n`);
  } catch (error) {
    console.log("⚠️  Could not load missing-parks-full-report.json");
    console.log("   Make sure you've run the detection script first\n");
  }

  // STEP 2: Query missing boroughs
  console.log("STEP 2: Querying missing boroughs...\n");

  const allDbParks = await db.select().from(parks);
  const newMissingParks: OSMPark[] = [];

  const missingBoroughNames = Object.keys(MISSING_BOROUGHS);
  for (let i = 0; i < missingBoroughNames.length; i++) {
    const borough = missingBoroughNames[i];
    console.log(`[${i + 1}/${missingBoroughNames.length}] Processing ${borough}...`);

    const bounds = MISSING_BOROUGHS[borough];
    const osmParks = await getOSMParksInBounds(borough, bounds);
    console.log(`  Found ${osmParks.length} medium/large parks in OSM`);

    const missingParks = osmParks.filter((osmPark) => !findMatchInDatabase(osmPark, allDbParks));
    console.log(`  Missing: ${missingParks.length} parks`);

    if (missingParks.length > 0) {
      console.log(`  Missing parks in ${borough}:`);
      missingParks.forEach((park, idx) => {
        console.log(`    ${idx + 1}. ${park.name} (${park.type}, ${(park.area / 1000).toFixed(1)}k m², ${park.openToPublic === "Yes" ? "Public" : "Private"})`);
      });
    }

    newMissingParks.push(...missingParks);

    if (i < missingBoroughNames.length - 1) {
      console.log(`  ⏱️  Waiting 10 seconds...\n`);
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }

  console.log(`\n✅ Found ${newMissingParks.length} additional parks from missing boroughs\n`);

  // STEP 3: Combine and summarize
  const allParksToImport = [...jsonParks, ...newMissingParks];

  console.log("\n" + "=".repeat(60));
  console.log("📊 SUMMARY");
  console.log("=".repeat(60));
  console.log(`Parks from JSON: ${jsonParks.length}`);
  console.log(`Parks from missing boroughs: ${newMissingParks.length}`);
  console.log(`Total to import: ${allParksToImport.length}`);

  const bySize = {
    medium: allParksToImport.filter((p) => p.area >= 5000 && p.area < 50000).length,
    large: allParksToImport.filter((p) => p.area >= 50000).length,
  };
  console.log(`\nSize distribution:`);
  console.log(`  Medium (5k-50k m²): ${bySize.medium}`);
  console.log(`  Large (>50k m²): ${bySize.large}`);

  const byAccess = {
    public: allParksToImport.filter((p) => p.openToPublic === "Yes").length,
    private: allParksToImport.filter((p) => p.openToPublic === "No").length,
  };
  console.log(`\nAccess:`);
  console.log(`  Public: ${byAccess.public}`);
  console.log(`  Private/Restricted: ${byAccess.private}`);

  // STEP 4: Import
  if (ACTUALLY_IMPORT && allParksToImport.length > 0) {
    console.log(`\n📥 Importing ${allParksToImport.length} parks to database...`);

    let imported = 0;
    for (const osmPark of allParksToImport) {
      try {
        await db.insert(parks).values({
          name: osmPark.name,
          borough: osmPark.borough,
          siteType: mapOSMTypeToSiteType(osmPark.type),
          openToPublic: osmPark.openToPublic,
          accessCategory: osmPark.openToPublic === "Yes" ? "Public" : "Private",
          latitude: osmPark.center[1],
          longitude: osmPark.center[0],
          polygon: osmPark.polygon,
          osmId: osmPark.osmId,
          osmMatchStatus: "ambiguous_new",
          osmMatchScore: 0.5,
          siteRef: "OSM_IMPORT",
          completed: false,
        });
        imported++;
        if (imported % 50 === 0) {
          console.log(`  Imported ${imported}/${allParksToImport.length}...`);
        }
      } catch (error) {
        console.error(`  ❌ Failed to import ${osmPark.name}:`, error);
      }
    }

    console.log(`\n✅ Successfully imported ${imported}/${allParksToImport.length} parks`);
    console.log(`\n🔍 All parks marked with:`);
    console.log(`   - osmMatchStatus = 'ambiguous_new'`);
    console.log(`   - site_ref = 'OSM_IMPORT'`);
  } else if (!ACTUALLY_IMPORT) {
    console.log(`\n💡 Set ACTUALLY_IMPORT=true in the script to import these parks`);
  }
}

main().catch(console.error);

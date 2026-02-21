import "dotenv/config";
import { db } from "./server/db.js";
import { parks } from "./shared/schema.js";
import { inArray } from "drizzle-orm";

/**
 * ALL 33 London Boroughs with bounding boxes
 * Format: [minLat, minLon, maxLat, maxLon]
 */
const LONDON_BOROUGHS: Record<string, [number, number, number, number]> = {
  // Inner London
  Camden: [51.52, -0.20, 51.57, -0.11],
  "City of London": [51.51, -0.12, 51.52, -0.07],
  Greenwich: [51.45, 0.00, 51.50, 0.08],
  Hackney: [51.53, -0.08, 51.58, -0.02],
  Hammersmith: [51.48, -0.24, 51.52, -0.20],
  Islington: [51.53, -0.12, 51.57, -0.08],
  Kensington: [51.49, -0.21, 51.52, -0.17],
  Lambeth: [51.45, -0.13, 51.50, -0.08],
  Lewisham: [51.43, -0.05, 51.48, 0.01],
  Southwark: [51.47, -0.10, 51.52, -0.05],
  "Tower Hamlets": [51.50, -0.07, 51.54, -0.01],
  Wandsworth: [51.43, -0.21, 51.48, -0.16],
  Westminster: [51.49, -0.18, 51.54, -0.12],
  
  // Outer London
  Barking: [51.52, 0.06, 51.57, 0.15],
  Barnet: [51.58, -0.24, 51.67, -0.13],
  Bexley: [51.43, 0.08, 51.51, 0.18],
  Brent: [51.52, -0.29, 51.59, -0.21],
  Bromley: [51.32, -0.05, 51.43, 0.10],
  Croydon: [51.30, -0.13, 51.40, -0.03],
  Ealing: [51.50, -0.36, 51.55, -0.27],
  Enfield: [51.60, -0.16, 51.67, -0.04],
  Haringey: [51.56, -0.14, 51.61, -0.07],
  Harrow: [51.56, -0.37, 51.63, -0.30],
  Havering: [51.52, 0.16, 51.62, 0.28],
  Hillingdon: [51.48, -0.50, 51.57, -0.40],
  Hounslow: [51.44, -0.43, 51.50, -0.35],
  Kingston: [51.38, -0.32, 51.43, -0.26],
  Merton: [51.38, -0.24, 51.44, -0.18],
  Newham: [51.50, 0.00, 51.56, 0.08],
  Redbridge: [51.54, 0.03, 51.62, 0.11],
  "Richmond upon Thames": [51.42, -0.36, 51.48, -0.28],
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
        await new Promise((resolve) => setTimeout(resolve, 10000));
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

      // Filter: only medium (5k-50k) and large (>50k) parks
      if (area < 5000) continue;

      const excludeTags = ["playground", "dog_park", "pitch", "sports_centre"];
      if (excludeTags.some((tag) => element.tags[tag])) continue;

      // Determine access
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

function areSimilarNames(name1: string, name2: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/^the\s+/i, "")
      .replace(/'/g, "")
      .replace(/[*]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const n1 = normalize(name1);
  const n2 = normalize(name2);

  if (n1 === n2) return true;
  if (n1.includes(n2) || n2.includes(n1)) return true;

  const words1 = n1.split(" ").filter((w) => w.length > 0);
  const words2 = n2.split(" ").filter((w) => w.length > 0);

  if (words1.length <= 3 || words2.length <= 3) {
    const shorterWords = words1.length < words2.length ? words1 : words2;
    const longerWords = words1.length < words2.length ? words2 : words1;
    const allWordsPresent = shorterWords.every((word) =>
      longerWords.some((w) => w.includes(word) || word.includes(w))
    );
    if (allWordsPresent && shorterWords.length >= 2) return true;
  }

  const words1Set = new Set(words1);
  const words2Set = new Set(words2);
  const intersection = new Set([...words1Set].filter((x) => words2Set.has(x)));
  const union = new Set([...words1Set, ...words2Set]);

  if (intersection.size / union.size > 0.7) return true;

  const commonWords = new Set([
    "park",
    "gardens",
    "garden",
    "green",
    "space",
    "open",
    "playing",
    "field",
    "fields",
    "recreation",
    "ground",
  ]);
  const significantWords1 = words1.filter((w) => !commonWords.has(w));
  const significantWords2 = words2.filter((w) => !commonWords.has(w));

  if (significantWords1.length > 0 && significantWords2.length > 0) {
    const sigIntersection = significantWords1.filter((w) => significantWords2.includes(w));
    if (
      sigIntersection.length >= 2 &&
      sigIntersection.length >= Math.min(significantWords1.length, significantWords2.length)
    ) {
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
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function doPolygonsOverlap(poly1: [number, number][], poly2: any): number {
  if (!poly2 || !Array.isArray(poly2) || poly2.length === 0) return 0;
  if (!poly1 || poly1.length === 0) return 0;

  const getCentroid = (poly: [number, number][]) => {
    const lats = poly.map((c) => c[1]);
    const lons = poly.map((c) => c[0]);
    return [
      (Math.min(...lons) + Math.max(...lons)) / 2,
      (Math.min(...lats) + Math.max(...lats)) / 2,
    ];
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
      const distance = calculateDistance(
        osmPark.center[1],
        osmPark.center[0],
        dbPark.latitude,
        dbPark.longitude
      );

      if (distance < 50 && areSimilarNames(osmPark.name, dbPark.name)) return true;
      if (distance < 20) return true;
    }

    if (areSimilarNames(osmPark.name, dbPark.name)) {
      const distance =
        dbPark.latitude && dbPark.longitude
          ? calculateDistance(osmPark.center[1], osmPark.center[0], dbPark.latitude, dbPark.longitude)
          : null;
      if (distance && distance < 200) return true;
    }
  }

  return false;
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

async function main() {
  console.log("🌳 London Missing Parks Importer");
  console.log("=================================\n");
  console.log("Searching for medium (5k-50k m²) and large (>50k m²) parks\n");
  console.log("⚠️  IMPORTANT: New parks will be marked with site_ref='OSM_IMPORT'\n");

  const DRY_RUN = true; // Set to false to actually import
  console.log(DRY_RUN ? "🔍 DRY RUN MODE - No database changes\n" : "✅ IMPORT MODE - Will add to database\n");

  const allDbParks = await db.select().from(parks);
  console.log(`Database currently has: ${allDbParks.length} parks\n`);

  const boroughs = Object.keys(LONDON_BOROUGHS);
  const allMissingParks: OSMPark[] = [];

  for (let i = 0; i < boroughs.length; i++) {
    const borough = boroughs[i];
    console.log(`[${i + 1}/${boroughs.length}] Processing ${borough}...`);

    const bounds = LONDON_BOROUGHS[borough];
    const osmParks = await getOSMParksInBounds(borough, bounds);
    console.log(`  Found ${osmParks.length} medium/large parks in OSM`);

    const missingParks = osmParks.filter((osmPark) => !findMatchInDatabase(osmPark, allDbParks));
    console.log(`  Missing: ${missingParks.length} parks`);

    if (missingParks.length > 0) {
      console.log(`  Missing parks in ${borough}:`);
      missingParks.forEach((park, idx) => {
        console.log(
          `    ${idx + 1}. ${park.name} (${park.type}, ${(park.area / 1000).toFixed(1)}k m², ${park.openToPublic === "Yes" ? "Public" : "Private"})`
        );
      });
    }

    allMissingParks.push(...missingParks);

    // Rate limiting
    if (i < boroughs.length - 1) {
      console.log(`  ⏱️  Waiting 3 seconds...\n`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total missing parks found: ${allMissingParks.length}`);

  const bySize = {
    medium: allMissingParks.filter((p) => p.area >= 5000 && p.area < 50000).length,
    large: allMissingParks.filter((p) => p.area >= 50000).length,
  };
  console.log(`\nSize distribution:`);
  console.log(`  Medium (5k-50k m²): ${bySize.medium}`);
  console.log(`  Large (>50k m²): ${bySize.large}`);

  const byAccess = {
    public: allMissingParks.filter((p) => p.openToPublic === "Yes").length,
    private: allMissingParks.filter((p) => p.openToPublic === "No").length,
  };
  console.log(`\nAccess:`);
  console.log(`  Public: ${byAccess.public}`);
  console.log(`  Private/Restricted: ${byAccess.private}`);

  // Export to JSON
  const fs = await import("fs");
  const reportPath = "./missing-parks-full-report.json";
  await fs.promises.writeFile(
    reportPath,
    JSON.stringify(
      {
        totalMissing: allMissingParks.length,
        summary: { bySize, byAccess },
        parks: allMissingParks,
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log(`\n📄 Full report: ${reportPath}`);

  // Import to database if not dry run
  if (!DRY_RUN && allMissingParks.length > 0) {
    console.log(`\n📥 Importing ${allMissingParks.length} parks to database...`);

    let imported = 0;
    for (const osmPark of allMissingParks) {
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
          osmMatchStatus: "verified",
          osmMatchScore: 1.0,
          siteRef: "OSM_IMPORT", // MARKER TO IDENTIFY NEW PARKS
          completed: false,
        });
        imported++;
      } catch (error) {
        console.error(`  ❌ Failed to import ${osmPark.name}:`, error);
      }
    }

    console.log(`\n✅ Successfully imported ${imported}/${allMissingParks.length} parks`);
    console.log(`\n🔍 To identify new parks, filter by: site_ref = 'OSM_IMPORT'`);
  } else if (DRY_RUN) {
    console.log(`\n💡 Set DRY_RUN=false in the script to import these parks`);
  }
}

main().catch(console.error);

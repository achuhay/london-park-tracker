/**
 * Builds server/data/gigl-parks.json — the park list the app uses.
 *
 * Source: GiGL "Spaces to Visit" v15 (April 2024), the dataset behind goparks.london.
 * GiGL stopped publishing it as open data in Oct 2025, but this last open release is still
 * served by the Greater London Authority's public map server, and every record is licensed
 * under the Open Government Licence v3.0 (attribution required — see LICENCE below).
 *
 * Which sites count as "parks": everything publicly open (access Free / De facto / Part free /
 * Part de facto), minus rivers, canals, footpaths, road verges, sewage works, landscaping around
 * buildings, hard-surfaced areas and allotments, and minus the few sites outside Greater London.
 *
 * Run with:  npx tsx scripts/build-gigl-parks.ts
 */
import { writeFileSync, mkdirSync } from "fs";
import simplify from "@turf/simplify";
import truncate from "@turf/truncate";
import centroid from "@turf/centroid";
import type { Feature, Polygon, MultiPolygon } from "geojson";

const LAYER = "https://gis.london.gov.uk/arcgis/rest/services/apps/LGIF_source_and_context_layers/MapServer/2/query";
const OUT = "server/data/gigl-parks.json";
const LICENCE =
  "Created by Greenspace Information for Greater London CIC (GiGL). " +
  "Contains public sector information licensed under the Open Government Licence v3.0.";

const OPEN_ACCESS = new Set(["Free", "De facto", "Part free", "Part de facto"]);
const NOT_PARKS = new Set([
  "River", "Canal", "Walking/cycling route", "Road island/verge", "Sewage/water works",
  "Landscaping around premises", "Other hard surfaced areas", "Allotments",
]);

// The eight Royal Parks, by GiGL site ID (used by the "Royal Flush" badge).
const ROYAL_PARKS = new Set([
  "OS_RT_0023", // Bushy Park
  "OS_We_0054", // The Green Park
  "OS_Gr_0165", // Greenwich Park
  "OS_We_0065", // Hyde Park
  "OS_MB_0058", // Kensington Gardens
  "OS_MB_0022", // The Regent's Park
  "OS_RT_0169", // Richmond Park
  "OS_We_0159", // St James's Park
]);

// ~0.7 m. Keeps outlines accurate while cutting the file to about a fifth of its raw size.
const SIMPLIFY_TOLERANCE = 0.00001;

type GiglProps = {
  sitename: string; siteid: string; primaryuse: string | null;
  borough: string; access: string; releasedat: string;
};

async function fetchAll(): Promise<Feature<Polygon | MultiPolygon, GiglProps>[]> {
  const all: Feature<Polygon | MultiPolygon, GiglProps>[] = [];
  for (let offset = 0; ; offset += 2000) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "sitename,siteid,primaryuse,borough,access,releasedat",
      outSR: "4326",
      geometryPrecision: "6",
      orderByFields: "objectid",
      resultOffset: String(offset),
      resultRecordCount: "2000",
      f: "geojson",
    });
    const res = await fetch(`${LAYER}?${params}`);
    if (!res.ok) throw new Error(`GLA map server returned ${res.status}`);
    const page = await res.json();
    all.push(...page.features);
    console.log(`Downloaded ${all.length} sites...`);
    if (page.features.length < 2000) break;
  }
  return all;
}

async function main() {
  const features = await fetchAll();

  const parks = features
    .filter((f) => f.geometry && OPEN_ACCESS.has(f.properties.access))
    .filter((f) => f.properties.primaryuse && !NOT_PARKS.has(f.properties.primaryuse))
    .filter((f) => f.properties.borough !== "Outside Greater London")
    .map((f) => {
      let geometry: Polygon | MultiPolygon;
      try {
        geometry = truncate(simplify(f, { tolerance: SIMPLIFY_TOLERANCE }), { precision: 5 }).geometry;
      } catch {
        // A few outlines contain a tiny ring the simplifier rejects — keep those unsimplified.
        geometry = truncate(f, { precision: 5 }).geometry;
      }
      const [lng, lat] = centroid(f).geometry.coordinates;
      return {
        siteId: f.properties.siteid,
        name: f.properties.sitename.trim(),
        boroughs: f.properties.borough,
        primaryUse: f.properties.primaryuse,
        access: f.properties.access,
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        royal: ROYAL_PARKS.has(f.properties.siteid),
        geometry,
      };
    })
    .sort((a, b) => a.siteId.localeCompare(b.siteId));

  const royalFound = parks.filter((p) => p.royal).length;
  if (royalFound !== ROYAL_PARKS.size) throw new Error(`Expected 8 Royal Parks, found ${royalFound}`);

  mkdirSync("server/data", { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    source: "GiGL Spaces to Visit v15 (released April 2024), via the GLA map server",
    licence: LICENCE,
    generated: new Date().toISOString().slice(0, 10),
    count: parks.length,
    parks,
  }));
  console.log(`Wrote ${parks.length} parks to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

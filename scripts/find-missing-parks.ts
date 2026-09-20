/**
 * find-missing-parks.ts
 *
 * Finds public green spaces that exist in OpenStreetMap but are missing from
 * our parks table, and (optionally) imports them.
 *
 * This replaces the borough-bounding-box approach in import-missing-parks.ts,
 * which had two bugs that silently hid real parks:
 *
 *   1. COVERAGE HOLES. Each borough was approximated by one hand-typed
 *      lat/lon rectangle. Those 33 rectangles do not tile Greater London —
 *      they leave gaps (and overlaps), so anything in a gap was never even
 *      queried. Southfield Recreation Ground in Acton sat in one of those gaps.
 *      Here we ask Overpass for the borough's real administrative boundary
 *      instead, so coverage is exact and the borough name is correct by
 *      construction rather than inferred from which rectangle a park fell in.
 *
 *   2. AREA CUT-OFF TOO HIGH. The old script skipped anything under 5,000 m².
 *      Plenty of genuine neighbourhood parks are smaller than half a hectare
 *      (West Park in Acton is 3,875 m²). The floor is now 2,000 m² and is
 *      configurable with --min-area.
 *
 * Usage:
 *   npx tsx scripts/find-missing-parks.ts                  # dry run, whole of London
 *   npx tsx scripts/find-missing-parks.ts --borough Ealing # one borough
 *   npx tsx scripts/find-missing-parks.ts --min-area 5000  # raise the size floor
 *   npx tsx scripts/find-missing-parks.ts --apply          # insert everything found
 *   npx tsx scripts/find-missing-parks.ts --borough Ealing --apply \
 *       --only "Mill Hill Park, West Park"                 # insert just these
 *
 * Output: scripts/missing-parks.csv (review this before using --apply)
 */

import "dotenv/config";
import { pool } from "../server/db";
import { writeFileSync } from "fs";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "LondonParkTracker/1.0 (park data reconciliation)";
const SLEEP_MS = 2500; // be polite to the free Overpass instance

const APPLY = process.argv.includes("--apply");
const MIN_AREA = Number(argValue("--min-area") ?? 2000);
const ONLY_BOROUGH = argValue("--borough");
/**
 * Import only these parks by name. The intended workflow is: run once without
 * --apply, read scripts/missing-parks.csv, then re-run with --apply and
 * --only "Name, Other Name" listing just the ones you decided are real.
 */
const ONLY_NAMES = argValue("--only")
  ?.split(",")
  .map((n) => n.trim().toLowerCase())
  .filter(Boolean);

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Our borough name (as stored in parks.borough) -> the borough's name in OSM.
 * Verified against admin_level=8 boundaries inside the Greater London relation.
 * City of London is not admin_level=8, so it is looked up without that filter.
 */
const BOROUGH_OSM_NAMES: Record<string, string> = {
  "Barking and Dagenham": "London Borough of Barking and Dagenham",
  Barnet: "London Borough of Barnet",
  Bexley: "London Borough of Bexley",
  Brent: "London Borough of Brent",
  Bromley: "London Borough of Bromley",
  Camden: "London Borough of Camden",
  "City of London": "City of London",
  Croydon: "London Borough of Croydon",
  Ealing: "London Borough of Ealing",
  Enfield: "London Borough of Enfield",
  Greenwich: "Royal Borough of Greenwich",
  Hackney: "London Borough of Hackney",
  "Hammersmith and Fulham": "London Borough of Hammersmith and Fulham",
  Haringey: "London Borough of Haringey",
  Harrow: "London Borough of Harrow",
  Havering: "London Borough of Havering",
  Hillingdon: "London Borough of Hillingdon",
  Hounslow: "London Borough of Hounslow",
  Islington: "London Borough of Islington",
  "Kensington and Chelsea": "Royal Borough of Kensington and Chelsea",
  "Kingston upon Thames": "Royal Borough of Kingston upon Thames",
  Lambeth: "London Borough of Lambeth",
  Lewisham: "London Borough of Lewisham",
  Merton: "London Borough of Merton",
  Newham: "London Borough of Newham",
  Redbridge: "London Borough of Redbridge",
  "Richmond upon Thames": "London Borough of Richmond upon Thames",
  Southwark: "London Borough of Southwark",
  Sutton: "London Borough of Sutton",
  "Tower Hamlets": "London Borough of Tower Hamlets",
  "Waltham Forest": "London Borough of Waltham Forest",
  Wandsworth: "London Borough of Wandsworth",
  Westminster: "City of Westminster",
};

interface Candidate {
  osmId: string;
  name: string;
  osmType: string; // the leisure/landuse value
  borough: string;
  polygon: [number, number][]; // [lng, lat] — the format the map component expects
  centre: [number, number]; // [lng, lat]
  area: number; // m²
  accessTag: string | null;
  /** Non-blocking warning for the reviewer, e.g. a nearby park with the same name. */
  reviewNote: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Shoelace area in m², using a local equirectangular approximation. */
function polygonArea(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const mPerDegLon = 111320 * Math.cos((midLat * Math.PI) / 180);
  const mPerDegLat = 110540;
  let a = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    a += coords[i][0] * mPerDegLon * (coords[j][1] * mPerDegLat)
       - coords[j][0] * mPerDegLon * (coords[i][1] * mPerDegLat);
  }
  return Math.abs(a / 2);
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Pull the usable outer ring out of an OSM element.
 * For a relation (multipolygon) we take the LARGEST outer ring rather than
 * concatenating every outer member — concatenating produces a nonsense
 * self-crossing shape when a site has several detached parts.
 */
function extractRing(element: any): [number, number][] {
  if (element.type === "way" && element.geometry) {
    return element.geometry.map((n: any) => [n.lon, n.lat] as [number, number]);
  }
  if (element.type === "relation" && element.members) {
    const rings = element.members
      .filter((m: any) => m.role === "outer" && m.geometry?.length >= 3)
      .map((m: any) => m.geometry.map((n: any) => [n.lon, n.lat] as [number, number]));
    if (rings.length === 0) return [];
    return rings.reduce((best: [number, number][], r: [number, number][]) =>
      polygonArea(r) > polygonArea(best) ? r : best
    );
  }
  return [];
}

async function fetchBorough(dbName: string, osmName: string): Promise<Candidate[]> {
  // City of London is not tagged admin_level=8, so don't filter on it there.
  const areaFilter =
    dbName === "City of London"
      ? `area["name"="${osmName}"]["boundary"="administrative"]->.b;`
      : `area["name"="${osmName}"]["admin_level"="8"]->.b;`;

  const query = `
    [out:json][timeout:180];
    ${areaFilter}
    (
      way(area.b)["leisure"~"^(park|garden|nature_reserve|common)$"]["name"];
      way(area.b)["landuse"~"^(recreation_ground|village_green)$"]["name"];
      relation(area.b)["leisure"~"^(park|garden|nature_reserve|common)$"]["name"];
      relation(area.b)["landuse"~"^(recreation_ground|village_green)$"]["name"];
    );
    out geom;
  `;

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Overpass ${res.status} for ${osmName}`);

  const json = (await res.json()) as any;
  const out: Candidate[] = [];

  for (const el of json.elements ?? []) {
    const tags = el.tags ?? {};
    if (!tags.name) continue;

    const ring = extractRing(el);
    if (ring.length < 3) continue;

    const area = polygonArea(ring);
    if (area < MIN_AREA) continue;

    // Skip things that are a facility rather than a place you'd go for a run.
    if (tags.leisure === "playground" || tags.leisure === "dog_park" || tags.leisure === "pitch") continue;

    const lats = ring.map((c) => c[1]);
    const lons = ring.map((c) => c[0]);
    const centre: [number, number] = [
      (Math.min(...lons) + Math.max(...lons)) / 2,
      (Math.min(...lats) + Math.max(...lats)) / 2,
    ];

    out.push({
      osmId: `${el.type}/${el.id}`,
      name: tags.name,
      osmType: tags.leisure || tags.landuse || "unknown",
      borough: dbName,
      polygon: ring,
      centre,
      area,
      accessTag: tags.access ?? null,
      reviewNote: "",
    });
  }

  return out;
}

/** Same name-similarity rules the previous importer used, so we stay consistent. */
function areSimilarNames(a: string, b: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().trim().replace(/^the\s+/i, "").replace(/'/g, "").replace(/[*]/g, "").replace(/\s+/g, " ").trim();
  const n1 = normalize(a);
  const n2 = normalize(b);
  if (n1 === n2) return true;
  if (n1.includes(n2) || n2.includes(n1)) return true;

  const w1 = n1.split(" ").filter(Boolean);
  const w2 = n2.split(" ").filter(Boolean);

  if (w1.length <= 3 || w2.length <= 3) {
    const shorter = w1.length < w2.length ? w1 : w2;
    const longer = w1.length < w2.length ? w2 : w1;
    if (shorter.length >= 2 && shorter.every((w) => longer.some((l) => l.includes(w) || w.includes(l)))) return true;
  }

  const s1 = new Set(w1);
  const s2 = new Set(w2);
  const inter = [...s1].filter((x) => s2.has(x));
  if (inter.length / new Set([...s1, ...s2]).size > 0.7) return true;

  const generic = new Set([
    "park", "gardens", "garden", "green", "space", "open",
    "playing", "field", "fields", "recreation", "ground",
  ]);
  const g1 = w1.filter((w) => !generic.has(w));
  const g2 = w2.filter((w) => !generic.has(w));
  if (g1.length && g2.length) {
    const si = g1.filter((w) => g2.includes(w));
    if (si.length >= 2 && si.length >= Math.min(g1.length, g2.length)) return true;
  }
  return false;
}

function normalizeName(s: string): string {
  return s.toLowerCase().trim().replace(/^the\s+/i, "").replace(/'/g, "").replace(/[*]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Decide what to do with a candidate.
 *
 *   "skip"   - we are confident this is already in the database.
 *   "review" - probably new, but something nearby looks similar enough that a
 *              human should glance at it before importing.
 *   "new"    - no sign of it in the database.
 *
 * The "same name, same borough" skip matters because OpenStreetMap often splits
 * one site into several ways that all carry the same name (Horsenden Hill Open
 * Space and Acton Green Common are both split this way). Without it we would
 * add a second, partial copy of a park we already have.
 */
function classify(c: Candidate, dbParks: any[]): { verdict: "skip" | "review" | "new"; reason: string } {
  let nearest: { park: any; distance: number } | null = null;

  for (const p of dbParks) {
    if (p.osmId && p.osmId === c.osmId) return { verdict: "skip", reason: `same OSM id as #${p.id} ${p.name}` };

    if (p.borough === c.borough && normalizeName(p.name) === normalizeName(c.name)) {
      return { verdict: "skip", reason: `#${p.id} ${p.name} already has this name in ${c.borough}` };
    }

    if (p.latitude == null || p.longitude == null) continue;
    const d = haversine(c.centre[1], c.centre[0], p.latitude, p.longitude);

    if (d < 20) return { verdict: "skip", reason: `within 20m of #${p.id} ${p.name}` };
    if (d < 200 && areSimilarNames(c.name, p.name)) {
      return { verdict: "skip", reason: `${Math.round(d)}m from #${p.id} ${p.name}, similar name` };
    }

    if (!nearest || d < nearest.distance) nearest = { park: p, distance: d };
  }

  if (nearest && nearest.distance < 300) {
    return {
      verdict: "review",
      reason: `${Math.round(nearest.distance)}m from #${nearest.park.id} ${nearest.park.name} - check they are not the same place`,
    };
  }
  return { verdict: "new", reason: "" };
}

function mapSiteType(osmType: string): string {
  return {
    park: "Public Park",
    garden: "Public Gardens",
    nature_reserve: "Nature Reserve",
    common: "Common Land",
    recreation_ground: "Recreation Ground",
    village_green: "Village Green",
  }[osmType] ?? "Public Park";
}

async function main() {
  const client = await pool.connect();

  // Does this database have the multi-city column yet? (The Edinburgh work adds
  // it; the live database may not have had the migration run.)
  const hasCity =
    (await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='parks' AND column_name='city'`
    )).rowCount > 0;

  const { rows: dbParks } = await client.query(
    `SELECT id, name, borough, latitude, longitude, osm_id AS "osmId" FROM parks`
  );

  const boroughs = ONLY_BOROUGH
    ? [ONLY_BOROUGH]
    : Object.keys(BOROUGH_OSM_NAMES);

  for (const b of boroughs) {
    if (!BOROUGH_OSM_NAMES[b]) {
      console.error(`Unknown borough "${b}". Valid names:\n  ${Object.keys(BOROUGH_OSM_NAMES).join("\n  ")}`);
      client.release();
      await pool.end();
      process.exit(1);
    }
  }

  console.log(`\nComparing OpenStreetMap against ${dbParks.length} parks already in the database`);
  console.log(`Minimum size: ${MIN_AREA.toLocaleString()} m²   Boroughs: ${boroughs.length}`);
  if (ONLY_NAMES) console.log(`Restricted to: ${ONLY_NAMES.join(", ")}`);
  console.log(APPLY ? "Mode: APPLY (will insert)\n" : "Mode: dry run (nothing will be written)\n");

  const missing: Candidate[] = [];
  const seenOsmIds = new Set<string>();

  for (let i = 0; i < boroughs.length; i++) {
    const b = boroughs[i];
    process.stdout.write(`[${i + 1}/${boroughs.length}] ${b.padEnd(26)}`);

    let found: Candidate[];
    try {
      found = await fetchBorough(b, BOROUGH_OSM_NAMES[b]);
    } catch (err) {
      console.log(`  FAILED: ${(err as Error).message}`);
      continue;
    }

    const gaps: Candidate[] = [];
    let skipped = 0;
    for (const c of found) {
      if (seenOsmIds.has(c.osmId)) continue; // a site can straddle two boroughs
      const { verdict, reason } = classify(c, dbParks);
      if (verdict === "skip") {
        skipped++;
        continue;
      }
      if (ONLY_NAMES && !ONLY_NAMES.includes(c.name.toLowerCase())) continue;
      c.reviewNote = verdict === "review" ? reason : "";
      seenOsmIds.add(c.osmId);
      gaps.push(c);
    }

    console.log(`  ${String(found.length).padStart(4)} in OSM   ${String(skipped).padStart(4)} already have   ${String(gaps.length).padStart(4)} missing`);
    gaps.forEach((g) =>
      console.log(`        - ${g.name} (${mapSiteType(g.osmType)}, ${(g.area / 10000).toFixed(2)} ha)${g.reviewNote ? `  [check: ${g.reviewNote}]` : ""}`)
    );

    missing.push(...gaps);
    if (i < boroughs.length - 1) await sleep(SLEEP_MS);
  }

  console.log(`\n${"=".repeat(60)}`);
  if (ONLY_NAMES) {
    const got = new Set(missing.map((m) => m.name.toLowerCase()));
    const notFound = ONLY_NAMES.filter((n) => !got.has(n));
    if (notFound.length) console.log(`Not found (check spelling, or already in the database): ${notFound.join(", ")}`);
  }
  const needChecking = missing.filter((m) => m.reviewNote).length;
  console.log(`Missing parks found: ${missing.length}  (${needChecking} worth eyeballing first)`);

  const csv = [
    "name,borough,site_type,osm_id,hectares,latitude,longitude,access_tag,check_before_importing,osm_link",
    ...missing.map((m) =>
      [
        `"${m.name.replace(/"/g, '""')}"`,
        m.borough,
        mapSiteType(m.osmType),
        m.osmId,
        (m.area / 10000).toFixed(3),
        m.centre[1].toFixed(7),
        m.centre[0].toFixed(7),
        m.accessTag ?? "",
        `"${m.reviewNote.replace(/"/g, '""')}"`,
        `https://www.openstreetmap.org/${m.osmId}`,
      ].join(",")
    ),
  ].join("\n");
  writeFileSync("scripts/missing-parks.csv", csv);
  console.log("Review list written to scripts/missing-parks.csv");

  if (!APPLY) {
    console.log("\nRe-run with --apply to add these to the database.");
    client.release();
    await pool.end();
    return;
  }

  let inserted = 0;
  for (const m of missing) {
    const isPublic = !m.accessTag || m.accessTag === "yes" || m.accessTag === "permissive";
    const cols = [
      "name", "borough", "site_type", "open_to_public", "access_category",
      "latitude", "longitude", "polygon", "osm_id", "osm_match_status",
      "osm_match_score", "site_ref", "completed",
    ];
    const vals: any[] = [
      m.name, m.borough, mapSiteType(m.osmType),
      isPublic ? "Yes" : "No", isPublic ? "Public" : "Not Public",
      m.centre[1], m.centre[0], JSON.stringify(m.polygon),
      m.osmId, "verified", 1.0, "OSM_IMPORT", false,
    ];
    if (hasCity) {
      cols.push("city");
      vals.push("london");
    }
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(",");
    try {
      await client.query(`INSERT INTO parks (${cols.join(",")}) VALUES (${placeholders})`, vals);
      inserted++;
    } catch (err) {
      console.log(`  Could not insert ${m.name}: ${(err as Error).message}`);
    }
  }
  console.log(`\nInserted ${inserted} of ${missing.length} parks (site_ref = 'OSM_IMPORT').`);

  client.release();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

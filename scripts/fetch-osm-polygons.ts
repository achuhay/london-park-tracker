/**
 * Fetch polygon boundaries from OpenStreetMap for London parks
 * Caches OSM data locally to avoid repeated API calls
 */

import { db } from "../server/db";
import { parks } from "../shared/schema";
import { eq, isNull, and } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

const OVERPASS_API = "https://overpass-api.de/api/interpreter";
const CACHE_FILE = path.join(process.cwd(), "scripts/osm-cache.json");

interface OSMElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  members?: Array<{
    type: string;
    ref: number;
    role: string;
    geometry?: Array<{ lat: number; lon: number }>;
  }>;
}

interface PolygonCandidate {
  osmId: string;
  name: string;
  type: string;
  polygon: number[][];
  area: number;
  centroid: [number, number];
  tags: Record<string, string>;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculatePolygonArea(coords: number[][]): number {
  if (coords.length < 3) return 0;
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = coords[i][0] * 111320 * Math.cos(coords[i][1] * Math.PI / 180);
    const y1 = coords[i][1] * 110540;
    const x2 = coords[j][0] * 111320 * Math.cos(coords[j][1] * Math.PI / 180);
    const y2 = coords[j][1] * 110540;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function calculateCentroid(coords: number[][]): [number, number] {
  let sumLng = 0, sumLat = 0;
  for (const [lng, lat] of coords) {
    sumLng += lng;
    sumLat += lat;
  }
  return [sumLng / coords.length, sumLat / coords.length];
}

function calculateNameScore(parkName: string, osmName: string): number {
  const normalize = (s: string) => s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  const p = normalize(parkName);
  const o = normalize(osmName);
  
  if (p === o) return 1.0;
  if (p.includes(o) || o.includes(p)) return 0.8;
  
  const pWords = new Set(p.split(' ').filter(w => w.length > 2));
  const oWords = new Set(o.split(' ').filter(w => w.length > 2));
  
  let matches = 0;
  for (const word of pWords) {
    if (oWords.has(word)) matches++;
  }
  
  if (pWords.size === 0) return 0;
  return matches / Math.max(pWords.size, oWords.size);
}

function extractPolygonCoords(element: OSMElement): number[][] | null {
  if (element.geometry && element.geometry.length > 0) {
    return element.geometry.map(p => [p.lon, p.lat]);
  }
  
  if (element.members) {
    const outerMembers = element.members.filter(m => m.role === 'outer' && m.geometry);
    if (outerMembers.length > 0 && outerMembers[0].geometry) {
      return outerMembers[0].geometry.map(p => [p.lon, p.lat]);
    }
  }
  
  return null;
}

async function queryAllLondonParks(): Promise<OSMElement[]> {
  // Check cache first
  if (fs.existsSync(CACHE_FILE)) {
    console.log('Loading OSM data from cache...');
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    console.log(`Loaded ${cached.length} elements from cache`);
    return cached;
  }
  
  console.log('Querying Overpass API for all London parks (this may take a while)...');
  
  const bbox = "51.28,-0.51,51.69,0.33";
  
  const query = `
    [out:json][timeout:300];
    (
      way["leisure"~"park|garden|nature_reserve|recreation_ground|common"](${bbox});
      way["landuse"~"recreation_ground|grass|meadow|forest|cemetery|allotments"](${bbox});
      relation["leisure"~"park|garden|nature_reserve|recreation_ground|common"](${bbox});
      relation["landuse"~"recreation_ground|grass|meadow|forest|cemetery|allotments"](${bbox});
      relation["boundary"~"national_park|protected_area"](${bbox});
    );
    out geom;
  `;
  
  const response = await fetch(OVERPASS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  
  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`);
  }
  
  const data = await response.json();
  const elements = data.elements || [];
  
  // Cache the results
  fs.writeFileSync(CACHE_FILE, JSON.stringify(elements));
  console.log(`Cached ${elements.length} OSM elements`);
  
  return elements;
}

function buildCandidates(elements: OSMElement[]): PolygonCandidate[] {
  const candidates: PolygonCandidate[] = [];
  
  for (const element of elements) {
    const tags = element.tags || {};
    const osmName = tags.name || tags['name:en'] || '';
    
    const coords = extractPolygonCoords(element);
    if (!coords || coords.length < 3) continue;
    
    const area = calculatePolygonArea(coords);
    const centroid = calculateCentroid(coords);
    
    candidates.push({
      osmId: `${element.type}/${element.id}`,
      name: osmName,
      type: tags.leisure || tags.landuse || tags.boundary || 'unknown',
      polygon: coords,
      area,
      centroid,
      tags,
    });
  }
  
  return candidates;
}

function findBestMatch(
  park: { id: number; name: string; latitude: number | null; longitude: number | null },
  candidates: PolygonCandidate[],
  maxDistance: number = 500
): {
  bestMatch: (PolygonCandidate & { nameScore: number }) | null;
  alternatives: Array<PolygonCandidate & { nameScore: number }>;
  status: 'matched' | 'ambiguous' | 'no_match';
} {
  if (!park.latitude || !park.longitude) {
    return { bestMatch: null, alternatives: [], status: 'no_match' };
  }
  
  const nearby = candidates
    .map(c => ({
      ...c,
      distance: haversineDistance(park.latitude!, park.longitude!, c.centroid[1], c.centroid[0]),
      nameScore: c.name ? calculateNameScore(park.name, c.name) : 0,
    }))
    .filter(c => c.distance <= maxDistance)
    .sort((a, b) => {
      if (a.nameScore >= 0.7 && b.nameScore < 0.7) return -1;
      if (b.nameScore >= 0.7 && a.nameScore < 0.7) return 1;
      if (Math.abs(a.nameScore - b.nameScore) < 0.2) {
        return b.area - a.area;
      }
      return b.nameScore - a.nameScore;
    });
  
  if (nearby.length === 0) {
    return { bestMatch: null, alternatives: [], status: 'no_match' };
  }
  
  const bestMatch = nearby[0];
  const alternatives = nearby.slice(1, 4);
  
  let status: 'matched' | 'ambiguous' | 'no_match' = 'matched';
  
  if (bestMatch.nameScore < 0.5 && bestMatch.distance > 200) {
    status = 'ambiguous';
  } else if (alternatives.length > 0 && alternatives[0].nameScore >= 0.5) {
    status = 'ambiguous';
  }
  
  return { bestMatch, alternatives, status };
}

async function main() {
  console.log('=== OSM Polygon Fetcher for London Parks ===\n');
  
  const osmElements = await queryAllLondonParks();
  const candidates = buildCandidates(osmElements);
  console.log(`Built ${candidates.length} polygon candidates\n`);
  
  const parksToProcess = await db.select()
    .from(parks)
    .where(isNull(parks.osmMatchStatus));
  
  console.log(`Processing ${parksToProcess.length} parks without match status...\n`);
  
  if (parksToProcess.length === 0) {
    console.log('All parks have been processed!');
    return;
  }
  
  let matched = 0, ambiguous = 0, noMatch = 0;
  
  for (let i = 0; i < parksToProcess.length; i++) {
    const park = parksToProcess[i];
    const result = findBestMatch(park, candidates);
    
    const updateData: Record<string, any> = {
      osmMatchStatus: result.status,
    };
    
    if (result.bestMatch) {
      updateData.polygon = result.bestMatch.polygon;
      updateData.osmId = result.bestMatch.osmId;
      updateData.osmMatchScore = result.bestMatch.nameScore;
    }
    
    if (result.alternatives.length > 0) {
      updateData.alternativePolygons = result.alternatives.map(alt => ({
        osmId: alt.osmId,
        name: alt.name,
        type: alt.type,
        polygon: alt.polygon,
        area: alt.area,
        nameScore: alt.nameScore,
      }));
    }
    
    await db.update(parks)
      .set(updateData)
      .where(eq(parks.id, park.id));
    
    if (result.status === 'matched') matched++;
    else if (result.status === 'ambiguous') ambiguous++;
    else noMatch++;
    
    if ((i + 1) % 100 === 0) {
      console.log(`Progress: ${i + 1}/${parksToProcess.length} (matched: ${matched}, ambiguous: ${ambiguous}, no_match: ${noMatch})`);
    }
  }
  
  console.log('\n=== COMPLETE ===');
  console.log(`Total: ${parksToProcess.length}`);
  console.log(`Matched: ${matched} (${(matched/parksToProcess.length*100).toFixed(1)}%)`);
  console.log(`Ambiguous: ${ambiguous} (${(ambiguous/parksToProcess.length*100).toFixed(1)}%)`);
  console.log(`No match: ${noMatch} (${(noMatch/parksToProcess.length*100).toFixed(1)}%)`);
}

main().catch(console.error);

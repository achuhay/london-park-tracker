import type { Park } from "@shared/schema";

// A park counts as visited when at least this much of the route lies inside its outline.
// Stops a single GPS point on the edge, or a line between two points cutting a corner,
// from counting as a visit.
export const MIN_METRES_INSIDE = 20;

// Routes are checked every 5 m along their length (Strava's summary routes can have
// points 30+ m apart, so we fill in the gaps rather than only checking the raw points).
const SAMPLE_STEP_METRES = 5;

// Parks with no outline count when the route passes within this distance of their pin.
const PIN_RADIUS_METRES = 30;

// Size of the grid squares used to find which parks are near each point of a route.
const GRID_CELL_METRES = 250;

// Flat projection around central London: accurate to well under 1% across Greater London,
// and lets us work in metres with plain arithmetic.
const LAT0 = 51.5;
const LNG0 = -0.12;
const METRES_PER_DEG_LNG = Math.cos((LAT0 * Math.PI) / 180) * 111320;
const METRES_PER_DEG_LAT = 110540;
const project = (lat: number, lng: number): [number, number] => [
  (lng - LNG0) * METRES_PER_DEG_LNG,
  (lat - LAT0) * METRES_PER_DEG_LAT,
];

interface Ring { xs: Float64Array; ys: Float64Array }
interface Shape { outer: Ring; holes: Ring[] }
interface PreparedPark {
  park: Park;
  shapes: Shape[];
  pin: [number, number] | null;
  minX: number; minY: number; maxX: number; maxY: number;
}
export interface ParkIndex {
  prepared: PreparedPark[];
  grid: Map<string, PreparedPark[]>;
}

// Accepts the outline formats found in the parks table:
// GeoJSON Polygon / MultiPolygon (current), or the older flat [[lng, lat], ...] ring.
function toShapes(polygon: unknown): number[][][][] {
  if (!polygon) return [];
  const p = polygon as any;
  if (p.type === "Polygon" && Array.isArray(p.coordinates)) return [p.coordinates];
  if (p.type === "MultiPolygon" && Array.isArray(p.coordinates)) return p.coordinates;
  if (Array.isArray(p) && p.length > 0) {
    if (typeof p[0]?.[0] === "number") return [[p]];            // one ring
    if (Array.isArray(p[0]?.[0])) return p.map((ring: number[][]) => [ring]); // several rings
  }
  return [];
}

function toRing(coords: number[][]): Ring {
  const xs = new Float64Array(coords.length);
  const ys = new Float64Array(coords.length);
  coords.forEach(([lng, lat], i) => {
    const [x, y] = project(lat, lng);
    xs[i] = x;
    ys[i] = y;
  });
  return { xs, ys };
}

function inRing(ring: Ring, x: number, y: number): boolean {
  const { xs, ys } = ring;
  let inside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    if ((ys[i] > y) !== (ys[j] > y) && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]) {
      inside = !inside;
    }
  }
  return inside;
}

function containsPoint(p: PreparedPark, x: number, y: number): boolean {
  if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) return false;
  if (p.shapes.length === 0) {
    return p.pin !== null && Math.hypot(x - p.pin[0], y - p.pin[1]) <= PIN_RADIUS_METRES;
  }
  return p.shapes.some((s) => inRing(s.outer, x, y) && !s.holes.some((h) => inRing(h, x, y)));
}

const cellKey = (cx: number, cy: number) => `${cx},${cy}`;

/** Prepare parks once so many routes can be checked against them quickly. */
export function buildParkIndex(parks: Park[]): ParkIndex {
  const prepared: PreparedPark[] = [];
  const grid = new Map<string, PreparedPark[]>();

  for (const park of parks) {
    const shapes: Shape[] = toShapes(park.polygon)
      .filter((rings) => rings[0]?.length >= 3)
      .map((rings) => ({ outer: toRing(rings[0]), holes: rings.slice(1).filter((r) => r.length >= 3).map(toRing) }));
    const pin = park.latitude != null && park.longitude != null ? project(park.latitude, park.longitude) : null;
    if (shapes.length === 0 && !pin) continue;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (shapes.length > 0) {
      for (const s of shapes) {
        for (let i = 0; i < s.outer.xs.length; i++) {
          minX = Math.min(minX, s.outer.xs[i]); maxX = Math.max(maxX, s.outer.xs[i]);
          minY = Math.min(minY, s.outer.ys[i]); maxY = Math.max(maxY, s.outer.ys[i]);
        }
      }
    } else {
      [minX, maxX] = [pin![0] - PIN_RADIUS_METRES, pin![0] + PIN_RADIUS_METRES];
      [minY, maxY] = [pin![1] - PIN_RADIUS_METRES, pin![1] + PIN_RADIUS_METRES];
    }

    const p: PreparedPark = { park, shapes, pin, minX, minY, maxX, maxY };
    prepared.push(p);
    for (let cx = Math.floor(minX / GRID_CELL_METRES); cx <= Math.floor(maxX / GRID_CELL_METRES); cx++) {
      for (let cy = Math.floor(minY / GRID_CELL_METRES); cy <= Math.floor(maxY / GRID_CELL_METRES); cy++) {
        const key = cellKey(cx, cy);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push(p);
      }
    }
  }
  return { prepared, grid };
}

function parksAt(index: ParkIndex, x: number, y: number): PreparedPark[] {
  const candidates = index.grid.get(cellKey(Math.floor(x / GRID_CELL_METRES), Math.floor(y / GRID_CELL_METRES)));
  return candidates ? candidates.filter((p) => containsPoint(p, x, y)) : [];
}

/** Rough middle of a stored outline (average of its outline points), as [lat, lng]. */
export function outlineCentre(polygon: unknown): [number, number] | null {
  const points = toShapes(polygon).flatMap((rings) => rings[0] ?? []);
  if (points.length === 0) return null;
  const lng = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const lat = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  return [lat, lng];
}

/** Parks whose outline contains a point (used to carry manual completions across data changes). */
export function parksContainingPoint(index: ParkIndex, lat: number, lng: number): Park[] {
  const [x, y] = project(lat, lng);
  return parksAt(index, x, y).map((p) => p.park);
}

export interface RouteMatch { park: Park; metresInside: number }

/**
 * Which parks does this route visit? routePoints are [lat, lng] pairs (decoded Strava polyline).
 * Returns every park with at least MIN_METRES_INSIDE of the route inside it.
 */
export function matchRoute(routePoints: [number, number][], index: ParkIndex): RouteMatch[] {
  const metres = new Map<PreparedPark, number>();
  const pts = routePoints.map(([lat, lng]) => project(lat, lng));

  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length === 0) continue;
    const steps = Math.max(1, Math.round(length / SAMPLE_STEP_METRES));
    const stepLength = length / steps;
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      for (const p of parksAt(index, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) {
        metres.set(p, (metres.get(p) ?? 0) + stepLength);
      }
    }
  }

  return Array.from(metres.entries())
    .filter(([, m]) => m >= MIN_METRES_INSIDE)
    .map(([p, m]) => ({ park: p.park, metresInside: Math.round(m) }));
}

/** Single-park check, kept for callers that only care about one park. */
export function routePassesThroughPark(routePoints: [number, number][], park: Park): boolean {
  return matchRoute(routePoints, buildParkIndex([park])).length > 0;
}

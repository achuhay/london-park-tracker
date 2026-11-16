/**
 * Route planning on the server.
 *
 * The browser sends the stops of a planned run (start, parks, shaping points, end); this file
 * asks a routing engine for a path along real footpaths, then checks the path against the same
 * "does this park count?" rule used for Strava runs (park-matching.ts) and fixes any park that
 * wouldn't count — by moving the stop onto a path inside the park, or, if the park has no paths
 * (playing fields, meadows), by adding a short dash across the grass.
 *
 * Engines:
 *  - OpenRouteService (HeiGIT), foot-walking profile — main engine. Needs ORS_API_KEY
 *    (free key: 2,000 routes a day, 40 a minute). The key stays on the server.
 *  - Valhalla on the FOSSGIS community server — backup when ORS is missing, over quota or down.
 *    No key, but fair use only (max 1 request a second), so we queue requests to it.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { Park } from "@shared/schema";
import { storage } from "./storage";
import { buildParkIndex, matchRoute, parksContainingPoint, type ParkIndex } from "./park-matching";

type LatLng = [number, number];
/** [lat, lng, elevation in metres or null] */
type TrackPoint = [number, number, number | null];

interface EngineRoute {
  coords: TrackPoint[];
  /** Index in `coords` where each waypoint sits (same length as the waypoint list). */
  waypointIdx: number[];
  ascentM: number | null;
  engine: "ors" | "valhalla";
}

class RoutingError extends Error {
  constructor(message: string, public status = 502, public userMessage = message) {
    super(message);
  }
}

// ─── Engines ────────────────────────────────────────────────────────────────

// api.openrouteservice.org was retired in 2026; api.heigit.org is the new home (same keys).
const ORS_BASE = process.env.ORS_BASE_URL || "https://api.heigit.org/openrouteservice";
const VALHALLA_URL = process.env.VALHALLA_URL || "https://valhalla1.openstreetmap.de/route";
// Trimmed, because a key pasted into Railway with a stray space, line break or quote marks would
// otherwise be rejected (Node refuses to send a header containing a line break).
const orsKey = () => (process.env.ORS_API_KEY || process.env.VITE_ORS_API_KEY || "").trim().replace(/^["']+|["']+$/g, "");

/** Why OpenRouteService last failed (shown on /api/routing/status), with the key itself scrubbed out. */
let lastOrsError: { at: string; message: string } | null = null;
function noteOrsError(err: unknown) {
  const key = orsKey();
  let message = String((err as Error)?.message ?? err).slice(0, 300);
  if (key) message = message.split(key).join("[key]");
  lastOrsError = { at: new Date().toISOString(), message };
}

const ATTRIBUTION = {
  ors: "Routing © openrouteservice.org by HeiGIT · Map data © OpenStreetMap contributors",
  valhalla: "Routing: Valhalla (FOSSGIS) · Map data © OpenStreetMap contributors",
};

/** Split a long waypoint list into overlapping chunks (each engine caps waypoints per request). */
function chunks(wps: LatLng[], size: number): LatLng[][] {
  if (wps.length <= size) return [wps];
  const out: LatLng[][] = [];
  for (let i = 0; i < wps.length - 1; i += size - 1) out.push(wps.slice(i, i + size));
  return out;
}

/** Join chunk results end to end (each chunk starts where the last one ended). */
function joinChunks(parts: EngineRoute[]): EngineRoute {
  const coords: TrackPoint[] = [];
  const waypointIdx: number[] = [];
  let ascent: number | null = 0;
  parts.forEach((part, n) => {
    const offset = coords.length === 0 ? 0 : coords.length - 1;
    coords.push(...(n === 0 ? part.coords : part.coords.slice(1)));
    part.waypointIdx.forEach((idx, i) => {
      if (n > 0 && i === 0) return; // shared with previous chunk's last waypoint
      waypointIdx.push(idx + offset);
    });
    ascent = ascent === null || part.ascentM === null ? null : ascent + part.ascentM;
  });
  return { coords, waypointIdx, ascentM: ascent, engine: parts[0].engine };
}

async function orsRoute(wps: LatLng[]): Promise<EngineRoute> {
  const key = orsKey();
  if (!key) throw new RoutingError("No ORS key configured", 503);
  const parts: EngineRoute[] = [];
  for (const chunk of chunks(wps, 45)) {
    const res = await fetch(`${ORS_BASE}/v2/directions/foot-walking/geojson`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: key },
      body: JSON.stringify({
        coordinates: chunk.map(([lat, lng]) => [lng, lat]),
        elevation: true,
        instructions: false,
        preference: "recommended",
        // How far a stop may be from the nearest path (metres) before ORS gives up
        radiuses: chunk.map(() => 400),
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok || !body?.features?.[0]) {
      const msg = body?.error?.message || body?.error || `HTTP ${res.status}`;
      // 2010 = a point is too far from any path; 2009 = no route between points
      const code = body?.error?.code;
      if (code === 2010 || code === 2009) {
        throw new RoutingError(`ORS: ${msg}`, 422, "One of the points is too far from any footpath — try moving it.");
      }
      throw new RoutingError(`ORS: ${msg}`, res.status === 429 || res.status === 403 ? 503 : 502);
    }
    const f = body.features[0];
    parts.push({
      coords: f.geometry.coordinates.map(([lng, lat, ele]: number[]) => [lat, lng, ele ?? null] as TrackPoint),
      waypointIdx: f.properties.way_points,
      ascentM: typeof f.properties.ascent === "number" ? f.properties.ascent : null,
      engine: "ors",
    });
  }
  return joinChunks(parts);
}

/** Valhalla's compressed line format (6 decimal places). */
function decodePolyline6(str: string): LatLng[] {
  const out: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  const next = () => {
    let b, shift = 0, result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < str.length) {
    lat += next();
    lng += next();
    out.push([lat / 1e6, lng / 1e6]);
  }
  return out;
}

// The FOSSGIS server asks for at most one request a second, so requests queue up here.
let valhallaQueue: Promise<unknown> = Promise.resolve();
let lastValhallaAt = 0;
function valhallaThrottled<T>(fn: () => Promise<T>): Promise<T> {
  const run = valhallaQueue.then(async () => {
    const wait = lastValhallaAt + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastValhallaAt = Date.now();
    return fn();
  });
  valhallaQueue = run.catch(() => undefined);
  return run;
}

async function valhallaRoute(wps: LatLng[]): Promise<EngineRoute> {
  const parts: EngineRoute[] = [];
  for (const chunk of chunks(wps, 20)) {
    const body: any = await valhallaThrottled(async () => {
      const res = await fetch(VALHALLA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "DetourParkChallenge/1.0 (route planner)" },
        body: JSON.stringify({
          locations: chunk.map(([lat, lon]) => ({ lat, lon, type: "break" })),
          costing: "pedestrian",
          costing_options: { pedestrian: { walkway_factor: 0.9 } },
          directions_type: "none",
        }),
        signal: AbortSignal.timeout(15000),
      });
      const json: any = await res.json().catch(() => null);
      if (!res.ok || !json?.trip) {
        throw new RoutingError(`Valhalla: ${json?.error || `HTTP ${res.status}`}`, res.status === 400 ? 422 : 502,
          res.status === 400 ? "Couldn't find a walking route between these points — try moving one." : undefined);
      }
      return json;
    });
    const coords: TrackPoint[] = [];
    const waypointIdx: number[] = [0];
    for (const leg of body.trip.legs) {
      const pts = decodePolyline6(leg.shape);
      coords.push(...(coords.length === 0 ? pts : pts.slice(1)).map(([a, b]) => [a, b, null] as TrackPoint));
      waypointIdx.push(coords.length - 1);
    }
    parts.push({ coords, waypointIdx, ascentM: null, engine: "valhalla" });
  }
  return joinChunks(parts);
}

// Recent routes, so dragging a point back, undo, or re-opening the planner doesn't use up quota.
const routeCache = new Map<string, { at: number; route: EngineRoute }>();
const ROUTE_CACHE_MS = 30 * 60 * 1000;
const cacheKey = (wps: LatLng[]) => wps.map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join("|");

async function routeVia(wps: LatLng[]): Promise<EngineRoute> {
  const key = cacheKey(wps);
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < ROUTE_CACHE_MS) return hit.route;

  let route: EngineRoute;
  try {
    route = await orsRoute(wps);
    lastOrsError = null;
  } catch (err) {
    // A point that genuinely can't be reached won't be fixed by another engine.
    if (err instanceof RoutingError && err.status === 422) throw err;
    if (orsKey()) {
      noteOrsError(err);
      console.warn("[routing] ORS failed, falling back to Valhalla:", lastOrsError?.message);
    }
    route = await valhallaRoute(wps);
  }
  routeCache.set(key, { at: Date.now(), route });
  if (routeCache.size > 500) routeCache.delete(routeCache.keys().next().value!);
  return route;
}

/** Snap points to the nearest walkable path (ORS only). Returns null where nothing is in range. */
async function snapToPaths(points: LatLng[], radiusM: number): Promise<(LatLng | null)[]> {
  const key = orsKey();
  if (!key || points.length === 0) return points.map(() => null);
  const out: (LatLng | null)[] = [];
  for (let i = 0; i < points.length; i += 50) {
    const batch = points.slice(i, i + 50);
    try {
      const res = await fetch(`${ORS_BASE}/v2/snap/foot-walking`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: key },
        body: JSON.stringify({ locations: batch.map(([lat, lng]) => [lng, lat]), radius: radiusM }),
        signal: AbortSignal.timeout(10000),
      });
      const body: any = await res.json();
      const locs: any[] = body?.locations ?? [];
      batch.forEach((_, j) => {
        const l = locs[j];
        out.push(l?.location ? [l.location[1], l.location[0]] : null);
      });
    } catch {
      batch.forEach(() => out.push(null));
    }
  }
  return out;
}

// ─── Park geometry helpers ──────────────────────────────────────────────────

// Flat projection around central London (same as park-matching.ts) so we can work in metres.
const LAT0 = 51.5, LNG0 = -0.12;
const M_PER_LNG = Math.cos((LAT0 * Math.PI) / 180) * 111320;
const M_PER_LAT = 110540;
const toXY = (lat: number, lng: number): LatLng => [(lng - LNG0) * M_PER_LNG, (lat - LAT0) * M_PER_LAT];
const toLatLng = (x: number, y: number): LatLng => [y / M_PER_LAT + LAT0, x / M_PER_LNG + LNG0];

function haversineM(a: LatLng | TrackPoint, b: LatLng | TrackPoint): number {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Outline rings of a park in metres (handles the same formats as park-matching.ts). */
function parkRingsXY(polygon: unknown): LatLng[][] {
  const p = polygon as any;
  let rings: number[][][] = [];
  if (p?.type === "Polygon") rings = p.coordinates;
  else if (p?.type === "MultiPolygon") rings = p.coordinates.flat();
  else if (Array.isArray(p) && p.length > 0) rings = typeof p[0]?.[0] === "number" ? [p] : p;
  return rings.filter((r) => Array.isArray(r) && r.length >= 3).map((r) => r.map(([lng, lat]) => toXY(lat, lng)));
}

function distToRingsM(rings: LatLng[][], x: number, y: number): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j], [x2, y2] = ring[i];
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
      best = Math.min(best, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
    }
  }
  return best;
}

interface ParkGeo {
  park: Park;
  index: ParkIndex;          // index holding just this park (exact counting rule)
  rings: LatLng[][];
  requiredMetres: number;
  /** Points spread across the inside of the park, deepest first: [lat, lng, depth from edge in m] */
  interior: [number, number, number][];
}

let parkData: { at: number; index: ParkIndex; byId: Map<number, Park> } | null = null;
const parkGeoCache = new Map<number, ParkGeo>();

async function getParkData() {
  if (!parkData || Date.now() - parkData.at > 10 * 60 * 1000) {
    // Same set of parks the Strava sync matches against, so "will count" means the same thing.
    const parks = await storage.getParks();
    parkData = { at: Date.now(), index: buildParkIndex(parks), byId: new Map(parks.map((p) => [p.id, p])) };
    parkGeoCache.clear();
  }
  return parkData;
}

function getParkGeo(park: Park): ParkGeo {
  const cached = parkGeoCache.get(park.id);
  if (cached) return cached;
  const index = buildParkIndex([park]);
  const rings = parkRingsXY(park.polygon);
  const requiredMetres = index.prepared[0]?.requiredMetres ?? 20;

  const interior: [number, number, number][] = [];
  if (rings.length > 0) {
    const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const N = 9;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = minX + ((i + 0.5) / N) * (maxX - minX);
        const y = minY + ((j + 0.5) / N) * (maxY - minY);
        const [lat, lng] = toLatLng(x, y);
        if (parksContainingPoint(index, lat, lng).length > 0) interior.push([lat, lng, distToRingsM(rings, x, y)]);
      }
    }
    interior.sort((a, b) => b[2] - a[2]);
  } else if (park.latitude != null && park.longitude != null) {
    interior.push([park.latitude, park.longitude, 30]);
  }
  const geo: ParkGeo = { park, index, rings, requiredMetres, interior };
  parkGeoCache.set(park.id, geo);
  return geo;
}

/**
 * The planner aims a little past the bare minimum, so a few metres of GPS wobble on the day
 * doesn't stop a park counting: +50% for small parks, +10 m for the rest.
 */
const safeMetres = (geo: ParkGeo) => geo.requiredMetres + Math.min(10, geo.requiredMetres * 0.5);

const isInside = (geo: ParkGeo, p: LatLng) => parksContainingPoint(geo.index, p[0], p[1]).length > 0;

/** Metres of the route inside one park, even when it's short of the amount needed to count. */
function metresInsidePark(coords: LatLng[], geo: ParkGeo): number {
  const prepared = geo.index.prepared[0];
  if (!prepared) return 0;
  // Same index, but with "needed" set to 0 so matchRoute always reports the measured amount.
  const relaxed = { ...prepared, requiredMetres: 0 };
  const grid = new Map(Array.from(geo.index.grid.entries()).map(([k, v]) => [k, v.map(() => relaxed)]));
  return matchRoute(coords, { prepared: [relaxed], grid })[0]?.metresInside ?? 0;
}

// ─── Planning ───────────────────────────────────────────────────────────────

const stopSchema = z.object({
  lat: z.number().min(49).max(61),
  lng: z.number().min(-8).max(2),
  parkId: z.number().int().optional(),
  /** The user placed this point by hand — don't move it. */
  pinned: z.boolean().optional(),
});
const planSchema = z.object({
  stops: z.array(stopSchema).min(2).max(60),
  loop: z.boolean().default(false),
});
type PlanStop = z.infer<typeof stopSchema>;

export interface PlannedPark {
  parkId: number;
  metresInside: number;
  requiredMetres: number;
  counts: boolean;
  tight: boolean;
  /** How the planner made it count: moved the stop onto a path inside, or added a dash across the grass. */
  fix: "moved" | "offpath" | null;
}

interface SplicedRoute {
  coords: TrackPoint[];
  waypointIdx: number[];
  offPath: LatLng[][];
}

/** Closest point on the route to a park's outline, as (segment index, point). */
function closestOnRoute(coords: TrackPoint[], geo: ParkGeo, target: LatLng): { seg: number; point: LatLng } {
  const [tx, ty] = toXY(target[0], target[1]);
  let best = { seg: 0, point: [coords[0][0], coords[0][1]] as LatLng, score: Infinity };
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = toXY(coords[i][0], coords[i][1]);
    const [x2, y2] = toXY(coords[i + 1][0], coords[i + 1][1]);
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((tx - x1) * dx + (ty - y1) * dy) / len2));
    const px = x1 + t * dx, py = y1 + t * dy;
    const score = Math.hypot(tx - px, ty - py);
    if (score < best.score) best = { seg: i, point: toLatLng(px, py), score };
  }
  return best;
}

/**
 * Add an out-and-back dash from the nearest point of the route into a park with no usable paths,
 * just long enough (plus a little margin) for the park to count.
 */
function addGrassDash(route: SplicedRoute, geo: ParkGeo): boolean {
  const deep = geo.interior[0];
  if (!deep) return false;
  const target: LatLng = [deep[0], deep[1]];
  const { seg, point: from } = closestOnRoute(route.coords, geo, target);
  const [fx, fy] = toXY(from[0], from[1]);
  const [tx, ty] = toXY(target[0], target[1]);
  const length = Math.hypot(tx - fx, ty - fy);
  const latLngs = route.coords.map((c) => [c[0], c[1]] as LatLng);

  let chosen: LatLng | null = null;
  for (let d = 4; d <= length + 0.01; d += 2) {
    const tip = toLatLng(fx + ((tx - fx) * d) / length, fy + ((ty - fy) * d) / length);
    const trial = [...latLngs.slice(0, seg + 1), from, tip, from, ...latLngs.slice(seg + 1)];
    if (metresInsidePark(trial, geo) >= safeMetres(geo)) {
      chosen = tip;
      break;
    }
  }
  if (!chosen) chosen = target;
  const ele = route.coords[seg][2];
  route.coords.splice(seg + 1, 0, [from[0], from[1], ele], [chosen[0], chosen[1], ele], [from[0], from[1], ele]);
  route.waypointIdx = route.waypointIdx.map((idx) => (idx > seg ? idx + 3 : idx));
  route.offPath.push([from, chosen]);
  return true;
}

async function planRoute(stops: PlanStop[], loop: boolean) {
  const { index: allIndex, byId } = await getParkData();

  const wps = (stops: PlanStop[]): LatLng[] => {
    const list = stops.map((s) => [s.lat, s.lng] as LatLng);
    return loop ? [...list, list[0]] : list;
  };

  let straightM = 0;
  const firstWps = wps(stops);
  for (let i = 1; i < firstWps.length; i++) straightM += haversineM(firstWps[i - 1], firstWps[i]);
  if (straightM > 150_000) throw new RoutingError("Route too long", 400, "That route is over 150 km — try fewer stops.");

  // 1. Route through the stops as given
  let current = stops.map((s) => ({ ...s }));
  let route = await routeVia(wps(current));

  // Which parks are we aiming for (each counted once, even if visited twice)?
  const targetIds = Array.from(new Set(current.map((s) => s.parkId).filter((id): id is number => id != null && byId.has(id))));
  const fixes = new Map<number, PlannedPark["fix"]>();
  // Parks the route doesn't go far enough into (with the safety margin)
  const failing = (r: EngineRoute | SplicedRoute) => {
    const latLngs = r.coords.map((c) => [c[0], c[1]] as LatLng);
    return targetIds.filter((id) => {
      const geo = getParkGeo(byId.get(id)!);
      return metresInsidePark(latLngs, geo) < safeMetres(geo);
    });
  };

  // 2. Parks that wouldn't count: move their stop onto a path well inside the park
  const stillFailing = failing(route);
  const movable = stillFailing.filter((id) => current.some((s) => s.parkId === id && !s.pinned));
  if (movable.length > 0 && route.engine === "ors") {
    const candidates: { parkId: number; point: LatLng; depth: number }[] = [];
    for (const id of movable) {
      const geo = getParkGeo(byId.get(id)!);
      for (const [lat, lng, depth] of geo.interior.slice(0, 16)) candidates.push({ parkId: id, point: [lat, lng], depth });
    }
    const snapped = await snapToPaths(candidates.map((c) => c.point), 60);
    let moved = false;
    for (const id of movable) {
      const geo = getParkGeo(byId.get(id)!);
      const stopIdx = current.findIndex((s) => s.parkId === id && !s.pinned);
      const list = wps(current);
      const prev = list[stopIdx - 1] ?? list[stopIdx + 1];
      const next = list[stopIdx + 1] ?? list[stopIdx - 1];
      let best: { point: LatLng; score: number } | null = null;
      candidates.forEach((c, i) => {
        const s = snapped[i];
        if (c.parkId !== id || !s || !isInside(geo, s)) return;
        const [sx, sy] = toXY(s[0], s[1]);
        const depth = geo.rings.length ? distToRingsM(geo.rings, sx, sy) : 30;
        // Prefer a small detour, and paths a little way in from the edge
        const score = (prev ? haversineM(prev, s) : 0) + (next ? haversineM(s, next) : 0) - 2 * Math.min(depth, 25);
        if (!best || score < best.score) best = { point: s, score };
      });
      if (best) {
        const b = best as { point: LatLng };
        current[stopIdx] = { ...current[stopIdx], lat: b.point[0], lng: b.point[1] };
        fixes.set(id, "moved");
        moved = true;
      }
    }
    if (moved) route = await routeVia(wps(current));
  }

  // 3. Anything still short: add a short dash across the grass
  const spliced: SplicedRoute = { coords: route.coords.map((c) => [...c] as TrackPoint), waypointIdx: [...route.waypointIdx], offPath: [] };
  for (const id of failing(spliced)) {
    if (addGrassDash(spliced, getParkGeo(byId.get(id)!))) fixes.set(id, "offpath");
  }

  // 4. Final check of every park on the route
  const latLngs = spliced.coords.map((c) => [c[0], c[1]] as LatLng);
  const matches = matchRoute(latLngs, allIndex);
  const countedById = new Map(matches.map((m) => [m.park.id, m.metresInside]));
  const parks: PlannedPark[] = targetIds.map((id) => {
    const geo = getParkGeo(byId.get(id)!);
    const counts = countedById.has(id);
    const metresInside = counts ? countedById.get(id)! : metresInsidePark(latLngs, geo);
    return {
      parkId: id,
      metresInside,
      requiredMetres: Math.round(geo.requiredMetres),
      counts,
      /** Counts, but only just — GPS wobble on the day could tip it either way. */
      tight: counts && metresInside < safeMetres(geo),
      fix: counts ? fixes.get(id) ?? null : null,
    };
  });
  const targetSet = new Set(targetIds);
  const bonusParks = matches
    .filter((m) => !targetSet.has(m.park.id))
    .map((m) => ({ parkId: m.park.id, metresInside: m.metresInside }));

  let distanceM = 0;
  for (let i = 1; i < spliced.coords.length; i++) distanceM += haversineM(spliced.coords[i - 1], spliced.coords[i]);

  return {
    coords: spliced.coords,
    waypointIdx: spliced.waypointIdx,
    offPath: spliced.offPath,
    distanceKm: Math.round(distanceM) / 1000,
    ascentM: route.ascentM === null ? null : Math.round(route.ascentM),
    engine: route.engine,
    attribution: ATTRIBUTION[route.engine],
    parks,
    bonusParks,
    /** New positions for stops the planner moved (null = unchanged), so the app can show them. */
    adjustedStops: current.map((s, i) => (s.lat !== stops[i].lat || s.lng !== stops[i].lng ? [s.lat, s.lng] : null)),
  };
}

export type PlanResponse = Awaited<ReturnType<typeof planRoute>>;

// ─── Express wiring ─────────────────────────────────────────────────────────

// Simple per-visitor limit so one browser can't burn through the shared daily routing quota.
const hits = new Map<string, number[]>();
function rateLimited(req: Request): boolean {
  const ip = req.ip || "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 40;
}

export function registerRoutingRoutes(app: Express) {
  app.post("/api/routing/plan", async (req: Request, res: Response) => {
    if (rateLimited(req)) {
      return res.status(429).json({ message: "Planning a lot of routes very quickly — wait a few seconds and try again." });
    }
    const parsed = planSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Route needs 2–60 stops in or near London." });
    }
    try {
      res.json(await planRoute(parsed.data.stops, parsed.data.loop));
    } catch (err) {
      const e = err instanceof RoutingError ? err : new RoutingError((err as Error).message, 500);
      console.error("[routing]", e.message);
      res.status(e.status).json({
        message: e.status >= 500 && e.userMessage === e.message
          ? "The routing service isn't responding right now — try again in a minute."
          : e.userMessage,
      });
    }
  });

  app.get("/api/routing/status", (_req, res) => {
    const engine = orsKey() && !lastOrsError ? "ors" : "valhalla";
    res.json({
      engine,
      attribution: ATTRIBUTION[engine],
      orsKeySet: !!orsKey(),
      // Why OpenRouteService last failed, if it did (the key itself is never shown)
      lastOrsError,
    });
  });
}

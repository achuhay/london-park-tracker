/**
 * Route planner building blocks that don't need React: the shape of a plan, talking to the
 * server's /api/routing/plan, putting stops in a sensible order, suggesting a loop of a target
 * distance, and writing the GPX file.
 */
import type { ParkResponse } from "@shared/routes";
import { getParkCenter, type LocationPoint } from "@/lib/route-utils";

export type LatLng = [number, number];

export type StopKind = "start" | "park" | "via" | "end";

export interface PlanStop {
  id: string;
  kind: StopKind;
  lat: number;
  lng: number;
  name: string;
  parkId?: number;
  /** Placed by hand (dragged) — the server won't move it. */
  pinned?: boolean;
}

export type RouteMode = "loop" | "oneway";

export interface PlanState {
  start: PlanStop | null;
  /** Parks and shaping points, in running order. */
  stops: PlanStop[];
  /** Only used for A→B routes. With no end, the run finishes at the last stop. */
  end: PlanStop | null;
  mode: RouteMode;
}

export const EMPTY_PLAN: PlanState = { start: null, stops: [], end: null, mode: "loop" };

/** What the server sends back (see server/routing.ts). */
export interface PlanResult {
  coords: [number, number, number | null][];
  waypointIdx: number[];
  offPath: [LatLng, LatLng][];
  distanceKm: number;
  ascentM: number | null;
  engine: "ors" | "valhalla";
  attribution: string;
  parks: {
    parkId: number;
    metresInside: number;
    requiredMetres: number;
    counts: boolean;
    tight: boolean;
    fix: "moved" | "offpath" | null;
  }[];
  bonusParks: { parkId: number; metresInside: number }[];
  adjustedStops: (LatLng | null)[];
}

let idCounter = 0;
export const newStopId = (kind: StopKind) => `${kind}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export function parkStop(park: ParkResponse): PlanStop | null {
  const c = getParkCenter(park);
  if (!c) return null;
  return { id: newStopId("park"), kind: "park", lat: c[0], lng: c[1], name: park.name, parkId: park.id };
}

export function pointStop(kind: "start" | "end" | "via", p: LocationPoint): PlanStop {
  return { id: newStopId(kind), kind, lat: p.lat, lng: p.lng, name: p.name, pinned: true };
}

/** Every point the route goes through, in order: start, stops, end (A→B only). */
export function orderedStops(plan: PlanState): PlanStop[] {
  return [
    ...(plan.start ? [plan.start] : []),
    ...plan.stops,
    ...(plan.mode === "oneway" && plan.end ? [plan.end] : []),
  ];
}

export function canRoute(plan: PlanState): boolean {
  return orderedStops(plan).length >= 2;
}

/** Turns "insert after waypoint k of the route" into a position in plan.stops. */
export function stopsIndexAfterWaypoint(plan: PlanState, waypoint: number): number {
  const idx = waypoint + 1 - (plan.start ? 1 : 0);
  return Math.max(0, Math.min(plan.stops.length, idx));
}

// ─── Distances ──────────────────────────────────────────────────────────────

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const pt = (s: { lat: number; lng: number }): LatLng => [s.lat, s.lng];

function pathKm(points: LatLng[], start: LatLng | null, end: LatLng | null): number {
  const all = [...(start ? [start] : []), ...points, ...(end ? [end] : [])];
  let km = 0;
  for (let i = 1; i < all.length; i++) km += haversineKm(all[i - 1], all[i]);
  return km;
}

/** The fixed ends of a plan: its start, and its end (or the start again for a loop). */
function planEnds(plan: PlanState): { start: LatLng | null; end: LatLng | null } {
  const start = plan.start ? pt(plan.start) : null;
  const end = plan.mode === "oneway" ? (plan.end ? pt(plan.end) : null) : start;
  return { start, end };
}

/** Where a new stop adds the least distance (so tapping parks in any order still gives a sensible route). */
export function bestInsertIndex(plan: PlanState, p: LatLng): number {
  const { start, end } = planEnds(plan);
  const pts = plan.stops.map(pt);
  let best = pts.length, bestExtra = Infinity;
  for (let i = 0; i <= pts.length; i++) {
    const prev = i === 0 ? start : pts[i - 1];
    const next = i === pts.length ? end : pts[i];
    const extra = prev && next ? haversineKm(prev, p) + haversineKm(p, next) - haversineKm(prev, next)
      : prev ? haversineKm(prev, p) : next ? haversineKm(p, next) : 0;
    if (extra < bestExtra) { bestExtra = extra; best = i; }
  }
  return best;
}

/**
 * Shortest sensible running order: nearest-stop-next from the start, then "2-opt" — reverse any
 * stretch that makes the route shorter (this un-crosses the route) until nothing improves.
 */
export function orderStops<T>(items: T[], getPoint: (t: T) => LatLng, start: LatLng | null, end: LatLng | null): T[] {
  if (items.length <= 1) return [...items];
  const remaining = [...items];
  const order: T[] = [];
  let here: LatLng = start ?? getPoint(remaining[0]);
  while (remaining.length) {
    let nearest = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (haversineKm(here, getPoint(remaining[i])) < haversineKm(here, getPoint(remaining[nearest]))) nearest = i;
    }
    const [next] = remaining.splice(nearest, 1);
    order.push(next);
    here = getPoint(next);
  }
  let points = order.map(getPoint);
  let improved = true;
  for (let pass = 0; improved && pass < 50; pass++) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let k = i + 1; k < order.length; k++) {
        const candidate = [...points.slice(0, i), ...points.slice(i, k + 1).reverse(), ...points.slice(k + 1)];
        if (pathKm(candidate, start, end) < pathKm(points, start, end) - 1e-9) {
          order.splice(i, k - i + 1, ...order.slice(i, k + 1).reverse());
          points = candidate;
          improved = true;
        }
      }
    }
  }
  return order;
}

/** Re-order a plan's parks for the shortest route. Shaping points are dropped (they only make sense in the old order). */
export function autoOrderPlan(plan: PlanState): PlanState {
  const { start, end } = planEnds(plan);
  const parks = plan.stops.filter((s) => s.kind === "park");
  return { ...plan, stops: orderStops(parks, pt, start, end) };
}

// ─── Auto-plan: the loop that collects the most new parks ───────────────────

/**
 * Picks parks for a loop of about `targetKm` from `start`, collecting as many as possible.
 * Greedy "cheapest insertion": keep adding whichever park adds the least extra distance until the
 * distance budget is used up. Real paths are longer than straight lines, so the budget is the
 * target divided by `detour` (≈1.3 in London; the caller re-runs with the real ratio if needed).
 * Stops at `maxParks`: in dense areas like the City, a long loop could otherwise pick 100+ tiny gardens.
 */
export function suggestLoop(start: LatLng, targetKm: number, candidates: ParkResponse[], detour = 1.3, maxParks = 40): ParkResponse[] {
  const budget = targetKm / detour;
  const pool = candidates
    .map((park) => ({ park, c: getParkCenter(park) }))
    .filter((x): x is { park: ParkResponse; c: LatLng } => x.c !== null && haversineKm(start, x.c) < budget / 2)
    .sort((a, b) => haversineKm(start, a.c) - haversineKm(start, b.c))
    .slice(0, 400);

  const tour: { park: ParkResponse; c: LatLng }[] = [];
  let length = 0;
  const used = new Set<number>();
  while (tour.length < maxParks) {
    let best: { i: number; at: number; extra: number } | null = null;
    pool.forEach((cand, i) => {
      if (used.has(i)) return;
      for (let at = 0; at <= tour.length; at++) {
        const prev = at === 0 ? start : tour[at - 1].c;
        const next = at === tour.length ? start : tour[at].c;
        const extra = haversineKm(prev, cand.c) + haversineKm(cand.c, next) - haversineKm(prev, next);
        if (!best || extra < best.extra) best = { i, at, extra };
      }
    });
    if (!best) break;
    const b = best as { i: number; at: number; extra: number };
    // Small allowance per park for weaving through it, rather than just touching its middle
    if (length + b.extra + 0.05 > budget) break;
    tour.splice(b.at, 0, pool[b.i]);
    used.add(b.i);
    length += b.extra + 0.05;
    if (tour.length % 5 === 0) {
      const ordered = orderStops(tour, (t) => t.c, start, start);
      tour.splice(0, tour.length, ...ordered);
      length = pathKm(tour.map((t) => t.c), start, start) + tour.length * 0.05;
    }
  }
  return orderStops(tour, (t) => t.c, start, start).map((t) => t.park);
}

export function straightKm(stops: PlanStop[], loop: boolean): number {
  const pts = stops.map(pt);
  return pathKm(loop && pts.length ? [...pts, pts[0]] : pts, null, null);
}

// ─── Server ─────────────────────────────────────────────────────────────────

export function planRequestBody(plan: PlanState) {
  return {
    loop: plan.mode === "loop",
    stops: orderedStops(plan).map((s) => ({
      lat: +s.lat.toFixed(6),
      lng: +s.lng.toFixed(6),
      ...(s.parkId != null ? { parkId: s.parkId } : {}),
      ...(s.pinned ? { pinned: true } : {}),
    })),
  };
}

export async function fetchPlan(plan: PlanState, signal?: AbortSignal): Promise<PlanResult> {
  const res = await fetch("/api/routing/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(planRequestBody(plan)),
    credentials: "include",
    signal,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || "Couldn't plan the route — try again in a moment.");
  return body as PlanResult;
}

/** Copy the server's improved stop positions (parks it moved onto a path inside) into the plan. */
export function applyAdjustments(plan: PlanState, result: PlanResult): PlanState {
  const ordered = orderedStops(plan);
  if (!result.adjustedStops.some(Boolean) || result.adjustedStops.length !== ordered.length) return plan;
  const moved = new Map<string, LatLng>();
  ordered.forEach((s, i) => { const a = result.adjustedStops[i]; if (a) moved.set(s.id, a); });
  const fix = (s: PlanStop | null) => (s && moved.has(s.id) ? { ...s, lat: moved.get(s.id)![0], lng: moved.get(s.id)![1] } : s);
  return { ...plan, start: fix(plan.start), end: fix(plan.end), stops: plan.stops.map((s) => fix(s)!) };
}

// ─── GPX ────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A GPX "track" (the exact line to follow, point by point) plus a waypoint for each park.
 * Komoot, Garmin Connect, Strava, Apple Maps-based apps and most watches import this as-is.
 */
export function buildGpx(plan: PlanState, result: PlanResult, parkNames: Map<number, string>, title: string): string {
  const parkWpts = plan.stops
    .filter((s) => s.kind === "park")
    .map((s) => `  <wpt lat="${s.lat.toFixed(6)}" lon="${s.lng.toFixed(6)}">\n    <name>${esc(parkNames.get(s.parkId!) ?? s.name)}</name>\n    <type>Park</type>\n  </wpt>`);
  const trkpts = result.coords.map(([lat, lng, ele]) =>
    ele == null
      ? `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"/>`
      : `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>`,
  );
  const desc = `${result.distanceKm.toFixed(1)} km, ${result.parks.filter((p) => p.counts).length} parks. Planned with Detour — London Park Challenge.`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Detour London Park Challenge" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${esc(title)}</name>
    <desc>${esc(desc)}</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
${parkWpts.join("\n")}
  <trk>
    <name>${esc(title)}</name>
    <desc>${esc(desc)}</desc>
    <type>running</type>
    <trkseg>
${trkpts.join("\n")}
    </trkseg>
  </trk>
</gpx>
`;
}

export function routeTitle(plan: PlanState, result: PlanResult): string {
  const n = result.parks.filter((p) => p.counts).length;
  // "Pinned on map" / "My location" aren't useful in a title; a searched place name is
  const name = plan.start?.name?.split(",")[0];
  const where = name && !["Pinned on map", "My location"].includes(name) ? name : null;
  return `${n} park${n === 1 ? "" : "s"} · ${result.distanceKm.toFixed(1)} km${where ? ` from ${where}` : ""}`;
}

export function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export function formatDuration(mins: number): string {
  const m = Math.round(mins);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

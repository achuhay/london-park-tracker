import type { ParkResponse } from "@shared/routes";
import { parkOutlineCenter } from "@/lib/park-geometry";

/** A geocoded start or end point for a route (from LocationSearch). */
export interface LocationPoint {
  name: string;
  lat: number;
  lng: number;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Returns [lat, lng] for a park: its stored centre point (the middle of its GiGL outline),
 * falling back to the middle of the outline itself.
 */
export function getParkCenter(park: ParkResponse): [number, number] | null {
  if (park.latitude != null && park.longitude != null) {
    return [park.latitude, park.longitude];
  }
  return parkOutlineCenter(park.polygon);
}

type Point = [number, number]; // [lat, lng]

const legKm = (a: Point, b: Point) => haversineKm(a[0], a[1], b[0], b[1]);

/**
 * Where a route begins and ends, if fixed: the start point (A), and the end point (B) —
 * or back to the start for a loop.
 */
function routeEnds(startPoint: LocationPoint | null, endPoint: LocationPoint | null, isLoop: boolean) {
  const start: Point | null = startPoint ? [startPoint.lat, startPoint.lng] : null;
  const end: Point | null = endPoint ? [endPoint.lat, endPoint.lng] : isLoop ? start : null;
  return { start, end };
}

/** Straight-line length of start → points → end (start/end optional). */
function pathKm(points: Point[], start: Point | null, end: Point | null): number {
  const all = [...(start ? [start] : []), ...points, ...(end ? [end] : [])];
  let km = 0;
  for (let i = 1; i < all.length; i++) km += legKm(all[i - 1], all[i]);
  return km;
}

/**
 * Adds a park to the route at the position that adds the least distance, so the order stays
 * sensible as you click parks on the map (instead of always going on the end). Parks already
 * in the route keep their order, so manual reordering isn't undone.
 */
export function insertParkInBestPosition(
  parks: ParkResponse[],
  park: ParkResponse,
  startPoint: LocationPoint | null,
  endPoint: LocationPoint | null,
  isLoop: boolean,
): ParkResponse[] {
  const centre = getParkCenter(park);
  if (!centre) return [...parks, park];
  const { start, end } = routeEnds(startPoint, endPoint, isLoop);
  const centres = parks.map(getParkCenter);

  let bestIdx = parks.length;
  let bestExtraKm = Infinity;
  for (let i = 0; i <= parks.length; i++) {
    const prev = i === 0 ? start : centres[i - 1];
    const next = i === parks.length ? end : centres[i];
    const extraKm =
      prev && next ? legKm(prev, centre) + legKm(centre, next) - legKm(prev, next)
      : prev ? legKm(prev, centre)
      : next ? legKm(centre, next)
      : 0;
    if (extraKm < bestExtraKm) {
      bestExtraKm = extraKm;
      bestIdx = i;
    }
  }
  return [...parks.slice(0, bestIdx), park, ...parks.slice(bestIdx)];
}

/**
 * Puts the parks in a short order, taking the start point, end point and loop setting into
 * account: first nearest-park-next from the start, then "2-opt" clean-up, which un-crosses the
 * route by reversing any stretch that makes it shorter. Fast enough for routes of 50+ parks.
 */
export function optimizeRoute(
  parks: ParkResponse[],
  startPoint: LocationPoint | null = null,
  endPoint: LocationPoint | null = null,
  isLoop = false,
): ParkResponse[] {
  const located = parks.filter((p) => getParkCenter(p));
  const unlocated = parks.filter((p) => !getParkCenter(p));
  if (located.length <= 1) return [...parks];
  const { start, end } = routeEnds(startPoint, endPoint, isLoop);

  // 1. Nearest park next, beginning at the start point (or the first park if there's none)
  const remaining = [...located];
  const order: ParkResponse[] = [];
  let here: Point = start ?? getParkCenter(remaining[0])!;
  while (remaining.length > 0) {
    let nearest = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (legKm(here, getParkCenter(remaining[i])!) < legKm(here, getParkCenter(remaining[nearest])!)) nearest = i;
    }
    const [next] = remaining.splice(nearest, 1);
    order.push(next);
    here = getParkCenter(next)!;
  }

  // 2. Reverse any stretch of the route that makes it shorter, until nothing improves
  let points = order.map((p) => getParkCenter(p)!);
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
  return [...order, ...unlocated];
}

/**
 * Builds a Google Maps directions URL with all parks as waypoints.
 * Order is always: startPoint → parks → endPoint.
 * Note: URLs with more than ~10 waypoints may hit browser URL length limits.
 */
export function buildGoogleMapsUrl(
  parks: ParkResponse[],
  isLoop: boolean,
  startPoint?: LocationPoint | null,
  endPoint?: LocationPoint | null
): string {
  const parkWaypoints = parks
    .map((p) => getParkCenter(p))
    .filter((c): c is [number, number] => c !== null);

  // Build ordered stop list: start → parks → end (or loop back to start)
  const allStops: string[] = [];

  if (startPoint) {
    allStops.push(`${startPoint.lat.toFixed(6)},${startPoint.lng.toFixed(6)}`);
  }

  for (const [lat, lng] of parkWaypoints) {
    allStops.push(`${lat.toFixed(6)},${lng.toFixed(6)}`);
  }

  if (isLoop && !endPoint) {
    // Loop: return to wherever we started
    const first = allStops[0];
    if (first) allStops.push(first);
  } else if (endPoint) {
    allStops.push(`${endPoint.lat.toFixed(6)},${endPoint.lng.toFixed(6)}`);
  }

  if (allStops.length === 0) return "https://www.google.com/maps";

  return `https://www.google.com/maps/dir/${allStops.join("/")}`;
}

/**
 * Generates a GPX route file string with <rtept> waypoints.
 * Order is always: startPoint → parks → endPoint.
 * When imported into Komoot, it calculates a running route between each waypoint.
 */
export function generateGpx(
  parks: ParkResponse[],
  isLoop: boolean,
  startPoint?: LocationPoint | null,
  endPoint?: LocationPoint | null
): string {
  type WaypointEntry = { name: string; lat: number; lng: number };

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const allWaypoints: WaypointEntry[] = [];

  // 1. Start point
  if (startPoint) {
    allWaypoints.push({ name: startPoint.name, lat: startPoint.lat, lng: startPoint.lng });
  }

  // 2. Parks in the middle
  for (const park of parks) {
    const coord = getParkCenter(park);
    if (coord) {
      allWaypoints.push({ name: park.name, lat: coord[0], lng: coord[1] });
    }
  }

  // 3. End point (or loop back to start)
  if (isLoop && !endPoint && allWaypoints.length > 1) {
    allWaypoints.push(allWaypoints[0]);
  } else if (endPoint) {
    allWaypoints.push({ name: endPoint.name, lat: endPoint.lat, lng: endPoint.lng });
  }

  const rtepts = allWaypoints
    .map(
      ({ name, lat, lng }) =>
        `    <rtept lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}">\n      <name>${escape(name)}</name>\n    </rtept>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ParkRun.LDN" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>London Park Run Route</name>
  </metadata>
  <rte>
    <name>London Park Run Route</name>
    <type>running</type>
${rtepts}
  </rte>
</gpx>`;
}

import type { ParkResponse } from "@shared/routes";

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
 * Returns [lat, lng] for a park. Prefers polygon centroid, falls back to point coords.
 * Polygon is stored as [lng, lat] pairs (GeoJSON order).
 */
export function getParkCenter(park: ParkResponse): [number, number] | null {
  const poly = park.polygon as unknown as [number, number][] | null;
  if (poly && poly.length >= 3) {
    const sumLng = poly.reduce((s, [lng]) => s + lng, 0);
    const sumLat = poly.reduce((s, [, lat]) => s + lat, 0);
    return [sumLat / poly.length, sumLng / poly.length];
  }
  if (park.latitude != null && park.longitude != null) {
    return [park.latitude, park.longitude];
  }
  return null;
}

/**
 * Nearest-neighbor greedy algorithm: starts from the first park and always
 * visits the closest unvisited park next. O(n²) — fine for typical route sizes.
 */
export function optimizeRoute(parks: ParkResponse[]): ParkResponse[] {
  if (parks.length <= 2) return [...parks];

  const unvisited = [...parks];
  const route: ParkResponse[] = [unvisited.shift()!];

  while (unvisited.length > 0) {
    const last = route[route.length - 1];
    const lastCoord = getParkCenter(last);

    if (!lastCoord) {
      // Can't compute distance, just append remaining in original order
      route.push(...unvisited.splice(0));
      break;
    }

    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const coord = getParkCenter(unvisited[i]);
      if (!coord) continue;
      const dist = haversineKm(lastCoord[0], lastCoord[1], coord[0], coord[1]);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    route.push(unvisited.splice(nearestIdx, 1)[0]);
  }

  return route;
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

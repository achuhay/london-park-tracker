import type { ParkResponse } from "@shared/routes";

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
 * Google Maps reliably routes between multiple stops.
 * Note: URLs with more than ~10 waypoints may hit browser URL length limits.
 */
export function buildGoogleMapsUrl(parks: ParkResponse[], isLoop: boolean): string {
  const waypoints = parks
    .map((p) => getParkCenter(p))
    .filter((c): c is [number, number] => c !== null);

  if (waypoints.length === 0) return "https://www.google.com/maps";

  if (isLoop && waypoints.length > 1) {
    waypoints.push(waypoints[0]);
  }

  const stops = waypoints.map(([lat, lng]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join("/");
  return `https://www.google.com/maps/dir/${stops}`;
}

/**
 * Generates a GPX route file string with <rtept> waypoints.
 * When imported into Komoot, it calculates a running route between each park.
 */
export function generateGpx(parks: ParkResponse[], isLoop: boolean): string {
  type WaypointEntry = { park: ParkResponse; coord: [number, number] };

  const waypoints = parks
    .map((p) => ({ park: p, coord: getParkCenter(p) }))
    .filter((x): x is WaypointEntry => x.coord !== null);

  if (isLoop && waypoints.length > 1) {
    waypoints.push(waypoints[0]);
  }

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const rtepts = waypoints
    .map(
      ({ park, coord: [lat, lng] }) =>
        `    <rtept lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}">\n      <name>${escape(park.name)}</name>\n    </rtept>`
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

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
 * Builds a Komoot route planner URL pre-populated with waypoints.
 * Opens centered on the first waypoint at zoom 12.
 */
export function buildKomootUrl(parks: ParkResponse[], isLoop: boolean): string {
  const waypoints = parks
    .map((p) => getParkCenter(p))
    .filter((c): c is [number, number] => c !== null);

  if (waypoints.length === 0) return "https://www.komoot.com/plan";

  if (isLoop && waypoints.length > 1) {
    waypoints.push(waypoints[0]);
  }

  const [centerLat, centerLng] = waypoints[0];
  const params = new URLSearchParams({ sport: "running" });
  waypoints.forEach(([lat, lng], i) => {
    params.append(`way_points[${i}][lat]`, lat.toFixed(6));
    params.append(`way_points[${i}][lng]`, lng.toFixed(6));
  });

  return `https://www.komoot.com/plan/@${centerLat.toFixed(5)},${centerLng.toFixed(5)},12z?${params}`;
}

import type { LatLngTuple } from "leaflet";

/**
 * Park outlines are stored as GeoJSON — a Polygon, or a MultiPolygon for parks made of several
 * separate pieces — with points in [lng, lat] order. (Older rows used a single flat
 * [[lng, lat], ...] ring.) Leaflet wants [lat, lng], grouped as pieces → rings, where each
 * piece's first ring is its outline and any further rings are holes (e.g. a lake).
 */
export function parkOutlineToLeaflet(polygon: unknown): LatLngTuple[][][] | null {
  const p = polygon as any;
  let pieces: number[][][][] = [];
  if (p?.type === "Polygon" && Array.isArray(p.coordinates)) pieces = [p.coordinates];
  else if (p?.type === "MultiPolygon" && Array.isArray(p.coordinates)) pieces = p.coordinates;
  else if (Array.isArray(p) && typeof p[0]?.[0] === "number") pieces = [[p]];

  const flip = (ring: number[][]) => ring.map(([lng, lat]) => [lat, lng] as LatLngTuple);
  const result = pieces
    .filter((rings) => Array.isArray(rings?.[0]) && rings[0].length >= 3)
    .map((rings) => rings.filter((ring) => ring.length >= 3).map(flip));
  return result.length > 0 ? result : null;
}

/** Rough middle of a park's outline (average of its outline points), as [lat, lng]. */
export function parkOutlineCenter(polygon: unknown): [number, number] | null {
  const pieces = parkOutlineToLeaflet(polygon);
  if (!pieces) return null;
  const points = pieces.flatMap((rings) => rings[0]);
  const lat = points.reduce((sum, [la]) => sum + la, 0) / points.length;
  const lng = points.reduce((sum, [, ln]) => sum + ln, 0) / points.length;
  return [lat, lng];
}

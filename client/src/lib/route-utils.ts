import type { ParkResponse } from "@shared/routes";
import { parkOutlineCenter } from "@/lib/park-geometry";

/** A geocoded start or end point for a route (from LocationSearch). */
export interface LocationPoint {
  name: string;
  lat: number;
  lng: number;
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

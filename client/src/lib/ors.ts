/**
 * OpenRouteService (ORS) client — foot-hiking route calculation.
 * Free tier: 2,000 requests/day. Sign up at https://openrouteservice.org/dev/#/home
 * Add VITE_ORS_API_KEY=<your key> to your .env file.
 */

export interface OrsRoute {
  /** [lat, lng] coordinate pairs — the actual trail path snapped to footpaths */
  coords: [number, number][];
  /** Total route distance in km (real trail distance, not straight-line) */
  distanceKm: number;
  /** Estimated duration in seconds */
  durationSecs: number;
}

export class OrsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrsError";
  }
}

/**
 * Fetch a foot-hiking route from ORS between a sequence of waypoints.
 * @param waypoints Array of [lat, lng] — at least 2 required
 */
export async function fetchOrsRoute(waypoints: [number, number][]): Promise<OrsRoute> {
  const apiKey = import.meta.env.VITE_ORS_API_KEY;

  if (!apiKey) {
    throw new OrsError(
      "No ORS API key found. Add VITE_ORS_API_KEY=<your key> to your .env file. " +
        "Get a free key at https://openrouteservice.org/dev/#/home"
    );
  }

  if (waypoints.length < 2) {
    throw new OrsError("At least 2 waypoints are needed to calculate a route.");
  }

  // ORS expects [lng, lat] order (GeoJSON)
  const coordinates = waypoints.map(([lat, lng]) => [lng, lat]);

  const response = await fetch(
    "https://api.openrouteservice.org/v2/directions/foot-walking/geojson",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({
        coordinates,
        preference: "recommended",
        units: "km",
        instructions: false,
      }),
    }
  );

  if (!response.ok) {
    let detail = "";
    try {
      const err = await response.json();
      detail = err?.error?.message || JSON.stringify(err);
    } catch {
      detail = await response.text();
    }
    throw new OrsError(`ORS API error ${response.status}: ${detail}`);
  }

  const data = await response.json();
  const feature = data?.features?.[0];
  if (!feature) {
    throw new OrsError("ORS returned no route.");
  }

  // ORS returns [lng, lat] — convert to [lat, lng] for Leaflet
  const coords: [number, number][] = feature.geometry.coordinates.map(
    ([lng, lat]: [number, number]) => [lat, lng]
  );

  const summary = feature.properties?.summary ?? {};
  return {
    coords,
    distanceKm: summary.distance ?? 0,
    durationSecs: summary.duration ?? 0,
  };
}

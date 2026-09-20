// Single source of truth for per-city configuration.
// Add a new entry here (plus a row in `parks.city`) to onboard another city.

export type CitySlug = 'london' | 'edinburgh';

export interface CityConfig {
  slug: CitySlug;
  name: string;
  displayName: string;
  mapCenter: [number, number];
  mapZoom: number;
  // Nominatim viewbox as "minLon,minLat,maxLon,maxLat" — biases location search results to this city.
  nominatimViewbox: string;
  regionLabel: string; // "borough" | "ward" — what `parks.borough` means for this city
  regionCount: number; // total number of regions in this city (33 London boroughs, 17 Edinburgh wards)
  allRegionsBadgeId: string; // activity badge id for "a park in every region"
  hasRoyalParks: boolean; // London-only: Royal Flush badge
  hasThamesConcept: boolean; // London-only: Both Sides (north/south of Thames) badge
  milestoneThresholds: number[]; // total-parks-visited milestone thresholds, ascending
}

export const CITIES: Record<CitySlug, CityConfig> = {
  london: {
    slug: 'london',
    name: 'London',
    displayName: 'London Park Challenge',
    mapCenter: [51.505, -0.09],
    mapZoom: 11,
    nominatimViewbox: '-0.5105,51.2868,0.3340,51.6862',
    regionLabel: 'borough',
    regionCount: 33,
    allRegionsBadgeId: 'all_33',
    hasRoyalParks: true,
    hasThamesConcept: true,
    milestoneThresholds: [1, 10, 25, 50, 100, 250, 500],
  },
  edinburgh: {
    slug: 'edinburgh',
    name: 'Edinburgh',
    displayName: 'Edinburgh Park Challenge',
    mapCenter: [55.9533, -3.1883],
    mapZoom: 12,
    nominatimViewbox: '-3.3360,55.8797,-3.0250,55.9975',
    regionLabel: 'ward',
    regionCount: 17,
    allRegionsBadgeId: 'all_17',
    hasRoyalParks: false,
    hasThamesConcept: false,
    // Placeholder — finalize once scripts/import-edinburgh-parks.ts reports the real total park count.
    milestoneThresholds: [1, 5, 10, 25, 50, 75],
  },
};

export const DEFAULT_CITY: CitySlug = 'london';

export function isCitySlug(value: string | undefined | null): value is CitySlug {
  return value === 'london' || value === 'edinburgh';
}

export function getCityConfig(city: string | undefined | null): CityConfig {
  return isCitySlug(city) ? CITIES[city] : CITIES[DEFAULT_CITY];
}

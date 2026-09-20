// Static config for all badge definitions.
// Milestone earned status is computed client-side from visitCount.
// Other badges are computed server-side in /api/gamification.
//
// Milestones and the "all regions" / royal / Thames badges vary per city —
// see shared/cities.ts for the per-city config that drives them.

import { type CitySlug, getCityConfig } from "./cities";

export interface MilestoneBadge {
  id: string;
  emoji: string;
  threshold: number;
  name: string;
  flavour: string;
}

const MILESTONE_BADGES_BY_CITY: Record<CitySlug, MilestoneBadge[]> = {
  london: [
    { id: "first_park",  emoji: "👟", threshold: 1,   name: "First Steps",            flavour: "Every legend starts somewhere." },
    { id: "ten_parks",   emoji: "🌿", threshold: 10,  name: "Getting Going",           flavour: "The city is opening up." },
    { id: "parks_25",    emoji: "🏅", threshold: 25,  name: "Quarter Century",         flavour: "A proper park person." },
    { id: "parks_50",    emoji: "⭐", threshold: 50,  name: "Halfway to a Hundred",    flavour: "You're not stopping now." },
    { id: "parks_100",   emoji: "💯", threshold: 100, name: "Century",                 flavour: "Three figures. Impressive." },
    { id: "parks_250",   emoji: "🌳", threshold: 250, name: "Park Regular",            flavour: "London knows your face." },
    { id: "parks_500",   emoji: "🏆", threshold: 500, name: "Parks Are Yours",         flavour: "You've done it. All of it." },
  ],
  // Placeholder thresholds — finalize once scripts/import-edinburgh-parks.ts reports
  // Edinburgh's real total park count (see shared/cities.ts CITIES.edinburgh).
  edinburgh: [
    { id: "first_park",  emoji: "👟", threshold: 1,  name: "First Steps",     flavour: "Every legend starts somewhere." },
    { id: "five_parks",  emoji: "🌿", threshold: 5,  name: "Getting Going",   flavour: "The city is opening up." },
    { id: "parks_10",    emoji: "🏅", threshold: 10, name: "Double Figures",  flavour: "A proper park person." },
    { id: "parks_25",    emoji: "⭐", threshold: 25, name: "Quarter Century", flavour: "You're not stopping now." },
    { id: "parks_50",    emoji: "💯", threshold: 50, name: "Half Century",    flavour: "Fifty parks. Impressive." },
    { id: "parks_75",    emoji: "🌳", threshold: 75, name: "Park Regular",    flavour: "Edinburgh knows your face." },
    { id: "parks_all",   emoji: "🏆", threshold: 100, name: "Parks Are Yours",flavour: "You've done it. All of it." },
  ],
};

export function getMilestoneBadges(city: CitySlug = "london"): MilestoneBadge[] {
  return MILESTONE_BADGES_BY_CITY[city] ?? MILESTONE_BADGES_BY_CITY.london;
}

export interface StreakBadge {
  id: string;
  emoji: string;
  threshold: number;
  name: string;
  flavour: string;
}

// Streaks are calendar-week based, not tied to a city's total park count — shared across cities.
export const STREAK_BADGES: StreakBadge[] = [
  { id: "streak_3",  emoji: "🔥",   threshold: 3,  name: "Warming Up",     flavour: "Three weeks straight. Habit forming." },
  { id: "streak_5",  emoji: "🔥🔥", threshold: 5,  name: "On A Roll",      flavour: "Can't stop, won't stop." },
  { id: "streak_10", emoji: "🔥🔥🔥",threshold: 10, name: "Unstoppable",    flavour: "Ten weeks. Nothing slows you down." },
  { id: "streak_20", emoji: "🌋",   threshold: 20, name: "Force of Nature", flavour: "Twenty weeks. You ARE a park." },
  { id: "streak_52", emoji: "👑",   threshold: 52, name: "Full Year",       flavour: "Every single week of the year." },
];

export interface LocalLegendTier {
  id: string;
  emoji: string;
  threshold: number;
  name: string;
  flavour: string;
}

// Per-park visit counts — also city-agnostic (a park is a park, wherever it is).
export const LOCAL_LEGEND_TIERS: LocalLegendTier[] = [
  { id: "familiar_face",  emoji: "🌱", threshold: 3,  name: "Familiar Face", flavour: "They're starting to recognise you." },
  { id: "regular",        emoji: "🏡", threshold: 5,  name: "Regular",       flavour: "This park feels like yours." },
  { id: "local_legend",   emoji: "❤️",  threshold: 10, name: "Local Legend",  flavour: "You're part of the furniture." },
  { id: "obsessed",       emoji: "🔁", threshold: 20, name: "Obsessed",      flavour: "Twenty visits. No shame." },
  { id: "human_squirrel", emoji: "🐿️", threshold: 50, name: "Human Squirrel",flavour: "Fifty visits. You basically live here." },
];

export interface BoroughCollectorBadge {
  id: string;
  emoji: string;
  name: string;
  flavour: string;
  requiredTier: "bronze" | "silver" | "gold" | "king";
  requiredCount: number;
}

export function getBoroughCollectorBadges(city: CitySlug = "london"): BoroughCollectorBadge[] {
  const { name, regionLabel } = getCityConfig(city);
  return [
    { id: "bronze_collector", emoji: "🥉", name: "Bronze Collector", flavour: `Five ${regionLabel}s, at least a quarter done.`,       requiredTier: "bronze", requiredCount: 5  },
    { id: "silver_collector", emoji: "🥈", name: "Silver Collector", flavour: `Ten ${regionLabel}s, halfway through each.`,             requiredTier: "silver", requiredCount: 10 },
    { id: "gold_collector",   emoji: "🥇", name: "Gold Collector",   flavour: `Five ${regionLabel}s, three-quarters conquered.`,        requiredTier: "gold",   requiredCount: 5  },
    { id: `king_of_${city}`,  emoji: "👑", name: `King of ${name}`,  flavour: `Three ${regionLabel}s, completely finished. Royalty.`,   requiredTier: "king",   requiredCount: 3  },
  ];
}

export interface ActivityBadge {
  id: string;
  emoji: string;
  name: string;
  category: "geography" | "single_run" | "distance" | "calendar" | "personality" | "social";
  flavour: string;
}

// Badges that don't depend on region count/name — shared by every city.
const BASE_ACTIVITY_BADGES: ActivityBadge[] = [
  { id: "haul",           emoji: "⚡", name: "Haul",            category: "single_run",  flavour: "5+ parks in one run." },
  { id: "blitz",          emoji: "🚀", name: "Blitz",           category: "single_run",  flavour: "8+ parks in one run." },
  { id: "speed_tour",     emoji: "💨", name: "Speed Tour",      category: "single_run",  flavour: "10+ parks in one run." },
  { id: "double_header",  emoji: "🏃", name: "Double Header",   category: "single_run",  flavour: "Two parks in a single day." },
  { id: "grand_tour",     emoji: "🏙️", name: "Grand Tour",      category: "single_run",  flavour: "10 parks across a whole day." },
  { id: "10k_green",      emoji: "🏃", name: "10K Through Green",  category: "distance", flavour: "10km run through parks." },
  { id: "marathon_miles", emoji: "🏃", name: "Marathon Miles",     category: "distance", flavour: "42.2km through the green." },
  { id: "century_km",     emoji: "🌐", name: "Century Kilometres", category: "distance", flavour: "100km. A park marathon and then some." },
  { id: "new_year",       emoji: "🎆", name: "New Year, New Parks", category: "calendar", flavour: "January 1st. In a park. Of course." },
  { id: "centurion",      emoji: "🗓️", name: "Centurion",           category: "calendar", flavour: "100 parks in one calendar year." },
  { id: "no_excuses",         emoji: "🌧️", name: "No Excuses",        category: "personality", flavour: "Parks visited in 4+ different months." },
  { id: "weekend_regular",    emoji: "📅", name: "Weekend Regular",    category: "personality", flavour: "Sat and Sun, three separate weekends." },
  { id: "early_bird",         emoji: "🌅", name: "Early Bird",         category: "personality", flavour: "Out before 7am. Respect." },
  { id: "night_owl",          emoji: "🦉", name: "Night Owl",          category: "personality", flavour: "Running after 8pm? You're committed." },
  { id: "creatures_of_habit", emoji: "👯", name: "Creatures of Habit", category: "personality", flavour: "Same park, same day of the week, four times." },
  { id: "top_of_borough",     emoji: "🥇", name: "Top of the Borough", category: "social", flavour: "#1 on a leaderboard." },
  { id: "dethroned",          emoji: "⚔️", name: "Dethroned",           category: "social", flavour: "Someone took your crown. Time to fight back." },
];

export function getActivityBadges(city: CitySlug = "london"): ActivityBadge[] {
  const cfg = getCityConfig(city);
  const geography: ActivityBadge[] = [
    { id: "explorer",       emoji: "🧭", name: "Explorer",        category: "geography", flavour: `First visit to a brand new ${cfg.regionLabel}.` },
    { id: "borough_hopper", emoji: "🗺️", name: `${cfg.regionLabel[0].toUpperCase()}${cfg.regionLabel.slice(1)} Hopper`, category: "geography", flavour: `Five ${cfg.regionLabel}s in one week.` },
    { id: "new_horizons",   emoji: "🌍", name: "New Horizons",    category: "geography", flavour: `Five new ${cfg.regionLabel}s in one month.` },
    { id: cfg.allRegionsBadgeId, emoji: "🏙️", name: `All ${cfg.regionCount}`, category: "geography", flavour: `A park in every ${cfg.name} ${cfg.regionLabel}.` },
  ];
  if (cfg.hasRoyalParks) {
    geography.push({ id: "royal_flush", emoji: "🌳", name: "Royal Flush", category: "geography", flavour: "All 8 Royal Parks. The full set." });
  }
  if (cfg.hasThamesConcept) {
    geography.push({ id: "both_sides", emoji: "🌉", name: "Both Sides", category: "geography", flavour: "North and south of the Thames in one week." });
  }
  return [...geography, ...BASE_ACTIVITY_BADGES];
}

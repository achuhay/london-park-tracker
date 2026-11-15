import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { MapContainer, Polyline, Polygon, useMap } from "react-leaflet";
import {
  Loader2,
  Trophy,
  ChevronLeft,
  ChevronRight,
  Map as MapIcon,
  Trees,
  Sparkles,
  Send,
  CheckCircle2,
  RotateCcw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BaseMap } from "@/components/map/BaseMap";
import { mapPalette } from "@/components/map/palette";
import { useTheme } from "@/components/theme";
import { decodePolyline } from "@/hooks/use-strava";
import { useParkStats } from "@/hooks/use-parks";
import type { SyncResult } from "./StravaButton";
import { parkOutlineToLeaflet } from "@/lib/park-geometry";
import { StarRating } from "@/components/StarRating";
import { useParkRatings, useRatePark } from "@/hooks/use-park-ratings";
import { useAppConfig } from "@/hooks/use-config";

interface FunFact {
  parkId: number;
  parkName: string;
  facts: string[];
}

interface RunSummaryModalProps {
  open: boolean;
  onClose: () => void;
  data: SyncResult | null;
}

// Build a text progress bar like ▓▓▓▓▓▓░░░░
function textProgressBar(pct: number, width = 10): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return "\u2593".repeat(filled) + "\u2591".repeat(empty);
}

// Find which route point index is closest to a given lat/lng.
// Used to sort parks in the order they were encountered along the run.
function closestRouteIndex(lat: number, lng: number, routePoints: [number, number][]): number {
  let minDist = Infinity;
  let minIdx = 0;
  for (let i = 0; i < routePoints.length; i++) {
    const [rLat, rLng] = routePoints[i];
    const d = (lat - rLat) ** 2 + (lng - rLng) ** 2;
    if (d < minDist) { minDist = d; minIdx = i; }
  }
  return minIdx;
}

// Build the gamified Strava post body
function buildDefaultPost(
  data: SyncResult,
  stats?: { completed: number; total: number } | null,
  yearVisits?: number | null,
  routePoints?: [number, number][] | null,
): string {
  const lines: string[] = [];
  const sep = "\u2501".repeat(15);
  const completedIds = new Set(data.parksCompleted.map((p) => p.id));
  const revisited = data.parksVisited.filter((p) => !completedIds.has(p.id));

  // Header
  if (data.parksCompleted.length > 0) {
    lines.push(`\u{1F3C6} ${data.parksCompleted.length} New Park${data.parksCompleted.length !== 1 ? "s" : ""} Conquered!`);
  } else if (revisited.length > 0) {
    lines.push(`\u{1F501} ${revisited.length} Park${revisited.length !== 1 ? "s" : ""} Revisited`);
  }
  lines.push(sep);

  // Borough breakdown (of new parks only)
  const boroughCounts = data.parksCompleted.reduce<Record<string, number>>((acc, p) => {
    const b = p.borough || "Unknown";
    acc[b] = (acc[b] || 0) + 1;
    return acc;
  }, {});
  if (Object.keys(boroughCounts).length > 0) {
    lines.push(
      `\u{1F5FA}\uFE0F ${Object.entries(boroughCounts)
        .map(([b, c]) => `${b} \u00D7${c}`)
        .join(", ")}`
    );
  }

  // Revisited count — directly after boroughs, no blank line
  if (revisited.length > 0) {
    lines.push(`\u{1F501} ${revisited.length} Park${revisited.length !== 1 ? "s" : ""} Revisited`);
  }

  // Second separator before progress
  lines.push(sep);

  // Overall progress
  if (stats && stats.total > 0) {
    const pct = ((stats.completed / stats.total) * 100).toFixed(1);
    lines.push("\u{1F3AF} Progress");
    lines.push(`${stats.completed} / ${stats.total} parks in London (${pct}%)`);
    lines.push(`${textProgressBar(parseFloat(pct))} ${pct}%`);
  }

  // 500 Parks Challenge — no blank line between sections
  if (yearVisits != null && yearVisits > 0) {
    const year = new Date().getFullYear();
    const challengePct = Math.min(100, (yearVisits / 500) * 100);
    lines.push(`${year} Challenge: ${yearVisits} / 500 parks!`);
    lines.push(`${textProgressBar(challengePct)} ${challengePct.toFixed(1)}%`);
  }

  // Call to action
  lines.push("\u{1F33F} London has over 3,000 parks - why not visit them all?");
  lines.push("\u{1F3C5}Join the challenge!");
  lines.push("www.challenge.detour.food");

  // Full park list — ALL visited parks (new + revisits), sorted by route order.
  // ✅ = new park this run, 🔁 = previously visited
  const allVisited: { park: typeof data.parksCompleted[0]; isNew: boolean }[] = [
    ...data.parksCompleted.map((p) => ({ park: p, isNew: true })),
    ...revisited.map((p) => ({ park: p, isNew: false })),
  ];

  if (routePoints && routePoints.length > 0) {
    allVisited.sort((a, b) => {
      const idxA = a.park.latitude != null && a.park.longitude != null
        ? closestRouteIndex(a.park.latitude, a.park.longitude, routePoints)
        : routePoints.length;
      const idxB = b.park.latitude != null && b.park.longitude != null
        ? closestRouteIndex(b.park.latitude, b.park.longitude, routePoints)
        : routePoints.length;
      return idxA - idxB;
    });
  }

  if (allVisited.length > 0) {
    lines.push(sep);
    for (const { park, isNew } of allVisited) {
      const emoji = isNew ? "\u2705" : "\u{1F501}"; // ✅ new, 🔁 revisit
      lines.push(`${emoji} ${park.name}${park.borough ? ` \u00B7 ${park.borough}` : ""}`);
    }
  }

  return lines.join("\n");
}

// Build gamified title
function buildDefaultTitle(data: SyncResult): string {
  const newCount = data.parksCompleted.length;
  const completedIds = new Set(data.parksCompleted.map((p) => p.id));
  const revisitedCount = data.parksVisited.filter((p) => !completedIds.has(p.id)).length;

  if (newCount > 0) {
    return `${newCount} Park${newCount !== 1 ? "s" : ""} Conquered! \u{1F3C6} | Detour`;
  }
  if (revisitedCount > 0) {
    return `Revisiting ${revisitedCount} Park${revisitedCount !== 1 ? "s" : ""} \u{1F501} | Detour`;
  }
  return `${data.activity?.name ?? "Run"} | Detour`;
}

// Auto-fits the Leaflet map to the route on first render
function MapFitter({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 0) {
      map.fitBounds(positions, { padding: [24, 24] });
    }
  }, [map, positions]);
  return null;
}

const ALL_PAGES = [
  { icon: Trophy, label: "Summary" },
  { icon: MapIcon, label: "Route" },
  { icon: Sparkles, label: "Facts" },
  { icon: Send, label: "Share" },
] as const;

export function RunSummaryModal({ open, onClose, data }: RunSummaryModalProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [funFacts, setFunFacts] = useState<FunFact[]>([]);
  const [stravaPost, setStravaPost] = useState("");
  const [stravaTitle, setStravaTitle] = useState("");
  const [aiCaptions, setAiCaptions] = useState<string[]>([]);
  const [aiTitles, setAiTitles] = useState<string[]>([]);
  const [selectedCaptionIdx, setSelectedCaptionIdx] = useState<number | null>(null);
  const [selectedTitleIdx, setSelectedTitleIdx] = useState<number | null>(null);
  const [isLoadingFacts, setIsLoadingFacts] = useState(false);
  const [isPostingToStrava, setIsPostingToStrava] = useState(false);
  const [postedToStrava, setPostedToStrava] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const touchStartX = useRef(0);
  // CARTO now needs an API key for its map tiles (served at runtime, like on the main map)
  const { data: appConfig } = useAppConfig();
  const cartoApiKey = appConfig?.cartoApiKey;
  const { dark } = useTheme();
  const ratings = useParkRatings();
  const ratePark = useRatePark();

  // Fetch stats for progress section in Strava post
  const { data: stats } = useParkStats();
  const { data: challenge } = useQuery<{
    totalVisits: number;
    weekly: { week: number; visits: number }[];
    year: number;
    target: number;
  }>({ queryKey: ["/api/stats/year-challenge"] });

  // Helper to generate defaults (used on open and for reset button)
  const generateDefaults = () => {
    if (!data) return;
    // Decode the run's polyline so we can sort parks by visit order
    const rPoints = data.activity?.summaryPolyline
      ? decodePolyline(data.activity.summaryPolyline)
      : null;
    const postText = buildDefaultPost(
      data,
      stats ? { completed: stats.completed, total: stats.total } : null,
      challenge?.totalVisits ?? null,
      rPoints,
    );
    setStravaPost(postText);
    setStravaTitle(buildDefaultTitle(data));
  };

  // Reset state whenever the modal opens or data changes
  useEffect(() => {
    if (open && data) {
      setCurrentPage(0);
      setFunFacts([]);
      setAiCaptions([]);
      setAiTitles([]);
      setSelectedCaptionIdx(null);
      setSelectedTitleIdx(null);
      setPostedToStrava(false);
      setPostError(null);
      generateDefaults();
    }
  }, [open, data, stats, challenge]);

  // Fetch fun facts as soon as modal opens
  useEffect(() => {
    if (!open || !data || data.parksVisited.length === 0) return;

    const fetchFacts = async () => {
      setIsLoadingFacts(true);
      try {
        const res = await fetch("/api/parks/fun-facts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            // Newly completed parks first — the server only writes facts for the first 10
            parkIds: [
              ...data.parksCompleted,
              ...data.parksVisited.filter((p) => !data.parksCompleted.some((c) => c.id === p.id)),
            ].map((p) => p.id),
            activityData: data.activity
              ? {
                  name: data.activity.name,
                  distance: data.activity.distance,
                  moving_time: data.activity.moving_time,
                  newParksCount: data.parksCompleted.length,
                  totalParksVisited: stats?.completed ?? data.parksVisited.length,
                }
              : undefined,
          }),
        });
        if (res.ok) {
          const result = await res.json();
          setFunFacts(result.facts || []);
          if (result.captions?.length) {
            setAiCaptions(result.captions);
            // Pre-select the first caption as the default Strava post
            setStravaPost(result.captions[0]);
            setSelectedCaptionIdx(0);
          }
          if (result.titles?.length) {
            setAiTitles(result.titles);
          }
        }
      } catch (e) {
        console.error("Failed to fetch fun facts", e);
      } finally {
        setIsLoadingFacts(false);
      }
    };

    fetchFacts();
  }, [open, data]);

  if (!data) return null;

  // For bulk syncs (no single activity), skip route map and share pages
  const hasActivity = !!data.activity;
  const visiblePageIndices = hasActivity ? [0, 1, 2, 3] : [0, 2]; // scorecard + facts only
  const pageCount = visiblePageIndices.length;
  const actualPage = visiblePageIndices[currentPage] ?? 0;

  const formatDistance = (m: number) => `${(m / 1000).toFixed(2)} km`;
  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const hrs = Math.floor(mins / 60);
    return hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
  };

  // Group all visited parks by borough, track how many were new in each
  const boroughMap = data.parksVisited.reduce<Record<string, { total: number; newCount: number }>>(
    (acc, park) => {
      const b = park.borough || "Unknown";
      if (!acc[b]) acc[b] = { total: 0, newCount: 0 };
      acc[b].total++;
      if (data.parksCompleted.some((p) => p.id === park.id)) acc[b].newCount++;
      return acc;
    },
    {}
  );

  // Parks the user has previously completed that they ran through again
  const completedIds = new Set(data.parksCompleted.map((p) => p.id));
  const revisitedParks = data.parksVisited.filter((p) => !completedIds.has(p.id));

  // decodePolyline returns [lat, lng] — correct for Leaflet
  const routePoints = data.activity?.summaryPolyline
    ? decodePolyline(data.activity.summaryPolyline)
    : [];

  const pushToStrava = async () => {
    if (!data.activity?.id) return;
    setIsPostingToStrava(true);
    setPostError(null);
    try {
      const res = await fetch(`/api/strava/activity/${data.activity.id}/description`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ description: stravaPost, name: stravaTitle }),
      });
      if (res.ok) {
        setPostedToStrava(true);
      } else {
        const body = await res.json().catch(() => ({}));
        if (body.error === "needs_reauth") {
          setPostError("Your Strava connection needs updating before Detour can post. Open Progress → Account, disconnect Strava, then connect again.");
        } else {
          setPostError("Failed to post to Strava. Please try again.");
        }
      }
    } catch {
      setPostError("Network error. Please try again.");
    } finally {
      setIsPostingToStrava(false);
    }
  };

  const tierLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const TIER_DOT: Record<string, string> = { bronze: "#cd7f32", silver: "#a8a9ad", gold: "#E2B227", king: "#8b5cf6" };

  const renderPage = () => {
    switch (actualPage) {
      case 0: {
        // Scorecard
        const newCount = data.parksCompleted.length;
        const visitedCount = data.parksVisited.length;
        const newAchievements = data.newBoroughAchievements ?? [];
        return (
          <div className="space-y-5">
            <div className={cn("rounded-3xl px-5 py-6 text-center", newCount > 0 ? "bg-ember-soft" : "bg-muted")}>
              <p className={cn("num font-display text-6xl font-extrabold leading-none", newCount > 0 ? "text-ember-ink" : "text-foreground")}>
                {newCount > 0 ? newCount : revisitedParks.length}
              </p>
              <p className="mt-2 text-base font-semibold">
                {newCount > 0 ? `new park${newCount !== 1 ? "s" : ""} run` : `park${revisitedParks.length !== 1 ? "s" : ""} revisited`}
              </p>
              {newCount > 0 && revisitedParks.length > 0 && (
                <p className="mt-0.5 text-sm text-muted-foreground">plus {revisitedParks.length} you'd already run</p>
              )}
            </div>

            {newAchievements.length > 0 && (
              <div className="space-y-2">
                <p className="px-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Badge{newAchievements.length !== 1 ? "s" : ""} unlocked
                </p>
                <div className="flex flex-wrap gap-2">
                  {newAchievements.map((a) => (
                    <span key={a.borough} className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm font-semibold">
                      <span className="size-2.5 rounded-full" style={{ background: TIER_DOT[a.tier] }} />
                      {a.borough} {tierLabel(a.tier)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className={cn("grid gap-2", data.activity ? "grid-cols-2" : "grid-cols-2")}>
              {(data.activity
                ? [
                    { label: "Distance", value: formatDistance(data.activity.distance) },
                    { label: "Moving time", value: formatTime(data.activity.moving_time) },
                    { label: "New parks", value: String(newCount) },
                    { label: "Parks visited", value: String(visitedCount) },
                  ]
                : [
                    { label: "New parks", value: String(newCount) },
                    { label: "Parks visited", value: String(visitedCount) },
                  ]
              ).map(({ label, value }) => (
                <div key={label} className="rounded-2xl bg-muted/70 px-4 py-3">
                  <p className="text-xs font-medium text-muted-foreground">{label}</p>
                  <p className="num font-display text-2xl font-bold">{value}</p>
                </div>
              ))}
            </div>

            {Object.keys(boroughMap).length > 0 && (
              <div className="space-y-2">
                <p className="px-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Boroughs</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(boroughMap).map(([borough, { total, newCount: bc }]) => (
                    <span
                      key={borough}
                      className={cn(
                        "num rounded-full px-3 py-1 text-[13px] font-medium",
                        bc > 0 ? "bg-ember-soft text-ember-ink" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {borough} · {total}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {newCount > 0 && (
              <div className="space-y-2">
                <p className="px-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">New parks</p>
                <ul className="divide-y overflow-hidden rounded-2xl border">
                  {data.parksCompleted.map((park) => (
                    <li key={park.id} className="flex items-center gap-3 px-3.5 py-2.5">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ember-soft text-ember">
                        <Trees className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{park.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {park.borough} · {park.siteType}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {revisitedParks.length > 0 && (
              <div className="space-y-1.5">
                <p className="px-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Revisited</p>
                <p className="px-1 text-sm text-muted-foreground">{revisitedParks.map((p) => p.name).join(", ")}</p>
              </div>
            )}

            {visitedCount > 0 && (
              <div className="space-y-2">
                <div className="px-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Rate today's parks</p>
                  <p className="text-xs text-muted-foreground">4 or 5 stars saves a park to your favourites.</p>
                </div>
                <ul className="divide-y overflow-hidden rounded-2xl border">
                  {[...data.parksCompleted, ...revisitedParks].map((park) => (
                    <li key={park.id} className="flex items-center justify-between gap-2 py-1.5 pl-3.5 pr-2">
                      <span className="min-w-0 truncate text-sm font-medium">{park.name}</span>
                      <StarRating
                        size="sm"
                        label={`Rate ${park.name}`}
                        value={ratings.get(park.id) ?? null}
                        onChange={(rating) => ratePark.mutate({ parkId: park.id, rating })}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      }

      case 1: {
        // Route map
        if (routePoints.length === 0) {
          return <p className="py-10 text-center text-muted-foreground">This run has no route data.</p>;
        }
        const pal = mapPalette(dark);
        return (
          <div className="overflow-hidden rounded-2xl border" style={{ height: "min(380px, 52dvh)" }}>
            <MapContainer
              center={routePoints[Math.floor(routePoints.length / 2)]}
              zoom={14}
              style={{ height: "100%", width: "100%" }}
              zoomControl={false}
              scrollWheelZoom={true}
              preferCanvas
            >
              <BaseMap dark={dark} cartoApiKey={cartoApiKey} />
              <MapFitter positions={routePoints} />
              {data.parksVisited
                .filter((p) => p.polygon)
                .map((park) => {
                  const positions = parkOutlineToLeaflet(park.polygon);
                  if (!positions) return null;
                  const isNew = data.parksCompleted.some((c) => c.id === park.id);
                  return (
                    <Polygon
                      key={park.id}
                      positions={positions}
                      pathOptions={{ color: isNew ? pal.done : pal.todo, fillColor: isNew ? pal.done : pal.todo, fillOpacity: 0.4, weight: 1.5 }}
                    />
                  );
                })}
              <Polyline positions={routePoints} pathOptions={{ color: pal.run, weight: 4, opacity: 0.95 }} />
            </MapContainer>
          </div>
        );
      }

      case 2: {
        // AI fun facts
        if (isLoadingFacts) {
          return (
            <div className="space-y-3 py-6 text-center">
              <Loader2 className="mx-auto size-7 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Digging up fun facts about your parks…</p>
            </div>
          );
        }
        if (funFacts.length === 0) {
          return (
            <p className="py-10 text-center text-muted-foreground">
              {data.parksVisited.length === 0 ? "No parks on this run." : "Couldn't load fun facts. Try again later."}
            </p>
          );
        }
        return (
          <div className="space-y-3">
            {funFacts.map((item) => (
              <div key={item.parkId} className="rounded-2xl bg-muted/70 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Trees className="size-4 shrink-0 text-park" />
                  <h4 className="font-sans text-[15px] font-semibold tracking-normal">{item.parkName}</h4>
                </div>
                <ul className="space-y-1.5">
                  {item.facts.map((fact, i) => (
                    <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                      <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-ember" />
                      {fact}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        );
      }

      case 3: {
        // Strava post builder
        return (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">Pick a title and caption, edit anything you like, then post it to this run on Strava.</p>

            <div className="space-y-2">
              <label htmlFor="strava-title" className="px-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Title
              </label>
              {aiTitles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {aiTitles.map((t, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setStravaTitle(t);
                        setSelectedTitleIdx(i);
                        setPostedToStrava(false);
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-left text-[13px] transition-colors",
                        selectedTitleIdx === i ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted",
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
              <input
                id="strava-title"
                className="h-11 w-full rounded-xl border bg-card px-3.5 text-[16px] outline-none focus:ring-2 focus:ring-ring/40"
                value={stravaTitle}
                onChange={(e) => {
                  setStravaTitle(e.target.value);
                  setSelectedTitleIdx(null);
                  setPostedToStrava(false);
                }}
                placeholder="Activity name"
              />
            </div>

            {aiCaptions.length > 0 && (
              <div className="space-y-2">
                <p className="px-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Caption</p>
                <div className="space-y-1.5">
                  {aiCaptions.map((caption, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setSelectedCaptionIdx(i);
                        setStravaPost(caption);
                        setPostedToStrava(false);
                      }}
                      className={cn(
                        "w-full rounded-2xl border px-3.5 py-3 text-left text-sm leading-relaxed transition-colors",
                        selectedCaptionIdx === i ? "border-foreground bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60",
                      )}
                    >
                      {caption}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <label htmlFor="strava-post" className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Description
                </label>
                <button
                  type="button"
                  onClick={() => {
                    generateDefaults();
                    setSelectedCaptionIdx(null);
                    setSelectedTitleIdx(null);
                    setPostedToStrava(false);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="size-3" />
                  Reset
                </button>
              </div>
              <textarea
                id="strava-post"
                className="h-40 w-full resize-none rounded-2xl border bg-card p-3.5 font-mono text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-ring/40"
                value={stravaPost}
                onChange={(e) => {
                  setStravaPost(e.target.value);
                  setSelectedCaptionIdx(null);
                  setPostedToStrava(false);
                }}
                placeholder="Your run description"
              />
            </div>

            {postError && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{postError}</p>}
            <button
              type="button"
              className={cn(
                "flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white transition-[filter] disabled:opacity-60",
                postedToStrava ? "bg-park" : "bg-strava hover:brightness-95",
              )}
              disabled={isPostingToStrava || !data.activity?.id}
              onClick={pushToStrava}
            >
              {isPostingToStrava ? <Loader2 className="size-4 animate-spin" /> : postedToStrava ? <CheckCircle2 className="size-4" /> : <Send className="size-4" />}
              {postedToStrava ? "Posted to Strava" : "Post to Strava"}
            </button>
          </div>
        );
      }
    }
  };

  const title = hasActivity ? (data.activity?.name ?? "Run summary") : "Parks synced";
  const subtitle = data.activity
    ? `${new Date(data.activity.start_date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · ${formatDistance(data.activity.distance)} · ${formatTime(data.activity.moving_time)}`
    : `${data.parksVisited.length} parks from your Strava history`;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex flex-col bg-card shadow-sheet outline-none duration-300",
            // Phone: a sheet from the bottom
            "inset-x-0 bottom-0 max-h-[94dvh] rounded-t-3xl max-sm:data-[state=open]:animate-in max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:animate-out max-sm:data-[state=closed]:slide-out-to-bottom",
            // Bigger screens: a centred card
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88vh] sm:w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:data-[state=open]:animate-in sm:data-[state=open]:fade-in-0 sm:data-[state=open]:zoom-in-95 sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%] sm:data-[state=closed]:animate-out sm:data-[state=closed]:fade-out-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%]",
          )}
        >
          <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-border sm:hidden" aria-hidden />
          <header className="space-y-3 px-5 pb-3 pt-3 sm:pt-5">
            <div className="flex items-start justify-between gap-3 pr-1">
              <div className="min-w-0">
                <DialogPrimitive.Title className="truncate font-display text-xl font-bold leading-tight">{title}</DialogPrimitive.Title>
                <p className="num truncate text-sm text-muted-foreground">{subtitle}</p>
              </div>
              <DialogPrimitive.Close className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>
            {pageCount > 1 && (
              <div role="tablist" className="grid gap-1 rounded-xl bg-muted p-1" style={{ gridTemplateColumns: `repeat(${pageCount}, minmax(0, 1fr))` }}>
                {visiblePageIndices.map((pageIdx, i) => {
                  const { icon: Icon, label } = ALL_PAGES[pageIdx];
                  return (
                    <button
                      key={pageIdx}
                      type="button"
                      role="tab"
                      aria-selected={i === currentPage}
                      onClick={() => setCurrentPage(i)}
                      className={cn(
                        "flex h-9 items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-semibold transition-all",
                        i === currentPage ? "bg-card text-foreground shadow-[0_1px_3px_hsl(var(--shadow-color)/0.15)]" : "text-muted-foreground",
                      )}
                    >
                      <Icon className="size-3.5" />
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </header>

          {/* Swipe left/right to move between pages on touch screens */}
          <div
            className="min-h-[220px] flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-1"
            onTouchStart={(e) => {
              touchStartX.current = e.touches[0].clientX;
            }}
            onTouchEnd={(e) => {
              if (actualPage === 1) return; // let the route map handle its own swipes
              const delta = e.changedTouches[0].clientX - touchStartX.current;
              if (delta < -60 && currentPage < pageCount - 1) setCurrentPage((p) => p + 1);
              else if (delta > 60 && currentPage > 0) setCurrentPage((p) => p - 1);
            }}
          >
            {renderPage()}
          </div>

          <footer className="flex gap-2 border-t px-5 pt-3" style={{ paddingBottom: "max(12px, var(--safe-bottom))" }}>
            {currentPage > 0 && (
              <button type="button" onClick={() => setCurrentPage((p) => p - 1)} className="flex h-12 items-center justify-center gap-1 rounded-xl bg-muted px-4 text-[15px] font-semibold">
                <ChevronLeft className="size-4" />
                Back
              </button>
            )}
            {currentPage < pageCount - 1 ? (
              <button type="button" onClick={() => setCurrentPage((p) => p + 1)} className="flex h-12 flex-1 items-center justify-center gap-1 rounded-xl bg-foreground text-[15px] font-semibold text-background">
                {ALL_PAGES[visiblePageIndices[currentPage + 1]].label}
                <ChevronRight className="size-4" />
              </button>
            ) : (
              <button type="button" onClick={onClose} className="flex h-12 flex-1 items-center justify-center rounded-xl bg-foreground text-[15px] font-semibold text-background">
                Done
              </button>
            )}
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

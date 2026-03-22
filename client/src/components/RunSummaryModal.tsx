import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MapContainer, TileLayer, Polyline, Polygon, useMap } from "react-leaflet";
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
} from "lucide-react";
import { decodePolyline } from "@/hooks/use-strava";
import { useParkStats } from "@/hooks/use-parks";
import type { SyncResult } from "./StravaButton";

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

// Build the gamified Strava post body
function buildDefaultPost(
  data: SyncResult,
  stats?: { completed: number; total: number } | null,
  yearVisits?: number | null,
): string {
  const lines: string[] = [];
  const completedIds = new Set(data.parksCompleted.map((p) => p.id));
  const revisited = data.parksVisited.filter((p) => !completedIds.has(p.id));

  // Header
  if (data.parksCompleted.length > 0) {
    lines.push(`\u{1F3C6} ${data.parksCompleted.length} New Park${data.parksCompleted.length !== 1 ? "s" : ""} Conquered!`);
  } else if (revisited.length > 0) {
    lines.push(`\u{1F501} ${revisited.length} Park${revisited.length !== 1 ? "s" : ""} Revisited`);
  }
  lines.push("\u2501".repeat(15));

  // Borough breakdown (of new parks conquered)
  const boroughCounts = data.parksCompleted.reduce<Record<string, number>>((acc, p) => {
    const b = p.borough || "Unknown";
    acc[b] = (acc[b] || 0) + 1;
    return acc;
  }, {});
  if (Object.keys(boroughCounts).length > 0) {
    lines.push("");
    lines.push(
      `\u{1F5FA}\uFE0F ${Object.entries(boroughCounts)
        .map(([b, c]) => `${b} \u00D7${c}`)
        .join(", ")}`
    );
  }

  // Revisited (count only)
  if (revisited.length > 0) {
    lines.push("");
    lines.push(`\u{1F501} ${revisited.length} Park${revisited.length !== 1 ? "s" : ""} Revisited`);
  }

  // Overall progress
  if (stats && stats.total > 0) {
    const pct = ((stats.completed / stats.total) * 100).toFixed(1);
    lines.push("");
    lines.push("\u{1F3AF} Progress");
    lines.push(`${stats.completed} / ${stats.total} parks (${pct}%)`);
    lines.push(`${textProgressBar(parseFloat(pct))} ${pct}%`);
  }

  // 500 Parks Challenge with progress bar
  if (yearVisits != null && yearVisits > 0) {
    const year = new Date().getFullYear();
    const challengePct = Math.min(100, (yearVisits / 500) * 100);
    lines.push("");
    lines.push(`${year} Challenge: ${yearVisits} / 500 parks!`);
    lines.push(`${textProgressBar(challengePct)} ${challengePct.toFixed(1)}%`);
  }

  // Call to action
  lines.push("");
  lines.push("\u{1F33F} Join the challenge!");
  lines.push("challenge.detour.food");

  // Full park list at the bottom
  if (data.parksCompleted.length > 0) {
    lines.push("");
    lines.push("\u2501".repeat(15));
    for (const p of data.parksCompleted) {
      lines.push(`\u2705 ${p.name}${p.borough ? ` \u00B7 ${p.borough}` : ""}`);
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
      map.fitBounds(positions, { padding: [30, 30] });
    }
  }, [map, positions]);
  return null;
}

const ALL_PAGES = [
  { icon: Trophy, title: "scorecard" },
  { icon: MapIcon, title: "route" },
  { icon: Sparkles, title: "facts" },
  { icon: Send, title: "share" },
] as const;

export function RunSummaryModal({ open, onClose, data }: RunSummaryModalProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [funFacts, setFunFacts] = useState<FunFact[]>([]);
  const [stravaPost, setStravaPost] = useState("");
  const [stravaTitle, setStravaTitle] = useState("");
  const [isLoadingFacts, setIsLoadingFacts] = useState(false);
  const [isPostingToStrava, setIsPostingToStrava] = useState(false);
  const [postedToStrava, setPostedToStrava] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

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
    const postText = buildDefaultPost(
      data,
      stats ? { completed: stats.completed, total: stats.total } : null,
      challenge?.totalVisits ?? null,
    );
    setStravaPost(postText);
    setStravaTitle(buildDefaultTitle(data));
  };

  // Reset state whenever the modal opens or data changes
  useEffect(() => {
    if (open && data) {
      setCurrentPage(0);
      setFunFacts([]);
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
            parkIds: data.parksVisited.map((p) => p.id),
            activityData: data.activity
              ? {
                  name: data.activity.name,
                  distance: data.activity.distance,
                  moving_time: data.activity.moving_time,
                  newParksCount: data.parksCompleted.length,
                  totalParksVisited: data.parksVisited.length,
                }
              : undefined,
          }),
        });
        if (res.ok) {
          const result = await res.json();
          setFunFacts(result.facts || []);
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
        setPostError("Failed to post to Strava. Please try again.");
      }
    } catch {
      setPostError("Network error. Please try again.");
    } finally {
      setIsPostingToStrava(false);
    }
  };

  const renderPage = () => {
    switch (actualPage) {
      case 0: {
        // Gamified scorecard
        const newCount = data.parksCompleted.length;
        const visitedCount = data.parksVisited.length;
        return (
          <div className="space-y-4">
            {/* Hero */}
            <div className="text-center py-1">
              {newCount > 0 ? (
                <>
                  <div className="text-5xl font-black font-display text-amber-500 leading-none">
                    🏆 {newCount}
                  </div>
                  <div className="text-base font-bold text-foreground mt-1">
                    Park{newCount !== 1 ? "s" : ""} Conquered!
                  </div>
                  {revisitedParks.length > 0 && (
                    <div className="text-sm text-muted-foreground mt-1">
                      🔁 +{revisitedParks.length} revisited
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="text-4xl font-black font-display text-primary leading-none">
                    🔁 {revisitedParks.length}
                  </div>
                  <div className="text-base font-bold text-foreground mt-1">
                    Park{revisitedParks.length !== 1 ? "s" : ""} Revisited
                  </div>
                </>
              )}
            </div>

            {/* Stat grid — full stats for single run, park counts for bulk sync */}
            <div className="grid grid-cols-2 gap-2">
              {(data.activity
                ? [
                    { label: "Distance", value: formatDistance(data.activity.distance) },
                    { label: "Time", value: formatTime(data.activity.moving_time) },
                    { label: "New Parks", value: String(newCount) },
                    { label: "Parks Visited", value: String(visitedCount) },
                  ]
                : [
                    { label: "New Parks", value: String(newCount) },
                    { label: "Parks Visited", value: String(visitedCount) },
                  ]
              ).map(({ label, value }) => (
                <div
                  key={label}
                  className="bg-muted/40 rounded-xl p-3 border border-border/50 text-center"
                >
                  <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide">
                    {label}
                  </p>
                  <p className="text-2xl font-bold font-display text-foreground">{value}</p>
                </div>
              ))}
            </div>

            {/* Borough pills */}
            {Object.keys(boroughMap).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-2">
                  Boroughs
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(boroughMap).map(([borough, { total, newCount: bc }]) => (
                    <span
                      key={borough}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
                        bc > 0
                          ? "bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-400"
                          : "bg-muted border-border text-muted-foreground"
                      }`}
                    >
                      {borough} ×{total}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Revisited parks */}
            {revisitedParks.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-1">
                  Revisited
                </p>
                <p className="text-sm text-muted-foreground">
                  🔁 {revisitedParks.map((p) => p.name).join(", ")}
                </p>
              </div>
            )}

            {/* New parks list */}
            {newCount > 0 && (
              <div>
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-2">
                  New Parks
                </p>
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {data.parksCompleted.map((park) => (
                    <div
                      key={park.id}
                      className="flex items-center gap-2.5 p-2 bg-primary/5 border border-primary/20 rounded-lg"
                    >
                      <Trophy className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      <div>
                        <p className="font-medium text-sm leading-none">{park.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{park.siteType}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      }

      case 1: {
        // Route map with auto-fit and zoom controls
        if (routePoints.length === 0) {
          return (
            <p className="text-muted-foreground text-center py-8">No route data available.</p>
          );
        }
        return (
          <div
            className="rounded-lg overflow-hidden border border-border"
            style={{ height: 300 }}
          >
            <MapContainer
              center={routePoints[Math.floor(routePoints.length / 2)]}
              zoom={14}
              style={{ height: "100%", width: "100%" }}
              zoomControl={true}
              scrollWheelZoom={true}
            >
              <TileLayer
                attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              />
              {/* Auto-fit map to route bounds */}
              <MapFitter positions={routePoints} />
              {/* Route in Strava orange */}
              <Polyline
                positions={routePoints}
                pathOptions={{ color: "#FC4C02", weight: 3, opacity: 0.9 }}
              />
              {/* Parks visited as green polygons */}
              {data.parksVisited
                .filter((p) => p.polygon)
                .map((park) => {
                  const rawPolygon = park.polygon as unknown as [number, number][];
                  if (!Array.isArray(rawPolygon) || rawPolygon.length < 3) return null;
                  // Stored as [lng, lat] — flip to [lat, lng] for Leaflet
                  const positions = rawPolygon.map(
                    ([lng, lat]) => [lat, lng] as [number, number]
                  );
                  return (
                    <Polygon
                      key={park.id}
                      positions={positions}
                      pathOptions={{
                        color: "hsl(151 55% 42%)",
                        fillColor: "hsl(151 55% 42%)",
                        fillOpacity: 0.4,
                        weight: 2,
                      }}
                    />
                  );
                })}
            </MapContainer>
          </div>
        );
      }

      case 2: {
        // AI fun facts
        if (isLoadingFacts) {
          return (
            <div className="text-center py-12">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
              <p className="text-sm text-muted-foreground">
                Generating fun facts about your green spaces...
              </p>
            </div>
          );
        }
        if (funFacts.length === 0) {
          return (
            <p className="text-center py-8 text-muted-foreground">
              {data.parksVisited.length === 0
                ? "No parks visited on this run."
                : "Could not load fun facts — try again later."}
            </p>
          );
        }
        return (
          <div className="space-y-4 max-h-64 overflow-y-auto pr-1">
            {funFacts.map((item) => (
              <div
                key={item.parkId}
                className="bg-muted/30 rounded-xl p-4 border border-border/50"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Trees className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <h4 className="font-semibold text-sm">{item.parkName}</h4>
                </div>
                <ul className="space-y-1.5">
                  {item.facts.map((fact, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex gap-2">
                      <span className="text-primary font-bold flex-shrink-0">·</span>
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
        // Strava post with editable title + gamified description
        return (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Edit your activity title and description, then push to Strava.
            </p>

            {/* Activity title */}
            <div>
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-1">
                Title
              </p>
              <input
                className="w-full rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={stravaTitle}
                onChange={(e) => {
                  setStravaTitle(e.target.value);
                  setPostedToStrava(false);
                }}
                placeholder="Activity name..."
              />
            </div>

            {/* Description / post body */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
                  Description
                </p>
                <button
                  onClick={() => {
                    generateDefaults();
                    setPostedToStrava(false);
                  }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              </div>
              <textarea
                className="w-full h-48 rounded-lg border border-border bg-muted/20 p-3 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono leading-relaxed"
                value={stravaPost}
                onChange={(e) => {
                  setStravaPost(e.target.value);
                  setPostedToStrava(false);
                }}
                placeholder="Your run description..."
              />
            </div>

            {postError && <p className="text-xs text-destructive">{postError}</p>}
            <Button
              className={`w-full gap-2 text-white ${
                postedToStrava
                  ? "bg-green-600 hover:bg-green-600"
                  : "bg-[#FC4C02] hover:bg-[#e04402]"
              }`}
              disabled={isPostingToStrava || !data.activity?.id}
              onClick={pushToStrava}
            >
              {isPostingToStrava ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : postedToStrava ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {postedToStrava ? "Posted to Strava!" : "Push to Strava"}
            </Button>
          </div>
        );
      }
    }
  };

  const PageIcon = ALL_PAGES[actualPage].icon;
  const pageTitles: Record<number, string> = {
    0: hasActivity ? (data.activity?.name ?? "Run Summary") : "Parks Synced",
    1: "Your Route",
    2: "Did You Know?",
    3: "Share on Strava",
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PageIcon className="w-5 h-5 text-primary" />
            {pageTitles[actualPage]}
          </DialogTitle>
          {/* Page indicator dots */}
          {pageCount > 1 && (
            <div className="flex gap-1.5 pt-1">
              {Array.from({ length: pageCount }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentPage(i)}
                  className={`rounded-full transition-all duration-200 ${
                    i === currentPage
                      ? "bg-primary h-2 w-6 sm:h-1.5 sm:w-4"
                      : "bg-muted h-2 w-2 sm:h-1.5 sm:w-1.5 hover:bg-muted-foreground/40"
                  }`}
                  aria-label={`Go to page ${i + 1}`}
                />
              ))}
            </div>
          )}
        </DialogHeader>

        <div className="min-h-[200px]">{renderPage()}</div>

        <div className="flex justify-between pt-2">
          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px] px-4"
            onClick={() => setCurrentPage((p) => p - 1)}
            disabled={currentPage === 0}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          {currentPage < pageCount - 1 ? (
            <Button size="sm" className="min-h-[44px] px-4" onClick={() => setCurrentPage((p) => p + 1)}>
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button size="sm" className="min-h-[44px] px-4" onClick={onClose}>
              Done
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MapContainer, TileLayer, Polyline, Polygon } from "react-leaflet";
import {
  Loader2,
  Trophy,
  ChevronLeft,
  ChevronRight,
  Map as MapIcon,
  Timer,
  Trees,
  Sparkles,
} from "lucide-react";
import { decodePolyline } from "@/hooks/use-strava";
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

const PAGE_ICONS = [Trophy, Timer, MapIcon, Sparkles];
const PAGE_COUNT = 4;

export function RunSummaryModal({ open, onClose, data }: RunSummaryModalProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [funFacts, setFunFacts] = useState<FunFact[]>([]);
  const [isLoadingFacts, setIsLoadingFacts] = useState(false);

  // Reset to first page whenever the modal opens with new data
  useEffect(() => {
    if (open) {
      setCurrentPage(0);
      setFunFacts([]);
    }
  }, [open]);

  // Fetch fun facts as soon as the modal opens (so they're ready by the time the user reaches page 4)
  useEffect(() => {
    if (!open || !data || data.parksVisited.length === 0) return;

    const fetchFacts = async () => {
      setIsLoadingFacts(true);
      try {
        const res = await fetch("/api/parks/fun-facts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ parkIds: data.parksVisited.map((p) => p.id) }),
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

  const formatDistance = (m: number) => `${(m / 1000).toFixed(2)} km`;
  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const hrs = Math.floor(mins / 60);
    return hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
  };

  // decodePolyline from use-strava returns [lat, lng] — correct for Leaflet
  const routePoints = data.activity?.summaryPolyline
    ? decodePolyline(data.activity.summaryPolyline)
    : [];

  const renderPage = () => {
    switch (currentPage) {
      case 0: {
        // Parks completed in this run
        return (
          <div className="space-y-3">
            {data.parksCompleted.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Trophy className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
                <p className="font-medium">No new parks on this one!</p>
                <p className="text-sm mt-1">
                  {data.parksVisited.length > 0
                    ? `You passed through ${data.parksVisited.length} park(s) you've already completed.`
                    : "No parks were detected on this route."}
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  You ticked off{" "}
                  <span className="font-semibold text-foreground">{data.parksCompleted.length}</span>{" "}
                  new park{data.parksCompleted.length !== 1 ? "s" : ""}!
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {data.parksCompleted.map((park) => (
                    <div
                      key={park.id}
                      className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg"
                    >
                      <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                        <Trophy className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{park.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {park.borough} · {park.siteType}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      }

      case 1: {
        // Run stats
        if (!data.activity) {
          return <p className="text-muted-foreground text-center py-8">No activity data available.</p>;
        }
        return (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted/30 rounded-xl p-4 border border-border/50 text-center">
              <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide mb-1">
                Distance
              </p>
              <p className="text-3xl font-bold font-display">
                {formatDistance(data.activity.distance)}
              </p>
            </div>
            <div className="bg-muted/30 rounded-xl p-4 border border-border/50 text-center">
              <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide mb-1">
                Time
              </p>
              <p className="text-3xl font-bold font-display">
                {formatTime(data.activity.moving_time)}
              </p>
            </div>
            <div className="bg-muted/30 rounded-xl p-4 border border-border/50 text-center col-span-2">
              <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide mb-1">
                Date
              </p>
              <p className="text-xl font-bold font-display">
                {new Date(data.activity.start_date).toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </p>
            </div>
          </div>
        );
      }

      case 2: {
        // Mini route map
        if (routePoints.length === 0) {
          return (
            <p className="text-muted-foreground text-center py-8">No route data available.</p>
          );
        }
        const midPoint = routePoints[Math.floor(routePoints.length / 2)];
        return (
          <div
            className="rounded-lg overflow-hidden border border-border"
            style={{ height: 280 }}
          >
            <MapContainer
              center={midPoint}
              zoom={14}
              style={{ height: "100%", width: "100%" }}
              zoomControl={false}
              scrollWheelZoom={false}
            >
              <TileLayer
                attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              />
              {/* Strava route in orange */}
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
                  // Polygon stored as [lng, lat] — flip to [lat, lng] for Leaflet
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

      case 3: {
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
    }
  };

  const PageIcon = PAGE_ICONS[currentPage];
  const pageTitles = [
    "Parks Completed",
    data.activity?.name ?? "Run Stats",
    "Your Route",
    "Did You Know?",
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PageIcon className="w-5 h-5 text-primary" />
            {pageTitles[currentPage]}
          </DialogTitle>
          {/* Page indicator dots */}
          <div className="flex gap-1.5 pt-1">
            {Array.from({ length: PAGE_COUNT }).map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i)}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  i === currentPage ? "bg-primary w-4" : "bg-muted w-1.5 hover:bg-muted-foreground/40"
                }`}
                aria-label={`Go to page ${i + 1}`}
              />
            ))}
          </div>
        </DialogHeader>

        <div className="min-h-[200px]">{renderPage()}</div>

        <div className="flex justify-between pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => p - 1)}
            disabled={currentPage === 0}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          {currentPage < PAGE_COUNT - 1 ? (
            <Button size="sm" onClick={() => setCurrentPage((p) => p + 1)}>
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

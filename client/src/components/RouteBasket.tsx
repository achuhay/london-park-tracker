import { useRef, useState, useMemo } from "react";
import type { ParkResponse } from "@shared/routes";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { X, GripVertical, Wand2, ExternalLink, Download, Route, ChevronUp, ChevronDown, Search, Plus, MapPin, Clock } from "lucide-react";
import { optimizeRoute, buildGoogleMapsUrl, generateGpx, getParkCenter, type LocationPoint } from "@/lib/route-utils";
import { LocationSearch } from "@/components/LocationSearch";
import { useIsMobile } from "@/hooks/use-mobile";

interface RouteBasketProps {
  parks: ParkResponse[];
  onClose: () => void;
  onReorder: (parks: ParkResponse[]) => void;
  onRemove: (id: number) => void;
  startPoint: LocationPoint | null;
  endPoint: LocationPoint | null;
  onStartPointChange: (p: LocationPoint | null) => void;
  onEndPointChange: (p: LocationPoint | null) => void;
  /** All parks (for the search + suggestions features) */
  allParks?: ParkResponse[];
  /** Called when user picks a park from search or suggestions to add to route */
  onAddPark?: (park: ParkResponse) => void;
}

export function RouteBasket({
  parks,
  onClose,
  onReorder,
  onRemove,
  startPoint,
  endPoint,
  onStartPointChange,
  onEndPointChange,
  allParks = [],
  onAddPark,
}: RouteBasketProps) {
  const isMobile = useIsMobile();
  const [isLoop, setIsLoop] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const dragIdx = useRef<number | null>(null);
  const dragOverIdx = useRef<number | null>(null);

  // Set of IDs already in the route basket — used to exclude from search results
  const routeIds = useMemo(() => new Set(parks.map(p => p.id)), [parks]);

  // Filtered search results — client-side, instant, capped at 8
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return allParks
      .filter(p => !routeIds.has(p.id) && (
        p.name.toLowerCase().includes(q) || p.borough.toLowerCase().includes(q)
      ))
      .slice(0, 8);
  }, [searchQuery, allParks, routeIds]);

  // Nearby incomplete parks — shown when start point is set (up to 6, within ~2km)
  const nearbyParks = useMemo(() => {
    if (!startPoint || allParks.length === 0) return [];
    return allParks
      .filter(p => !p.completed && !routeIds.has(p.id) && p.latitude && p.longitude)
      .map(p => ({
        park: p,
        dist: haversineKm(startPoint.lat, startPoint.lng, p.latitude!, p.longitude!),
      }))
      .filter(({ dist }) => dist <= 2)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 6);
  }, [startPoint, allParks, routeIds]);

  const newParksCount = parks.filter((p) => !p.completed).length;
  const completedInRoute = parks.length - newParksCount;

  // Compute total straight-line distance across all waypoints
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

  const totalDistKm = (() => {
    const waypoints: [number, number][] = [];
    if (startPoint) waypoints.push([startPoint.lat, startPoint.lng]);
    for (const park of parks) {
      const c = getParkCenter(park);
      if (c) waypoints.push(c);
    }
    if (endPoint) waypoints.push([endPoint.lat, endPoint.lng]);
    if (waypoints.length < 2) return null;
    let total = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      total += haversineKm(waypoints[i][0], waypoints[i][1], waypoints[i + 1][0], waypoints[i + 1][1]);
    }
    return total;
  })();

  function handleOptimize() {
    onReorder(optimizeRoute(parks));
  }

  function handleGoogleMaps() {
    const url = buildGoogleMapsUrl(parks, isLoop, startPoint, endPoint);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleDownloadGpx() {
    const gpx = generateGpx(parks, isLoop, startPoint, endPoint);
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "park-route.gpx";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onDragStart(idx: number) {
    dragIdx.current = idx;
  }

  function onDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    if (dragOverIdx.current === idx) return;
    dragOverIdx.current = idx;

    const reordered = [...parks];
    const [moved] = reordered.splice(dragIdx.current, 1);
    reordered.splice(idx, 0, moved);
    dragIdx.current = idx;
    onReorder(reordered);
  }

  function onDragEnd() {
    dragIdx.current = null;
    dragOverIdx.current = null;
  }

  const hasAnything = startPoint || endPoint || parks.length > 0;

  function moveUp(idx: number) {
    if (idx === 0) return;
    const reordered = [...parks];
    [reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]];
    onReorder(reordered);
  }

  function moveDown(idx: number) {
    if (idx >= parks.length - 1) return;
    const reordered = [...parks];
    [reordered[idx], reordered[idx + 1]] = [reordered[idx + 1], reordered[idx]];
    onReorder(reordered);
  }

  // Shared panel inner content — used in both desktop and mobile drawer
  const panelContent = (
    <>
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Route className="w-4 h-4 text-primary" />
          <h2 className="font-bold text-sm">Route Builder</h2>
          {parks.length > 0 && (
            <span className="bg-primary text-primary-foreground text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
              {parks.length}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9 md:h-7 md:w-7">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Stats */}
      {(parks.length > 0 || totalDistKm !== null) && (
        <div className="px-4 py-3 bg-muted/30 border-b border-border flex-shrink-0 space-y-1">
          {parks.length > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                <span className="text-green-600 dark:text-green-400 font-bold">{newParksCount}</span>{" "}
                new {newParksCount === 1 ? "park" : "parks"}
                {completedInRoute > 0 && (
                  <span className="text-muted-foreground text-xs font-normal ml-1">· {completedInRoute} done</span>
                )}
              </p>
              {totalDistKm !== null && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {totalDistKm < 1
                      ? `${Math.round(totalDistKm * 1000)} m`
                      : `${totalDistKm.toFixed(1)} km`}
                  </span>
                  {totalDistKm >= 0.5 && (
                    <span className="flex items-center gap-0.5">
                      <Clock className="w-3 h-3" />
                      {(() => {
                        const mins = Math.round(totalDistKm * 6);
                        return mins >= 60 ? `~${Math.floor(mins / 60)}h ${mins % 60}m` : `~${mins} min`;
                      })()}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main scrollable area: start → parks → end */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {/* ── Start point ── */}
          <LocationSearch
            label="Start from"
            placeholder="Home, tube station, pub…"
            value={startPoint}
            onChange={onStartPointChange}
            accentColor="text-green-600 dark:text-green-400"
            dotColor="bg-green-500"
          />

          {/* ── Connector line between start and parks ── */}
          {(startPoint || parks.length > 0) && (
            <div className="flex items-center gap-2 px-1">
              <div className="w-0.5 h-4 bg-border mx-auto ml-[5px]" />
            </div>
          )}

          {/* ── Park search ── */}
          {onAddPark && allParks.length > 0 && (
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search parks by name or borough…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                  className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              {/* Search results dropdown */}
              {searchFocused && searchResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                  {searchResults.map(park => (
                    <button
                      key={park.id}
                      onMouseDown={() => {
                        onAddPark(park);
                        setSearchQuery("");
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/60 transition-colors"
                    >
                      <div
                        className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${park.completed ? "bg-yellow-500" : "bg-green-500"}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{park.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{park.borough}</p>
                      </div>
                      <Plus className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Nearby park suggestions (when start point is set) ── */}
          {nearbyParks.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Nearby new parks
              </p>
              <div className="space-y-0.5">
                {nearbyParks.map(({ park, dist }) => (
                  <button
                    key={park.id}
                    onClick={() => onAddPark?.(park)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors text-left"
                  >
                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0 bg-green-500" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{park.name}</p>
                      <p className="text-[10px] text-muted-foreground">{park.borough}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      {dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`}
                    </span>
                    <Plus className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Park rows ── */}
          {parks.length === 0 ? (
            <div className="py-4 text-center text-muted-foreground">
              <Route className="w-6 h-6 mx-auto mb-2 opacity-20" />
              <p className="text-xs font-medium">No parks added yet</p>
              <p className="text-xs mt-1 leading-relaxed opacity-70">
                Tap the map or search above
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {parks.map((park, idx) => (
                <div
                  key={park.id}
                  draggable
                  onDragStart={() => onDragStart(idx)}
                  onDragOver={(e) => onDragOver(e, idx)}
                  onDragEnd={onDragEnd}
                  className="flex items-center gap-2 p-2 rounded-lg bg-card border border-border hover:border-primary/40 transition-colors cursor-grab active:cursor-grabbing active:opacity-60 group"
                >
                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />

                  {/* Completion indicator square */}
                  <div
                    className={`w-3 h-3 rounded-sm flex-shrink-0 ${
                      park.completed ? "bg-yellow-500" : "bg-green-500"
                    }`}
                    title={park.completed ? "Already completed" : "New park"}
                  />

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate leading-tight">{park.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{park.borough}</p>
                  </div>

                  <span className="text-xs text-muted-foreground/50 flex-shrink-0 font-mono w-4 text-right">
                    {idx + 1}
                  </span>

                  {/* Mobile: up/down reorder buttons (touch-friendly) */}
                  <div className="flex flex-col md:hidden flex-shrink-0">
                    <button
                      onClick={() => moveUp(idx)}
                      disabled={idx === 0}
                      className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => moveDown(idx)}
                      disabled={idx >= parks.length - 1}
                      className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 md:h-5 md:w-5 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => onRemove(park.id)}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* ── Connector line between parks and end ── */}
          {(endPoint || parks.length > 0) && (
            <div className="flex items-center gap-2 px-1">
              <div className="w-0.5 h-4 bg-border mx-auto ml-[5px]" />
            </div>
          )}

          {/* ── End point ── */}
          <LocationSearch
            label="End at"
            placeholder="Pub, home, tube station…"
            value={endPoint}
            onChange={onEndPointChange}
            accentColor="text-red-600 dark:text-red-400"
            dotColor="bg-red-500"
          />
        </div>
      </ScrollArea>

      {/* Footer actions */}
      <div className="p-4 border-t border-border space-y-3 flex-shrink-0">
        {parks.length >= 2 && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleOptimize}
          >
            <Wand2 className="w-3.5 h-3.5 mr-1.5" />
            Auto-optimize order
          </Button>
        )}

        <div className="flex items-center justify-between">
          <Label htmlFor="route-loop-toggle" className="text-sm cursor-pointer select-none">
            Make it a loop
          </Label>
          <Switch
            id="route-loop-toggle"
            checked={isLoop}
            onCheckedChange={setIsLoop}
            disabled={!!endPoint} // loop doesn't make sense when an end point is set
          />
        </div>

        <Button
          className="w-full"
          onClick={handleDownloadGpx}
          disabled={!hasAnything}
        >
          <Download className="w-3.5 h-3.5 mr-1.5" />
          Download GPX for Komoot
        </Button>

        <Button
          variant="outline"
          className="w-full"
          onClick={handleGoogleMaps}
          disabled={!hasAnything}
        >
          <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
          Open in Google Maps
        </Button>
    </div>
    </>
  );

  // Mobile: render as a bottom sheet (Vaul Drawer)
  if (isMobile) {
    return (
      <Drawer
        open={true}
        onOpenChange={(open) => { if (!open) onClose(); }}
        snapPoints={[0.5, 1]}
        modal={true}
      >
        <DrawerContent className="flex flex-col p-0 focus:outline-none" style={{ maxHeight: "95dvh" }}>
          {panelContent}
        </DrawerContent>
      </Drawer>
    );
  }

  // Desktop: absolute right panel
  return (
    <>
      {/* Backdrop (desktop doesn't need one, but keeps bg-dim for any overlap) */}
      <div className="absolute right-0 top-0 h-full w-72 bg-background border-l border-border shadow-2xl z-[999] flex flex-col">
        {panelContent}
      </div>
    </>
  );
}

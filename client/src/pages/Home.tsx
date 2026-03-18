import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart, Bar, Cell, ResponsiveContainer } from "recharts";
import { useParks, useParkStats, useToggleParkComplete, useFilterOptions } from "@/hooks/use-parks";
import { MapContainer, TileLayer, Polygon, CircleMarker, Popup, LayersControl, Marker, Polyline } from "react-leaflet";
import L from "leaflet";
import { MapController } from "@/components/MapController";
import { ParkPopup } from "@/components/ParkPopup";
import { StatsCard } from "@/components/StatsCard";
import { ParkFilter } from "@/components/ParkFilter";
import { RouteOverlay } from "@/components/RouteOverlay";
import { RouteBasket } from "@/components/RouteBasket";
import { StravaButton } from "@/components/StravaButton";
import { RunSummaryModal } from "@/components/RunSummaryModal";
import type { SyncResult } from "@/components/StravaButton";
import { useStravaStatus, useSyncAllActivities } from "@/hooks/use-strava";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Loader2, Menu, Map as MapIcon, List, AlertCircle, Trophy, Route, Filter, ChevronDown } from "lucide-react";
import { SiStrava } from "react-icons/si";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ParkResponse } from "@shared/routes";
import { getParkCenter, type LocationPoint } from "@/lib/route-utils";

export default function Home() {
  const [filters, setFilters] = useState<any>({});
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [showRoutes, setShowRoutes] = useState(false);
  const [showOnly2026, setShowOnly2026] = useState(false);
  const [showCompletedOnly, setShowCompletedOnly] = useState(false);
  const [routeBuilderMode, setRouteBuilderMode] = useState(false);
  const [routeParks, setRouteParks] = useState<ParkResponse[]>([]);
  const [startPoint, setStartPoint] = useState<LocationPoint | null>(null);
  const [endPoint, setEndPoint] = useState<LocationPoint | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [stravaError, setStravaError] = useState<string | null>(null);
  const [isInitialSyncing, setIsInitialSyncing] = useState(false);
  const hasAutoSynced = useRef(false);
  const hasBackgroundSynced = useRef(false);

  const { data: stravaStatus } = useStravaStatus();
  const syncAll = useSyncAllActivities();
  const queryClient = useQueryClient();

  // Auto-sync all runs on first login (when ?strava=connected appears)
  useEffect(() => {
    if (hasAutoSynced.current) return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("strava");
    const errorDetail = params.get("strava_error");

    if (status && status !== "connected") {
      const fullUrl = window.location.href;
      setStravaError(errorDetail || `Strava status: ${status}. Return URL was: ${fullUrl}`);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (status === "connected") {
      hasAutoSynced.current = true;
      window.history.replaceState({}, "", window.location.pathname);
      setIsInitialSyncing(true);
      syncAll.mutate(undefined, {
        onSuccess: (data: any) => {
          setIsInitialSyncing(false);
          queryClient.invalidateQueries({ queryKey: ["/api/parks"] });
          queryClient.invalidateQueries({ queryKey: ["/api/strava/status"] });
          if (data.parksCompleted?.length > 0 || data.parksVisited?.length > 0) {
            setSyncResult({
              activity: null,
              parksCompleted: data.parksCompleted || [],
              parksVisited: data.parksVisited || [],
              message: data.message || "Sync complete",
            });
          }
        },
        onError: () => {
          setIsInitialSyncing(false);
          setStravaError("Failed to sync your Strava runs. Try clicking 'Sync Latest Run' manually.");
        },
      });
    }
  }, []);

  // Background sync for returning users — check for new runs since last visit
  useEffect(() => {
    if (hasBackgroundSynced.current || hasAutoSynced.current) return;
    if (!stravaStatus?.connected) return;

    hasBackgroundSynced.current = true;
    // Sync latest run in the background
    fetch("/api/strava/sync-latest", { method: "POST", credentials: "include" })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.parksCompleted?.length > 0) {
          queryClient.invalidateQueries({ queryKey: ["/api/parks"] });
          setSyncResult(data);
        }
      })
      .catch(() => {}); // Silent — background sync shouldn't show errors
  }, [stravaStatus?.connected]);

  const { data: allParks = [], isLoading: isLoadingParks, error } = useParks(filters);
  const { data: stats, isLoading: isLoadingStats } = useParkStats();
  const { data: filterOptions } = useFilterOptions();
  const toggleComplete = useToggleParkComplete();

  // 500 Parks Challenge — annual tracker
  const { data: challenge } = useQuery<{
    totalVisits: number;
    weekly: { week: number; visits: number }[];
    year: number;
    target: number;
  }>({ queryKey: ["/api/stats/year-challenge"] });

  const challengeStats = useMemo(() => {
    const CHALLENGE_TARGET = 500;
    const totalVisits = challenge?.totalVisits ?? 0;
    const progressPct = Math.min(100, (totalVisits / CHALLENGE_TARGET) * 100);
    const weeksElapsed = challenge?.weekly.length ?? 0;
    const weeksLeft = Math.max(0, 52 - weeksElapsed);
    const weeklyRate = weeksElapsed > 0 ? totalVisits / weeksElapsed : 0;
    const projected = Math.round(totalVisits + weeklyRate * weeksLeft);

    // Per-week bars: compute delta from cumulative weekly data
    const weekly = challenge?.weekly ?? [];
    const weeklyBars = weekly.map((d, i) => ({
      week: d.week,
      count: i === 0 ? d.visits : d.visits - weekly[i - 1].visits,
    }));

    return { totalVisits, progressPct, projected, weeklyBars };
  }, [challenge]);

  // Filter parks based on active toggles
  // showOnly2026: keeps parks completed this year + all incomplete parks
  // showCompletedOnly: keeps only completed parks
  // Both on: only parks completed this year
  const parks = useMemo(() => {
    let result = allParks;
    if (showOnly2026) {
      const thisYear = new Date().getFullYear();
      result = result.filter(park =>
        !park.completed ||
        (park.completedDate && new Date(park.completedDate).getFullYear() === thisYear)
      );
    }
    if (showCompletedOnly) {
      result = result.filter(park => park.completed);
    }
    return result;
  }, [allParks, showOnly2026, showCompletedOnly]);

  // Set of park IDs currently in the route basket for O(1) lookup
  const routeParkSet = useMemo(
    () => new Set(routeParks.map((p) => p.id)),
    [routeParks]
  );

  const toggleParkInRoute = useCallback((park: ParkResponse) => {
    setRouteParks((prev) => {
      const exists = prev.some((p) => p.id === park.id);
      if (exists) return prev.filter((p) => p.id !== park.id);
      return [...prev, park];
    });
    // Auto-open basket when adding the first park
    setRouteBuilderMode(true);
  }, []);

  const handleRouteReorder = useCallback((reordered: ParkResponse[]) => {
    setRouteParks(reordered);
  }, []);

  const handleRouteRemove = useCallback((id: number) => {
    setRouteParks((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // When user clicks "View Run Card" on a route polyline, fetch the summary and open RunSummaryModal
  const handleRouteActivityClick = useCallback(async (stravaId: string) => {
    try {
      const res = await fetch(`/api/strava/activity/${stravaId}/summary`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load summary");
      const result: SyncResult = await res.json();
      setSyncResult(result);
    } catch {
      // Silently fail — the loading state in RouteOverlay will clear on its own
    }
  }, []);

  // Use filter options from all parks, not just filtered results
  const uniqueBoroughs = filterOptions?.boroughs || [];
  const uniqueTypes = filterOptions?.siteTypes || [];
  const uniqueAccessCategories = filterOptions?.accessCategories || [];

  // Active filter tracking (for collapsed filter header badge)
  const selectedBoroughs = filters.borough ? filters.borough.split(',').filter(Boolean) : [];
  const selectedTypes = filters.siteType ? filters.siteType.split(',').filter(Boolean) : [];
  const selectedAccess = filters.accessCategory ? filters.accessCategory.split(',').filter(Boolean) : [];
  const hasActiveFilters = selectedBoroughs.length > 0 || selectedTypes.length > 0 || selectedAccess.length > 0 || !!filters.search;
  const activeFilterCount = [selectedBoroughs, selectedTypes, selectedAccess].filter(a => a.length > 0).length + (filters.search ? 1 : 0);

  // Shared sidebar content (rendered in both desktop panel and mobile Sheet)
  const SidebarInner = () => (
    <>
      <StatsCard
        stats={stats}
        isLoading={isLoadingStats}
        showCompletedOnly={showCompletedOnly}
        onToggleCompleted={setShowCompletedOnly}
      />

      {/* 500 Parks Challenge */}
      {challenge && (
        <div className="bg-card rounded-xl border border-border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Trophy className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs font-semibold">500 Parks {challenge.year}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <label htmlFor="toggle-2026" className="text-[10px] text-muted-foreground cursor-pointer select-none">
                2026 only
              </label>
              <Switch
                id="toggle-2026"
                checked={showOnly2026}
                onCheckedChange={setShowOnly2026}
                className="scale-75 origin-right"
              />
            </div>
          </div>

          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold">{challengeStats.totalVisits}</span>
            <span className="text-xs text-muted-foreground">/ 500 parks</span>
            <span className="ml-auto text-xs font-semibold text-primary">
              {challengeStats.progressPct.toFixed(1)}%
            </span>
          </div>

          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${challengeStats.progressPct}%` }}
            />
          </div>

          <ResponsiveContainer width="100%" height={48}>
            <BarChart
              data={challengeStats.weeklyBars}
              margin={{ top: 2, right: 0, left: 0, bottom: 0 }}
              barSize={4}
              barGap={1}
            >
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {challengeStats.weeklyBars.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.count > 0 ? "hsl(var(--primary))" : "hsl(var(--muted))"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <p className="text-[10px] text-muted-foreground">
            On track for ~<span className="font-semibold text-foreground">{challengeStats.projected}</span> parks by year end
          </p>
        </div>
      )}

      <StravaButton onSyncComplete={setSyncResult} isSyncing={isInitialSyncing} />

      {/* Collapsible filters */}
      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/30 transition-colors"
          onClick={() => setFiltersOpen(v => !v)}
        >
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-primary" />
            <span>Filters</span>
            {hasActiveFilters && (
              <span className="text-[10px] bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 leading-none">
                {activeFilterCount}
              </span>
            )}
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${filtersOpen ? 'rotate-180' : ''}`} />
        </button>
        {filtersOpen && (
          <ParkFilter
            filters={filters}
            setFilters={setFilters}
            uniqueBoroughs={uniqueBoroughs}
            uniqueTypes={uniqueTypes}
            uniqueAccessCategories={uniqueAccessCategories}
          />
        )}
      </div>
    </>
  );

  return (
    <div className="h-screen w-full flex bg-background overflow-hidden relative">

      {/* --- Sidebar (Desktop) --- */}
      <div className="w-80 h-full border-r border-border bg-[#F5EDD9] z-20 flex-col p-4 hidden md:flex overflow-hidden">
        {/* Detour brand header */}
        <div className="bg-[#25391D] -mx-4 -mt-4 px-5 pt-5 pb-5 mb-3 rounded-b-2xl flex-shrink-0">
          <img src="/detour-logo-white.svg" alt="Detour" className="h-8 w-auto" />
          <h1 className="mt-2 text-[#F5EDD9] text-lg font-semibold italic leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
            London Park Challenge
          </h1>
          <p className="mt-0.5 text-[#F5EDD9]/60 text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ fontFamily: 'var(--font-body)' }}>
            Off the beaten path
          </p>
        </div>

        {/* Main content — fixed height, no scroll */}
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          <SidebarInner />
        </div>

        <div className="pt-3 mt-3 border-t border-border flex items-center justify-between flex-shrink-0">
          <a href="/marathon" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Marathon Planner
          </a>
          <a href="/admin" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Admin Login
          </a>
        </div>
      </div>

      {/* --- Mobile Header --- */}
      <div className="absolute top-4 left-4 z-[1000] md:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="shadow-lg bg-background border-border">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 p-0 bg-[#F5EDD9]">
            <div className="flex flex-col h-full p-4">
              {/* Detour brand header — mobile */}
              <div className="bg-[#25391D] -mx-4 -mt-4 px-5 pt-5 pb-5 mb-3 rounded-b-2xl flex-shrink-0">
                <img src="/detour-logo-white.svg" alt="Detour" className="h-8 w-auto" />
                <h1 className="mt-2 text-[#F5EDD9] text-lg font-semibold italic leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
                  London Park Challenge
                </h1>
                <p className="mt-0.5 text-[#F5EDD9]/60 text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ fontFamily: 'var(--font-body)' }}>
                  Off the beaten path
                </p>
              </div>

              <div className="flex flex-col gap-3 flex-1 min-h-0">
                <SidebarInner />
              </div>

              <div className="pt-3 mt-3 border-t border-border flex items-center justify-between flex-shrink-0">
                <a href="/marathon" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Marathon Planner
                </a>
                <a href="/admin" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Admin Login
                </a>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* --- Main Content --- */}
      <div className="flex-1 relative">
        {/* Syncing overlay — shown during initial sync after OAuth */}
        {isInitialSyncing && (
          <div className="absolute inset-0 z-[2000] bg-background/80 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-card rounded-2xl border border-border shadow-xl p-8 text-center max-w-sm">
              <SiStrava className="w-10 h-10 text-[#FC4C02] mx-auto mb-4" />
              <h2 className="text-lg font-semibold mb-2">Syncing your Strava runs</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Processing your recent activities and finding which parks you've run through...
              </p>
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-[#FC4C02]" />
            </div>
          </div>
        )}
        {/* View Mode Toggle & Route Toggle */}
        <div
          className="absolute top-4 z-[1000] flex gap-2 transition-all duration-200"
          style={{ right: routeBuilderMode ? "19rem" : "1rem" }}
        >
          {/* Build Route button */}
          <Button
            variant={routeBuilderMode ? "default" : "outline"}
            size="sm"
            className={`shadow-lg gap-1.5 ${
              routeBuilderMode
                ? "bg-[#25391D] hover:bg-[#1a2914] text-[#F5EDD9] border-[#25391D]"
                : "bg-background/95 backdrop-blur-sm"
            }`}
            onClick={() => setRouteBuilderMode((v) => !v)}
          >
            <Route className="w-4 h-4" />
            Build Route
            {routeParks.length > 0 && (
              <span className={`text-xs font-bold px-1 py-0.5 rounded-full leading-none ${
                routeBuilderMode ? "bg-white/20" : "bg-[#25391D]/10 text-[#25391D]"
              }`}>
                {routeParks.length}
              </span>
            )}
          </Button>

          <div className="flex items-center gap-2 bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-lg p-1">
            <div className="flex items-center gap-2 px-2">
              <Route className="w-4 h-4 text-muted-foreground" />
              <Switch
                checked={showRoutes}
                onCheckedChange={setShowRoutes}
                id="routes-toggle"
              />
            </div>
          </div>

          <div className="bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-lg flex overflow-hidden">
            <button
              onClick={() => setViewMode("map")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === "map"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
              data-testid="button-view-map"
            >
              <div className="flex items-center gap-2">
                <MapIcon className="w-4 h-4" /> Map
              </div>
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === "list"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
              data-testid="button-view-list"
            >
              <div className="flex items-center gap-2">
                <List className="w-4 h-4" /> List
              </div>
            </button>
          </div>
        </div>

        {error && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] w-full max-w-md px-4">
            <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive-foreground shadow-xl">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error loading parks</AlertTitle>
              <AlertDescription>
                {(error as Error).message}
              </AlertDescription>
            </Alert>
          </div>
        )}

        {stravaError && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] w-full max-w-md px-4">
            <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive-foreground shadow-xl">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Strava connection failed</AlertTitle>
              <AlertDescription className="break-all text-xs">
                {stravaError}
              </AlertDescription>
              <button
                className="mt-2 text-xs underline opacity-70 hover:opacity-100"
                onClick={() => setStravaError(null)}
              >
                Dismiss
              </button>
            </Alert>
          </div>
        )}

        {/* Route Basket panel — shown in both map and list mode */}
        {routeBuilderMode && (
          <RouteBasket
            parks={routeParks}
            onClose={() => setRouteBuilderMode(false)}
            onReorder={handleRouteReorder}
            onRemove={handleRouteRemove}
            startPoint={startPoint}
            endPoint={endPoint}
            onStartPointChange={setStartPoint}
            onEndPointChange={setEndPoint}
          />
        )}

        {viewMode === "map" ? (
          <div className="w-full h-full">
             <MapContainer
               center={[51.505, -0.09]}
               zoom={11}
               style={{ height: "100%", width: "100%" }}
               zoomControl={false}
             >
              <LayersControl position="bottomright">
                <LayersControl.BaseLayer checked name="Clean Light">
                   <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                  />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Clean Dark">
                   <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Satellite">
                   <TileLayer
                    attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  />
                </LayersControl.BaseLayer>
              </LayersControl>

              <MapController />

              {parks.map((park) => {
                // Check if park has polygon data
                // OSM format is [lng, lat], Leaflet needs [lat, lng]
                const rawPolygon = park.polygon as unknown as [number, number][];
                const hasPolygon = Array.isArray(rawPolygon) && rawPolygon.length >= 3;

                // Convert [lng, lat] to [lat, lng] for Leaflet
                const positions = hasPolygon
                  ? rawPolygon.map(([lng, lat]) => [lat, lng] as [number, number])
                  : [];

                const inRoute = routeParkSet.has(park.id);

                // Colors: Ember for completed, Fern for incomplete, Forest for route outline
                const baseColor = park.completed ? "#E85D1A" : "#6B8C5A";
                const color = inRoute ? "#25391D" : baseColor;
                const fillColor = baseColor;
                const fillOpacity = park.completed ? 0.6 : 0.4;
                const weight = inRoute ? 4 : park.completed ? 3 : 2;

                // In route builder mode: clicks add/remove from route, no popup
                const routeClickHandler = routeBuilderMode
                  ? { click: () => toggleParkInRoute(park) }
                  : undefined;

                const popup = !routeBuilderMode ? (
                  <Popup>
                    <ParkPopup
                      park={park}
                      onToggleComplete={toggleComplete.mutate}
                      isPending={toggleComplete.isPending}
                      onAddToRoute={() => toggleParkInRoute(park)}
                      isInRoute={inRoute}
                    />
                  </Popup>
                ) : null;

                // If we have polygon data, render as Polygon
                if (hasPolygon) {
                  return (
                    <Polygon
                      key={park.id}
                      positions={positions}
                      pathOptions={{ color, fillColor, fillOpacity, weight }}
                      eventHandlers={routeClickHandler}
                    >
                      {popup}
                    </Polygon>
                  );
                }

                // If we have lat/lng, render as CircleMarker
                if (park.latitude && park.longitude) {
                  return (
                    <CircleMarker
                      key={park.id}
                      center={[park.latitude, park.longitude]}
                      radius={12}
                      pathOptions={{ color, fillColor, fillOpacity: 0.7, weight: inRoute ? 4 : 2 }}
                      eventHandlers={routeClickHandler}
                    >
                      {popup}
                    </CircleMarker>
                  );
                }

                // Park has no location data, skip
                return null;
              })}

              {/* Route overlay — rendered AFTER parks so routes sit on top and are clickable */}
              <RouteOverlay visible={showRoutes} onActivityClick={handleRouteActivityClick} />

              {/* Dotted connector line between all route waypoints */}
              {(() => {
                const linePoints: [number, number][] = [];
                if (startPoint) linePoints.push([startPoint.lat, startPoint.lng]);
                for (const park of routeParks) {
                  const center = getParkCenter(park);
                  if (center) linePoints.push(center);
                }
                if (endPoint) linePoints.push([endPoint.lat, endPoint.lng]);
                if (linePoints.length < 2) return null;

                return (
                  <Polyline
                    positions={linePoints}
                    pathOptions={{
                      color: "#25391D",
                      weight: 2.5,
                      opacity: 0.75,
                      dashArray: "8, 10",
                    }}
                  />
                );
              })()}

              {/* Order number badges — show 1/2/3… on each park's centre when in route */}
              {routeParks.map((park, idx) => {
                const center = getParkCenter(park);
                if (!center) return null;
                return (
                  <Marker
                    key={`route-num-${park.id}`}
                    position={center}
                    interactive={false}
                    icon={L.divIcon({
                      html: `<div style="width:20px;height:20px;background:#25391D;border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:white;box-shadow:0 1px 4px rgba(0,0,0,0.35)">${idx + 1}</div>`,
                      className: "",
                      iconSize: [20, 20],
                      iconAnchor: [10, 10],
                    })}
                  />
                );
              })}

              {/* Start point marker — green circle with "A" */}
              {startPoint && (
                <Marker
                  position={[startPoint.lat, startPoint.lng]}
                  icon={L.divIcon({
                    html: `<div style="width:28px;height:28px;background:#22c55e;border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:white;box-shadow:0 2px 6px rgba(0,0,0,0.35)">A</div>`,
                    className: "",
                    iconSize: [28, 28],
                    iconAnchor: [14, 14],
                  })}
                >
                  <Popup>
                    <span className="font-semibold">Start:</span> {startPoint.name}
                  </Popup>
                </Marker>
              )}

              {/* End point marker — red circle with "B" */}
              {endPoint && (
                <Marker
                  position={[endPoint.lat, endPoint.lng]}
                  icon={L.divIcon({
                    html: `<div style="width:28px;height:28px;background:#ef4444;border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:white;box-shadow:0 2px 6px rgba(0,0,0,0.35)">B</div>`,
                    className: "",
                    iconSize: [28, 28],
                    iconAnchor: [14, 14],
                  })}
                >
                  <Popup>
                    <span className="font-semibold">End:</span> {endPoint.name}
                  </Popup>
                </Marker>
              )}
            </MapContainer>
          </div>
        ) : (
          <div className="w-full h-full bg-muted/10 p-4 md:p-8 overflow-y-auto">
            <div className="max-w-4xl mx-auto space-y-4 pt-16">
              {isLoadingParks ? (
                <div className="text-center py-20 text-muted-foreground">Loading parks...</div>
              ) : parks.length === 0 ? (
                <div className="text-center py-20 bg-card rounded-xl border border-border">
                  <p className="text-lg font-medium">No parks found</p>
                  <p className="text-muted-foreground">Try adjusting your filters.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {parks.map((park) => (
                    <div
                      key={park.id}
                      className={`bg-card rounded-xl border p-4 shadow-sm hover:shadow-md transition-all ${
                        park.completed ? "border-primary/50 bg-primary/5" : "border-border"
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="text-xs text-muted-foreground uppercase font-bold">{park.borough}</div>
                          <h3 className="text-lg font-bold font-display">{park.name}</h3>
                          <div className="text-sm text-muted-foreground mt-1">{park.siteType}</div>
                        </div>
                        {park.completed && (
                          <div className="bg-primary/20 p-2 rounded-full">
                            <Trophy className="w-5 h-5 text-primary" />
                          </div>
                        )}
                      </div>
                      <div className="mt-4 flex justify-end">
                         <Button
                          onClick={() => toggleComplete.mutate({ id: park.id, completed: !park.completed })}
                          size="sm"
                          variant={park.completed ? "outline" : "default"}
                          disabled={toggleComplete.isPending}
                          className={park.completed ? "" : "bg-primary text-primary-foreground hover:bg-primary/90"}
                        >
                          {park.completed ? "Mark Incomplete" : "Mark Complete"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <RunSummaryModal
        open={!!syncResult}
        onClose={() => setSyncResult(null)}
        data={syncResult}
      />
    </div>
  );
}

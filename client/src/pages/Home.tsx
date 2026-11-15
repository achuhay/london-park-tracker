import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MapContainer, Popup, Polyline } from "react-leaflet";
import L, { type LeafletMouseEvent } from "leaflet";
import { AlertCircle, ChevronsLeft, Loader2, Route as RouteIcon, X } from "lucide-react";
import { SiStrava } from "react-icons/si";

import { useParks, useToggleParkComplete, useFilterOptions } from "@/hooks/use-parks";
import { useAppConfig } from "@/hooks/use-config";
import { useSyncAllActivities } from "@/hooks/use-strava";
import { FAVOURITE_MIN_STARS, useParkRatings } from "@/hooks/use-park-ratings";
import type { ParkResponse } from "@shared/routes";
import { getParkCenter } from "@/lib/route-utils";
import { parkOutlineToLeaflet } from "@/lib/park-geometry";

import { BaseMap, type BaseMapMode } from "@/components/map/BaseMap";
import { ParkLayer, visitedThisYear } from "@/components/map/ParkLayer";
import { MapBridge, MapControls, UserLocationMarker } from "@/components/map/MapControls";
import { MapSearch } from "@/components/map/MapSearch";
import { mapPalette } from "@/components/map/palette";
import { ParkPopup } from "@/components/ParkPopup";
import { MapChips, ParkFilter, countActiveFilters, type ServerFilters, type StatusFilter } from "@/components/ParkFilter";
import { MobileBottomNav, type MobileTab } from "@/components/MobileBottomNav";
import { MobileParkSheet } from "@/components/MobileParkSheet";
import { RunSummaryModal } from "@/components/RunSummaryModal";
import type { SyncResult } from "@/components/StravaButton";
import { RouteOverlay } from "@/components/RouteOverlay";
import { RoutePreview, type MatchedPark } from "@/components/RoutePreview";
import { ParksScreen } from "@/components/screens/ParksScreen";
import { RunsScreen } from "@/components/screens/RunsScreen";
import { ProgressScreen } from "@/components/screens/ProgressScreen";
import { ProgressPeek } from "@/components/screens/ProgressPeek";
import { DetourLogo, Segmented } from "@/components/kit";
import { useSession } from "@/components/use-session";
import { useIsPhone } from "@/components/use-breakpoint";
import { useTheme } from "@/components/theme";
// ── Route planner (merge point — see components/plan/legacy-planner.tsx) ──
import { useLegacyPlanner, LegacyPlannerLayer, LegacyPlannerShell } from "@/components/plan/legacy-planner";
import { cn } from "@/lib/utils";

type PanelTab = "progress" | "parks" | "runs";

const LONDON: [number, number] = [51.505, -0.11];
/** Legacy RouteBasket's desktop panel is 18rem wide; map controls on the right move left of it. */
const LEGACY_PLAN_PANEL_PX = 288;
const DESKTOP_PANEL_PX = 380;

/** Remember small UI choices (which tab was open) for this browser tab only. */
function useSessionState<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (sessionStorage.getItem(key) as T) || initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        sessionStorage.setItem(key, v);
      } catch {
        /* storage unavailable */
      }
    },
    [key],
  );
  return [value, set];
}

/** Bounds of a park's outline, or a small box around its point. */
function parkBounds(park: ParkResponse): L.LatLngBounds | null {
  const outline = parkOutlineToLeaflet(park.polygon);
  if (outline) return L.latLngBounds(outline.flatMap((rings) => rings[0]));
  if (park.latitude && park.longitude) return L.latLng(park.latitude, park.longitude).toBounds(250);
  return null;
}

export default function Home() {
  const isPhone = useIsPhone();
  const { dark } = useTheme();
  const palette = mapPalette(dark);
  const session = useSession();
  const queryClient = useQueryClient();
  const { data: appConfig } = useAppConfig();

  // ── What's shown ────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<ServerFilters>({ accessCategory: "Public,Partial" });
  const [reviewMode, setReviewMode] = useState(false); // "data review mode": every green space, not just public ones
  const [status, setStatus] = useState<StatusFilter>("all");
  const [thisYearOnly, setThisYearOnly] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [baseMode, setBaseMode] = useState<BaseMapMode>("map");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // ── Navigation ──────────────────────────────────────────────────────────
  const [tab, setTab] = useSessionState<MobileTab>("detour-tab", "map");
  const [panelTab, setPanelTab] = useSessionState<PanelTab>("detour-panel-tab", "progress");
  const [panelOpen, setPanelOpen] = useState(true);

  // ── Selection, runs, sync ───────────────────────────────────────────────
  const [selectedPark, setSelectedPark] = useState<ParkResponse | null>(null);
  const [popupAt, setPopupAt] = useState<L.LatLng | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [stravaError, setStravaError] = useState<string | null>(null);
  const [isInitialSyncing, setIsInitialSyncing] = useState(false);
  const hasAutoSynced = useRef(false);
  const hasBackgroundSynced = useRef(false);

  // ── Komoot GPX preview ──────────────────────────────────────────────────
  const [previewRouteCoords, setPreviewRouteCoords] = useState<[number, number][] | null>(null);
  const [previewMatchedIds, setPreviewMatchedIds] = useState<Set<number>>(new Set());
  const [previewMatchedParks, setPreviewMatchedParks] = useState<MatchedPark[]>([]);

  // ── Map + location ──────────────────────────────────────────────────────
  const mapRef = useRef<L.Map | null>(null);
  const onMapReady = useCallback((m: L.Map) => {
    mapRef.current = m;
  }, []);
  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);

  const syncAll = useSyncAllActivities();

  // First visit after connecting Strava (?strava=connected): pull in every run
  useEffect(() => {
    if (hasAutoSynced.current) return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get("strava");
    const errorDetail = params.get("strava_error");

    if (result && result !== "connected") {
      setStravaError(errorDetail || "Strava didn't finish connecting. Please try again.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (result === "connected") {
      hasAutoSynced.current = true;
      window.history.replaceState({}, "", window.location.pathname);
      setIsInitialSyncing(true);
      syncAll.mutate(undefined, {
        onSuccess: (data: any) => {
          setIsInitialSyncing(false);
          queryClient.invalidateQueries({ queryKey: ["/api/parks"] });
          queryClient.invalidateQueries({ queryKey: ["/api/strava/status"] });
          queryClient.invalidateQueries({ queryKey: ["/api/strava/runs"] });
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
          setStravaError("Couldn't sync your Strava runs. Open Runs and tap Sync to try again.");
        },
      });
    }
  }, []);

  // Returning visitors: quietly check Strava for a new run
  useEffect(() => {
    if (hasBackgroundSynced.current || hasAutoSynced.current) return;
    if (!session.connected) return;
    hasBackgroundSynced.current = true;
    fetch("/api/strava/sync-latest", { method: "POST", credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.parksCompleted?.length > 0) {
          queryClient.invalidateQueries({ queryKey: ["/api/parks"] });
          queryClient.invalidateQueries({ queryKey: ["/api/strava/runs"] });
          setSyncResult(data);
        }
      })
      .catch(() => {}); // background check — never show an error for it
  }, [session.connected]);

  // ── Data ────────────────────────────────────────────────────────────────
  const activeFilters = reviewMode ? { ...filters, accessCategory: undefined } : filters;
  const { data: allParks = [], isLoading: isLoadingParks, error } = useParks(activeFilters);
  const { data: filterOptions } = useFilterOptions();
  const toggleComplete = useToggleParkComplete();
  const ratings = useParkRatings();

  const favouriteIds = useMemo(() => {
    const ids = new Set<number>();
    ratings.forEach((stars, id) => {
      if (stars >= FAVOURITE_MIN_STARS) ids.add(id);
    });
    return ids;
  }, [ratings]);

  const isDone = useCallback((p: ParkResponse) => (thisYearOnly ? !!visitedThisYear(p) : p.completed), [thisYearOnly]);

  const parks = useMemo(() => {
    switch (status) {
      case "todo":
        return allParks.filter((p) => !isDone(p));
      case "done":
        return allParks.filter(isDone);
      case "favourites":
        return allParks.filter((p) => favouriteIds.has(p.id));
      default:
        return allParks;
    }
  }, [allParks, status, isDone, favouriteIds]);

  const selectedBoroughs = filters.borough ? filters.borough.split(",").filter(Boolean) : [];
  const filterCount = countActiveFilters(filters, thisYearOnly, reviewMode);

  // ── Route planner ───────────────────────────────────────────────────────
  const planner = useLegacyPlanner(allParks);
  const plannerRef = useRef(planner);
  plannerRef.current = planner;
  // A stable list of planned park ids (so the park layer only redraws when the route changes)
  const plannedKey = allParks.filter((p) => planner.hasPark(p.id)).map((p) => p.id).join(",");
  const plannedIds = useMemo(() => new Set(plannedKey ? plannedKey.split(",").map(Number) : []), [plannedKey]);

  // ── Map actions ─────────────────────────────────────────────────────────
  /** Space the map should keep clear (panels and sheets) when it moves to show something. */
  const mapPadding = useCallback(() => {
    if (isPhone) return { paddingTopLeft: L.point(24, 150), paddingBottomRight: L.point(24, 380) };
    const left = panelOpen ? DESKTOP_PANEL_PX + 48 : 48;
    const right = planner.isPlanning ? LEGACY_PLAN_PANEL_PX + 48 : 48;
    return { paddingTopLeft: L.point(left, 80), paddingBottomRight: L.point(right, 60) };
  }, [isPhone, panelOpen, planner.isPlanning]);

  const focusPark = useCallback(
    (park: ParkResponse) => {
      setSelectedPark(park);
      if (isPhone) setTab("map");
      const map = mapRef.current;
      const bounds = parkBounds(park);
      if (!map || !bounds) return;
      map.flyToBounds(bounds, { ...mapPadding(), maxZoom: 16, duration: 0.8 });
      if (!isPhone) {
        const c = getParkCenter(park);
        setPopupAt(c ? L.latLng(c[0], c[1]) : bounds.getCenter());
      }
    },
    [isPhone, mapPadding, setTab],
  );

  const onParkClick = useCallback(
    (park: ParkResponse, e: LeafletMouseEvent) => {
      const p = plannerRef.current;
      if (p.isPlanning && p.addsOnClick) {
        p.togglePark(park);
        return;
      }
      setSelectedPark(park);
      setPopupAt(e.latlng);
    },
    [],
  );

  const toggleBorough = useCallback((borough: string) => {
    setFilters((f) => {
      const current = f.borough ? f.borough.split(",").filter(Boolean) : [];
      const next = current.includes(borough) ? current.filter((b) => b !== borough) : [...current, borough];
      return { ...f, borough: next.length > 0 ? next.join(",") : undefined };
    });
  }, []);

  /** From Progress: show a borough's parks on the map and fly there. */
  const focusBorough = useCallback(
    (borough: string) => {
      const already = selectedBoroughs.includes(borough);
      toggleBorough(borough);
      setStatus("all");
      if (already) return;
      if (isPhone) setTab("map");
      const pts = allParks
        .filter((p) => p.borough === borough)
        .map((p) => getParkCenter(p))
        .filter((c): c is [number, number] => !!c);
      if (pts.length > 0) setTimeout(() => mapRef.current?.flyToBounds(L.latLngBounds(pts), { ...mapPadding(), duration: 0.8 }), 50);
    },
    [selectedBoroughs, toggleBorough, isPhone, setTab, allParks, mapPadding],
  );

  const locate = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUserPos(here);
        setLocating(false);
        mapRef.current?.flyTo(here, Math.max(mapRef.current.getZoom(), 15), { duration: 0.8 });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  const openRunFromMap = useCallback(async (stravaId: string) => {
    try {
      const res = await fetch(`/api/strava/activity/${stravaId}/summary`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load summary");
      setSyncResult(await res.json());
    } catch {
      /* the run overlay clears its own spinner */
    }
  }, []);

  const handleRoutePreviewLoaded = useCallback((coords: [number, number][], ids: Set<number>, matched: MatchedPark[]) => {
    setPreviewRouteCoords(coords);
    setPreviewMatchedIds(ids);
    setPreviewMatchedParks(matched);
    if (coords.length > 1) mapRef.current?.flyToBounds(L.latLngBounds(coords), { ...mapPadding(), duration: 0.8 });
  }, [mapPadding]);

  const clearPreview = useCallback(() => {
    setPreviewRouteCoords(null);
    setPreviewMatchedIds(new Set());
    setPreviewMatchedParks([]);
  }, []);

  const changeTab = useCallback(
    (t: MobileTab) => {
      setTab(t);
      setSelectedPark(null);
      if (planner.isPlanning) planner.close();
    },
    [setTab, planner],
  );

  // Close the park card with Escape (desktop) and whenever the planner opens
  useEffect(() => {
    if (planner.isPlanning) setSelectedPark(null);
  }, [planner.isPlanning]);

  // Keep the selected park's details fresh after it's marked visited
  const selected = selectedPark ? (allParks.find((p) => p.id === selectedPark.id) ?? selectedPark) : null;
  const onMapTab = !isPhone || tab === "map";
  const planInset = !isPhone && planner.isPlanning ? LEGACY_PLAN_PANEL_PX + 12 : 12;

  const sharedParkProps = {
    onToggleComplete: toggleComplete.mutate,
    isPending: toggleComplete.isPending,
    onAddToRoute: selected ? () => planner.togglePark(selected) : undefined,
    isInRoute: selected ? planner.hasPark(selected.id) : false,
  };

  const parksScreenProps = {
    parks,
    isLoading: isLoadingParks,
    status,
    onStatusChange: setStatus,
    favouriteIds,
    signedIn: session.signedIn,
    filterCount,
    onOpenFilters: () => setFiltersOpen(true),
    onSelectPark: focusPark,
  };

  const boroughPills = selectedBoroughs.map((b) => (
    <button
      key={b}
      type="button"
      onClick={() => toggleBorough(b)}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-float"
      aria-label={`Stop showing only ${b}`}
    >
      {b}
      <X className="size-3.5" />
    </button>
  ));

  const chips = (
    <MapChips
      className={isPhone ? "overflow-visible" : "flex-wrap overflow-visible"}
      status={status}
      onStatusChange={setStatus}
      showRuns={showRuns}
      onShowRunsChange={setShowRuns}
      filterCount={filterCount}
      onOpenFilters={() => setFiltersOpen(true)}
      signedIn={session.signedIn}
    />
  );

  return (
    <div
      className="relative h-[100dvh] w-full overflow-hidden bg-background"
      style={{ ["--map-inset-bottom" as string]: isPhone ? "calc(var(--tabbar-h) + var(--safe-bottom))" : "0px" }}
    >
      {/* ── The map (full screen, behind everything) ─────────────────────── */}
      <div className="absolute inset-0">
        <MapContainer
          center={LONDON}
          zoom={isPhone ? 11 : 12}
          minZoom={9}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
          preferCanvas
          // Canvas renderer with a little tap tolerance so small parks are easy to hit with a finger
          renderer={L.canvas({ tolerance: isPhone ? 6 : 3 })}
          attributionControl
        >
          <MapBridge onReady={onMapReady} />
          <BaseMap mode={baseMode} dark={dark} cartoApiKey={appConfig?.cartoApiKey} />

          <ParkLayer
            parks={parks}
            palette={palette}
            thisYearOnly={thisYearOnly}
            reviewMode={reviewMode}
            favouriteIds={favouriteIds}
            plannedIds={plannedIds}
            previewIds={previewMatchedIds}
            selectedId={selected?.id ?? null}
            onParkClick={onParkClick}
          />

          {/* Your Strava runs — drawn after parks so they sit on top and stay clickable */}
          <RouteOverlay visible={showRuns} onActivityClick={openRunFromMap} filterYear={thisYearOnly ? new Date().getFullYear() : null} />

          {previewRouteCoords && previewRouteCoords.length >= 2 && (
            <Polyline positions={previewRouteCoords} pathOptions={{ color: palette.preview, weight: 4, opacity: 0.85 }} interactive={false} />
          )}

          <LegacyPlannerLayer planner={planner} ink={palette.planned} />
          <UserLocationMarker position={userPos} />

          {/* Desktop: one popup for whichever park is selected */}
          {!isPhone && selected && popupAt && (
            <Popup
              key={selected.id}
              position={popupAt}
              autoPanPaddingTopLeft={L.point(panelOpen ? DESKTOP_PANEL_PX + 32 : 32, 72)}
              autoPanPaddingBottomRight={L.point(planInset + 72, 32)}
              maxWidth={340}
              eventHandlers={{ remove: () => setSelectedPark(null) }}
            >
              <ParkPopup park={selected} {...sharedParkProps} />
            </Popup>
          )}
        </MapContainer>
      </div>

      {/* ── Phone: map overlays ───────────────────────────────────────────── */}
      {isPhone && onMapTab && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 space-y-2.5 px-3" style={{ paddingTop: "calc(var(--safe-top) + 10px)" }}>
            <MapSearch
              parks={allParks}
              onSelect={focusPark}
              className="glass shadow-float pointer-events-auto h-12 rounded-full pl-4 pr-1.5"
              leading={
                <>
                  <DetourLogo className="h-[22px] text-foreground" />
                  <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                </>
              }
            />
            <div className="pointer-events-auto -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 no-scrollbar">
              {boroughPills}
              {chips}
            </div>
          </div>

          <MapControls
            className="absolute right-3 z-10"
            style={{ top: "calc(var(--safe-top) + 122px)" }}
            mode={baseMode}
            onModeChange={setBaseMode}
            onLocate={locate}
            locating={locating}
            located={!!userPos}
            extra={
              <div className="[&_button]:glass [&_button]:shadow-float [&_button]:!size-11 [&_button]:!rounded-full [&_button]:!border-0 [&_button]:!p-0">
                <RoutePreview onRouteLoaded={handleRoutePreviewLoaded} hasActivePreview={previewRouteCoords !== null} matchedCount={previewMatchedParks.length} />
              </div>
            }
          />

          {!selected && !planner.isPlanning && !previewRouteCoords && (
            <div className="absolute inset-x-3 z-10" style={{ bottom: "calc(var(--tabbar-h) + var(--safe-bottom) + 12px)" }}>
              <ProgressPeek onOpen={() => changeTab("progress")} />
            </div>
          )}
        </>
      )}

      {/* ── Phone: tab screens over the map ─────────────────────────────── */}
      {isPhone && tab === "parks" && <ParksScreen variant="mobile" {...parksScreenProps} />}
      {isPhone && tab === "runs" && <RunsScreen variant="mobile" onOpenRun={setSyncResult} isInitialSyncing={isInitialSyncing} />}
      {isPhone && tab === "progress" && (
        <ProgressScreen variant="mobile" onBoroughFocus={focusBorough} selectedBoroughs={selectedBoroughs} onSyncComplete={setSyncResult} isInitialSyncing={isInitialSyncing} />
      )}

      {isPhone && (
        <MobileParkSheet park={tab === "map" ? selected : null} onClose={() => setSelectedPark(null)} {...sharedParkProps} />
      )}

      {/* ── Desktop: side panel + map controls ──────────────────────────── */}
      {!isPhone && (
        <>
          {panelOpen ? (
            <aside
              className="shadow-float absolute bottom-3 left-3 top-3 z-20 flex flex-col overflow-hidden rounded-3xl bg-card"
              style={{ width: DESKTOP_PANEL_PX }}
              aria-label="Detour"
            >
              <div className="space-y-3 px-4 pb-3 pt-4">
                <div className="flex items-center justify-between">
                  <DetourLogo className="h-8 text-foreground" />
                  <button
                    type="button"
                    onClick={() => setPanelOpen(false)}
                    className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Hide panel"
                    title="Hide panel"
                  >
                    <ChevronsLeft className="size-5" />
                  </button>
                </div>
                <MapSearch parks={allParks} onSelect={focusPark} className="h-11 rounded-xl bg-muted pl-3.5 pr-1" placeholder="Search parks or boroughs" />
                <Segmented<PanelTab>
                  value={panelTab}
                  onChange={setPanelTab}
                  options={[
                    { value: "progress", label: "Progress" },
                    { value: "parks", label: "Parks" },
                    { value: "runs", label: "Runs" },
                  ]}
                />
              </div>
              {panelTab === "progress" && (
                <ProgressScreen variant="panel" onBoroughFocus={focusBorough} selectedBoroughs={selectedBoroughs} onSyncComplete={setSyncResult} isInitialSyncing={isInitialSyncing} />
              )}
              {panelTab === "parks" && <ParksScreen variant="panel" {...parksScreenProps} />}
              {panelTab === "runs" && <RunsScreen variant="panel" onOpenRun={setSyncResult} isInitialSyncing={isInitialSyncing} />}
            </aside>
          ) : (
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="glass shadow-float absolute left-3 top-3 z-20 flex h-12 items-center gap-3 rounded-full pl-4 pr-5"
              aria-label="Show panel"
            >
              <DetourLogo className="h-6 text-foreground" />
              <span className="text-sm font-semibold text-muted-foreground">Show panel</span>
            </button>
          )}

          <div
            className="pointer-events-none absolute top-3 z-10 flex items-start gap-2"
            style={{ left: panelOpen ? DESKTOP_PANEL_PX + 24 : 220, right: planInset + 340 }}
          >
            <div className="pointer-events-auto flex flex-wrap gap-2">
              {boroughPills}
              {chips}
            </div>
          </div>

          <div className="absolute top-3 z-10 flex items-center gap-2 transition-[right] duration-300" style={{ right: planInset }}>
            <div className="[&_button]:glass [&_button]:shadow-float [&_button]:!h-11 [&_button]:!rounded-full [&_button]:!border-0 [&_button]:!px-4 [&_button]:!text-sm [&_button]:!font-semibold">
              <RoutePreview onRouteLoaded={handleRoutePreviewLoaded} hasActivePreview={previewRouteCoords !== null} matchedCount={previewMatchedParks.length} />
            </div>
            <button
              type="button"
              onClick={() => (planner.isPlanning ? planner.close() : planner.open())}
              className={cn(
                "inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold shadow-float transition-colors",
                planner.isPlanning ? "bg-foreground text-background" : "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              <RouteIcon className="size-4" />
              {planner.isPlanning ? "Done planning" : "Plan a route"}
              {planner.parkCount > 0 && <span className="num rounded-full bg-white/20 px-1.5 text-xs">{planner.parkCount}</span>}
            </button>
          </div>

          <MapControls
            className="absolute bottom-8 z-10 transition-[right] duration-300"
            style={{ right: planInset }}
            mode={baseMode}
            onModeChange={setBaseMode}
            onLocate={locate}
            locating={locating}
            located={!!userPos}
            showZoom
            onZoomIn={() => mapRef.current?.zoomIn()}
            onZoomOut={() => mapRef.current?.zoomOut()}
          />
        </>
      )}

      {/* ── Route planner (merge point) ──────────────────────────────────── */}
      <LegacyPlannerShell planner={planner} />

      {/* ── Komoot GPX preview results ───────────────────────────────────── */}
      {previewRouteCoords && previewMatchedParks.length > 0 && onMapTab && (
        <div
          className="shadow-float absolute left-1/2 z-20 w-[min(92vw,360px)] -translate-x-1/2 rounded-3xl bg-card p-4 animate-fade-up"
          style={{ bottom: isPhone ? "calc(var(--tabbar-h) + var(--safe-bottom) + 12px)" : 24 }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-lg font-bold leading-tight">
                {previewMatchedParks.length} park{previewMatchedParks.length !== 1 ? "s" : ""} on this route
              </p>
              <p className="text-sm text-muted-foreground">Highlighted in blue on the map</p>
            </div>
            <button type="button" onClick={clearPreview} className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Clear preview">
              <X className="size-4" />
            </button>
          </div>
          <ul className="mt-3 max-h-40 space-y-1.5 overflow-y-auto">
            {previewMatchedParks.map((p) => {
              const live = allParks.find((ap) => ap.id === p.id);
              return (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <span className={cn("size-2 shrink-0 rounded-full", live?.completed ? "bg-ember" : "bg-[#2563EB]")} />
                  <span className="truncate font-medium">{p.name}</span>
                  {live?.completed && <span className="ml-auto shrink-0 text-xs text-muted-foreground">visited</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Messages ─────────────────────────────────────────────────────── */}
      {(error || stravaError) && (
        <div className="absolute left-1/2 z-40 w-[min(92vw,420px)] -translate-x-1/2" style={{ top: "calc(var(--safe-top) + 72px)" }}>
          <div role="alert" className="shadow-float flex items-start gap-3 rounded-2xl bg-card p-4">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{error ? "Couldn't load the parks" : "Strava didn't connect"}</p>
              <p className="break-words text-sm text-muted-foreground">{error ? (error as Error).message : stravaError}</p>
            </div>
            {stravaError && (
              <button type="button" onClick={() => setStravaError(null)} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted" aria-label="Dismiss">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {isInitialSyncing && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-background/70 p-6 backdrop-blur-sm">
          <div className="shadow-float w-full max-w-sm rounded-3xl bg-card p-8 text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-strava/10 text-strava">
              <SiStrava className="size-6" />
            </div>
            <h2 className="mb-2 text-xl font-bold">Syncing your runs</h2>
            <p className="mb-5 text-sm text-muted-foreground">Going through your Strava activities and colouring in every park you've run through.</p>
            <Loader2 className="mx-auto size-6 animate-spin text-strava" />
          </div>
        </div>
      )}

      <ParkFilter
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        isMobile={isPhone}
        filters={filters}
        setFilters={setFilters}
        uniqueBoroughs={filterOptions?.boroughs ?? []}
        uniqueTypes={filterOptions?.siteTypes ?? []}
        uniqueAccessCategories={filterOptions?.accessCategories ?? []}
        thisYearOnly={thisYearOnly}
        onThisYearOnlyChange={setThisYearOnly}
        reviewMode={reviewMode}
        onReviewModeChange={setReviewMode}
        shownCount={parks.length}
      />

      <RunSummaryModal open={!!syncResult} onClose={() => setSyncResult(null)} data={syncResult} />

      {isPhone && <MobileBottomNav activeTab={tab} onChange={changeTab} onPlan={() => (planner.isPlanning ? planner.close() : (setTab("map"), planner.open()))} planning={planner.isPlanning} planCount={planner.parkCount} />}
    </div>
  );
}

import { useState, useMemo, useCallback } from "react";
import { useParks, useParkStats, useToggleParkComplete, useFilterOptions } from "@/hooks/use-parks";
import { MapContainer, TileLayer, Polygon, CircleMarker, Popup, LayersControl } from "react-leaflet";
import { MapController } from "@/components/MapController";
import { ParkPopup } from "@/components/ParkPopup";
import { StatsCard } from "@/components/StatsCard";
import { ParkFilter } from "@/components/ParkFilter";
import { RouteOverlay } from "@/components/RouteOverlay";
import { RouteBasket } from "@/components/RouteBasket";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Menu, Map as MapIcon, List, AlertCircle, Trophy, Route, Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ParkResponse } from "@shared/routes";

export default function Home() {
  const [filters, setFilters] = useState<any>({});
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [showRoutes, setShowRoutes] = useState(false);
  const [showOnlyNew, setShowOnlyNew] = useState(false);
  const [routeBuilderMode, setRouteBuilderMode] = useState(false);
  const [routeParks, setRouteParks] = useState<ParkResponse[]>([]);

  const { data: allParks = [], isLoading: isLoadingParks, error } = useParks(filters);
  const { data: stats, isLoading: isLoadingStats } = useParkStats();
  const { data: filterOptions } = useFilterOptions();
  const toggleComplete = useToggleParkComplete();

  // Filter to show only new parks if toggle is on
  const parks = useMemo(() => {
    if (!showOnlyNew) return allParks;
    return allParks.filter(park => 
      park.siteRef === 'OSM_IMPORT' || park.siteRef === 'OSM_IMPORT_MANUAL'
    );
  }, [allParks, showOnlyNew]);

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

  // Use filter options from all parks, not just filtered results
  const uniqueBoroughs = filterOptions?.boroughs || [];
  const uniqueTypes = filterOptions?.siteTypes || [];
  const uniqueAccessCategories = filterOptions?.accessCategories || [];

  const totalFiltered = parks.length;
  const completedCount = parks.filter(p => p.completed).length;
  const pendingCount = totalFiltered - completedCount;
  const progressPercent = totalFiltered > 0 ? Math.round((completedCount / totalFiltered) * 100) : 0;

  // Build filter summary label
  const filterLabels: string[] = [];
  if (showOnlyNew) {
    filterLabels.push('New imports only');
  }
  if (filters.borough) {
    const boroughs = filters.borough.split(',');
    filterLabels.push(boroughs.length === 1 ? boroughs[0] : `${boroughs.length} boroughs`);
  }
  if (filters.siteType) {
    const types = filters.siteType.split(',');
    filterLabels.push(types.length === 1 ? types[0] : `${types.length} types`);
  }
  if (filters.accessCategory) {
    const access = filters.accessCategory.split(',');
    if (access.length === 1) {
      filterLabels.push(access[0]);
    } else {
      filterLabels.push(`${access.length} access types`);
    }
  }
  if (filters.search) {
    filterLabels.push(`"${filters.search}"`);
  }
  const filterSummary = filterLabels.length > 0 ? filterLabels.join(', ') : 'All parks';

  return (
    <div className="h-screen w-full flex bg-background overflow-hidden relative">
      
      {/* --- Sidebar (Desktop) --- */}
      <div className="w-80 h-full border-r border-border bg-background/50 backdrop-blur-sm z-20 flex-col gap-4 p-4 hidden md:flex overflow-hidden">
        <div className="flex items-center gap-3 px-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/20 flex items-center justify-center">
            <span className="text-lg font-bold text-primary-foreground">L</span>
          </div>
          <h1 className="text-xl font-bold font-display tracking-tight text-foreground">
            ParkRun<span className="text-primary">.LDN</span>
          </h1>
        </div>

        <ScrollArea className="flex-1 -mx-4 px-4">
          <div className="space-y-6 pb-6">
            <StatsCard stats={stats} isLoading={isLoadingStats} />
            
            <div className="bg-muted/30 rounded-xl p-4 border border-border/50 space-y-3">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Showing</h4>
                <p className="text-sm font-medium text-foreground" data-testid="text-filter-summary">{filterSummary}</p>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-2xl font-bold font-display text-foreground" data-testid="text-total-parks">{totalFiltered}</span>
                  <span className="text-xs text-muted-foreground">total parks</span>
                </div>
                
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-300" 
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                
                <div className="flex justify-between text-sm">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                    <span className="text-muted-foreground">Completed</span>
                    <span className="font-bold text-foreground" data-testid="text-completed-count">{completedCount}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-secondary" />
                    <span className="text-muted-foreground">To Run</span>
                    <span className="font-bold text-foreground" data-testid="text-pending-count">{pendingCount}</span>
                  </div>
                </div>
                
                <div className="text-center pt-1">
                  <span className="text-lg font-bold text-primary" data-testid="text-progress-percent">{progressPercent}%</span>
                  <span className="text-xs text-muted-foreground ml-1">complete</span>
                </div>
              </div>
            </div>

            {/* NEW PARKS TOGGLE */}
            <div className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 rounded-xl p-4 border border-blue-500/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-500" />
                  <Label htmlFor="new-parks-toggle" className="text-sm font-medium cursor-pointer">
                    New Imports
                  </Label>
                </div>
                <Switch
                  id="new-parks-toggle"
                  checked={showOnlyNew}
                  onCheckedChange={setShowOnlyNew}
                />
              </div>
              {showOnlyNew && (
                <p className="text-xs text-muted-foreground mt-2">
                  Showing {parks.length} newly imported parks
                </p>
              )}
            </div>

            <ParkFilter 
              filters={filters} 
              setFilters={setFilters} 
              uniqueBoroughs={uniqueBoroughs} 
              uniqueTypes={uniqueTypes}
              uniqueAccessCategories={uniqueAccessCategories}
            />
          </div>
        </ScrollArea>

        <div className="pt-4 border-t border-border">
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
          <SheetContent side="left" className="w-80 p-0">
            <div className="flex flex-col h-full p-4 gap-4">
              <div className="flex items-center gap-3 px-2">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <span className="text-lg font-bold text-primary-foreground">L</span>
                </div>
                <h1 className="text-xl font-bold font-display tracking-tight">ParkRun.LDN</h1>
              </div>
              <ScrollArea className="flex-1">
                <div className="space-y-6">
                  <StatsCard stats={stats} isLoading={isLoadingStats} />
                  
                  <div className="bg-muted/30 rounded-xl p-4 border border-border/50 space-y-3">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Showing</h4>
                      <p className="text-sm font-medium text-foreground">{filterSummary}</p>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between items-baseline">
                        <span className="text-2xl font-bold font-display text-foreground">{totalFiltered}</span>
                        <span className="text-xs text-muted-foreground">total parks</span>
                      </div>
                      
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary transition-all duration-300" 
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      
                      <div className="flex justify-between text-sm">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-primary" />
                          <span className="text-muted-foreground">Completed</span>
                          <span className="font-bold text-foreground">{completedCount}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-secondary" />
                          <span className="text-muted-foreground">To Run</span>
                          <span className="font-bold text-foreground">{pendingCount}</span>
                        </div>
                      </div>
                      
                      <div className="text-center pt-1">
                        <span className="text-lg font-bold text-primary">{progressPercent}%</span>
                        <span className="text-xs text-muted-foreground ml-1">complete</span>
                      </div>
                    </div>
                  </div>

                  {/* NEW PARKS TOGGLE - MOBILE */}
                  <div className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 rounded-xl p-4 border border-blue-500/20">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-blue-500" />
                        <Label htmlFor="new-parks-toggle-mobile" className="text-sm font-medium cursor-pointer">
                          New Imports
                        </Label>
                      </div>
                      <Switch
                        id="new-parks-toggle-mobile"
                        checked={showOnlyNew}
                        onCheckedChange={setShowOnlyNew}
                      />
                    </div>
                    {showOnlyNew && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Showing {parks.length} newly imported parks
                      </p>
                    )}
                  </div>

                  <ParkFilter 
                    filters={filters} 
                    setFilters={setFilters} 
                    uniqueBoroughs={uniqueBoroughs} 
                    uniqueTypes={uniqueTypes}
                    uniqueAccessCategories={uniqueAccessCategories}
                  />
                </div>
              </ScrollArea>
              <div className="pt-4 border-t border-border">
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
                ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600"
                : "bg-background/95 backdrop-blur-sm"
            }`}
            onClick={() => setRouteBuilderMode((v) => !v)}
          >
            <Route className="w-4 h-4" />
            Build Route
            {routeParks.length > 0 && (
              <span className={`text-xs font-bold px-1 py-0.5 rounded-full leading-none ${
                routeBuilderMode ? "bg-white/20" : "bg-indigo-100 text-indigo-700"
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

        {/* Route Basket panel — shown in both map and list mode */}
        {routeBuilderMode && (
          <RouteBasket
            parks={routeParks}
            onClose={() => setRouteBuilderMode(false)}
            onReorder={handleRouteReorder}
            onRemove={handleRouteRemove}
          />
        )}

        {viewMode === "map" ? (
          <div className="w-full h-full">
             <MapContainer 
               center={[51.505, -0.09]} 
               zoom={11} 
               style={{ height: "100%", width: "100%" }}
               zoomControl={false} // We can add custom zoom control if needed
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
              <RouteOverlay visible={showRoutes} />

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

                // Colors for completed/incomplete parks; route parks get an indigo outline
                const baseColor = park.completed ? "hsl(45 93% 47%)" : "hsl(151 55% 42%)";
                const color = inRoute ? "#6366f1" : baseColor;
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
    </div>
  );
}

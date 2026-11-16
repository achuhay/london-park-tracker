/**
 * The route planner's controls. Fills whatever container it's put in (side panel on desktop,
 * bottom sheet on phones — see RoutePlannerShell), so a new app layout can host it anywhere.
 */
import { useMemo, useState } from "react";
import type { ParkResponse } from "@shared/routes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LocationSearch } from "@/components/LocationSearch";
import type { RoutePlanner } from "@/hooks/use-route-planner";
import { buildGpx, formatDuration, formatKm, routeTitle, type PlanStop } from "@/lib/route-planner";
import { cn } from "@/lib/utils";
import {
  ArrowRight, Check, ChevronDown, ChevronUp, Crosshair, Download, Loader2, Maximize2, Mountain, Plus, Repeat,
  Route, Search, Share2, Sparkles, TriangleAlert, Undo2, Wand2, X,
} from "lucide-react";

const PACE_MIN_PER_KM = 6;

function canShareFiles(): boolean {
  try {
    return typeof navigator !== "undefined" && !!navigator.canShare?.({
      files: [new File([""], "route.gpx", { type: "application/gpx+xml" })],
    });
  } catch {
    return false;
  }
}

interface RoutePlannerPanelProps {
  planner: RoutePlanner;
  allParks: ParkResponse[];
  /** Phone bottom sheet pulled down: show only the summary and the main buttons. */
  compact?: boolean;
}

export function RoutePlannerPanel({ planner, allParks, compact = false }: RoutePlannerPanelProps) {
  const { plan, result, parkStatus, parksById } = planner;
  const [targetKm, setTargetKm] = useState(8);
  const [notice, setNotice] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState("");
  const shareable = useMemo(canShareFiles, []);

  const live = result && !planner.isStale ? result : null;
  const parkStops = plan.stops.filter((s) => s.kind === "park");
  const counted = live ? live.parks.filter((p) => p.counts) : [];
  const newCounted = counted.filter((p) => !parksById.get(p.parkId)?.completed).length;
  const shortCount = live ? live.parks.filter((p) => !p.counts).length : 0;
  const bonus = live ? live.bonusParks : [];
  const bonusNew = bonus.filter((b) => !parksById.get(b.parkId)?.completed);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return allParks
      .filter((p) => !planner.hasPark(p.id) && (p.name.toLowerCase().includes(q) || p.borough.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [query, allParks, planner]);

  const useMyLocation = () => {
    if (!navigator.geolocation) return setNotice("This browser can't share your location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        planner.setStart({ name: "My location", lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        setNotice("Couldn't get your location — search for a place or tap the map instead.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const runAutoPlan = async () => {
    setNotice(null);
    const msg = await planner.autoPlan(targetKm);
    if (msg) setNotice(msg);
  };

  const gpxFile = () => {
    if (!live) return null;
    const title = routeTitle(plan, live);
    const names = new Map(Array.from(parksById.entries()).map(([id, p]) => [id, p.name]));
    const gpx = buildGpx(plan, live, names, title);
    const fileName = `detour-${counted.length}-parks-${live.distanceKm.toFixed(1)}km.gpx`;
    return { gpx, fileName, title };
  };

  const downloadGpx = () => {
    const f = gpxFile();
    if (!f) return;
    const url = URL.createObjectURL(new Blob([f.gpx], { type: "application/gpx+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = f.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const shareGpx = async () => {
    const f = gpxFile();
    if (!f) return;
    try {
      await navigator.share({ files: [new File([f.gpx], f.fileName, { type: "application/gpx+xml" })], title: f.title });
    } catch { /* user closed the share sheet */ }
  };

  const statusLine = (s: PlanStop) => {
    const st = s.parkId != null ? parkStatus.get(s.parkId) : undefined;
    if (!st) {
      return planner.error ? null : <span className="text-muted-foreground">Checking…</span>;
    }
    if (!st.counts) {
      return (
        <span className="text-destructive">
          Only {st.metresInside} of {st.requiredMetres} m inside — drag its point further in
        </span>
      );
    }
    const why = st.fix === "moved" ? " · moved onto a path inside"
      : st.fix === "offpath" ? " · includes a short dash across the grass"
      : st.tight ? " · only just — drag its point deeper in to be safe"
      : "";
    return <span className={st.tight ? "text-muted-foreground" : "text-primary"}>Counts · {st.metresInside} m inside{why}</span>;
  };

  const hasAnything = !!plan.start || plan.stops.length > 0;
  let parkNo = 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-1 border-b border-border px-4 py-2.5">
        <Route className="mr-1 h-4 w-4 text-primary" />
        <h2 className="flex-1 text-sm font-bold">Plan a run</h2>
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={planner.undo} disabled={!planner.canUndo} title="Undo" aria-label="Undo">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={planner.close} title="Close planner" aria-label="Close planner">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Summary */}
      <div className="flex-shrink-0 border-b border-border bg-muted/30 px-4 py-3" aria-live="polite">
        {live ? (
          <>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-bold tabular-nums">{formatKm(live.distanceKm)}</span>
              <span className="text-sm text-muted-foreground">~{formatDuration(live.distanceKm * PACE_MIN_PER_KM)}</span>
              {live.ascentM != null && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground" title="Total climb">
                  <Mountain className="h-3.5 w-3.5" /> {live.ascentM} m
                </span>
              )}
              <Button variant="ghost" size="icon" className="ml-auto h-8 w-8 self-center" onClick={planner.requestFit} title="Show the whole route" aria-label="Show the whole route">
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge className="gap-1"><Check className="h-3 w-3" />{newCounted} new {newCounted === 1 ? "park" : "parks"}</Badge>
              {counted.length > newCounted && <Badge variant="secondary">{counted.length - newCounted} done before</Badge>}
              {bonusNew.length > 0 && <Badge variant="outline">+{bonusNew.length} new on the way</Badge>}
              {shortCount > 0 && <Badge variant="destructive" className="gap-1"><TriangleAlert className="h-3 w-3" />{shortCount} won't count</Badge>}
            </div>
          </>
        ) : planner.isRouting || planner.autoPlanning ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {planner.autoPlanning ? "Finding the best loop…" : "Snapping to paths…"}
          </div>
        ) : planner.error ? (
          <p className="text-sm text-destructive">{planner.error}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {!plan.start ? "Set a start point, then tap parks on the map." : "Now tap parks on the map to add them."}
          </p>
        )}
        {live && planner.error && <p className="mt-1 text-xs text-destructive">{planner.error}</p>}
        {planner.isStale && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Updating route…</p>}
      </div>

      {/* Body */}
      {!compact && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="space-y-4 p-4">
            {/* Loop or A→B */}
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={plan.mode}
              onValueChange={(v) => v && planner.setMode(v as "loop" | "oneway")}
              className="grid grid-cols-2"
            >
              <ToggleGroupItem value="loop" className="gap-1.5"><Repeat className="h-3.5 w-3.5" /> Loop</ToggleGroupItem>
              <ToggleGroupItem value="oneway" className="gap-1.5">A <ArrowRight className="h-3.5 w-3.5" /> B</ToggleGroupItem>
            </ToggleGroup>

            {/* Start / finish */}
            <div className="space-y-2">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <LocationSearch
                    label="Start"
                    placeholder="Search, or tap the map…"
                    value={plan.start ? { name: plan.start.name, lat: plan.start.lat, lng: plan.start.lng } : null}
                    onChange={planner.setStart}
                    accentColor="text-primary"
                    dotColor="bg-primary"
                  />
                </div>
                <Button variant="outline" size="icon" className="h-9 w-9 flex-shrink-0" onClick={useMyLocation} title="Start from my location" aria-label="Start from my location">
                  {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
                </Button>
              </div>
              {plan.mode === "oneway" && (
                <LocationSearch
                  label="Finish (optional)"
                  placeholder="Pub, home, station…"
                  value={plan.end ? { name: plan.end.name, lat: plan.end.lat, lng: plan.end.lng } : null}
                  onChange={planner.setEnd}
                  accentColor="text-foreground"
                  dotColor="bg-foreground"
                />
              )}
            </div>

            {/* Auto-plan */}
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Suggest a loop</Label>
                <span className="text-sm tabular-nums text-muted-foreground">{targetKm} km</span>
              </div>
              <Slider min={2} max={25} step={0.5} value={[targetKm]} onValueChange={([v]) => setTargetKm(v)} aria-label="Target distance" />
              <Button className="w-full gap-1.5" variant="secondary" onClick={runAutoPlan} disabled={!plan.start || planner.autoPlanning}>
                {planner.autoPlanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Most new parks in {targetKm} km
              </Button>
              {!plan.start && <p className="text-xs text-muted-foreground">Set a start point first.</p>}
              {notice && <p className="text-xs text-destructive">{notice}</p>}
            </div>

            {/* Stops */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your route</h3>
                <div className="flex gap-1">
                  {parkStops.length >= 2 && (
                    <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={planner.autoOrder} title="Put the parks in the shortest order">
                      <Wand2 className="h-3.5 w-3.5" /> Best order
                    </Button>
                  )}
                  {plan.stops.length > 0 && (
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={planner.clear}>Clear</Button>
                  )}
                </div>
              </div>

              {parkStops.length > 0 && (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Parks on your route have a bold outline on the map. The route may cross parks you've done to reach them.
                </p>
              )}

              {plan.stops.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-xs leading-relaxed text-muted-foreground">
                  Tap parks on the map to add them. The route follows real paths and the app checks each
                  park will count when you run it.
                  <span className="mt-1 block">Drag the line to reshape it · tap the line to add a point · drag any point to move it.</span>
                </div>
              ) : (
                <ol className="space-y-1">
                  {plan.stops.map((s, i) => {
                    const park = s.parkId != null ? parksById.get(s.parkId) : undefined;
                    const st = s.parkId != null ? parkStatus.get(s.parkId) : undefined;
                    if (s.kind === "park") parkNo++;
                    return (
                      <li key={s.id} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
                        {s.kind === "park" ? (
                          <span className={cn(
                            "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold",
                            !st ? "border border-primary text-foreground" : st.counts ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground",
                          )}>{parkNo}</span>
                        ) : (
                          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
                            <span className="h-3 w-3 rounded-full border-2 border-primary" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold leading-tight">
                            {s.kind === "park" ? park?.name ?? s.name : "Shaping point"}
                            {park?.completed && <span className="ml-1 font-normal text-muted-foreground">(done before)</span>}
                          </p>
                          <p className="text-[11px] leading-snug">
                            {s.kind === "park" ? statusLine(s) : <span className="text-muted-foreground">Drag it on the map to reshape the route</span>}
                          </p>
                        </div>
                        <div className="flex flex-shrink-0 flex-col">
                          <button className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20" onClick={() => planner.moveInList(i, i - 1)} disabled={i === 0} aria-label="Move earlier">
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20" onClick={() => planner.moveInList(i, i + 1)} disabled={i === plan.stops.length - 1} aria-label="Move later">
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0 hover:text-destructive" onClick={() => planner.removeStop(s.id)} aria-label="Remove">
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    );
                  })}
                </ol>
              )}

              {/* Add a park by name */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Add a park by name…" className="h-9 pl-8 text-xs" />
                {searchResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                    {searchResults.map((p) => (
                      <button key={p.id} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
                        onClick={() => { planner.addPark(p); setQuery(""); }}>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold">{p.name}</p>
                          <p className="truncate text-[10px] text-muted-foreground">{p.borough}{p.completed ? " · done before" : ""}</p>
                        </div>
                        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Bonus parks */}
            {bonus.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Also counts on the way</h3>
                <ul className="space-y-0.5">
                  {bonus.map((b) => {
                    const p = parksById.get(b.parkId);
                    return (
                      <li key={b.parkId} className="flex items-center gap-2 text-xs">
                        <Check className="h-3 w-3 flex-shrink-0 text-primary" />
                        <span className="truncate">{p?.name ?? "Park"}</span>
                        {p?.completed && <span className="ml-auto flex-shrink-0 text-[10px] text-muted-foreground">done before</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Settings */}
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="planner-tap-adds" className="cursor-pointer text-xs leading-tight">
                Tapping a park adds it
                <span className="block font-normal text-muted-foreground">Off: show the park's info first</span>
              </Label>
              <Switch id="planner-tap-adds" checked={planner.addsOnClick} onCheckedChange={(on) => planner.setPreviewBeforeAdd(!on)} />
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex-shrink-0 space-y-1.5 border-t border-border p-3">
        <div className="flex gap-2">
          <Button className="flex-1 gap-1.5" onClick={downloadGpx} disabled={!live}>
            <Download className="h-4 w-4" /> Download GPX
          </Button>
          {shareable && (
            <Button variant="outline" className="gap-1.5" onClick={shareGpx} disabled={!live}>
              <Share2 className="h-4 w-4" /> Send to app
            </Button>
          )}
        </div>
        {!compact && (
          <p className="text-[10px] leading-tight text-muted-foreground">
            {hasAnything && live ? `${live.attribution}. ` : ""}The GPX is the exact route — import it into Komoot, Garmin Connect or Strava as it is.
          </p>
        )}
      </div>
    </div>
  );
}

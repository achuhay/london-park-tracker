/**
 * The route planner's map layer — goes inside <MapContainer>.
 *
 *  - The planned route, snapped to real paths (dotted where it cuts across grass to make a park count)
 *  - Draggable markers for the start (A), end (B), parks (numbered) and shaping points
 *  - Desktop: hover the route to get a handle, drag it to reshape the route
 *  - Phone & desktop: tap the route to add a shaping point there, then drag it
 *  - Tap an empty spot on the map: start here / add a point / end here
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Marker, Polyline, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import type { RoutePlanner } from "@/hooks/use-route-planner";
import type { LatLng, PlanStop } from "@/lib/route-planner";

// Icons are cached: giving a marker a new icon object mid-drag would cancel the drag.
const iconCache = new Map<string, L.DivIcon>();
function icon(html: string, size: number): L.DivIcon {
  const key = `${size}:${html}`;
  let i = iconCache.get(key);
  if (!i) {
    i = L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    iconCache.set(key, i);
  }
  return i;
}

const START_ICON = icon(
  `<div class="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-primary text-sm font-bold text-primary-foreground shadow-lg">A</div>`, 32);
const END_ICON = icon(
  `<div class="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-foreground text-sm font-bold text-background shadow-lg">B</div>`, 32);
const VIA_ICON = icon(
  `<div class="h-4 w-4 rounded-full border-[3px] border-primary bg-background shadow-md"></div>`, 16);
const GHOST_ICON = icon(
  `<div class="h-4 w-4 cursor-grab rounded-full border-[3px] border-primary bg-background opacity-90 shadow-md"></div>`, 16);

function parkIcon(n: number, status: "counts" | "short" | "unknown") {
  const colours = status === "counts" ? "bg-primary text-primary-foreground"
    : status === "short" ? "bg-destructive text-destructive-foreground"
    : "bg-background text-foreground";
  return icon(
    `<div class="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background ${colours} text-xs font-bold shadow-lg ring-2 ring-primary">${n}</div>`, 28);
}

/** Closest point on a polyline (in screen pixels) to p: which segment, the point, and how far away. */
function nearestOnLine(pts: L.Point[], p: L.Point) {
  let best = { seg: -1, point: p, dist: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const q = L.point(a.x + t * dx, a.y + t * dy);
    const d = q.distanceTo(p);
    if (d < best.dist) best = { seg: i, point: q, dist: d };
  }
  return best;
}

export function RoutePlannerLayer({ planner }: { planner: RoutePlanner }) {
  const map = useMap();
  const isMobile = useIsMobile();
  const { plan, result, ordered, isPlanning } = planner;
  const coords = result?.coords;

  // Route in screen pixels, for finding the nearest point under the mouse. Rebuilt on zoom.
  const layerPts = useRef<L.Point[]>([]);
  const rebuildPts = useCallback(() => {
    layerPts.current = coords ? coords.map(([lat, lng]) => map.latLngToLayerPoint([lat, lng])) : [];
  }, [coords, map]);
  useEffect(rebuildPts, [rebuildPts]);

  /** Which leg (stretch between two stops) a route segment belongs to. */
  const legOf = useCallback((seg: number) => {
    const w = result?.waypointIdx ?? [];
    let leg = 0;
    for (let k = 0; k < w.length - 1; k++) if (w[k] <= seg) leg = k;
    return leg;
  }, [result]);

  const [ghost, setGhost] = useState<{ latlng: L.LatLng; seg: number } | null>(null);
  const [rubberBand, setRubberBand] = useState<LatLng[] | null>(null);
  const dragging = useRef(false);
  const [tapMenu, setTapMenu] = useState<L.LatLng | null>(null);

  useMapEvents({
    zoomend: rebuildPts,
    viewreset: rebuildPts,
    mousemove(e) {
      if (!isPlanning || isMobile || dragging.current || !coords || planner.isStale) return;
      // A button is held down: a drag of the handle may be starting — don't move or hide it
      if ((e.originalEvent as MouseEvent).buttons) return;
      const near = nearestOnLine(layerPts.current, e.layerPoint);
      if (near.seg >= 0 && near.dist < 12) setGhost({ latlng: map.layerPointToLatLng(near.point), seg: near.seg });
      else if (ghost) setGhost(null);
    },
    click(e) {
      if (!isPlanning) return;
      // Clicks on parks, the route, markers or popups are handled by those layers
      const target = e.originalEvent.target as Element | null;
      if (target?.closest?.(".leaflet-interactive, .leaflet-marker-icon, .leaflet-popup")) return;
      if (!plan.start) {
        planner.setStart({ name: "Pinned on map", lat: e.latlng.lat, lng: e.latlng.lng });
      } else {
        setTapMenu(e.latlng);
      }
    },
  });

  // Hide hover handle when the route changes or planning stops
  useEffect(() => { setGhost(null); setRubberBand(null); }, [coords, isPlanning]);
  useEffect(() => { if (!isPlanning) setTapMenu(null); }, [isPlanning]);

  // Zoom to the whole route when asked (after auto-plan, or when opening a saved plan)
  const fitToRoute = useCallback(() => {
    const pts: LatLng[] = coords?.length ? coords.map(([a, b]) => [a, b] as LatLng) : ordered.map((s) => [s.lat, s.lng] as LatLng);
    if (pts.length === 0) return;
    const bounds = L.latLngBounds(pts);
    if (isMobile) {
      map.fitBounds(bounds, { paddingTopLeft: [24, 80], paddingBottomRight: [24, Math.round(window.innerHeight * 0.5)], maxZoom: 16 });
    } else {
      map.fitBounds(bounds, { paddingTopLeft: [40, 80], paddingBottomRight: [360, 40], maxZoom: 16 });
    }
  }, [coords, ordered, isMobile, map]);
  const lastFit = useRef(planner.fitSignal);
  useEffect(() => {
    if (planner.fitSignal === lastFit.current) return;
    lastFit.current = planner.fitSignal;
    fitToRoute();
  }, [planner.fitSignal, fitToRoute]);

  // When planning opens with a saved route, show it
  const wasPlanning = useRef(false);
  useEffect(() => {
    if (isPlanning && !wasPlanning.current && ordered.length > 0) fitToRoute();
    wasPlanning.current = isPlanning;
  }, [isPlanning, ordered.length, fitToRoute]);

  // A start chosen from search that's off-screen: bring it into view
  const startId = plan.start?.id;
  useEffect(() => {
    if (!isPlanning || !plan.start) return;
    const ll = L.latLng(plan.start.lat, plan.start.lng);
    if (!map.getBounds().pad(-0.1).contains(ll)) map.setView(ll, Math.max(map.getZoom(), 15));
    // only when the start itself changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startId, isPlanning]);

  const parkNumbers = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const s of plan.stops) if (s.kind === "park") m.set(s.id, ++n);
    return m;
  }, [plan.stops]);

  if (!isPlanning) return null;

  const routeLine = coords?.map(([a, b]) => [a, b] as LatLng);
  // Before the first route arrives (or if routing failed), join the stops with straight dashes
  const straight: LatLng[] = ordered.map((s) => [s.lat, s.lng]);
  if (plan.mode === "loop" && straight.length > 1) straight.push(straight[0]);

  const onLineClick = (e: L.LeafletMouseEvent) => {
    L.DomEvent.stopPropagation(e);
    const near = nearestOnLine(layerPts.current, map.latLngToLayerPoint(e.latlng));
    if (near.seg < 0) return;
    const ll = map.layerPointToLatLng(near.point);
    planner.insertVia(legOf(near.seg), ll.lat, ll.lng);
  };

  const stopMarker = (s: PlanStop) => {
    const status = s.parkId != null ? planner.parkStatus.get(s.parkId) : undefined;
    const markerIcon = s.kind === "start" ? START_ICON
      : s.kind === "end" ? END_ICON
      : s.kind === "via" ? VIA_ICON
      : parkIcon(parkNumbers.get(s.id) ?? 0, !status ? "unknown" : status.counts ? "counts" : "short");
    const label = s.kind === "park" && s.parkId != null ? planner.parksById.get(s.parkId)?.name ?? s.name : s.name;
    return (
      <Marker
        key={s.id}
        position={[s.lat, s.lng]}
        icon={markerIcon}
        draggable
        zIndexOffset={s.kind === "via" ? 0 : 500}
        eventHandlers={{
          dragend: (e) => {
            const ll = (e.target as L.Marker).getLatLng();
            planner.moveStop(s.id, ll.lat, ll.lng);
          },
        }}
      >
        <Popup>
          <div className="min-w-[160px] space-y-2">
            <div className="text-sm font-semibold text-foreground">
              {s.kind === "start" ? "Start" : s.kind === "end" ? "Finish" : s.kind === "via" ? "Shaping point" : label}
            </div>
            {(s.kind === "start" || s.kind === "end") && <div className="text-xs text-muted-foreground">{s.name}</div>}
            <div className="text-xs text-muted-foreground">Drag to move{s.kind === "park" ? " where the route goes in this park" : ""}.</div>
            <Button size="sm" variant="outline" className="w-full" onClick={() => planner.removeStop(s.id)}>
              Remove
            </Button>
          </div>
        </Popup>
      </Marker>
    );
  };

  return (
    <>
      {routeLine && routeLine.length > 1 ? (
        <>
          <Polyline positions={routeLine} interactive={false}
            className="stroke-background" pathOptions={{ weight: 9, opacity: planner.isStale ? 0.4 : 0.9, lineJoin: "round" }} />
          <Polyline positions={routeLine} interactive={false}
            className="stroke-primary" pathOptions={{ weight: 5, opacity: planner.isStale ? 0.45 : 1, lineJoin: "round" }} />
          {result?.offPath.map((seg, i) => (
            <Polyline key={i} positions={seg} interactive={false}
              className="stroke-background" pathOptions={{ weight: 5, opacity: 1, dashArray: "2 8", lineCap: "round" }} />
          ))}
          {/* Wide, invisible line that catches taps and clicks on the route */}
          <Polyline positions={routeLine} pathOptions={{ weight: isMobile ? 26 : 16, opacity: 0.01 }}
            eventHandlers={{ click: onLineClick }} />
        </>
      ) : straight.length > 1 ? (
        <Polyline positions={straight} interactive={false}
          className="stroke-primary" pathOptions={{ weight: 3, opacity: 0.6, dashArray: "6 8" }} />
      ) : null}

      {rubberBand && (
        <Polyline positions={rubberBand} interactive={false}
          className="stroke-primary" pathOptions={{ weight: 3, opacity: 0.8, dashArray: "4 6" }} />
      )}

      {plan.stops.map(stopMarker)}
      {plan.start && stopMarker(plan.start)}
      {plan.mode === "oneway" && plan.end && stopMarker(plan.end)}

      {ghost && (
        <Marker
          position={ghost.latlng}
          icon={GHOST_ICON}
          draggable
          zIndexOffset={1000}
          eventHandlers={{
            mousedown: () => { dragging.current = true; },
            mouseup: () => { dragging.current = false; },
            dragstart: () => { dragging.current = true; },
            drag: (e) => {
              // Show where the route will be pulled to, from the stop before to the stop after
              const w = result?.waypointIdx ?? [];
              const leg = legOf(ghost.seg);
              const a = coords?.[w[leg]], b = coords?.[w[leg + 1]];
              const ll = (e.target as L.Marker).getLatLng();
              if (a && b) setRubberBand([[a[0], a[1]], [ll.lat, ll.lng], [b[0], b[1]]]);
            },
            dragend: (e) => {
              dragging.current = false;
              const ll = (e.target as L.Marker).getLatLng();
              planner.insertVia(legOf(ghost.seg), ll.lat, ll.lng);
              setGhost(null);
              setRubberBand(null);
            },
            click: () => {
              planner.insertVia(legOf(ghost.seg), ghost.latlng.lat, ghost.latlng.lng);
              setGhost(null);
            },
          }}
        />
      )}

      {tapMenu && (
        <Popup position={tapMenu} eventHandlers={{ remove: () => setTapMenu(null) }}>
          <div className="flex min-w-[150px] flex-col gap-1.5">
            <Button size="sm" onClick={() => { planner.addVia(tapMenu.lat, tapMenu.lng); setTapMenu(null); }}>
              Route via here
            </Button>
            <Button size="sm" variant="outline" onClick={() => { planner.setStart({ name: "Pinned on map", lat: tapMenu.lat, lng: tapMenu.lng }); setTapMenu(null); }}>
              Start here
            </Button>
            <Button size="sm" variant="outline" onClick={() => { planner.setEnd({ name: "Pinned on map", lat: tapMenu.lat, lng: tapMenu.lng }); setTapMenu(null); }}>
              Finish here (A→B)
            </Button>
          </div>
        </Popup>
      )}
    </>
  );
}

/**
 * ─── MERGE POINT with the route-planning branch ────────────────────────────────────────────
 * This file keeps TODAY's route planner (RouteBasket) working inside the redesigned app.
 * It deliberately mirrors the API the route-planning rewrite exposes, so swapping is mechanical:
 *
 *   useLegacyPlanner(allParks)          →  useRoutePlanner(allParks)
 *   <LegacyPlannerLayer planner={…} />  →  <RoutePlannerLayer planner={…} />   (inside <MapContainer>)
 *   <LegacyPlannerShell planner={…} />  →  <PlanSlot …><RoutePlannerPanel planner={…} /></PlanSlot>
 *                                          (or <RoutePlannerShell planner={…} />)
 *
 * Once the new planner is merged, delete this file.
 * ───────────────────────────────────────────────────────────────────────────────────────────
 */
import { useCallback, useMemo, useState } from "react";
import { Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import type { ParkResponse } from "@shared/routes";
import { RouteBasket } from "@/components/RouteBasket";
import { getParkCenter, insertParkInBestPosition, type LocationPoint } from "@/lib/route-utils";

export function useLegacyPlanner(allParks: ParkResponse[]) {
  const [isPlanning, setIsPlanning] = useState(false);
  const [routeParks, setRouteParks] = useState<ParkResponse[]>([]);
  const [isLoop, setIsLoop] = useState(false);
  const [startPoint, setStartPoint] = useState<LocationPoint | null>(null);
  const [endPoint, setEndPoint] = useState<LocationPoint | null>(null);
  // Add a park in one click, or show its info card first and add from there (remembered on this device)
  const [previewBeforeAdd, setPreviewBeforeAdd] = useState<boolean>(() => {
    try {
      return localStorage.getItem("routePreviewBeforeAdd") === "true";
    } catch {
      return false;
    }
  });

  const ids = useMemo(() => new Set(routeParks.map((p) => p.id)), [routeParks]);

  const togglePark = useCallback(
    (park: ParkResponse) => {
      setRouteParks((prev) =>
        prev.some((p) => p.id === park.id) ? prev.filter((p) => p.id !== park.id) : insertParkInBestPosition(prev, park, startPoint, endPoint, isLoop),
      );
      setIsPlanning(true);
    },
    [startPoint, endPoint, isLoop],
  );

  return {
    isPlanning,
    open: () => setIsPlanning(true),
    close: () => setIsPlanning(false),
    parkCount: routeParks.length,
    hasPark: (id: number) => ids.has(id),
    togglePark,
    /** While planning, a tap on a park adds it straight away (unless "preview before adding" is on) */
    addsOnClick: isPlanning && !previewBeforeAdd,
    // Internals used only by the legacy layer + shell below
    legacy: {
      allParks,
      routeParks,
      setRouteParks,
      isLoop,
      setIsLoop,
      startPoint,
      setStartPoint,
      endPoint,
      setEndPoint,
      previewBeforeAdd,
      setPreviewBeforeAdd: (v: boolean) => {
        setPreviewBeforeAdd(v);
        try {
          localStorage.setItem("routePreviewBeforeAdd", String(v));
        } catch {
          /* storage unavailable */
        }
      },
    },
  };
}

export type LegacyPlanner = ReturnType<typeof useLegacyPlanner>;

const badge = (label: string, size: number, bg: string) =>
  L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:${bg};border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 ${size > 22 ? 12 : 10}px/1 Inter,system-ui,sans-serif;color:white;box-shadow:0 2px 6px rgba(0,0,0,.35)">${label}</div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

/** Route line, stop numbers and start/end pins. Goes inside <MapContainer>. */
export function LegacyPlannerLayer({ planner, ink }: { planner: LegacyPlanner; ink: string }) {
  const { routeParks, startPoint, endPoint } = planner.legacy;

  const connector: [number, number][] = [];
  if (startPoint) connector.push([startPoint.lat, startPoint.lng]);
  for (const park of routeParks) {
    const c = getParkCenter(park);
    if (c) connector.push(c);
  }
  if (endPoint) connector.push([endPoint.lat, endPoint.lng]);

  return (
    <>
      {connector.length >= 2 && <Polyline positions={connector} pathOptions={{ color: ink, weight: 2.5, opacity: 0.75, dashArray: "8, 10" }} interactive={false} />}
      {routeParks.map((park, idx) => {
        const c = getParkCenter(park);
        return c ? <Marker key={`route-num-${park.id}`} position={c} interactive={false} icon={badge(String(idx + 1), 22, ink)} /> : null;
      })}
      {startPoint && (
        <Marker position={[startPoint.lat, startPoint.lng]} icon={badge("A", 28, "#22c55e")}>
          <Popup>
            <div className="p-3 text-sm">
              <span className="font-semibold">Start:</span> {startPoint.name}
            </div>
          </Popup>
        </Marker>
      )}
      {endPoint && (
        <Marker position={[endPoint.lat, endPoint.lng]} icon={badge("B", 28, "#ef4444")}>
          <Popup>
            <div className="p-3 text-sm">
              <span className="font-semibold">End:</span> {endPoint.name}
            </div>
          </Popup>
        </Marker>
      )}
    </>
  );
}

/** Today's route basket panel (it positions itself: right-hand panel on desktop, drawer on phones). */
export function LegacyPlannerShell({ planner }: { planner: LegacyPlanner }) {
  if (!planner.isPlanning) return null;
  const l = planner.legacy;
  return (
    <RouteBasket
      parks={l.routeParks}
      onClose={planner.close}
      onReorder={l.setRouteParks}
      onRemove={(id) => l.setRouteParks((prev) => prev.filter((p) => p.id !== id))}
      startPoint={l.startPoint}
      endPoint={l.endPoint}
      onStartPointChange={l.setStartPoint}
      onEndPointChange={l.setEndPoint}
      allParks={l.allParks}
      onAddPark={(park) => {
        if (!planner.hasPark(park.id)) planner.togglePark(park);
      }}
      isLoop={l.isLoop}
      onLoopChange={l.setIsLoop}
      previewBeforeAdd={l.previewBeforeAdd}
      onPreviewBeforeAddChange={l.setPreviewBeforeAdd}
    />
  );
}

/**
 * EllipsePlanner — map layer rendered inside <MapContainer>.
 *
 * Renders:
 *  - A dashed ellipse polyline when both A and B are set
 *  - Circular markers at A and B
 *  - A straight dashed line between A and B (the "baseline")
 *
 * Also captures map clicks when pickMode is "A" or "B" and calls
 * onPickPoint so Home.tsx can update the ellipse state.
 */
import { useEffect, useMemo } from "react";
import { useMapEvents, Polyline, CircleMarker, Tooltip } from "react-leaflet";
import { computeEllipsePoints } from "@/lib/route-utils";
import type { EllipseState } from "./EllipsePlannerPanel";

interface EllipsePlannerProps {
  ellipse: EllipseState;
  onPickPoint: (latlng: [number, number]) => void;
  /** When true, suppress A/B circle markers (RouteLines owns them instead) */
  hideMarkers?: boolean;
}

export function EllipsePlanner({ ellipse, onPickPoint, hideMarkers = false }: EllipsePlannerProps) {
  const { a, b, detourFactor, pickMode } = ellipse;

  // Change cursor when in pick mode
  const map = useMapEvents({
    click(e) {
      if (pickMode) {
        onPickPoint([e.latlng.lat, e.latlng.lng]);
      }
    },
  });

  useEffect(() => {
    const container = map.getContainer();
    if (pickMode) {
      container.style.cursor = "crosshair";
    } else {
      container.style.cursor = "";
    }
    return () => {
      container.style.cursor = "";
    };
  }, [pickMode, map]);

  // Compute ellipse outline points
  const ellipsePoints = useMemo<[number, number][]>(() => {
    if (!a || !b) return [];
    return computeEllipsePoints(a, b, detourFactor);
  }, [a, b, detourFactor]);

  // Straight A→B baseline
  const baseline = useMemo<[number, number][]>(() => {
    if (!a || !b) return [];
    return [a, b];
  }, [a, b]);

  if (!a && !b) return null;

  return (
    <>
      {/* Ellipse outline */}
      {ellipsePoints.length > 0 && (
        <Polyline
          positions={ellipsePoints}
          pathOptions={{
            color: "#0ea5e9",      // sky-500
            weight: 1.5,
            opacity: 0.7,
            dashArray: "8 5",
            fillColor: "#0ea5e9",
            fill: true,
            fillOpacity: 0.04,    // very faint wash — parks show through clearly
          }}
        />
      )}

      {/* Baseline A→B */}
      {baseline.length === 2 && (
        <Polyline
          positions={baseline}
          pathOptions={{
            color: "#0ea5e9",
            weight: 1.5,
            opacity: 0.5,
            dashArray: "3 6",
          }}
        />
      )}

      {/* Marker A — hidden when RouteLines is showing its own A/B pins */}
      {!hideMarkers && a && (
        <CircleMarker
          center={a}
          radius={8}
          pathOptions={{
            color: "#fff",
            fillColor: "#0ea5e9",
            fillOpacity: 1,
            weight: 2,
          }}
        >
          <Tooltip permanent direction="top" offset={[0, -10]} className="text-xs font-bold">
            A
          </Tooltip>
        </CircleMarker>
      )}

      {!hideMarkers && b && (
        <CircleMarker
          center={b}
          radius={8}
          pathOptions={{
            color: "#fff",
            fillColor: "#0ea5e9",
            fillOpacity: 1,
            weight: 2,
          }}
        >
          <Tooltip permanent direction="top" offset={[0, -10]} className="text-xs font-bold">
            B
          </Tooltip>
        </CircleMarker>
      )}
    </>
  );
}

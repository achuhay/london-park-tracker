/**
 * RouteLines — rendered inside <MapContainer>.
 *
 * Draws a dashed indigo polyline connecting: A → parks in order → B (→ A if loop).
 * Numbered circle markers sit at each park centre.
 * A and B get distinct square pin markers.
 */
import { useMemo } from "react";
import { Polyline, Marker } from "react-leaflet";
import L from "leaflet";
import type { ParkResponse } from "@shared/routes";
import { getParkCenter } from "@/lib/route-utils";

interface RouteLinesProps {
  parks: ParkResponse[];
  isLoop: boolean;
  a?: [number, number] | null;
  b?: [number, number] | null;
}

function makeNumberIcon(n: number) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:18px;height:18px;border-radius:50%;
      background:#6366f1;color:#fff;
      font-size:10px;font-weight:700;
      display:flex;align-items:center;justify-content:center;
      border:2px solid #fff;
      box-shadow:0 1px 3px rgba(0,0,0,0.4);
      line-height:1;
    ">${n}</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function makeAbIcon(label: "A" | "B") {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:20px;height:20px;border-radius:4px;
      background:#0ea5e9;color:#fff;
      font-size:11px;font-weight:800;
      display:flex;align-items:center;justify-content:center;
      border:2px solid #fff;
      box-shadow:0 1px 4px rgba(0,0,0,0.5);
      line-height:1;
    ">${label}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

export function RouteLines({ parks, isLoop, a, b }: RouteLinesProps) {
  const parkCentres = useMemo(
    () =>
      parks
        .map((p) => getParkCenter(p))
        .filter((c): c is [number, number] => c !== null),
    [parks]
  );

  // Full ordered line: A (if set) → parks → B (if set) → A again if loop
  const linePositions = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [
      ...(a ? [a] : []),
      ...parkCentres,
      ...(b ? [b] : []),
    ];
    if (isLoop && pts.length > 1) {
      pts.push(a ?? pts[0]);
    }
    return pts;
  }, [a, b, parkCentres, isLoop]);

  // Need at least 2 total points (including A/B) to draw a line
  if (linePositions.length < 2) return null;

  return (
    <>
      {/* Connecting line */}
      <Polyline
        positions={linePositions}
        pathOptions={{
          color: "#6366f1",
          weight: 2,
          opacity: 0.7,
          dashArray: "6 4",
        }}
      />

      {/* A marker */}
      {a && (
        <Marker position={a} icon={makeAbIcon("A")} zIndexOffset={1100} />
      )}

      {/* Numbered park markers */}
      {parkCentres.map((centre, idx) => (
        <Marker
          key={parks[idx]?.id ?? idx}
          position={centre}
          icon={makeNumberIcon(idx + 1)}
          zIndexOffset={1000}
        />
      ))}

      {/* B marker */}
      {b && (
        <Marker position={b} icon={makeAbIcon("B")} zIndexOffset={1100} />
      )}
    </>
  );
}

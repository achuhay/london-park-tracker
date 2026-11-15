import { memo, useMemo } from "react";
import { Polygon, CircleMarker } from "react-leaflet";
import type { LatLngTuple, LeafletMouseEvent } from "leaflet";
import type { ParkResponse } from "@shared/routes";
import { parkOutlineToLeaflet } from "@/lib/park-geometry";
import type { MapPalette } from "./palette";

// Converting 4,000 outlines is the slow part of drawing the map, so do it once per park.
const outlineCache = new Map<number, { src: unknown; positions: LatLngTuple[][][] | null }>();
function outlineFor(park: ParkResponse) {
  const hit = outlineCache.get(park.id);
  if (hit && hit.src === park.polygon) return hit.positions;
  const positions = parkOutlineToLeaflet(park.polygon);
  outlineCache.set(park.id, { src: park.polygon, positions });
  return positions;
}

/** Did this visit happen in the current calendar year? */
export function visitedThisYear(park: ParkResponse, year = new Date().getFullYear()) {
  return (
    park.completed &&
    ((park.lastVisitDate && new Date(park.lastVisitDate).getFullYear() === year) ||
      (park.completedDate && new Date(park.completedDate).getFullYear() === year))
  );
}

interface ParkLayerProps {
  parks: ParkResponse[];
  palette: MapPalette;
  /** Count only this year's visits as "done" */
  thisYearOnly: boolean;
  /** Data review mode: outline not-public spaces in red */
  reviewMode: boolean;
  favouriteIds: Set<number>;
  plannedIds: Set<number>;
  previewIds: Set<number>;
  selectedId: number | null;
  onParkClick: (park: ParkResponse, e: LeafletMouseEvent) => void;
}

/**
 * Every park on the map. Drawn on a canvas (set on the MapContainer), which keeps
 * 4,000 shapes smooth on phones.
 */
export const ParkLayer = memo(function ParkLayer({
  parks,
  palette,
  thisYearOnly,
  reviewMode,
  favouriteIds,
  plannedIds,
  previewIds,
  selectedId,
  onParkClick,
}: ParkLayerProps) {
  const year = new Date().getFullYear();

  return useMemo(
    () =>
      parks.map((park) => {
        const done = thisYearOnly ? !!visitedThisYear(park, year) : park.completed;
        const suspect = reviewMode && park.accessCategory !== "Public";
        const base = suspect ? palette.suspect : done ? palette.done : palette.todo;
        const inPreview = previewIds.has(park.id);
        const planned = plannedIds.has(park.id);
        const favourite = favouriteIds.has(park.id);
        const selected = selectedId === park.id;

        const color = selected
          ? palette.selected
          : inPreview
            ? palette.preview
            : planned
              ? palette.planned
              : favourite
                ? palette.favourite
                : base;
        const fillColor = inPreview ? palette.preview : base;
        const fillOpacity = inPreview ? 0.5 : suspect ? 0.6 : done ? palette.doneFill : palette.todoFill;
        const weight = selected ? 3.5 : planned || favourite || inPreview ? 3 : done ? 1.5 : 1.2;

        const handlers = { click: (e: LeafletMouseEvent) => onParkClick(park, e) };
        const outline = outlineFor(park);

        if (outline) {
          return (
            <Polygon
              key={park.id}
              positions={outline}
              pathOptions={{ color, fillColor, fillOpacity, weight, opacity: 0.95 }}
              eventHandlers={handlers}
            />
          );
        }
        if (park.latitude && park.longitude) {
          return (
            <CircleMarker
              key={park.id}
              center={[park.latitude, park.longitude]}
              radius={7}
              pathOptions={{ color, fillColor: base, fillOpacity: 0.7, weight: planned || selected ? 3 : 1.5 }}
              eventHandlers={handlers}
            />
          );
        }
        return null;
      }),
    [parks, palette, thisYearOnly, reviewMode, favouriteIds, plannedIds, previewIds, selectedId, onParkClick, year],
  );
});

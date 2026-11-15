import { forwardRef, useEffect, useMemo, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { Marker, useMap } from "react-leaflet";
import L from "leaflet";
import { Layers, LocateFixed, Minus, Plus, Check, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { BaseMapMode } from "./BaseMap";

/** Hands the Leaflet map object to the page, so buttons outside the map can move it. */
export function MapBridge({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => onReady(map), [map, onReady]);
  return null;
}

/** Pulsing blue dot for "you are here". */
export function UserLocationMarker({ position }: { position: [number, number] | null }) {
  const icon = useMemo(() => L.divIcon({ className: "", html: '<div class="detour-you"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), []);
  if (!position) return null;
  return <Marker position={position} icon={icon} interactive={false} keyboard={false} />;
}

/** Round floating button used for map controls. */
export const MapFab = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }>(
  function MapFab({ label, active, className, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        className={cn(
          "glass shadow-float grid size-11 place-items-center rounded-full text-foreground transition-transform active:scale-95",
          active && "text-primary",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

interface MapControlsProps {
  mode: BaseMapMode;
  onModeChange: (mode: BaseMapMode) => void;
  onLocate: () => void;
  locating: boolean;
  located: boolean;
  /** Zoom buttons are for mouse users; phones pinch */
  showZoom?: boolean;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  className?: string;
  style?: CSSProperties;
  extra?: ReactNode;
}

/** The stack of round buttons on the map's right edge. */
export function MapControls({ mode, onModeChange, onLocate, locating, located, showZoom, onZoomIn, onZoomOut, className, style, extra }: MapControlsProps) {
  return (
    <div className={cn("flex flex-col gap-2.5", className)} style={style}>
      {extra}
      <Popover>
        <PopoverTrigger asChild>
          <MapFab label="Map style">
            <Layers className="size-5" />
          </MapFab>
        </PopoverTrigger>
        <PopoverContent side="left" align="start" className="w-56 rounded-2xl p-1.5">
          {(
            [
              { value: "map", label: "Map", hint: "Streets and place names" },
              { value: "satellite", label: "Satellite", hint: "Aerial photos" },
            ] as const
          ).map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onModeChange(o.value)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted"
            >
              <span className="flex-1">
                <span className="block text-sm font-semibold">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.hint}</span>
              </span>
              {mode === o.value && <Check className="size-4 text-primary" />}
            </button>
          ))}
        </PopoverContent>
      </Popover>
      <MapFab label="Show where I am" onClick={onLocate} active={located}>
        {locating ? <Loader2 className="size-5 animate-spin" /> : <LocateFixed className="size-5" />}
      </MapFab>
      {showZoom && (
        <div className="glass shadow-float flex flex-col overflow-hidden rounded-full">
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={onZoomIn} className="grid size-11 place-items-center hover:bg-muted/60">
            <Plus className="size-5" />
          </button>
          <span className="mx-2.5 h-px bg-border" />
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={onZoomOut} className="grid size-11 place-items-center hover:bg-muted/60">
            <Minus className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}

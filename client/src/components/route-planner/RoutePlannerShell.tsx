/**
 * Default container for the route planner: a panel down the right-hand side on desktop, and a
 * bottom sheet on phones that you can pull up or down (the map above it stays usable, so you can
 * keep tapping parks). A redesigned layout can skip this and put <RoutePlannerPanel> in its own container.
 */
import { useRef, useState, type PointerEvent } from "react";
import type { ParkResponse } from "@shared/routes";
import { useIsMobile } from "@/hooks/use-mobile";
import type { RoutePlanner } from "@/hooks/use-route-planner";
import { RoutePlannerPanel } from "./RoutePlannerPanel";

type Snap = "peek" | "half" | "full";

function MobileSheet({ planner, allParks }: { planner: RoutePlanner; allParks: ParkResponse[] }) {
  const [snap, setSnap] = useState<Snap>("half");
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);

  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const heights: Record<Snap, number> = { peek: 236, half: Math.round(vh * 0.5), full: vh - 56 };
  const height = dragHeight ?? heights[snap];

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { y: e.clientY, h: height, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 6) d.moved = true;
    if (d.moved) setDragHeight(Math.max(120, Math.min(heights.full, d.h + dy)));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      // A tap on the handle steps through the sizes
      setSnap(snap === "peek" ? "half" : snap === "half" ? "full" : "peek");
    } else if (dragHeight !== null) {
      const nearest = (Object.keys(heights) as Snap[]).reduce((a, b) =>
        Math.abs(heights[b] - dragHeight) < Math.abs(heights[a] - dragHeight) ? b : a);
      setSnap(nearest);
    }
    setDragHeight(null);
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[2100] flex flex-col overflow-hidden rounded-t-2xl border-t border-border bg-background shadow-2xl"
      style={{ height, transition: dragHeight === null ? "height 200ms ease" : "none" }}
      role="dialog"
      aria-label="Route planner"
    >
      <div
        className="flex flex-shrink-0 cursor-grab touch-none justify-center pb-1 pt-2"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Drag to resize the planner"
      >
        <div className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
      </div>
      <div className="min-h-0 flex-1">
        <RoutePlannerPanel planner={planner} allParks={allParks} compact={snap === "peek" && dragHeight === null} />
      </div>
    </div>
  );
}

export function RoutePlannerShell({ planner, allParks }: { planner: RoutePlanner; allParks: ParkResponse[] }) {
  const isMobile = useIsMobile();
  if (!planner.isPlanning) return null;
  if (isMobile) return <MobileSheet planner={planner} allParks={allParks} />;
  return (
    <aside className="absolute right-0 top-0 z-[999] flex h-full w-80 flex-col border-l border-border bg-background shadow-2xl">
      <RoutePlannerPanel planner={planner} allParks={allParks} />
    </aside>
  );
}

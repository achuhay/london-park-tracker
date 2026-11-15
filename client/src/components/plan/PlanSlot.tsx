import { useState, type ReactNode } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The space the route planner opens into, styled to match the rest of the app.
 *
 *  • Desktop: a floating panel down the right-hand side of the map (the left side is your
 *    Progress/Parks/Runs panel, so the map stays visible in the middle).
 *  • Phone: a bottom sheet above the tab bar that doesn't block the map — you can still tap
 *    parks to add them. Drag the handle (or tap it) to shrink it to just its header.
 *
 * Put the planner's own content inside (it should fill its parent: flex column, full height).
 * Width/height are exported as CSS variables (--plan-w) so map controls can move out of the way.
 */
export const PLAN_PANEL_WIDTH = 380;

interface PlanSlotProps {
  open: boolean;
  onClose: () => void;
  isMobile: boolean;
  title?: string;
  children: ReactNode;
}

export function PlanSlot({ open, onClose, isMobile, title = "Plan a route", children }: PlanSlotProps) {
  const [collapsed, setCollapsed] = useState(false);
  const drag = useDragControls();

  if (!isMobile) {
    return (
      <AnimatePresence>
        {open && (
          <motion.aside
            key="plan-panel"
            aria-label={title}
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 24, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="shadow-float absolute bottom-3 right-3 top-3 z-20 flex flex-col overflow-hidden rounded-3xl bg-card"
            style={{ width: PLAN_PANEL_WIDTH }}
          >
            <header className="flex items-center justify-between gap-2 border-b px-5 py-3.5">
              <h2 className="text-lg font-bold">{title}</h2>
              <button type="button" onClick={onClose} aria-label="Close planner" className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </header>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </motion.aside>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.section
          key="plan-sheet"
          aria-label={title}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 32, stiffness: 340 }}
          drag="y"
          dragListener={false}
          dragControls={drag}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.1, bottom: 0.5 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 60) setCollapsed(true);
            else if (info.offset.y < -40) setCollapsed(false);
          }}
          className={cn("shadow-sheet fixed inset-x-0 z-20 flex flex-col rounded-t-3xl bg-card transition-[height] duration-300 ease-sheet md:hidden", collapsed ? "h-[112px]" : "h-[min(72dvh,620px)]")}
          style={{ bottom: "calc(var(--tabbar-h) + var(--safe-bottom))" }}
        >
          <div className="flex touch-none justify-center pb-1 pt-2.5" onPointerDown={(e) => drag.start(e)} onClick={() => setCollapsed((c) => !c)}>
            <span className="h-1.5 w-10 rounded-full bg-border" />
          </div>
          <header className="flex items-center justify-between gap-2 px-5 pb-2">
            <h2 className="text-lg font-bold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close planner" className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground">
              <X className="size-4" />
            </button>
          </header>
          <div className={cn("flex min-h-0 flex-1 flex-col", collapsed && "invisible")}>{children}</div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

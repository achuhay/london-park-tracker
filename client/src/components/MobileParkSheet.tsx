import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { X } from "lucide-react";
import { ParkPopup } from "@/components/ParkPopup";
import type { ParkResponse } from "@shared/routes";

interface MobileParkSheetProps {
  park: ParkResponse | null;
  onClose: () => void;
  onToggleComplete: (params: { id: number; completed: boolean }) => void;
  isPending: boolean;
  onAddToRoute?: () => void;
  isInRoute?: boolean;
}

/**
 * Park card that slides up from the bottom on phones when you tap a park.
 * It doesn't block the map: you can keep panning, or tap another park to swap the card.
 * Drag it down (or tap ✕) to close. It sits above the tab bar so the tabs stay reachable.
 */
export function MobileParkSheet({ park, onClose, onToggleComplete, isPending, onAddToRoute, isInRoute }: MobileParkSheetProps) {
  const drag = useDragControls();

  return (
    <AnimatePresence>
      {park && (
        <motion.section
          key="park-sheet"
          role="dialog"
          aria-label={park.name}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 32, stiffness: 340 }}
          drag="y"
          dragListener={false}
          dragControls={drag}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.05, bottom: 0.6 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 80 || info.velocity.y > 500) onClose();
          }}
          className="shadow-sheet fixed inset-x-0 z-20 flex max-h-[68dvh] flex-col rounded-t-3xl bg-card md:hidden"
          style={{ bottom: "calc(var(--tabbar-h) + var(--safe-bottom))" }}
        >
          {/* Grab area: drag down to dismiss */}
          <div className="flex cursor-grab touch-none justify-center pb-1 pt-2.5" onPointerDown={(e) => drag.start(e)}>
            <span className="h-1.5 w-10 rounded-full bg-border" />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-muted text-muted-foreground"
          >
            <X className="size-4" />
          </button>
          <div className="-mt-2 overflow-y-auto overscroll-contain">
            <ParkPopup park={park} onToggleComplete={onToggleComplete} isPending={isPending} onAddToRoute={onAddToRoute} isInRoute={isInRoute} />
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

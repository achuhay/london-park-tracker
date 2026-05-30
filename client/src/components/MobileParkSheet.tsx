import { Sheet, SheetContent } from "@/components/ui/sheet";
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

export function MobileParkSheet({
  park,
  onClose,
  onToggleComplete,
  isPending,
  onAddToRoute,
  isInRoute,
}: MobileParkSheetProps) {
  return (
    <Sheet open={!!park} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="bottom"
        className="p-0 rounded-t-2xl max-h-[80vh] overflow-y-auto bg-background border-t border-border"
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-border rounded-full" />
        </div>
        {park && (
          <ParkPopup
            park={park}
            onToggleComplete={onToggleComplete}
            isPending={isPending}
            onAddToRoute={onAddToRoute}
            isInRoute={isInRoute}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

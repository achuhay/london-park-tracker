import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, ChevronRight, Trophy } from "lucide-react";
import { SiStrava } from "react-icons/si";
import type { SyncResult } from "./StravaButton";

interface StoredRun {
  id: number;
  stravaId: string;
  name: string;
  startDate: string;
  distance: number | null;
  movingTime: number | null;
  parkCount: number;
}

interface RunHistorySheetProps {
  open: boolean;
  onClose: () => void;
  /** Called when user picks a run — opens the RunSummaryModal in the parent */
  onSelectRun: (result: SyncResult) => void;
}

export function RunHistorySheet({ open, onClose, onSelectRun }: RunHistorySheetProps) {
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch the list of synced runs whenever the sheet opens
  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    setError(null);
    fetch("/api/strava/runs", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject("Failed to load")))
      .then((data) => setRuns(Array.isArray(data) ? data : []))
      .catch(() => setError("Couldn't load your runs. Try again."))
      .finally(() => setIsLoading(false));
  }, [open]);

  const openSummary = async (stravaId: string) => {
    setLoadingId(stravaId);
    try {
      const res = await fetch(`/api/strava/activity/${stravaId}/summary`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load summary");
      const result: SyncResult = await res.json();
      onSelectRun(result);
      // Don't close — the sheet stays visible so the user can pick another run
    } catch {
      // Silently fail — in future could show a toast
    } finally {
      setLoadingId(null);
    }
  };

  const formatDistance = (m: number | null) =>
    m ? `${(m / 1000).toFixed(1)} km` : "";

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="left" className="w-80 p-0 flex flex-col">
        <SheetHeader className="p-4 border-b border-border flex-shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <SiStrava className="w-4 h-4 text-[#FC4C02]" />
            My Runs
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-sm text-muted-foreground text-center py-12 px-4">{error}</p>
          ) : runs.length === 0 ? (
            <div className="text-center py-12 px-4">
              <p className="text-sm font-medium text-foreground">No runs synced yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Use "Sync Latest Run" to record your first run.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {runs.map((run) => (
                <button
                  key={run.stravaId}
                  className="w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors flex items-center gap-3 disabled:opacity-50"
                  onClick={() => openSummary(run.stravaId)}
                  disabled={loadingId !== null}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{run.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(run.startDate)}
                      {run.distance ? ` · ${formatDistance(run.distance)}` : ""}
                    </p>
                    {run.parkCount > 0 && (
                      <div className="flex items-center gap-1 mt-1">
                        <Trophy className="w-3 h-3 text-amber-500" />
                        <span className="text-xs text-amber-600 font-medium">
                          {run.parkCount} park{run.parkCount !== 1 ? "s" : ""}
                        </span>
                      </div>
                    )}
                  </div>
                  {loadingId === run.stravaId ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

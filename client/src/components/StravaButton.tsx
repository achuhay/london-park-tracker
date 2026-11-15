import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, LogOut, AlertTriangle } from "lucide-react";
import { SiStrava } from "react-icons/si";
import { useDisconnectStrava } from "@/hooks/use-strava";
import { useSession } from "@/components/use-session";
import { cn } from "@/lib/utils";
import type { ParkResponse } from "@shared/routes";
import type { BoroughAchievement } from "@shared/schema";

export interface SyncResult {
  activity: {
    id: number;
    name: string;
    distance: number;
    moving_time: number;
    start_date: string;
    summaryPolyline: string | null;
  } | null;
  parksCompleted: ParkResponse[];
  parksVisited: ParkResponse[];
  message: string;
  /** Boroughs that reached a new tier (bronze/silver/gold/king) as a result of this sync */
  newBoroughAchievements?: BoroughAchievement[];
}

/** "Sync my latest run" — fetches your newest Strava activity and ticks off its parks. */
export function useSyncLatest(onSyncComplete?: (result: SyncResult) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<SyncResult> => {
      const res = await fetch("/api/strava/sync-latest", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed to sync");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/parks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strava/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strava/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/borough-achievements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gamification"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/year-challenge"] });
      onSyncComplete?.(data);
    },
  });
}

/** Strava's orange "Connect with Strava" button. Starts Strava's sign-in. */
export function ConnectStravaButton({ className, label = "Connect with Strava" }: { className?: string; label?: string }) {
  return (
    <a
      href="/api/strava/connect"
      className={cn(
        "inline-flex h-12 items-center justify-center gap-2.5 rounded-xl bg-strava px-5 text-[15px] font-semibold text-white shadow-[0_10px_20px_-12px_hsl(var(--strava))] transition-[filter] hover:brightness-95 active:brightness-90",
        className,
      )}
    >
      <SiStrava className="size-4" aria-hidden />
      {label}
    </a>
  );
}

interface StravaButtonProps {
  onSyncComplete: (result: SyncResult) => void;
  isSyncing?: boolean;
}

/** Your Strava connection: who's connected, sync, disconnect. Lives in the Progress screen. */
export function StravaButton({ onSyncComplete, isSyncing }: StravaButtonProps) {
  const session = useSession();
  const disconnect = useDisconnectStrava();
  const syncLatest = useSyncLatest(onSyncComplete);

  if (session.isLoading) return <div className="h-[76px] animate-pulse rounded-2xl bg-muted" />;
  if (!session.configured) return null;

  if (!session.signedIn) {
    return (
      <div className="space-y-3 rounded-2xl border bg-card p-4">
        <p className="text-sm text-muted-foreground">Connect Strava and Detour ticks off every park your runs pass through, automatically.</p>
        <ConnectStravaButton className="w-full" />
      </div>
    );
  }

  const handleDisconnect = () => {
    if (window.confirm("Disconnect Strava? Detour will stop adding new runs until you connect again.")) {
      disconnect.mutate();
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-strava/10 text-strava">
          <SiStrava className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{session.athleteName || "Your Strava account"}</p>
          <p className={cn("text-xs", session.needsReconnect ? "text-destructive" : "text-muted-foreground")}>
            {session.needsReconnect ? "Strava link expired" : "Connected to Strava"}
          </p>
        </div>
        {session.connected && (
          <button
            type="button"
            onClick={handleDisconnect}
            className="grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label="Disconnect Strava"
            title="Disconnect Strava"
          >
            <LogOut className="size-4" />
          </button>
        )}
      </div>

      {session.needsReconnect ? (
        <div className="space-y-2">
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            Detour can't fetch new runs until you reconnect. Your parks and runs so far are safe.
          </p>
          <ConnectStravaButton className="w-full" label="Reconnect Strava" />
        </div>
      ) : isSyncing ? (
        <div className="flex h-11 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-strava" />
          Syncing all your runs…
        </div>
      ) : (
        <button
          type="button"
          onClick={() => syncLatest.mutate()}
          disabled={syncLatest.isPending}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-muted text-sm font-semibold transition-colors hover:bg-muted/70 disabled:opacity-60"
        >
          {syncLatest.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {syncLatest.isPending ? "Checking Strava…" : "Sync latest run"}
        </button>
      )}
      {syncLatest.isError && <p className="text-center text-xs text-destructive">Couldn't reach Strava. Try again in a moment.</p>}
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, History, LogOut } from "lucide-react";
import { SiStrava } from "react-icons/si";
import { useStravaStatus, useDisconnectStrava } from "@/hooks/use-strava";
import { RunHistorySheet } from "./RunHistorySheet";
import type { ParkResponse } from "@shared/routes";

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
}

interface StravaButtonProps {
  onSyncComplete: (result: SyncResult) => void;
  isSyncing?: boolean;
}

export function StravaButton({ onSyncComplete, isSyncing }: StravaButtonProps) {
  const { data: status, isLoading } = useStravaStatus();
  const queryClient = useQueryClient();
  const [historyOpen, setHistoryOpen] = useState(false);
  const disconnect = useDisconnectStrava();

  const syncLatest = useMutation({
    mutationFn: async (): Promise<SyncResult> => {
      const res = await fetch("/api/strava/sync-latest", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to sync");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/parks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strava/status"] });
      onSyncComplete(data);
    },
  });

  // Don't show anything if Strava isn't configured or status is loading
  if (isLoading || !status?.configured) return null;

  if (!status.connected) {
    return (
      <div className="bg-muted/30 rounded-xl p-4 border border-border/50">
        <div className="flex items-center gap-2 mb-3">
          <SiStrava className="w-4 h-4 text-[#FC4C02]" />
          <span className="text-sm font-semibold">Strava</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Connect Strava to start your London Park Challenge and track which parks you've run through.
        </p>
        <Button asChild size="sm" className="w-full bg-[#FC4C02] hover:bg-[#E34402] text-white">
          <a href="/api/strava/connect">Connect Strava</a>
        </Button>
      </div>
    );
  }

  const handleDisconnect = () => {
    if (window.confirm("Disconnect from Strava? Your synced data will be removed from this session.")) {
      disconnect.mutate();
    }
  };

  return (
    <>
      <div className="bg-muted/30 rounded-xl p-4 border border-border/50">
        {/* Header: Strava logo | name | disconnect */}
        <div className="flex items-center gap-2 mb-3">
          <SiStrava className="w-4 h-4 text-[#FC4C02] flex-shrink-0" />
          <span className="text-sm font-semibold truncate">
            {status.athleteName || "Connected"}
          </span>
          <button
            onClick={handleDisconnect}
            className="ml-auto text-muted-foreground hover:text-destructive transition-colors p-1 rounded-md hover:bg-destructive/10"
            title="Disconnect Strava"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>

        {isSyncing ? (
          <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin text-[#FC4C02]" />
            Syncing all runs...
          </div>
        ) : (
          <div className="space-y-2">
            <Button
              size="sm"
              className="w-full bg-[#FC4C02] hover:bg-[#E34402] text-white"
              onClick={() => syncLatest.mutate()}
              disabled={syncLatest.isPending}
            >
              {syncLatest.isPending ? (
                <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Syncing...</>
              ) : (
                <><SiStrava className="w-3 h-3 mr-2" />Sync Latest Run</>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => setHistoryOpen(true)}
            >
              <History className="w-3 h-3 mr-2" />
              My Runs
            </Button>
          </div>
        )}
        {syncLatest.isError && (
          <p className="text-xs text-destructive mt-2 text-center">Sync failed — try again.</p>
        )}
      </div>

      <RunHistorySheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelectRun={onSyncComplete}
      />
    </>
  );
}

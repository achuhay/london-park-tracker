import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, History } from "lucide-react";
import { SiStrava } from "react-icons/si";
import { useStravaStatus } from "@/hooks/use-strava";
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
}

export function StravaButton({ onSyncComplete }: StravaButtonProps) {
  const { data: status, isLoading } = useStravaStatus();
  const queryClient = useQueryClient();
  const [historyOpen, setHistoryOpen] = useState(false);

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
        <Button asChild size="sm" className="w-full bg-[#FC4C02] hover:bg-[#E34402] text-white">
          <a href="/api/strava/connect">Connect Strava</a>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="bg-muted/30 rounded-xl p-4 border border-border/50">
        <div className="flex items-center gap-2 mb-3">
          <SiStrava className="w-4 h-4 text-[#FC4C02]" />
          <span className="text-sm font-semibold">Strava</span>
          <span className="text-xs text-green-600 font-medium ml-auto">Connected</span>
        </div>
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

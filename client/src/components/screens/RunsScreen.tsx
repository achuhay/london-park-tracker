import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Loader2, RefreshCw, Activity, AlertTriangle, CloudOff } from "lucide-react";
import { useSession } from "@/components/use-session";
import { ConnectStravaButton, useSyncLatest, type SyncResult } from "@/components/StravaButton";
import { EmptyState, RouteThumb, SectionTitle, SkeletonRows, formatDate, formatDuration, formatKm } from "@/components/kit";
import { ScreenFrame, type ScreenVariant } from "./ScreenFrame";
import { cn } from "@/lib/utils";

interface StoredRun {
  id: number;
  stravaId: string;
  name: string;
  activityType?: string;
  startDate: string;
  distance: number | null;
  movingTime: number | null;
  polyline?: string | null;
  parkCount: number;
}

interface RunsScreenProps {
  variant: ScreenVariant;
  /** Open the run's summary card */
  onOpenRun: (result: SyncResult) => void;
  isInitialSyncing?: boolean;
}

/**
 * Your synced Strava runs, newest first, grouped by month.
 * Tap a run to see its parks, route, fun facts and the Strava post builder.
 */
export function RunsScreen({ variant, onOpenRun, isInitialSyncing }: RunsScreenProps) {
  const session = useSession();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const syncLatest = useSyncLatest(onOpenRun);

  const runsQuery = useQuery<StoredRun[]>({
    queryKey: ["/api/strava/runs"],
    enabled: session.signedIn,
  });
  const runs = runsQuery.data ?? [];

  const months = useMemo(() => {
    const groups: { label: string; runs: StoredRun[]; parks: number; km: number }[] = [];
    for (const run of runs) {
      const label = new Date(run.startDate).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
      let g = groups[groups.length - 1];
      if (!g || g.label !== label) {
        g = { label, runs: [], parks: 0, km: 0 };
        groups.push(g);
      }
      g.runs.push(run);
      g.parks += run.parkCount;
      g.km += (run.distance ?? 0) / 1000;
    }
    return groups;
  }, [runs]);

  const openRun = async (stravaId: string) => {
    setLoadingId(stravaId);
    setOpenError(null);
    try {
      const res = await fetch(`/api/strava/activity/${stravaId}/summary`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load summary");
      onOpenRun(await res.json());
    } catch {
      setOpenError("Couldn't open that run. Check your connection and try again.");
    } finally {
      setLoadingId(null);
    }
  };

  const syncButton = session.connected && (
    <button
      type="button"
      onClick={() => syncLatest.mutate()}
      disabled={syncLatest.isPending || isInitialSyncing}
      className="inline-flex h-10 items-center gap-2 rounded-full bg-muted px-4 text-sm font-semibold transition-colors hover:bg-muted/70 disabled:opacity-60"
    >
      {syncLatest.isPending || isInitialSyncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      {syncLatest.isPending || isInitialSyncing ? "Syncing" : "Sync"}
    </button>
  );

  const subtitle = session.signedIn && runs.length > 0 ? `${runs.length} runs synced from Strava` : undefined;

  let body: React.ReactNode;
  if (session.isLoading) {
    body = <SkeletonRows rows={6} />;
  } else if (!session.configured) {
    body = (
      <EmptyState icon={<CloudOff className="size-6" />} title="Strava isn't set up here">
        This copy of Detour has no Strava connection configured, so runs can't be synced.
      </EmptyState>
    );
  } else if (!session.signedIn) {
    body = (
      <EmptyState
        icon={<Activity className="size-6" />}
        title="Your runs live here"
        action={<ConnectStravaButton className="mt-1 w-full max-w-xs" />}
      >
        Connect Strava and every run shows up here with the parks it passed through, ready to share.
      </EmptyState>
    );
  } else if (runsQuery.isLoading) {
    body = <SkeletonRows rows={7} />;
  } else if (runsQuery.isError) {
    body = (
      <EmptyState
        icon={<AlertTriangle className="size-6" />}
        title="Couldn't load your runs"
        action={
          <button type="button" onClick={() => runsQuery.refetch()} className="h-11 rounded-xl bg-foreground px-5 text-sm font-semibold text-background">
            Try again
          </button>
        }
      >
        Something went wrong talking to the server.
      </EmptyState>
    );
  } else if (runs.length === 0) {
    body = (
      <EmptyState icon={<Activity className="size-6" />} title="No runs yet" action={syncButton}>
        Go for a run, then tap Sync to pull it in from Strava.
      </EmptyState>
    );
  } else {
    body = (
      <div className="space-y-6">
        {months.map((month) => (
          <section key={month.label} className="space-y-1.5">
            <SectionTitle
              action={
                <span className="num text-xs text-muted-foreground">
                  {month.km.toFixed(0)} km · {month.parks} park visits
                </span>
              }
            >
              {month.label}
            </SectionTitle>
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
              {month.runs.map((run) => (
                <li key={run.stravaId}>
                  <button
                    type="button"
                    onClick={() => openRun(run.stravaId)}
                    disabled={loadingId !== null}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50 active:bg-muted disabled:opacity-70"
                  >
                    <RouteThumb polyline={run.polyline} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold">{run.name}</p>
                      <p className="num truncate text-[13px] text-muted-foreground">
                        {formatDate(run.startDate, { weekday: "short", day: "numeric", month: "short" })}
                        {run.distance ? ` · ${formatKm(run.distance)}` : ""}
                        {run.movingTime ? ` · ${formatDuration(run.movingTime)}` : ""}
                      </p>
                    </div>
                    {run.parkCount > 0 && (
                      <span className="num shrink-0 rounded-full bg-ember-soft px-2.5 py-1 text-xs font-bold text-ember-ink">
                        {run.parkCount} park{run.parkCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    {loadingId === run.stravaId ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <ScreenFrame variant={variant} title="Runs" subtitle={subtitle} actions={syncButton || undefined}>
      {session.needsReconnect && (
        <div className="mb-4 space-y-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            Your Strava link has expired, so new runs won't appear. Reconnect to carry on — nothing you've done so far is lost.
          </p>
          <ConnectStravaButton className="h-11 w-full" label="Reconnect Strava" />
        </div>
      )}
      {(openError || syncLatest.isError) && (
        <p className={cn("mb-4 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive")}>
          {openError ?? "Couldn't reach Strava. Try again in a moment."}
        </p>
      )}
      {body}
    </ScreenFrame>
  );
}

import { ChevronRight, Flame } from "lucide-react";
import { useParkStats } from "@/hooks/use-parks";
import { useGamification } from "@/hooks/use-gamification";
import { useSession } from "@/components/use-session";
import { ConnectStravaButton } from "@/components/StravaButton";
import { ProgressRing } from "@/components/kit";
import { cn } from "@/lib/utils";

function Streak() {
  const { data } = useGamification();
  if (!data || data.streaks.current === 0) return null;
  return (
    <span className={cn("flex shrink-0 flex-col items-end", data.streaks.activeThisWeek ? "text-ember" : "text-muted-foreground")}>
      <span className="num flex items-center gap-1 font-display text-xl font-bold leading-none">
        <Flame className="size-4" fill="currentColor" />
        {data.streaks.current}
      </span>
      <span className="text-[11px] font-medium text-muted-foreground">week streak</span>
    </span>
  );
}

/**
 * The little progress card that peeks up from the bottom of the map on phones.
 * Tap it to open the Progress tab. Visitors see a "Connect Strava" prompt instead.
 */
export function ProgressPeek({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const session = useSession();
  const { data: stats } = useParkStats();

  if (session.isLoading || !stats) return null;

  if (!session.signedIn) {
    if (!session.configured) return null;
    return (
      <div className={cn("glass shadow-float flex items-center gap-3 rounded-3xl p-3 pl-4 animate-fade-up", className)}>
        <div className="min-w-0 flex-1">
          <p className="num font-display text-[17px] font-bold leading-tight">Run all {stats.total.toLocaleString()} parks</p>
          <p className="text-[13px] text-muted-foreground">Your runs colour them in.</p>
        </div>
        <ConnectStravaButton className="h-11 shrink-0 px-4 text-sm" label="Connect" />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn("glass shadow-float flex w-full items-center gap-3.5 rounded-3xl p-3 text-left animate-fade-up active:scale-[0.99]", className)}
    >
      <ProgressRing value={stats.percentage} size={52} stroke={6}>
        <span className="num text-[11px] font-bold">{stats.percentage < 10 ? stats.percentage.toFixed(1) : Math.round(stats.percentage)}%</span>
      </ProgressRing>
      <span className="min-w-0 flex-1">
        <span className="num block font-display text-[22px] font-bold leading-none">
          {stats.completed.toLocaleString()} <span className="font-sans text-sm font-semibold text-muted-foreground">parks run</span>
        </span>
        <span className="num mt-1 block text-[13px] text-muted-foreground">of {stats.total.toLocaleString()} in London</span>
      </span>
      {session.connected && <Streak />}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

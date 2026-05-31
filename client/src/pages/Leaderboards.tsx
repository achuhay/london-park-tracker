import { useState } from "react";
import { useGamification } from "@/hooks/use-gamification";
import { useBoroughAchievements } from "@/hooks/use-parks";
import { buildBoroughAchievement } from "@shared/schema";

type Tab = "global" | "weekly" | "best_run";

const TAB_LABELS: Record<Tab, string> = {
  global: "All Time",
  weekly: "This Week",
  best_run: "Best Run",
};

function LeaderRow({
  rank,
  name,
  value,
  unit,
}: {
  rank: number;
  name: string;
  value: number;
  unit: string;
}) {
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border last:border-0">
      <span className="w-8 text-center text-sm font-bold text-muted-foreground">
        {medal ?? `#${rank}`}
      </span>
      <span className="flex-1 text-sm font-medium truncate">{name}</span>
      <span className="text-sm font-semibold tabular-nums">
        {value} <span className="text-xs text-muted-foreground">{unit}</span>
      </span>
    </div>
  );
}

export default function Leaderboards() {
  const [tab, setTab] = useState<Tab>("global");
  const { data } = useGamification();

  return (
    <div className="min-h-screen bg-background p-4 pb-20 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Leaderboards 🏅</h1>
        <p className="text-sm text-muted-foreground mt-1">How do you stack up?</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2">
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
              tab === t
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {!data && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Log in to see leaderboards
        </p>
      )}

      {data && tab === "global" && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-3">Total unique parks visited</p>
          {data.leaderboards.global.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>
          ) : (
            data.leaderboards.global.map(r => (
              <LeaderRow key={r.rank} rank={r.rank} name={r.displayName} value={r.visitCount} unit="parks" />
            ))
          )}
        </div>
      )}

      {data && tab === "weekly" && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-3">Distinct parks this ISO week</p>
          {data.leaderboards.weekly.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No parks visited yet this week</p>
          ) : (
            data.leaderboards.weekly.map(r => (
              <LeaderRow key={r.rank} rank={r.rank} name={r.displayName} value={r.visitsThisWeek} unit="parks" />
            ))
          )}
        </div>
      )}

      {data && tab === "best_run" && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-3">Most parks in one Strava activity</p>
          {data.leaderboards.bestSingleRun.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No run data yet</p>
          ) : (
            data.leaderboards.bestSingleRun.map(r => (
              <LeaderRow key={r.rank} rank={r.rank} name={r.displayName} value={r.parksInRun} unit="parks" />
            ))
          )}
        </div>
      )}
    </div>
  );
}

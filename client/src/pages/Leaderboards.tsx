import { useState } from "react";
import { BarChart3 } from "lucide-react";
import { useGamification } from "@/hooks/use-gamification";
import { useSession } from "@/components/use-session";
import { PageShell } from "@/components/PageShell";
import { ConnectStravaButton } from "@/components/StravaButton";
import { EmptyState, Segmented, SkeletonRows } from "@/components/kit";
import { cn } from "@/lib/utils";

type Tab = "global" | "weekly" | "best_run";

const PODIUM = ["#E2B227", "#A8A9AD", "#CD7F32"];

function LeaderRow({ rank, name, value, unit }: { rank: number; name: string; value: number; unit: string }) {
  const podium = rank <= 3;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span
        className={cn("num grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold", podium ? "text-white" : "bg-muted text-muted-foreground")}
        style={podium ? { background: PODIUM[rank - 1] } : undefined}
      >
        {rank}
      </span>
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{name}</span>
      <span className="num shrink-0 text-[15px] font-semibold">
        {value} <span className="text-xs font-medium text-muted-foreground">{unit}</span>
      </span>
    </li>
  );
}

function Board<T>({ rows, caption, empty, render }: { rows: T[]; caption: string; empty: string; render: (r: T) => React.ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="px-1 text-sm text-muted-foreground">{caption}</p>
      {rows.length === 0 ? (
        <div className="rounded-2xl border bg-card">
          <EmptyState icon={<BarChart3 className="size-6" />} title="Nobody yet">
            {empty}
          </EmptyState>
        </div>
      ) : (
        <ol className="divide-y overflow-hidden rounded-2xl border bg-card">{rows.map(render)}</ol>
      )}
    </section>
  );
}

export default function Leaderboards() {
  const [tab, setTab] = useState<Tab>("global");
  const session = useSession();
  const { data, isLoading } = useGamification();

  return (
    <PageShell title="Leaderboards" subtitle="How you stack up against other park runners.">
      <Segmented<Tab>
        className="mb-5"
        value={tab}
        onChange={setTab}
        options={[
          { value: "global", label: "All time" },
          { value: "weekly", label: "This week" },
          { value: "best_run", label: "Best run" },
        ]}
      />

      {!session.isLoading && !session.signedIn ? (
        <div className="rounded-3xl border bg-card">
          <EmptyState icon={<BarChart3 className="size-6" />} title="Join the leaderboard" action={<ConnectStravaButton className="mt-1 w-full max-w-xs" />}>
            Connect Strava to see where you rank.
          </EmptyState>
        </div>
      ) : isLoading || !data ? (
        <SkeletonRows rows={6} />
      ) : tab === "global" ? (
        <Board
          rows={data.leaderboards.global}
          caption="Different parks visited, all time"
          empty="No one has synced a run yet."
          render={(r) => <LeaderRow key={r.rank} rank={r.rank} name={r.displayName} value={r.visitCount} unit="parks" />}
        />
      ) : tab === "weekly" ? (
        <Board
          rows={data.leaderboards.weekly}
          caption="Different parks visited since Monday"
          empty="No parks visited yet this week. Be the first!"
          render={(r) => <LeaderRow key={r.rank} rank={r.rank} name={r.displayName} value={r.visitsThisWeek} unit="parks" />}
        />
      ) : (
        <Board
          rows={data.leaderboards.bestSingleRun}
          caption="Most parks in a single Strava activity"
          empty="No runs yet."
          render={(r) => <LeaderRow key={r.rank} rank={r.rank} name={r.displayName} value={r.parksInRun} unit="parks" />}
        />
      )}
    </PageShell>
  );
}

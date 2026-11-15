import { useMemo, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, Cell, ResponsiveContainer } from "recharts";
import { ChevronRight, Flame, Footprints, Medal, Trophy, BarChart3, Timer, Moon, Sun, Monitor, Shield } from "lucide-react";
import { useParkStats, useBoroughAchievements } from "@/hooks/use-parks";
import { useGamification } from "@/hooks/use-gamification";
import { useSession } from "@/components/use-session";
import { useTheme, type ThemeChoice } from "@/components/theme";
import { ConnectStravaButton, StravaButton, type SyncResult } from "@/components/StravaButton";
import { BoroughAchievementsGrid } from "@/components/BoroughAchievementsGrid";
import { ProgressRing, SectionTitle, Segmented } from "@/components/kit";
import { ScreenFrame, type ScreenVariant } from "./ScreenFrame";
import { cn } from "@/lib/utils";

const CHALLENGE_TARGET = 500;

const TIER_NAME: Record<string, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold", king: "King" };
const TIER_DOT: Record<string, string> = { bronze: "#cd7f32", silver: "#a8a9ad", gold: "#E2B227", king: "#8b5cf6" };

interface ProgressScreenProps {
  variant: ScreenVariant;
  /** Show a borough's parks on the map */
  onBoroughFocus: (borough: string) => void;
  selectedBoroughs: string[];
  onSyncComplete: (result: SyncResult) => void;
  isInitialSyncing?: boolean;
}

function Tile({ icon, value, label, sub, tone = "default" }: { icon: ReactNode; value: ReactNode; label: string; sub?: ReactNode; tone?: "default" | "ember" }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl border bg-card p-3.5">
      <span className={cn("grid size-8 place-items-center rounded-full", tone === "ember" ? "bg-ember-soft text-ember" : "bg-muted text-muted-foreground")}>{icon}</span>
      <div>
        <p className="num font-display text-2xl font-bold leading-none">{value}</p>
        <p className="mt-1 text-[13px] font-medium">{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function LinkRow({ href, icon, label, hint }: { href: string; icon: ReactNode; label: string; hint?: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50 active:bg-muted">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );
}

/** Personal stats. Only mounted when signed in, so visitors don't ask the server for data they don't have. */
function SignedInProgress({ onBoroughFocus, selectedBoroughs }: Pick<ProgressScreenProps, "onBoroughFocus" | "selectedBoroughs">) {
  const { data: gamification } = useGamification();
  const { data: achievements } = useBoroughAchievements();
  const { data: challenge } = useQuery<{ totalVisits: number; weekly: { week: number; visits: number }[]; year: number; target: number }>({
    queryKey: ["/api/stats/year-challenge"],
  });

  const year = useMemo(() => {
    const total = challenge?.totalVisits ?? 0;
    const weekly = challenge?.weekly ?? [];
    const weeksElapsed = weekly.length;
    const rate = weeksElapsed > 0 ? total / weeksElapsed : 0;
    return {
      total,
      pct: Math.min(100, (total / CHALLENGE_TARGET) * 100),
      projected: Math.round(total + rate * Math.max(0, 52 - weeksElapsed)),
      bars: weekly.map((d, i) => ({ week: d.week, count: i === 0 ? d.visits : d.visits - weekly[i - 1].visits })),
    };
  }, [challenge]);

  return (
    <>
      {gamification && (
        <div className="grid grid-cols-3 gap-2.5">
          <Tile
            tone={gamification.streaks.activeThisWeek ? "ember" : "default"}
            icon={<Flame className="size-4" />}
            value={gamification.streaks.current}
            label="Week streak"
            sub={gamification.streaks.activeThisWeek ? "On fire" : gamification.streaks.current > 0 ? "Run this week!" : `Best ${gamification.streaks.best}`}
          />
          <Tile icon={<Footprints className="size-4" />} value={Math.round(gamification.runStats.totalKm)} label="km in parks" />
          <Tile icon={<Medal className="size-4" />} value={gamification.runStats.bestRunParks} label="Best run" sub="parks in one go" />
        </div>
      )}

      {challenge && (
        <section className="space-y-3 rounded-2xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{challenge.year} challenge</p>
              <p className="num mt-1 font-display text-3xl font-bold leading-none">
                {year.total}
                <span className="font-sans text-base font-semibold text-muted-foreground"> / {CHALLENGE_TARGET} parks</span>
              </p>
            </div>
            <span className="num rounded-full bg-ember-soft px-2.5 py-1 text-xs font-bold text-ember-ink">{year.pct.toFixed(0)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-ember transition-[width] duration-700" style={{ width: `${year.pct}%` }} />
          </div>
          {year.bars.length > 0 && (
            <div className="h-14" aria-label="Parks visited each week this year">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={year.bars} margin={{ top: 2, right: 0, left: 0, bottom: 0 }} barCategoryGap={1.5}>
                  <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {year.bars.map((b, i) => (
                      <Cell key={i} fill={b.count > 0 ? "hsl(var(--ember))" : "hsl(var(--muted))"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            On track for about <span className="num font-semibold text-foreground">{year.projected}</span> parks by the end of the year.
          </p>
        </section>
      )}

      {gamification && gamification.nextUnlocks.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Next badges</SectionTitle>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {gamification.nextUnlocks.map((u) => (
              <li key={u.borough}>
                <button type="button" onClick={() => onBoroughFocus(u.borough)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: TIER_DOT[u.nextTier] }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">
                      {u.borough} {TIER_NAME[u.nextTier]}
                    </span>
                    <span className="num block text-xs text-muted-foreground">
                      {u.parksNeeded} more park{u.parksNeeded !== 1 ? "s" : ""} · tap to see them on the map
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Room for the gamification work (quests, levels, weekly goals) to slot in here. */}

      {achievements && achievements.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Borough badges</SectionTitle>
          <BoroughAchievementsGrid achievements={achievements} onBoroughClick={onBoroughFocus} selectedBoroughs={selectedBoroughs} />
        </section>
      )}
    </>
  );
}

/** Your progress, badges and account. Leaves room for the upcoming game features. */
export function ProgressScreen({ variant, onBoroughFocus, selectedBoroughs, onSyncComplete, isInitialSyncing }: ProgressScreenProps) {
  const session = useSession();
  const { data: stats, isLoading } = useParkStats();
  const { choice, setChoice } = useTheme();

  const greeting = session.athleteName ? `Nice running, ${session.athleteName.split(" ")[0]}.` : undefined;

  return (
    <ScreenFrame variant={variant} title="Progress" subtitle={greeting}>
      <div className="space-y-5">
        {/* Hero: how much of London you've run */}
        <section className="flex items-center gap-4 rounded-3xl border bg-card p-4">
          {isLoading || !stats ? (
            <div className="h-[88px] w-full animate-pulse rounded-2xl bg-muted" />
          ) : session.signedIn ? (
            <>
              <ProgressRing value={stats.percentage} size={88} stroke={9}>
                <span className="num text-sm font-bold">{stats.percentage < 10 ? stats.percentage.toFixed(1) : Math.round(stats.percentage)}%</span>
              </ProgressRing>
              <div className="min-w-0">
                <p className="num font-display text-[34px] font-bold leading-none">{stats.completed.toLocaleString()}</p>
                <p className="mt-1 text-[15px] font-medium">parks run</p>
                <p className="num text-sm text-muted-foreground">of {stats.total.toLocaleString()} in London</p>
              </div>
            </>
          ) : (
            <div className="w-full space-y-3">
              <p className="num font-display text-[28px] font-bold leading-tight">
                {stats.total.toLocaleString()} parks.
                <br />
                How many can you run?
              </p>
              <p className="text-sm text-muted-foreground">Connect Strava and Detour colours in every park your runs pass through.</p>
              {session.configured && <ConnectStravaButton className="w-full" />}
            </div>
          )}
        </section>

        {session.signedIn && <SignedInProgress onBoroughFocus={onBoroughFocus} selectedBoroughs={selectedBoroughs} />}

        <section className="space-y-2">
          <SectionTitle>More</SectionTitle>
          <div className="divide-y overflow-hidden rounded-2xl border bg-card">
            <LinkRow href="/trophies" icon={<Trophy className="size-[18px]" />} label="Trophy cabinet" hint="Every badge, earned and still to win" />
            <LinkRow href="/leaderboards" icon={<BarChart3 className="size-[18px]" />} label="Leaderboards" hint="How you stack up" />
            <LinkRow href="/marathon" icon={<Timer className="size-[18px]" />} label="Marathon planner" hint="Training load and race paces" />
          </div>
        </section>

        <section className="space-y-2">
          <SectionTitle>Account</SectionTitle>
          {session.signedIn ? (
            <StravaButton onSyncComplete={onSyncComplete} isSyncing={isInitialSyncing} />
          ) : (
            <p className="px-1 text-sm text-muted-foreground">Not connected. Your progress is saved to your Strava login.</p>
          )}
        </section>

        <section className="space-y-2">
          <SectionTitle>Appearance</SectionTitle>
          <Segmented<ThemeChoice>
            value={choice}
            onChange={setChoice}
            options={[
              { value: "system", label: <span className="inline-flex items-center gap-1.5"><Monitor className="size-4" />Auto</span> },
              { value: "light", label: <span className="inline-flex items-center gap-1.5"><Sun className="size-4" />Light</span> },
              { value: "dark", label: <span className="inline-flex items-center gap-1.5"><Moon className="size-4" />Dark</span> },
            ]}
          />
        </section>

        <div className="flex justify-center pt-2">
          <Link href="/admin" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Shield className="size-3.5" /> Admin
          </Link>
        </div>
      </div>
    </ScreenFrame>
  );
}

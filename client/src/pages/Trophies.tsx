import { useGamification } from "@/hooks/use-gamification";
import { useBoroughAchievements } from "@/hooks/use-parks";
import { useSession } from "@/components/use-session";
import { PageShell } from "@/components/PageShell";
import { ConnectStravaButton } from "@/components/StravaButton";
import { SectionTitle } from "@/components/kit";
import { cn } from "@/lib/utils";
import {
  MILESTONE_BADGES,
  STREAK_BADGES,
  LOCAL_LEGEND_TIERS,
  ACTIVITY_BADGES,
  BOROUGH_COLLECTOR_BADGES,
} from "@shared/milestones";

function BadgeTile({ emoji, name, flavour, earned, subtitle }: { emoji: string; name: string; flavour: string; earned: boolean; subtitle?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center transition-all",
        earned ? "border-transparent bg-card shadow-[0_8px_20px_-14px_hsl(var(--shadow-color)/0.6)] ring-1 ring-gold/50" : "bg-transparent",
      )}
      title={flavour}
    >
      <span className={cn("grid size-12 place-items-center rounded-full text-[28px]", earned ? "bg-gold/15" : "bg-muted opacity-40 grayscale")}>{emoji}</span>
      <p className={cn("text-[13px] font-semibold leading-tight", !earned && "text-muted-foreground")}>{name}</p>
      {subtitle && <p className="num text-[11px] leading-tight text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function Section({ title, count, total, children }: { title: string; count?: number; total?: number; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <SectionTitle action={total !== undefined ? <span className="num text-xs text-muted-foreground">{count ?? 0} of {total}</span> : undefined}>{title}</SectionTitle>
      {children}
    </section>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  geography: "Geography",
  single_run: "Single run",
  distance: "Distance",
  calendar: "Calendar",
  personality: "Personality",
  social: "Social",
};

function Trophies() {
  const session = useSession();
  return session.signedIn ? <TrophyCabinet /> : <TrophyCabinetPreview loading={session.isLoading} />;
}

/** Visitors see what there is to win, all greyed out. */
function TrophyCabinetPreview({ loading }: { loading: boolean }) {
  return (
    <PageShell title="Trophy cabinet" subtitle="Badges you earn by running London's parks.">
      {!loading && (
        <div className="mb-8 space-y-3 rounded-3xl border bg-card p-5">
          <p className="font-display text-lg font-semibold">Start your collection</p>
          <p className="text-sm text-muted-foreground">Connect Strava and badges unlock automatically as your runs pass through new parks.</p>
          <ConnectStravaButton className="w-full" />
        </div>
      )}
      <BadgeSections earnedMilestones={new Set()} earnedActivity={new Set()} boroughCollectorEarned={new Set()} />
    </PageShell>
  );
}

function TrophyCabinet() {
  const { data } = useGamification();
  const { data: boroughAchievements } = useBoroughAchievements();

  const earnedMilestones = new Set(data?.milestones.earned ?? []);
  const earnedActivity = new Set(data?.activityBadges.earned ?? []);

  const rank = { none: 0, bronze: 1, silver: 2, gold: 3, king: 4 } as const;
  const boroughCollectorEarned = new Set<string>();
  if (boroughAchievements) {
    for (const bc of BOROUGH_COLLECTOR_BADGES) {
      const count = boroughAchievements.filter((a) => rank[a.tier] >= rank[bc.requiredTier as keyof typeof rank]).length;
      if (count >= bc.requiredCount) boroughCollectorEarned.add(bc.id);
    }
  }
  const total = earnedMilestones.size + earnedActivity.size + boroughCollectorEarned.size;

  return (
    <PageShell title="Trophy cabinet" subtitle={data ? `${total} badge${total !== 1 ? "s" : ""} earned so far` : "Loading your badges…"}>
      {data?.localLegend && data.localLegend.length > 0 && (
        <section className="mb-8 space-y-3">
          <SectionTitle>Local legend</SectionTitle>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {data.localLegend.map((row) => {
              const tier = LOCAL_LEGEND_TIERS.slice().reverse().find((t) => row.visitCount >= t.threshold);
              if (!tier) return null;
              return (
                <li key={row.parkId} className="flex items-center gap-3 px-4 py-3">
                  <span className="grid size-10 place-items-center rounded-full bg-gold/15 text-xl">{tier.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold">{row.parkName}</p>
                    <p className="num text-xs text-muted-foreground">
                      {tier.name} · {row.visitCount} visits
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <BadgeSections earnedMilestones={earnedMilestones} earnedActivity={earnedActivity} boroughCollectorEarned={boroughCollectorEarned} />
    </PageShell>
  );
}

function BadgeSections({ earnedMilestones, earnedActivity, boroughCollectorEarned }: { earnedMilestones: Set<string>; earnedActivity: Set<string>; boroughCollectorEarned: Set<string> }) {
  const countIn = (ids: { id: string }[], set: Set<string>) => ids.filter((b) => set.has(b.id)).length;
  return (
    <div className="space-y-8">
      <Section title="Milestones" count={countIn(MILESTONE_BADGES, earnedMilestones)} total={MILESTONE_BADGES.length}>
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
          {MILESTONE_BADGES.map((b) => (
            <BadgeTile key={b.id} emoji={b.emoji} name={b.name} flavour={b.flavour} earned={earnedMilestones.has(b.id)} subtitle={`${b.threshold} parks`} />
          ))}
        </div>
      </Section>

      <Section title="Borough collector" count={countIn(BOROUGH_COLLECTOR_BADGES, boroughCollectorEarned)} total={BOROUGH_COLLECTOR_BADGES.length}>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {BOROUGH_COLLECTOR_BADGES.map((b) => (
            <BadgeTile key={b.id} emoji={b.emoji} name={b.name} flavour={b.flavour} earned={boroughCollectorEarned.has(b.id)} />
          ))}
        </div>
      </Section>

      <Section title="Streaks" count={countIn(STREAK_BADGES, earnedActivity)} total={STREAK_BADGES.length}>
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
          {STREAK_BADGES.map((b) => (
            <BadgeTile key={b.id} emoji={b.emoji} name={b.name} flavour={b.flavour} earned={earnedActivity.has(b.id)} subtitle={`${b.threshold} weeks`} />
          ))}
        </div>
      </Section>

      {(["geography", "single_run", "distance", "calendar", "personality", "social"] as const).map((cat) => {
        const catBadges = ACTIVITY_BADGES.filter((b) => b.category === cat);
        return (
          <Section key={cat} title={CATEGORY_LABELS[cat]} count={countIn(catBadges, earnedActivity)} total={catBadges.length}>
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
              {catBadges.map((b) => (
                <BadgeTile key={b.id} emoji={b.emoji} name={b.name} flavour={b.flavour} earned={earnedActivity.has(b.id)} />
              ))}
            </div>
          </Section>
        );
      })}
    </div>
  );
}

export default Trophies;

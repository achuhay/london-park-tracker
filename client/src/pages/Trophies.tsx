import { useGamification } from "@/hooks/use-gamification";
import { useBoroughAchievements } from "@/hooks/use-parks";
import {
  MILESTONE_BADGES,
  STREAK_BADGES,
  LOCAL_LEGEND_TIERS,
  ACTIVITY_BADGES,
  BOROUGH_COLLECTOR_BADGES,
} from "@shared/milestones";

function BadgeTile({
  emoji,
  name,
  flavour,
  earned,
  subtitle,
}: {
  emoji: string;
  name: string;
  flavour: string;
  earned: boolean;
  subtitle?: string;
}) {
  return (
    <div
      className={`rounded-xl border p-3 flex flex-col items-center text-center gap-1 transition-all ${
        earned
          ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30"
          : "border-border bg-muted/20 opacity-50 grayscale"
      }`}
      title={flavour}
    >
      <span className="text-3xl">{emoji}</span>
      <p className="text-xs font-semibold leading-tight">{name}</p>
      {subtitle && <p className="text-[10px] text-muted-foreground leading-tight">{subtitle}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default function Trophies() {
  const { data } = useGamification();
  const { data: boroughAchievements } = useBoroughAchievements();

  const earnedMilestones = new Set(data?.milestones.earned ?? []);
  const earnedActivity = new Set(data?.activityBadges.earned ?? []);

  // Borough collector badges
  const boroughCollectorEarned = new Set<string>();
  if (boroughAchievements) {
    for (const bc of BOROUGH_COLLECTOR_BADGES) {
      const count = boroughAchievements.filter(a => a.tier === bc.requiredTier || (
        bc.requiredTier === "bronze" && ["bronze","silver","gold","king"].includes(a.tier) ||
        bc.requiredTier === "silver" && ["silver","gold","king"].includes(a.tier) ||
        bc.requiredTier === "gold" && ["gold","king"].includes(a.tier) ||
        bc.requiredTier === "king" && a.tier === "king"
      )).length;
      if (count >= bc.requiredCount) boroughCollectorEarned.add(bc.id);
    }
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-20 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Trophy Cabinet 🏆</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {data ? `${earnedMilestones.size + earnedActivity.size} badges earned so far` : "Log in to see your badges"}
        </p>
      </div>

      {/* Milestones */}
      <Section title="Milestones">
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {MILESTONE_BADGES.map(b => (
            <BadgeTile
              key={b.id}
              emoji={b.emoji}
              name={b.name}
              flavour={b.flavour}
              earned={earnedMilestones.has(b.id)}
              subtitle={`${b.threshold} parks`}
            />
          ))}
        </div>
      </Section>

      {/* Borough Collector */}
      <Section title="Borough Collector">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {BOROUGH_COLLECTOR_BADGES.map(b => (
            <BadgeTile
              key={b.id}
              emoji={b.emoji}
              name={b.name}
              flavour={b.flavour}
              earned={boroughCollectorEarned.has(b.id)}
            />
          ))}
        </div>
      </Section>

      {/* Streak badges */}
      <Section title="Streaks">
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {STREAK_BADGES.map(b => (
            <BadgeTile
              key={b.id}
              emoji={b.emoji}
              name={b.name}
              flavour={b.flavour}
              earned={earnedActivity.has(b.id)}
              subtitle={`${b.threshold} weeks`}
            />
          ))}
        </div>
      </Section>

      {/* Local Legend */}
      {data?.localLegend && data.localLegend.length > 0 && (
        <Section title="Local Legend">
          <div className="space-y-2">
            {data.localLegend.map(row => {
              const tier = LOCAL_LEGEND_TIERS.slice().reverse().find(t => row.visitCount >= t.threshold);
              if (!tier) return null;
              return (
                <div key={row.parkId} className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
                  <span className="text-2xl">{tier.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{row.parkName}</p>
                    <p className="text-xs text-muted-foreground">{tier.name} · {row.visitCount} visits</p>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Show unearned tiers as prompts */}
        </Section>
      )}

      {/* Activity badges by category */}
      {(["geography", "single_run", "distance", "calendar", "personality", "social"] as const).map(cat => {
        const catBadges = ACTIVITY_BADGES.filter(b => b.category === cat);
        const catLabels: Record<string, string> = {
          geography: "Geography",
          single_run: "Single Run",
          distance: "Distance",
          calendar: "Calendar",
          personality: "Personality",
          social: "Social",
        };
        return (
          <Section key={cat} title={catLabels[cat]}>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {catBadges.map(b => (
                <BadgeTile
                  key={b.id}
                  emoji={b.emoji}
                  name={b.name}
                  flavour={b.flavour}
                  earned={earnedActivity.has(b.id)}
                />
              ))}
            </div>
          </Section>
        );
      })}
    </div>
  );
}

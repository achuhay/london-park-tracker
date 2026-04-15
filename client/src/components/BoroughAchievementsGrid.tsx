import { useState } from "react";
import { Progress } from "@/components/ui/progress";
import { type BoroughAchievement, type AchievementTier } from "@shared/schema";

// ── Tier colour palette ──────────────────────────────────────────────────────
const TIER_COLOURS: Record<AchievementTier, { border: string; bg: string; text: string; label: string }> = {
  none:     { border: "border-border",         bg: "bg-muted/30",        text: "text-muted-foreground", label: "" },
  bronze:   { border: "border-[#cd7f32]",      bg: "bg-[#cd7f32]/10",    text: "text-[#cd7f32]",        label: "Bronze"   },
  silver:   { border: "border-[#a8a9ad]",      bg: "bg-[#a8a9ad]/10",    text: "text-[#a8a9ad]",        label: "Silver"   },
  gold:     { border: "border-[#ffd700]",      bg: "bg-[#ffd700]/10",    text: "text-[#daa520]",        label: "Gold"     },
  platinum: { border: "border-[#8b5cf6]",      bg: "bg-[#8b5cf6]/10",    text: "text-[#8b5cf6]",        label: "Platinum" },
};

// Simple medal SVG — renders as a filled circle with a ribbon tail
function MedalIcon({ tier }: { tier: AchievementTier }) {
  if (tier === "none") return null;
  const colours: Record<Exclude<AchievementTier, "none">, string> = {
    bronze:   "#cd7f32",
    silver:   "#a8a9ad",
    gold:     "#ffd700",
    platinum: "#8b5cf6",
  };
  const fill = colours[tier as Exclude<AchievementTier, "none">];
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" aria-hidden>
      {/* ribbon */}
      <path d="M9 2 L12 7 L15 2 Z" fill={fill} opacity="0.7" />
      {/* circle */}
      <circle cx="12" cy="15" r="7" fill={fill} />
      {/* shine */}
      <circle cx="10" cy="13" r="1.5" fill="white" opacity="0.35" />
    </svg>
  );
}

interface BoroughCardProps {
  achievement: BoroughAchievement;
}

function BoroughCard({ achievement }: BoroughCardProps) {
  const { border, bg, text, label } = TIER_COLOURS[achievement.tier];
  const hasTier = achievement.tier !== "none";

  // Progress toward next tier (or 100% if platinum)
  const progressValue = achievement.tier === "platinum"
    ? 100
    : achievement.total > 0
      ? Math.round((achievement.completed / achievement.total) * 100)
      : 0;

  return (
    <div
      className={`rounded-xl border-2 ${border} ${bg} p-3 flex flex-col gap-2 transition-all duration-200 hover:shadow-md`}
    >
      {/* Header: medal + borough name + tier badge */}
      <div className="flex items-start gap-2">
        {hasTier && <MedalIcon tier={achievement.tier} />}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold leading-tight truncate" title={achievement.borough}>
            {achievement.borough}
          </p>
          {hasTier && (
            <p className={`text-[10px] font-bold uppercase tracking-wider ${text}`}>{label}</p>
          )}
        </div>
        <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
          {achievement.completed}/{achievement.total}
        </span>
      </div>

      {/* Progress bar */}
      <Progress value={progressValue} className="h-1.5" />

      {/* Footer: next tier hint */}
      <p className="text-[10px] text-muted-foreground leading-tight">
        {achievement.tier === "platinum"
          ? "🏆 Complete!"
          : achievement.nextTier
            ? `${achievement.parksToNextTier} more for ${achievement.nextTier}`
            : `${Math.ceil(achievement.total * 0.25) - achievement.completed} more for Bronze`}
      </p>
    </div>
  );
}

interface BoroughAchievementsGridProps {
  achievements: BoroughAchievement[];
  /** When true, shows all boroughs — default is collapsed (5 boroughs by completion %) */
  defaultExpanded?: boolean;
}

export function BoroughAchievementsGrid({ achievements, defaultExpanded = false }: BoroughAchievementsGridProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (achievements.length === 0) return null;

  // Sort by completion percentage descending, then name
  const sorted = [...achievements].sort((a, b) => b.percentage - a.percentage || a.borough.localeCompare(b.borough));
  const visible = expanded ? sorted : sorted.slice(0, 5);

  // Summary counts per tier
  const tierCounts = achievements.reduce((acc, a) => {
    if (a.tier !== "none") acc[a.tier] = (acc[a.tier] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-3">
      {/* Mini summary strip */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["platinum", "gold", "silver", "bronze"] as Exclude<AchievementTier, "none">[]).map(t =>
          tierCounts[t] ? (
            <span
              key={t}
              className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${TIER_COLOURS[t].bg} ${TIER_COLOURS[t].text}`}
            >
              <MedalIcon tier={t} />
              {tierCounts[t]}×&nbsp;{TIER_COLOURS[t].label}
            </span>
          ) : null
        )}
        {Object.keys(tierCounts).length === 0 && (
          <span className="text-[10px] text-muted-foreground">Complete 25% of a borough's parks to earn Bronze</span>
        )}
      </div>

      {/* Borough grid */}
      <div className="grid grid-cols-2 gap-2">
        {visible.map(a => (
          <BoroughCard key={a.borough} achievement={a} />
        ))}
      </div>

      {/* Expand/collapse */}
      {achievements.length > 5 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          {expanded ? "Show less ↑" : `Show all ${achievements.length} boroughs ↓`}
        </button>
      )}
    </div>
  );
}

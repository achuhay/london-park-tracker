import { useState } from "react";
import { MapPin } from "lucide-react";
import { type BoroughAchievement, type AchievementTier } from "@shared/schema";
import { cn } from "@/lib/utils";

const TIERS: Record<Exclude<AchievementTier, "none">, { label: string; colour: string }> = {
  bronze: { label: "Bronze", colour: "#cd7f32" },
  silver: { label: "Silver", colour: "#a8a9ad" },
  gold: { label: "Gold", colour: "#E2B227" },
  king: { label: "King", colour: "#8b5cf6" },
};

/** Simple medal: a coloured disc with a ribbon. Grey outline when not earned yet. */
function Medal({ tier }: { tier: AchievementTier }) {
  const colour = tier === "none" ? undefined : TIERS[tier].colour;
  return (
    <svg viewBox="0 0 24 24" className="size-7 shrink-0" aria-hidden>
      <path d="M8 2l4 6 4-6" fill="none" stroke={colour ?? "hsl(var(--border))"} strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="12" cy="15" r="7" fill={colour ?? "none"} stroke={colour ?? "hsl(var(--border))"} strokeWidth="2" />
      {colour && <circle cx="9.8" cy="12.8" r="1.6" fill="white" opacity="0.4" />}
    </svg>
  );
}

function BoroughCard({ achievement, onClick, selected }: { achievement: BoroughAchievement; onClick?: (b: string) => void; selected?: boolean }) {
  const pct = achievement.tier === "king" ? 100 : achievement.total > 0 ? Math.round((achievement.completed / achievement.total) * 100) : 0;
  const tier = achievement.tier !== "none" ? TIERS[achievement.tier] : null;
  const hint =
    achievement.tier === "king"
      ? "Every park run"
      : achievement.nextTier
        ? `${achievement.parksToNextTier} to ${TIERS[achievement.nextTier as Exclude<AchievementTier, "none">]?.label ?? achievement.nextTier}`
        : `${Math.max(0, Math.ceil(achievement.total * 0.25) - achievement.completed)} to Bronze`;

  return (
    <button
      type="button"
      onClick={() => onClick?.(achievement.borough)}
      aria-pressed={selected}
      className={cn(
        "flex w-full min-w-0 flex-col gap-2.5 rounded-2xl border bg-card p-3 text-left transition-all active:scale-[0.98]",
        selected ? "border-foreground ring-1 ring-foreground" : "hover:border-foreground/20",
        !onClick && "cursor-default",
      )}
    >
      <div className="flex items-start gap-2">
        <Medal tier={achievement.tier} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight" title={achievement.borough}>
            {achievement.borough}
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: tier?.colour }}>
            {tier ? tier.label : <span className="text-muted-foreground">No badge yet</span>}
          </p>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: tier?.colour ?? "hsl(var(--ember))" }} />
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="num">
          {achievement.completed}/{achievement.total}
        </span>
        <span className="truncate">{hint}</span>
      </div>
      {selected && (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-foreground">
          <MapPin className="size-3" /> On the map
        </span>
      )}
    </button>
  );
}

interface BoroughAchievementsGridProps {
  achievements: BoroughAchievement[];
  /** When true, shows all boroughs — default shows the six closest to their next badge */
  defaultExpanded?: boolean;
  /** Called with the borough name when a card is tapped */
  onBoroughClick?: (borough: string) => void;
  /** Currently selected boroughs (highlighted) */
  selectedBoroughs?: string[];
}

export function BoroughAchievementsGrid({ achievements, defaultExpanded = false, onBoroughClick, selectedBoroughs = [] }: BoroughAchievementsGridProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (achievements.length === 0) return null;

  const sorted = [...achievements].sort((a, b) => b.percentage - a.percentage || a.borough.localeCompare(b.borough));
  const visible = expanded ? sorted : sorted.slice(0, 6);
  const counts = achievements.reduce<Record<string, number>>((acc, a) => {
    if (a.tier !== "none") acc[a.tier] = (acc[a.tier] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 px-1">
        {(["king", "gold", "silver", "bronze"] as const).map((t) =>
          counts[t] ? (
            <span key={t} className="num inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
              <span className="size-2 rounded-full" style={{ background: TIERS[t].colour }} />
              {counts[t]} {TIERS[t].label}
            </span>
          ) : null,
        )}
        {Object.keys(counts).length === 0 && <span className="text-xs text-muted-foreground">Run a quarter of a borough's parks to earn Bronze.</span>}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {visible.map((a) => (
          <BoroughCard key={a.borough} achievement={a} onClick={onBoroughClick} selected={selectedBoroughs.includes(a.borough)} />
        ))}
      </div>
      {achievements.length > 6 && (
        <button type="button" onClick={() => setExpanded((e) => !e)} className="h-11 w-full rounded-xl text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
          {expanded ? "Show fewer" : `Show all ${achievements.length} boroughs`}
        </button>
      )}
    </div>
  );
}

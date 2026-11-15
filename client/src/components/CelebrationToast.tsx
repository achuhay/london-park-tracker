import { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { useGamification } from "@/hooks/use-gamification";
import { useSession } from "@/components/use-session";
import { MILESTONE_BADGES, STREAK_BADGES, LOCAL_LEGEND_TIERS, ACTIVITY_BADGES } from "@shared/milestones";
import type { GamificationResponse } from "@shared/gamification";

const STORAGE_KEY = "gamification_state";

// Build a lookup of all badge ID → { emoji, name, flavour }
const ALL_BADGES = new Map<string, { emoji: string; name: string; flavour: string }>();
for (const b of MILESTONE_BADGES)   ALL_BADGES.set(b.id, b);
for (const b of STREAK_BADGES)      ALL_BADGES.set(b.id, b);
for (const b of LOCAL_LEGEND_TIERS) ALL_BADGES.set(b.id, b);
for (const b of ACTIVITY_BADGES)    ALL_BADGES.set(b.id, b);

function collectEarnedIds(data: GamificationResponse): Set<string> {
  const ids = new Set<string>();
  for (const id of data.milestones.earned)      ids.add(id);
  for (const id of data.activityBadges.earned)  ids.add(id);
  for (const row of data.localLegend)           ids.add(`ll_${row.parkId}_${row.currentTier}`);
  return ids;
}

interface PendingBadge {
  emoji: string;
  name: string;
  flavour: string;
  isDethroned?: boolean;
}

/** Only signed-in runners can earn badges, so visitors never ask the server for them. */
export function CelebrationToast() {
  const { signedIn } = useSession();
  return signedIn ? <Celebration /> : null;
}

function Celebration() {
  const { data } = useGamification();
  const [queue, setQueue] = useState<PendingBadge[]>([]);
  const [visible, setVisible] = useState(false);
  const hasRun = useRef(false);

  useEffect(() => {
    if (!data || hasRun.current) return;
    hasRun.current = true;

    const prev = localStorage.getItem(STORAGE_KEY);
    const currentIds = collectEarnedIds(data);

    if (prev) {
      try {
        const prevData: GamificationResponse = JSON.parse(prev);
        const prevIds = collectEarnedIds(prevData);
        const newBadges: PendingBadge[] = [];

        for (const id of Array.from(currentIds)) {
          if (!prevIds.has(id)) {
            if (id.startsWith("ll_")) {
              // Local Legend badge: ll_{parkId}_{tierId}
              const parts = id.split("_");
              const tierId = parts[parts.length - 1];
              const parkId = parseInt(parts[1]);
              const park = data.localLegend.find(r => r.parkId === parkId);
              const tier = LOCAL_LEGEND_TIERS.find(t => t.id === tierId);
              if (tier && park) {
                newBadges.push({
                  emoji: tier.emoji,
                  name: `${tier.name} — ${park.parkName}`,
                  flavour: tier.flavour,
                });
              }
            } else {
              const badge = ALL_BADGES.get(id);
              if (badge) newBadges.push(badge);
            }
          }
        }

        if (newBadges.length > 0) {
          setQueue(newBadges);
          setVisible(true);
        }
      } catch {
        // corrupted storage — reset
      }
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  const current = queue[0];

  function dismiss() {
    const rest = queue.slice(1);
    if (rest.length > 0) {
      setQueue(rest);
      triggerConfetti();
    } else {
      setQueue([]);
      setVisible(false);
    }
  }

  function triggerConfetti() {
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.4 },
      colors: ["#E8590F", "#F7A23B", "#E2B227", "#3B8659", "#FFFFFF"],
      disableForReducedMotion: true,
    });
  }

  useEffect(() => {
    if (visible && current && !current.isDethroned) {
      triggerConfetti();
    }
  }, [visible, current?.name]);

  if (!visible || !current) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/50 p-4 backdrop-blur-[2px] animate-in fade-in sm:items-center" style={{ paddingBottom: "max(16px, var(--safe-bottom))" }}>
      <div role="dialog" aria-label="New badge" className="w-full max-w-sm space-y-5 rounded-3xl bg-card p-6 text-center shadow-2xl animate-in slide-in-from-bottom-8 sm:zoom-in-95">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-ember">
          {current.isDethroned ? "Overtaken" : queue.length > 1 ? `${queue.length} new badges` : "Badge earned"}
        </p>
        <div className="mx-auto grid size-24 place-items-center rounded-full bg-gold/15 text-6xl">{current.emoji}</div>
        <div className="space-y-1">
          <p className="font-display text-2xl font-bold leading-tight">{current.name}</p>
          <p className="text-sm text-muted-foreground">{current.flavour}</p>
        </div>
        {current.isDethroned && <p className="text-sm font-medium text-ember-ink">Someone's overtaken you. Time to fight back.</p>}
        <button
          type="button"
          onClick={dismiss}
          className="h-12 w-full rounded-xl bg-foreground text-[15px] font-semibold text-background transition-opacity hover:opacity-90"
        >
          {queue.length > 1 ? `Next (${queue.length - 1} more)` : "Nice!"}
        </button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { useGamification } from "@/hooks/use-gamification";
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

export function CelebrationToast() {
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
      colors: ["#ffd700", "#ff6b6b", "#4ecdc4", "#45b7d1", "#96ceb4"],
    });
  }

  useEffect(() => {
    if (visible && current && !current.isDethroned) {
      triggerConfetti();
    }
  }, [visible, current?.name]);

  if (!visible || !current) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 animate-in fade-in">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl p-6 max-w-sm w-full text-center space-y-4 animate-in zoom-in-95">
        {queue.length > 1 && (
          <p className="text-xs text-muted-foreground">{queue.length} new badges!</p>
        )}
        <div className="text-6xl">{current.emoji}</div>
        <div>
          <p className="text-xl font-bold">{current.name}</p>
          <p className="text-sm text-muted-foreground mt-1">{current.flavour}</p>
        </div>
        {current.isDethroned ? (
          <p className="text-sm text-amber-600 font-medium">
            Someone's overtaken you. Time to fight back 💪
          </p>
        ) : (
          <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider text-green-600">
            Badge earned!
          </p>
        )}
        <button
          onClick={dismiss}
          className="w-full py-2 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:opacity-90 transition"
        >
          {queue.length > 1 ? `Next (${queue.length - 1} more)` : "Sweet!"}
        </button>
      </div>
    </div>
  );
}

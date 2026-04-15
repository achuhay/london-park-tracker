import { useState } from "react";
import { Trophy, MapPin, ChevronDown, ChevronUp, Medal } from "lucide-react";
import { type ParkStatsResponse } from "@shared/routes";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { BoroughAchievementsGrid } from "@/components/BoroughAchievementsGrid";
import { useBoroughAchievements } from "@/hooks/use-parks";

interface StatsCardProps {
  stats?: ParkStatsResponse;
  isLoading: boolean;
  showCompletedOnly?: boolean;
  onToggleCompleted?: (val: boolean) => void;
}

export function StatsCard({ stats, isLoading, showCompletedOnly, onToggleCompleted }: StatsCardProps) {
  const [badgesOpen, setBadgesOpen] = useState(false);
  const { data: achievements } = useBoroughAchievements();

  if (isLoading) {
    return <div className="animate-pulse bg-muted h-32 w-full rounded-2xl" />;
  }

  if (!stats) return null;

  const earnedCount = achievements?.filter(a => a.tier !== "none").length ?? 0;

  return (
    <div className="bg-card text-card-foreground rounded-2xl shadow-lg border border-border p-6 relative overflow-hidden group">
      {/* Decorative background element */}
      <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
        <Trophy className="w-32 h-32 text-primary rotate-12" />
      </div>

      <div className="relative z-10">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          London Park Run
        </h2>
        <div className="flex items-baseline gap-2 mb-4">
          <span className="text-4xl font-extrabold font-display text-foreground">
            {stats.percentage.toFixed(1)}%
          </span>
          <span className="text-sm text-muted-foreground font-medium">
            Complete
          </span>
        </div>

        <Progress value={stats.percentage} className="h-3 mb-4 bg-muted" />

        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg">
              <Trophy className="w-4 h-4 text-primary-dark" />
            </div>
            <div>
              <p className="text-lg font-bold font-display">{stats.completed}</p>
              <p className="text-xs text-muted-foreground">Conquered</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-secondary/10 p-2 rounded-lg">
              <MapPin className="w-4 h-4 text-secondary" />
            </div>
            <div>
              <p className="text-lg font-bold font-display">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total Parks</p>
            </div>
          </div>
        </div>

        {onToggleCompleted !== undefined && (
          <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between">
            <label htmlFor="toggle-completed" className="text-xs text-muted-foreground cursor-pointer select-none">
              Completed only
            </label>
            <Switch
              id="toggle-completed"
              checked={!!showCompletedOnly}
              onCheckedChange={onToggleCompleted}
              className="scale-75 origin-right"
            />
          </div>
        )}

        {/* Borough Badges collapsible section */}
        {achievements && achievements.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border/50">
            <button
              onClick={() => setBadgesOpen(o => !o)}
              className="w-full flex items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Medal className="w-3.5 h-3.5" />
                Borough Badges
                {earnedCount > 0 && (
                  <span className="bg-primary/15 text-primary-dark text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {earnedCount}
                  </span>
                )}
              </span>
              {badgesOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {badgesOpen && (
              <div className="mt-3">
                <BoroughAchievementsGrid achievements={achievements} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

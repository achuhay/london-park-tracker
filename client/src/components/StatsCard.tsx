import { Trophy, MapPin, Footprints } from "lucide-react";
import { type ParkStatsResponse } from "@shared/routes";
import { Progress } from "@/components/ui/progress";

interface StatsCardProps {
  stats?: ParkStatsResponse;
  isLoading: boolean;
}

export function StatsCard({ stats, isLoading }: StatsCardProps) {
  if (isLoading) {
    return <div className="animate-pulse bg-muted h-32 w-full rounded-2xl" />;
  }

  if (!stats) return null;

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

        <Progress value={stats.percentage} className="h-3 mb-4 bg-muted" indicatorClassName="bg-primary" />

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
      </div>
    </div>
  );
}

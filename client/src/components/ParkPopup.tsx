import { type ParkResponse } from "@shared/routes";
import { Check, X, Trophy, Calendar, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useParkVisits } from "@/hooks/use-strava";

interface ParkPopupProps {
  park: ParkResponse;
  onToggleComplete: (params: { id: number; completed: boolean }) => void;
  isPending: boolean;
  onAddToRoute?: () => void;
  isInRoute?: boolean;
}

export function ParkPopup({ park, onToggleComplete, isPending, onAddToRoute, isInRoute }: ParkPopupProps) {
  const { data: visits = [] } = useParkVisits(park.id);
  
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div className="flex flex-col min-w-[240px]">
      <div className={`h-2 w-full ${park.completed ? "bg-primary" : "bg-secondary"}`} />
      
      <div className="p-4 bg-background">
        <div className="flex items-start justify-between mb-2">
          <div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {park.borough}
            </span>
            <h3 className="text-lg font-bold font-display leading-tight text-foreground mt-0.5">
              {park.name}
            </h3>
          </div>
          {park.completed && (
            <div className="bg-primary/10 p-1.5 rounded-full">
              <Trophy className="w-4 h-4 text-primary" />
            </div>
          )}
        </div>

        <div className="space-y-1 mb-3 text-sm text-muted-foreground">
          <p className="flex justify-between">
            <span>Type:</span>
            <span className="font-medium text-foreground">{park.siteType}</span>
          </p>
          <p className="flex justify-between">
            <span>Access:</span>
            <span className="font-medium text-foreground">{park.openToPublic}</span>
          </p>
        </div>

        {visits.length > 0 && (
          <div className="mb-3 p-2 bg-muted/50 rounded-md">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-1.5">
              <Calendar className="w-3 h-3" />
              <span>Visit History</span>
            </div>
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {visits.slice(0, 5).map((visit) => (
                <div key={visit.id} className="text-xs flex justify-between">
                  <span className="text-foreground">{formatDate(visit.visitDate)}</span>
                  {visit.activityName && (
                    <span className="text-muted-foreground truncate ml-2 max-w-[100px]">
                      {visit.activityName}
                    </span>
                  )}
                </div>
              ))}
              {visits.length > 5 && (
                <div className="text-xs text-muted-foreground">
                  +{visits.length - 5} more visits
                </div>
              )}
            </div>
          </div>
        )}

        <Button
          onClick={() => onToggleComplete({ id: park.id, completed: !park.completed })}
          disabled={isPending}
          className={`w-full font-semibold shadow-sm transition-all duration-200 ${
            park.completed
              ? "bg-secondary/10 text-secondary hover:bg-secondary/20 hover:text-secondary-dark border-transparent"
              : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/25 hover:shadow-primary/30"
          }`}
          variant={park.completed ? "ghost" : "default"}
        >
          {isPending ? (
            <span className="animate-pulse">Updating...</span>
          ) : park.completed ? (
            <span className="flex items-center gap-2">
              <X className="w-4 h-4" /> Mark Incomplete
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4" /> Mark Complete
            </span>
          )}
        </Button>

        {onAddToRoute && (
          <Button
            onClick={onAddToRoute}
            variant="outline"
            size="sm"
            className={`w-full mt-2 text-xs ${
              isInRoute
                ? "border-indigo-400 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {isInRoute ? (
              <span className="flex items-center gap-1.5">
                <Minus className="w-3 h-3" /> Remove from Route
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Plus className="w-3 h-3" /> Add to Route
              </span>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

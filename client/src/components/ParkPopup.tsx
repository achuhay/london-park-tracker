import { type ParkResponse } from "@shared/routes";
import { Check, X, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ParkPopupProps {
  park: ParkResponse;
  onToggleComplete: (id: number, completed: boolean) => void;
  isPending: boolean;
}

export function ParkPopup({ park, onToggleComplete, isPending }: ParkPopupProps) {
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

        <div className="space-y-1 mb-4 text-sm text-muted-foreground">
          <p className="flex justify-between">
            <span>Type:</span>
            <span className="font-medium text-foreground">{park.siteType}</span>
          </p>
          <p className="flex justify-between">
            <span>Access:</span>
            <span className="font-medium text-foreground">{park.openToPublic}</span>
          </p>
        </div>

        <Button 
          onClick={() => onToggleComplete(park.id, !park.completed)}
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
      </div>
    </div>
  );
}

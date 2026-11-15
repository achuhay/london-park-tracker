import { type ParkResponse } from "@shared/routes";
import { Check, CheckCircle2, Plus, Minus, Lock, AlertTriangle, CalendarDays, Undo2 } from "lucide-react";
import { useParkVisits } from "@/hooks/use-strava";
import { useBoroughAchievements } from "@/hooks/use-parks";
import { type AchievementTier } from "@shared/schema";
import { StarRating } from "@/components/StarRating";
import { FAVOURITE_MIN_STARS, useParkRatings, useRatePark } from "@/hooks/use-park-ratings";
import { useSession } from "@/components/use-session";
import { formatDate } from "@/components/kit";
import { cn } from "@/lib/utils";

const TIER_LABEL: Record<AchievementTier, string> = {
  none: "",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  king: "King",
};

const TIER_COLOUR: Record<AchievementTier, string> = {
  none: "bg-muted text-muted-foreground",
  bronze: "bg-[#cd7f32]/15 text-[#a5622a] dark:text-[#e3a46a]",
  silver: "bg-[#9ca3af]/20 text-[#5b6270] dark:text-[#cfd3da]",
  gold: "bg-gold/20 text-[#9a7210] dark:text-gold",
  king: "bg-[#8b5cf6]/15 text-[#6d40d9] dark:text-[#b69cff]",
};

interface ParkPopupProps {
  park: ParkResponse;
  onToggleComplete: (params: { id: number; completed: boolean }) => void;
  isPending: boolean;
  onAddToRoute?: () => void;
  isInRoute?: boolean;
}

/** Your personal bits for a park — visits, rating, borough progress. Only mounted when signed in. */
function PersonalDetails({ park }: { park: ParkResponse }) {
  const { data: visits = [] } = useParkVisits(park.id);
  const { data: achievements } = useBoroughAchievements();
  const boroughAchievement = achievements?.find((a) => a.borough === park.borough);
  const ratings = useParkRatings();
  const ratePark = useRatePark();
  const rating = ratings.get(park.id) ?? null;

  return (
    <>
      {park.completed && (
        <div className="flex items-center justify-between gap-2 rounded-2xl bg-muted/70 px-3.5 py-2.5">
          <span className="text-sm font-medium">{rating !== null && rating >= FAVOURITE_MIN_STARS ? "Favourite" : "Your rating"}</span>
          <StarRating size="md" value={rating} onChange={(value) => ratePark.mutate({ parkId: park.id, rating: value })} />
        </div>
      )}

      {visits.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <CalendarDays className="size-3.5" />
            {visits.length} visit{visits.length !== 1 ? "s" : ""}
          </p>
          <ul className="max-h-28 space-y-1 overflow-y-auto">
            {visits.slice(0, 6).map((visit) => (
              <li key={visit.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="num shrink-0 text-muted-foreground">{formatDate(visit.visitDate, { day: "numeric", month: "short", year: "numeric" })}</span>
                {visit.activityName && <span className="truncate text-right">{visit.activityName}</span>}
              </li>
            ))}
          </ul>
          {visits.length > 6 && <p className="text-xs text-muted-foreground">and {visits.length - 6} more</p>}
        </div>
      )}

      {boroughAchievement && (
        <div className="space-y-2 rounded-2xl border px-3.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{park.borough}</span>
            {boroughAchievement.tier !== "none" && (
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide", TIER_COLOUR[boroughAchievement.tier])}>
                {TIER_LABEL[boroughAchievement.tier]}
              </span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-ember transition-[width] duration-700" style={{ width: `${Math.min(100, boroughAchievement.percentage)}%` }} />
          </div>
          <p className="num text-xs text-muted-foreground">
            {boroughAchievement.completed} of {boroughAchievement.total} parks
            {boroughAchievement.nextTier && ` · ${boroughAchievement.parksToNextTier} more for ${TIER_LABEL[boroughAchievement.nextTier as AchievementTier] || boroughAchievement.nextTier}`}
          </p>
        </div>
      )}
    </>
  );
}

/** Everything about one park. Used in the desktop map popup and the phone's bottom sheet. */
export function ParkPopup({ park, onToggleComplete, isPending, onAddToRoute, isInRoute }: ParkPopupProps) {
  const { signedIn } = useSession();
  const isOpen = ["Yes", "Free", "De facto"].includes(park.openToPublic);

  return (
    <div className="flex flex-col gap-4 p-5">
      <header className="space-y-1.5 pr-8">
        <div className="flex flex-wrap items-center gap-1.5">
          {park.completed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-ember-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ember-ink">
              <CheckCircle2 className="size-3" /> Visited
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-park-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-park">
              To visit
            </span>
          )}
          <span className="text-xs font-medium text-muted-foreground">{park.borough}</span>
        </div>
        <h3 className="text-[22px] font-bold leading-tight">{park.name}</h3>
        <p className="text-sm text-muted-foreground">
          {park.siteType}
          {park.openToPublic && (
            <>
              {" · "}
              <span className={cn(isOpen ? "text-park" : "text-muted-foreground")}>{isOpen ? "Open to the public" : `Access: ${park.openToPublic}`}</span>
            </>
          )}
        </p>
      </header>

      {park.accessCategory === "Not Public" && (
        <p className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          <Lock className="mt-0.5 size-4 shrink-0" /> Not open to the public, so it's hidden from the map unless data review mode is on.
        </p>
      )}
      {park.accessCategory === "Partial" && park.openToPublic !== "Partially" && (
        <p className="flex items-start gap-2 rounded-2xl bg-gold/15 px-3.5 py-2.5 text-sm text-[#8a6410] dark:text-gold">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Limited access: {park.openToPublic}
        </p>
      )}

      {signedIn && <PersonalDetails park={park} />}

      <div className="flex flex-col gap-2">
        {onAddToRoute && (
          <button
            type="button"
            onClick={onAddToRoute}
            className={cn(
              "flex h-12 items-center justify-center gap-2 rounded-xl text-[15px] font-semibold transition-colors",
              isInRoute ? "bg-muted text-foreground hover:bg-muted/70" : "bg-foreground text-background hover:opacity-90",
            )}
          >
            {isInRoute ? <Minus className="size-4" /> : <Plus className="size-4" />}
            {isInRoute ? "Remove from route" : "Add to route"}
          </button>
        )}
        {signedIn && (
          <button
            type="button"
            onClick={() => onToggleComplete({ id: park.id, completed: !park.completed })}
            disabled={isPending}
            className={cn(
              "flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60",
              park.completed ? "text-muted-foreground hover:bg-muted" : "border border-border hover:bg-muted",
            )}
          >
            {isPending ? (
              "Saving…"
            ) : park.completed ? (
              <>
                <Undo2 className="size-4" /> Mark as not visited
              </>
            ) : (
              <>
                <Check className="size-4" /> I've been here (mark visited)
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

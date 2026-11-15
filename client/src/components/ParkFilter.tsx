import type { ReactNode } from "react";
import { SlidersHorizontal, Star, Route as RouteIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/kit";
import { cn } from "@/lib/utils";

/** Quick "which parks?" filter shown as chips on the map and in the Parks list. */
export type StatusFilter = "all" | "todo" | "done" | "favourites";

export interface ServerFilters {
  borough?: string;
  siteType?: string;
  accessCategory?: string;
  search?: string;
}

const split = (v?: string) => (v ? v.split(",").filter(Boolean) : []);

/** How many of the filter sheet's options differ from the defaults (for the badge on the button). */
export function countActiveFilters(filters: ServerFilters, thisYearOnly: boolean, reviewMode: boolean) {
  const access = split(filters.accessCategory);
  const accessChanged = !(access.length === 2 && access.includes("Public") && access.includes("Partial"));
  return (
    (split(filters.borough).length > 0 ? 1 : 0) +
    (split(filters.siteType).length > 0 ? 1 : 0) +
    (accessChanged && !reviewMode ? 1 : 0) +
    (thisYearOnly ? 1 : 0) +
    (reviewMode ? 1 : 0)
  );
}

/** A pill that can be switched on and off. */
export function Chip({
  on,
  onClick,
  children,
  className,
  dot,
}: {
  on?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  dot?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold transition-colors",
        on ? "bg-foreground text-background" : "glass shadow-float text-foreground hover:bg-muted",
        className,
      )}
    >
      {dot && <span className="size-2 rounded-full" style={{ background: dot }} />}
      {children}
    </button>
  );
}

interface MapChipsProps {
  status: StatusFilter;
  onStatusChange: (s: StatusFilter) => void;
  showRuns: boolean;
  onShowRunsChange: (v: boolean) => void;
  filterCount: number;
  onOpenFilters: () => void;
  signedIn: boolean;
  className?: string;
}

/** The row of chips under the search bar: what to show on the map. */
export function MapChips({ status, onStatusChange, showRuns, onShowRunsChange, filterCount, onOpenFilters, signedIn, className }: MapChipsProps) {
  return (
    <div className={cn("no-scrollbar flex gap-2 overflow-x-auto", className)}>
      <Chip on={filterCount > 0} onClick={onOpenFilters} className="pl-3">
        <SlidersHorizontal className="size-4" />
        Filters
        {filterCount > 0 && <span className="num -mr-1 grid size-5 place-items-center rounded-full bg-primary text-[11px] text-primary-foreground">{filterCount}</span>}
      </Chip>
      <Chip on={status === "all"} onClick={() => onStatusChange("all")}>All parks</Chip>
      <Chip on={status === "todo"} onClick={() => onStatusChange(status === "todo" ? "all" : "todo")} dot="hsl(var(--park))">
        To visit
      </Chip>
      <Chip on={status === "done"} onClick={() => onStatusChange(status === "done" ? "all" : "done")} dot="hsl(var(--ember))">
        Visited
      </Chip>
      {signedIn && (
        <>
          <Chip on={status === "favourites"} onClick={() => onStatusChange(status === "favourites" ? "all" : "favourites")}>
            <Star className="size-4" />
            Favourites
          </Chip>
          <Chip on={showRuns} onClick={() => onShowRunsChange(!showRuns)}>
            <RouteIcon className="size-4" />
            My runs
          </Chip>
        </>
      )}
    </div>
  );
}

function ToggleChips({ options, selected, onChange }: { options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((s) => s !== o) : [...selected, o])}
            className={cn(
              "h-9 rounded-full border px-3.5 text-sm font-medium transition-colors",
              on ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted",
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function Group({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h3 className="font-sans text-[15px] font-semibold tracking-normal">{title}</h3>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

interface ParkFilterProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isMobile: boolean;
  filters: ServerFilters;
  setFilters: (updater: (prev: ServerFilters) => ServerFilters) => void;
  uniqueBoroughs: string[];
  uniqueTypes: string[];
  uniqueAccessCategories: string[];
  thisYearOnly: boolean;
  onThisYearOnlyChange: (v: boolean) => void;
  reviewMode: boolean;
  onReviewModeChange: (v: boolean) => void;
  shownCount: number;
}

/** Filters panel: a bottom sheet on phones, a side panel on bigger screens. */
export function ParkFilter({
  open,
  onOpenChange,
  isMobile,
  filters,
  setFilters,
  uniqueBoroughs,
  uniqueTypes,
  uniqueAccessCategories,
  thisYearOnly,
  onThisYearOnlyChange,
  reviewMode,
  onReviewModeChange,
  shownCount,
}: ParkFilterProps) {
  const setList = (key: keyof ServerFilters, values: string[]) =>
    setFilters((prev) => ({ ...prev, [key]: values.length > 0 ? values.join(",") : undefined }));

  const reset = () => {
    setFilters((prev) => ({ search: prev.search, accessCategory: "Public,Partial" }));
    onThisYearOnlyChange(false);
    onReviewModeChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile ? "max-h-[88dvh] rounded-t-3xl pb-safe-b" : "w-[400px] sm:max-w-[400px]",
        )}
      >
        {isMobile && <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-border" aria-hidden />}
        <SheetHeader className="px-5 pb-3 pt-4 text-left">
          <SheetTitle className="text-xl">Filters</SheetTitle>
          <SheetDescription>Choose which green spaces show on the map and in the list.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-7 overflow-y-auto px-5 pb-6 pt-2">
          <Group title="Count visits from" hint="Colour parks orange only if you ran there in that period.">
            <Segmented
              value={thisYearOnly ? "year" : "all"}
              onChange={(v) => onThisYearOnlyChange(v === "year")}
              options={[
                { value: "all", label: "All time" },
                { value: "year", label: `${new Date().getFullYear()} only` },
              ]}
            />
          </Group>

          <Group
            title="Boroughs"
            action={
              split(filters.borough).length > 0 && (
                <button type="button" className="text-sm font-semibold text-primary" onClick={() => setList("borough", [])}>
                  Clear
                </button>
              )
            }
          >
            <ToggleChips options={uniqueBoroughs} selected={split(filters.borough)} onChange={(v) => setList("borough", v)} />
          </Group>

          <Group
            title="Type of space"
            action={
              split(filters.siteType).length > 0 && (
                <button type="button" className="text-sm font-semibold text-primary" onClick={() => setList("siteType", [])}>
                  Clear
                </button>
              )
            }
          >
            <ToggleChips options={uniqueTypes} selected={split(filters.siteType)} onChange={(v) => setList("siteType", v)} />
          </Group>

          {!reviewMode && (
            <Group title="Access" hint="The challenge counts public and partly public spaces.">
              <ToggleChips options={uniqueAccessCategories} selected={split(filters.accessCategory)} onChange={(v) => setList("accessCategory", v)} />
            </Group>
          )}

          <Group title="Data review mode" hint="Shows every green space, including private ones, outlined in red. For checking the park data.">
            <label className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3">
              <span className="text-sm font-medium">Show all green spaces</span>
              <Switch checked={reviewMode} onCheckedChange={onReviewModeChange} />
            </label>
          </Group>
        </div>

        <div className="flex items-center gap-3 border-t bg-background/80 px-5 py-3">
          <button type="button" onClick={reset} className="h-11 rounded-xl px-4 text-sm font-semibold text-muted-foreground hover:bg-muted">
            Reset
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="num h-11 flex-1 rounded-xl bg-foreground text-sm font-semibold text-background transition-opacity hover:opacity-90"
          >
            Show {shownCount.toLocaleString()} parks
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

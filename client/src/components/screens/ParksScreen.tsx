import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Search, SlidersHorizontal, Star, Trees, X } from "lucide-react";
import type { ParkResponse } from "@shared/routes";
import { EmptyState, Segmented, SkeletonRows } from "@/components/kit";
import type { StatusFilter } from "@/components/ParkFilter";
import { ScreenFrame, type ScreenVariant } from "./ScreenFrame";
import { cn } from "@/lib/utils";

type SortKey = "name" | "recent";
const PAGE = 60;

// Sort "1 New Street Square" under N, not before every real park name
const sortName = (name: string) => name.replace(/^[\d\s\-–,.]+/, "").toLowerCase();

interface ParksScreenProps {
  variant: ScreenVariant;
  parks: ParkResponse[];
  isLoading: boolean;
  status: StatusFilter;
  onStatusChange: (s: StatusFilter) => void;
  favouriteIds: Set<number>;
  signedIn: boolean;
  filterCount: number;
  onOpenFilters: () => void;
  /** Show this park on the map */
  onSelectPark: (park: ParkResponse) => void;
}

/** Every park as a searchable list. Tap one to see it on the map. */
export function ParksScreen({ variant, parks, isLoading, status, onStatusChange, favouriteIds, signedIn, filterCount, onOpenFilters, onSelectPark }: ParksScreenProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [limit, setLimit] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? parks.filter((p) => p.name.toLowerCase().includes(q) || p.borough.toLowerCase().includes(q)) : parks;
    const sorted = [...filtered];
    if (sort === "recent") {
      const t = (p: ParkResponse) => new Date((p.lastVisitDate ?? p.completedDate ?? 0) as string | number).getTime() || 0;
      sorted.sort((a, b) => t(b) - t(a) || sortName(a.name).localeCompare(sortName(b.name)));
    } else {
      sorted.sort((a, b) => sortName(a.name).localeCompare(sortName(b.name)));
    }
    return sorted;
  }, [parks, query, sort]);

  // Start again from the top whenever the list changes
  useEffect(() => setLimit(PAGE), [query, sort, status, parks]);

  // Draw more rows as you scroll near the bottom (4,000 rows at once would make phones stutter)
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setLimit((n) => n + PAGE);
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [list.length, limit]);

  const visited = parks.filter((p) => p.completed).length;

  const toolbar = (
    <div className="space-y-3">
      <div className="flex gap-2">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-muted px-3.5">
          <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">Search parks</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or borough"
            enterKeyHint="search"
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="-mr-1.5 grid size-8 place-items-center rounded-full text-muted-foreground">
              <X className="size-4" />
            </button>
          )}
        </label>
        <button
          type="button"
          onClick={onOpenFilters}
          aria-label="Filters"
          className={cn("relative grid size-11 shrink-0 place-items-center rounded-xl", filterCount > 0 ? "bg-foreground text-background" : "bg-muted")}
        >
          <SlidersHorizontal className="size-[18px]" />
          {filterCount > 0 && <span className="num absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{filterCount}</span>}
        </button>
      </div>
      <Segmented
        size="sm"
        value={status}
        onChange={onStatusChange}
        options={[
          { value: "all", label: "All" },
          { value: "todo", label: "To visit" },
          { value: "done", label: "Visited" },
          ...(signedIn ? [{ value: "favourites" as const, label: <span className="inline-flex items-center gap-1"><Star className="size-3.5" />Faves</span> }] : []),
        ]}
      />
    </div>
  );

  return (
    <ScreenFrame
      variant={variant}
      title="Parks"
      subtitle={isLoading ? "Loading…" : `${parks.length.toLocaleString()} parks · ${visited.toLocaleString()} visited`}
      toolbar={toolbar}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="num text-xs font-medium text-muted-foreground">
          {query ? `${list.length.toLocaleString()} matches` : `${list.length.toLocaleString()} parks`}
        </span>
        <button
          type="button"
          onClick={() => setSort(sort === "name" ? "recent" : "name")}
          className="text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          Sort: {sort === "name" ? "A–Z" : "Recently visited"}
        </button>
      </div>

      {isLoading ? (
        <SkeletonRows rows={8} />
      ) : list.length === 0 ? (
        <EmptyState icon={<Trees className="size-6" />} title="No parks here">
          {query ? "Nothing matches that search." : "Try a different filter."}
        </EmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {list.slice(0, limit).map((park) => (
            <li key={park.id}>
              <button
                type="button"
                onClick={() => onSelectPark(park)}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/50 active:bg-muted"
              >
                <span
                  className={cn("grid size-9 shrink-0 place-items-center rounded-full", park.completed ? "bg-ember-soft text-ember" : "bg-park-soft text-park")}
                  aria-label={park.completed ? "Visited" : "To visit"}
                >
                  <Trees className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[15px] font-medium">{park.name}</span>
                    {favouriteIds.has(park.id) && <Star className="size-3.5 shrink-0 fill-gold text-gold" aria-label="Favourite" />}
                  </span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {park.borough} · {park.siteType}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {limit < list.length && <div ref={sentinel} className="h-10" aria-hidden />}
    </ScreenFrame>
  );
}

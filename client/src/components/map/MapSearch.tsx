import { useMemo, useRef, useState, type ReactNode } from "react";
import { Search, X, CheckCircle2 } from "lucide-react";
import type { ParkResponse } from "@shared/routes";
import { cn } from "@/lib/utils";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Best matches for a search, ranked: name starts with it → a word starts with it → contains it → borough. */
export function searchParks(parks: ParkResponse[], query: string, limit = 8): ParkResponse[] {
  const q = norm(query.trim());
  if (q.length < 2) return [];
  const scored: { park: ParkResponse; score: number }[] = [];
  for (const park of parks) {
    const name = norm(park.name);
    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(` ${q}`)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (norm(park.borough).startsWith(q)) score = 3;
    if (score >= 0) scored.push({ park, score });
  }
  scored.sort((a, b) => a.score - b.score || a.park.name.length - b.park.name.length);
  return scored.slice(0, limit).map((s) => s.park);
}

interface MapSearchProps {
  parks: ParkResponse[];
  onSelect: (park: ParkResponse) => void;
  /** Shown at the start of the bar (e.g. the logo) */
  leading?: ReactNode;
  /** Shown at the end of the bar (e.g. the filter button) */
  trailing?: ReactNode;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
}

/** "Search parks" box with instant suggestions. Picking one flies the map to that park. */
export function MapSearch({ parks, onSelect, leading, trailing, className, inputClassName, placeholder = "Search parks" }: MapSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchParks(parks, query), [parks, query]);
  const showResults = open && query.trim().length >= 2;

  const pick = (park: ParkResponse) => {
    onSelect(park);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  return (
    <div className={cn("relative", className)}>
      <div className="flex h-full items-center gap-2">
        {leading}
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">Search parks</span>
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            placeholder={placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && results[active]) {
                pick(results[active]);
              } else if (e.key === "Escape") {
                setQuery("");
                inputRef.current?.blur();
              }
            }}
            className={cn(
              "h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden",
              inputClassName,
            )}
          />
        </label>
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        )}
        {trailing}
      </div>

      {showResults && (
        <div className="absolute inset-x-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-2xl bg-popover shadow-float animate-fade-up">
          {results.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted-foreground">No parks match “{query.trim()}”.</p>
          ) : (
            <ul role="listbox" className="max-h-[50vh] overflow-y-auto py-1.5">
              {results.map((park, i) => (
                <li key={park.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(park)}
                    onMouseEnter={() => setActive(i)}
                    className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left", i === active && "bg-muted")}
                  >
                    <span className={cn("size-2.5 shrink-0 rounded-full", park.completed ? "bg-ember" : "bg-park")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{park.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {park.borough} · {park.siteType}
                      </span>
                    </span>
                    {park.completed && <CheckCircle2 className="size-4 shrink-0 text-ember" aria-label="Visited" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

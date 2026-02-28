import { useState, useEffect, useRef } from "react";
import { X, Loader2, MapPin } from "lucide-react";
import type { LocationPoint } from "@/lib/route-utils";

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface LocationSearchProps {
  label: string;         // e.g. "Start from" | "End at"
  placeholder: string;   // e.g. "Home, pub, tube station…"
  value: LocationPoint | null;
  onChange: (point: LocationPoint | null) => void;
  accentColor: string;   // Tailwind text colour class, e.g. "text-green-600"
  dotColor: string;      // Tailwind bg colour class for the dot, e.g. "bg-green-500"
}

// Greater London bounding box for Nominatim
const LONDON_VIEWBOX = "-0.5105,51.2868,0.3340,51.6862";

export function LocationSearch({
  label,
  placeholder,
  value,
  onChange,
  accentColor,
  dotColor,
}: LocationSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch Nominatim suggestions with debounce
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    debounceTimer.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const url = new URL("https://nominatim.openstreetmap.org/search");
        url.searchParams.set("q", query);
        url.searchParams.set("format", "json");
        url.searchParams.set("limit", "5");
        url.searchParams.set("countrycodes", "gb");
        url.searchParams.set("viewbox", LONDON_VIEWBOX);
        url.searchParams.set("bounded", "1");
        url.searchParams.set("addressdetails", "1");

        const res = await fetch(url.toString(), {
          headers: { "Accept-Language": "en-GB" },
        });
        const data: NominatimResult[] = await res.json();
        setResults(data);
        setIsOpen(data.length > 0);
      } catch {
        setResults([]);
        setIsOpen(false);
      } finally {
        setIsLoading(false);
      }
    }, 300);
  }, [query]);

  function handleSelect(result: NominatimResult) {
    // Shorten display_name — take first two comma-separated parts
    const parts = result.display_name.split(",");
    const shortName = parts.slice(0, 2).join(",").trim();

    onChange({
      name: shortName,
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
    });
    setQuery("");
    setResults([]);
    setIsOpen(false);
  }

  function handleClear() {
    onChange(null);
    setQuery("");
    setResults([]);
    setIsOpen(false);
  }

  // Format display name for dropdown: bold first part, muted rest
  function splitDisplayName(name: string): [string, string] {
    const parts = name.split(",");
    const main = parts[0].trim();
    const rest = parts.slice(1, 3).join(",").trim();
    return [main, rest];
  }

  return (
    <div ref={containerRef} className="relative">
      <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${accentColor}`}>
        {label}
      </p>

      {/* Selected value display */}
      {value ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm">
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`} />
          <span className="flex-1 truncate text-foreground font-medium">{value.name}</span>
          <button
            onClick={handleClear}
            className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear location"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        /* Search input */
        <div className="relative">
          <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            className="w-full pl-8 pr-8 py-2 rounded-lg border border-border bg-muted/20 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/60"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setIsOpen(false)}
          />
          {isLoading && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin pointer-events-none" />
          )}
          {!isLoading && query.length > 0 && (
            <button
              onClick={() => { setQuery(""); setIsOpen(false); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Dropdown suggestions */}
      {isOpen && results.length > 0 && !value && (
        <ul className="absolute z-[1100] w-full mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
          {results.map((result) => {
            const [main, rest] = splitDisplayName(result.display_name);
            return (
              <li key={result.place_id}>
                <button
                  className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors flex flex-col gap-0.5"
                  onClick={() => handleSelect(result)}
                >
                  <span className="text-sm font-medium text-foreground truncate">{main}</span>
                  {rest && (
                    <span className="text-xs text-muted-foreground truncate">{rest}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

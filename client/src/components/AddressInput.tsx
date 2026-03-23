import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, MapPin, Home, Briefcase, Star, X } from "lucide-react";
import { useAddressAutocomplete } from "@/hooks/use-address-autocomplete";
import { useSavedPlaces } from "@/hooks/use-saved-places";
import type { SavedPlace } from "@/hooks/use-saved-places";

interface AddressInputProps {
  label: string;               // "A" or "B"
  placeholder: string;
  coord: [number, number] | null;
  pickMode: boolean;
  onCoordSet: (coord: [number, number], address: string) => void;
  onPickModeToggle: () => void;
}

const PLACE_ICONS: Record<string, React.ReactNode> = {
  home: <Home className="w-3 h-3" />,
  work: <Briefcase className="w-3 h-3" />,
};

export function AddressInput({
  label,
  placeholder,
  coord,
  pickMode,
  onCoordSet,
  onPickModeToggle,
}: AddressInputProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [lastAddress, setLastAddress] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { suggestions, loading } = useAddressAutocomplete(query, open && query.length >= 3);
  const { places, setHome, setWork, upsert, remove } = useSavedPlaces();

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowSaveMenu(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectSuggestion = useCallback((lat: number, lng: number, address: string) => {
    setQuery(address);
    setLastAddress(address);
    setOpen(false);
    onCoordSet([lat, lng], address);
  }, [onCoordSet]);

  const selectSavedPlace = useCallback((place: SavedPlace) => {
    setQuery(place.label);
    setLastAddress(place.address);
    setOpen(false);
    onCoordSet([place.lat, place.lng], place.address);
  }, [onCoordSet]);

  const handleSaveAs = (type: "home" | "work" | "custom") => {
    if (!coord) return;
    const address = lastAddress || query;
    if (type === "home") setHome(address, coord[0], coord[1]);
    else if (type === "work") setWork(address, coord[0], coord[1]);
    else {
      const name = window.prompt("Name this place:", query);
      if (!name) return;
      upsert({ id: crypto.randomUUID(), label: name, address, lat: coord[0], lng: coord[1] });
    }
    setShowSaveMenu(false);
  };

  // Saved places to show as quick-select chips (max 4)
  const savedChips = places.slice(0, 4);
  // Show dropdown if there are suggestions or saved places to browse
  const showDropdown = open && (loading || suggestions.length > 0 || (query.length < 3 && places.length > 0));

  return (
    <div ref={wrapperRef} className="relative">
      {/* Saved place chips */}
      {places.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {savedChips.map((place) => (
            <button
              key={place.id}
              onClick={() => selectSavedPlace(place)}
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-sky-500/20 transition-colors"
            >
              {PLACE_ICONS[place.id] ?? <Star className="w-3 h-3" />}
              {place.label}
            </button>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex gap-1">
        <div className="w-5 flex items-center justify-center flex-shrink-0">
          <span className="text-[10px] font-bold text-sky-500">{label}</span>
        </div>

        <div className="relative flex-1">
          <Input
            className="h-7 text-xs w-full pr-1"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setShowSaveMenu(false);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          />
          {/* Clear button */}
          {query && (
            <button
              className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => { setQuery(""); setOpen(false); }}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Map pick button */}
        <button
          title="Click map to set point"
          onClick={onPickModeToggle}
          className={`h-7 w-7 flex-shrink-0 flex items-center justify-center rounded border text-xs transition-colors ${
            pickMode
              ? "bg-sky-500 border-sky-500 text-white"
              : "border-border text-muted-foreground hover:border-sky-400 hover:text-sky-500"
          }`}
        >
          <MapPin className="w-3 h-3" />
        </button>

        {/* Save button — only when a coord is resolved */}
        {coord && (
          <div className="relative flex-shrink-0">
            <button
              title="Save this place"
              onClick={() => setShowSaveMenu((v) => !v)}
              className="h-7 w-7 flex items-center justify-center rounded border border-border text-muted-foreground hover:border-sky-400 hover:text-sky-500 transition-colors"
            >
              <Star className="w-3 h-3" />
            </button>
            {showSaveMenu && (
              <div className="absolute right-0 top-8 z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[120px]">
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center gap-2"
                  onClick={() => handleSaveAs("home")}>
                  <Home className="w-3 h-3" /> Save as Home
                </button>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center gap-2"
                  onClick={() => handleSaveAs("work")}>
                  <Briefcase className="w-3 h-3" /> Save as Work
                </button>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center gap-2"
                  onClick={() => handleSaveAs("custom")}>
                  <Star className="w-3 h-3" /> Save as…
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status line */}
      {coord && (
        <p className="text-[10px] text-sky-500 mt-0.5 pl-6">✓ set</p>
      )}

      {/* Autocomplete dropdown */}
      {showDropdown && (
        <div className="absolute left-5 right-0 top-full mt-0.5 z-50 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
          {/* Saved places section (when query is short) */}
          {query.length < 3 && places.length > 0 && (
            <div>
              <p className="px-2 pt-1.5 pb-0.5 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                Saved places
              </p>
              {places.map((place) => (
                <button
                  key={place.id}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center gap-2 group"
                  onClick={() => selectSavedPlace(place)}
                >
                  <span className="text-sky-500 flex-shrink-0">
                    {PLACE_ICONS[place.id] ?? <Star className="w-3 h-3" />}
                  </span>
                  <span className="flex-1 font-medium">{place.label}</span>
                  <span className="text-muted-foreground truncate text-[10px] max-w-[100px]">{place.address}</span>
                  <button
                    className="opacity-0 group-hover:opacity-100 ml-1 text-muted-foreground hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); remove(place.id); }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </button>
              ))}
              {suggestions.length > 0 && <div className="border-t border-border my-0.5" />}
            </div>
          )}

          {/* Nominatim suggestions */}
          {loading && (
            <div className="px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> Searching…
            </div>
          )}
          {!loading && suggestions.map((s, i) => (
            <button
              key={i}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex flex-col"
              onClick={() => selectSuggestion(s.lat, s.lng, s.shortName)}
            >
              <span className="font-medium leading-tight">{s.shortName}</span>
              <span className="text-muted-foreground text-[10px] truncate">{s.displayName}</span>
            </button>
          ))}
          {!loading && query.length >= 3 && suggestions.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">No results</div>
          )}
        </div>
      )}
    </div>
  );
}

import { useState, useMemo } from "react";
import type { ParkResponse } from "@shared/routes";

interface DataReviewPanelProps {
  parks: ParkResponse[];
  onFlyTo: (lat: number, lng: number) => void;
  onClose: () => void;
}

const ACCESS_ORDER = ["No", "Occasionally", "By appointment only", "Partially", "to check", "To check"];

export function DataReviewPanel({ parks, onFlyTo, onClose }: DataReviewPanelProps) {
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [focusedId, setFocusedId] = useState<number | null>(null);

  // Only show parks that aren't fully public
  const suspectParks = useMemo(() =>
    parks.filter(p => p.accessCategory !== "Public"),
    [parks]
  );

  const siteTypes = useMemo(() => {
    const types = [...new Set(suspectParks.map(p => p.siteType))].sort();
    return types;
  }, [suspectParks]);

  const filtered = useMemo(() => {
    return suspectParks
      .filter(p => selectedType === "all" || p.siteType === selectedType)
      .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.borough.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.siteType.localeCompare(b.siteType) || a.name.localeCompare(b.name));
  }, [suspectParks, selectedType, search]);

  function handleClick(park: ParkResponse) {
    setFocusedId(park.id);
    if (park.latitude && park.longitude) {
      onFlyTo(park.latitude, park.longitude);
    }
  }

  const accessColour = (access: string) => {
    if (access === "No") return "text-red-600 bg-red-50";
    if (access === "Occasionally") return "text-orange-600 bg-orange-50";
    return "text-yellow-700 bg-yellow-50";
  };

  return (
    <div className="absolute top-0 right-0 h-full w-80 bg-white border-l border-border shadow-xl z-[1500] flex flex-col">
      {/* Header */}
      <div className="bg-orange-50 border-b border-orange-200 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div>
          <p className="text-sm font-bold text-orange-800">🔍 Data Review</p>
          <p className="text-xs text-orange-600">{suspectParks.length} suspect parks</p>
        </div>
        <button onClick={onClose} className="text-orange-600 hover:text-orange-900 text-lg font-bold px-1">✕</button>
      </div>

      {/* Filters */}
      <div className="px-3 py-2 border-b border-border space-y-2 flex-shrink-0">
        <input
          type="text"
          placeholder="Search name or borough…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full text-xs border border-border rounded px-2 py-1.5 outline-none focus:border-primary"
        />
        <select
          value={selectedType}
          onChange={e => setSelectedType(e.target.value)}
          className="w-full text-xs border border-border rounded px-2 py-1.5 outline-none bg-white"
        >
          <option value="all">All types ({suspectParks.length})</option>
          {siteTypes.map(t => {
            const count = suspectParks.filter(p => p.siteType === t).length;
            return <option key={t} value={t}>{t} ({count})</option>;
          })}
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">No parks match</p>
        )}
        {filtered.map(park => (
          <button
            key={park.id}
            onClick={() => handleClick(park)}
            className={`w-full text-left px-3 py-2.5 border-b border-border/50 hover:bg-muted/30 transition-colors ${
              focusedId === park.id ? "bg-orange-50 border-l-2 border-l-orange-400" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">{park.name}</p>
                <p className="text-[10px] text-muted-foreground">{park.borough}</p>
                <p className="text-[10px] text-muted-foreground italic">{park.siteType}</p>
              </div>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0 ${accessColour(park.openToPublic ?? "")}`}>
                {park.openToPublic}
              </span>
            </div>
            {!park.latitude && !park.longitude && (
              <p className="text-[10px] text-muted-foreground mt-0.5">⚠ No coordinates</p>
            )}
          </button>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-border flex-shrink-0 bg-muted/20">
        <p className="text-[10px] text-muted-foreground text-center">
          Click a park to fly to it on the map
        </p>
      </div>
    </div>
  );
}

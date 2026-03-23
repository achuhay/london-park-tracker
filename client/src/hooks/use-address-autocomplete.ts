import { useState, useEffect, useRef } from "react";

export interface AddressSuggestion {
  displayName: string;
  shortName: string;
  lat: number;
  lng: number;
}

/**
 * Debounced Nominatim autocomplete — free, no API key.
 * Returns up to 5 suggestions for the given query string.
 */
export function useAddressAutocomplete(query: string, enabled = true) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || query.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    // Debounce: wait 350 ms after the user stops typing
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      // Cancel any in-flight request
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();

      setLoading(true);
      try {
        const url =
          `https://nominatim.openstreetmap.org/search` +
          `?q=${encodeURIComponent(query)}` +
          `&countrycodes=gb` +
          `&limit=5` +
          `&format=json` +
          `&addressdetails=1`;

        const res = await fetch(url, {
          signal: abortRef.current.signal,
          headers: {
            "Accept-Language": "en",
            "User-Agent": "ParkRunLDN/1.0 (parkrun.ldn)",
          },
        });

        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();

        const mapped: AddressSuggestion[] = (data as any[]).map((item) => {
          // Build a short readable name: road + town, or just the display_name truncated
          const addr = item.address || {};
          const parts = [
            addr.road || addr.pedestrian || addr.path,
            addr.suburb || addr.neighbourhood || addr.quarter,
            addr.city || addr.town || addr.village || addr.county,
          ].filter(Boolean);

          const shortName =
            parts.length > 0
              ? parts.slice(0, 2).join(", ")
              : (item.display_name as string).split(",").slice(0, 2).join(",").trim();

          return {
            displayName: item.display_name as string,
            shortName,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
          };
        });

        setSuggestions(mapped);
      } catch (err: any) {
        if (err.name !== "AbortError") setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, enabled]);

  return { suggestions, loading };
}

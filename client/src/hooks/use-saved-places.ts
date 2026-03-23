import { useState, useCallback } from "react";

export interface SavedPlace {
  id: string;          // "home" | "work" | uuid
  label: string;       // "Home", "Work", user-defined name
  address: string;     // original typed address
  lat: number;
  lng: number;
}

const STORAGE_KEY = "parkrun_saved_places";

function load(): SavedPlace[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedPlace[]) : [];
  } catch {
    return [];
  }
}

function save(places: SavedPlace[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
  } catch {
    // ignore quota errors
  }
}

export function useSavedPlaces() {
  const [places, setPlaces] = useState<SavedPlace[]>(load);

  const upsert = useCallback((place: SavedPlace) => {
    setPlaces((prev) => {
      const next = prev.some((p) => p.id === place.id)
        ? prev.map((p) => (p.id === place.id ? place : p))
        : [...prev, place];
      save(next);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setPlaces((prev) => {
      const next = prev.filter((p) => p.id !== id);
      save(next);
      return next;
    });
  }, []);

  /** Save or overwrite Home */
  const setHome = useCallback((address: string, lat: number, lng: number) => {
    upsert({ id: "home", label: "Home", address, lat, lng });
  }, [upsert]);

  /** Save or overwrite Work */
  const setWork = useCallback((address: string, lat: number, lng: number) => {
    upsert({ id: "work", label: "Work", address, lat, lng });
  }, [upsert]);

  return { places, upsert, remove, setHome, setWork };
}

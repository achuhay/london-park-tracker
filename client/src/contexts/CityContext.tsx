import { createContext, useContext, type ReactNode } from "react";
import { useLocation } from "wouter";
import { CITIES, type CityConfig, type CitySlug } from "@shared/cities";

interface CityContextValue {
  city: CitySlug;
  cityConfig: CityConfig;
}

const CityContext = createContext<CityContextValue | null>(null);

// Derive the active city from the URL — /edinburgh(/*) is Edinburgh, everything else defaults to London.
function cityFromPath(path: string): CitySlug {
  return path.startsWith("/edinburgh") ? "edinburgh" : "london";
}

export function CityProvider({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const city = cityFromPath(location);
  const cityConfig = CITIES[city];

  return (
    <CityContext.Provider value={{ city, cityConfig }}>
      {children}
    </CityContext.Provider>
  );
}

export function useCity(): CityContextValue {
  const ctx = useContext(CityContext);
  if (!ctx) throw new Error("useCity must be used within a CityProvider");
  return ctx;
}

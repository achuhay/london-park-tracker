import { useQuery } from "@tanstack/react-query";
import type { GamificationResponse } from "@shared/gamification";
import { useCity } from "@/contexts/CityContext";

export function useGamification() {
  const { city } = useCity();
  return useQuery<GamificationResponse>({
    queryKey: ["/api/gamification", city],
    queryFn: async () => {
      const res = await fetch(`/api/gamification?city=${city}`);
      if (res.status === 401) return null as any;
      if (!res.ok) throw new Error("Failed to fetch gamification data");
      return res.json();
    },
    staleTime: 30_000,
    retry: false,
  });
}

import { useQuery } from "@tanstack/react-query";
import type { GamificationResponse } from "@shared/gamification";

export function useGamification() {
  return useQuery<GamificationResponse>({
    queryKey: ["/api/gamification"],
    queryFn: async () => {
      const res = await fetch("/api/gamification");
      if (res.status === 401) return null as any;
      if (!res.ok) throw new Error("Failed to fetch gamification data");
      return res.json();
    },
    staleTime: 30_000,
    retry: false,
  });
}

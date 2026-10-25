import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";

/** Parks you rate this many stars or more count as favourites. */
export const FAVOURITE_MIN_STARS = 4;

type RatingRow = { parkId: number; rating: number };
const RATINGS_KEY = ["/api/park-ratings"];

/** Your park ratings as a map of parkId → 1–5 stars (empty when logged out). */
export function useParkRatings() {
  const { data } = useQuery<RatingRow[] | null>({
    queryKey: RATINGS_KEY,
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  return useMemo(() => new Map((data ?? []).map((r) => [r.parkId, r.rating])), [data]);
}

/** Save a 1–5 star rating for a park, or null to clear it. Updates the stars straight away. */
export function useRatePark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ parkId, rating }: { parkId: number; rating: number | null }) => {
      const res = await apiRequest("PUT", `/api/park-ratings/${parkId}`, { rating });
      return res.json();
    },
    onMutate: async ({ parkId, rating }) => {
      await queryClient.cancelQueries({ queryKey: RATINGS_KEY });
      const previous = queryClient.getQueryData<RatingRow[] | null>(RATINGS_KEY);
      const others = (previous ?? []).filter((r) => r.parkId !== parkId);
      queryClient.setQueryData<RatingRow[]>(RATINGS_KEY, rating === null ? others : [...others, { parkId, rating }]);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(RATINGS_KEY, context?.previous ?? null);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: RATINGS_KEY }),
  });
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { StravaActivity, ParkVisit } from "@shared/schema";

interface StoredActivity extends StravaActivity {
  decodedPolyline?: [number, number][];
}

interface ParkVisitWithActivity {
  id: number;
  visitDate: string;
  activityId: number | null;
  activityName: string | null;
  distance: number | null;
}

export function useStravaStatus() {
  return useQuery<{ connected: boolean; configured: boolean }>({
    queryKey: ["/api/strava/status"],
  });
}

export function useStoredActivities() {
  return useQuery<StoredActivity[]>({
    queryKey: ["/api/strava/stored-activities"],
  });
}

export function useStravaActivities() {
  return useQuery<any[]>({
    queryKey: ["/api/strava/activities"],
  });
}

export function useParkVisits(parkId: number) {
  return useQuery<ParkVisitWithActivity[]>({
    queryKey: ["/api/parks", parkId, "visits"],
    queryFn: async () => {
      const res = await fetch(`/api/parks/${parkId}/visits`);
      if (!res.ok) throw new Error("Failed to fetch visits");
      return res.json();
    },
    enabled: parkId > 0,
  });
}

export function useSyncActivity() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (activityId: string) => {
      return apiRequest("POST", `/api/strava/sync/${activityId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strava/stored-activities"] });
    },
  });
}

export function useSyncAllActivities() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/strava/sync-all");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strava/stored-activities"] });
    },
  });
}

export function useDisconnectStrava() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/strava/disconnect");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strava/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strava/activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strava/stored-activities"] });
    },
  });
}

export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;

  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}

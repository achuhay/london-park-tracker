import { useState, useCallback } from "react";
import { fetchOrsRoute, OrsError, type OrsRoute } from "@/lib/ors";

export type OrsRouteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; route: OrsRoute }
  | { status: "error"; message: string };

export function useOrsRoute() {
  const [state, setState] = useState<OrsRouteState>({ status: "idle" });

  const calculate = useCallback(async (waypoints: [number, number][]) => {
    setState({ status: "loading" });
    try {
      const route = await fetchOrsRoute(waypoints);
      setState({ status: "success", route });
    } catch (err) {
      const message =
        err instanceof OrsError
          ? err.message
          : "Failed to calculate route. Please try again.";
      setState({ status: "error", message });
    }
  }, []);

  const clear = useCallback(() => setState({ status: "idle" }), []);

  return { state, calculate, clear };
}

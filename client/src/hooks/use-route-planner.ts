/**
 * All of the route planner's state and actions in one place, so the page only needs:
 *   const planner = useRoutePlanner(allParks);
 *   <RoutePlannerLayer planner={planner} />   (inside the map)
 *   <RoutePlannerShell planner={planner} allParks={allParks} />   (the panel / bottom sheet)
 *
 * Every change to the plan is snapped to real paths by the server (debounced, so dragging
 * doesn't fire dozens of requests), and every change can be undone.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParkResponse } from "@shared/routes";
import type { LocationPoint } from "@/lib/route-utils";
import {
  EMPTY_PLAN, applyAdjustments, autoOrderPlan, bestInsertIndex, canRoute, fetchPlan, newStopId,
  orderedStops, parkStop, planRequestBody, pointStop, stopsIndexAfterWaypoint, straightKm, suggestLoop,
  type LatLng, type PlanResult, type PlanState, type PlanStop, type RouteMode,
} from "@/lib/route-planner";

const PLAN_KEY = "routePlanner.plan.v2";
/** Most parks auto-plan picks in one go (a route can hold 100 stops). */
export const MAX_AUTO_PARKS = 70;

export interface PlannerNotice { message: string; kind: "error" | "info" }
const PREVIEW_KEY = "routePreviewBeforeAdd"; // same key the old planner used, so the setting carries over

function loadPlan(): PlanState {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAN_KEY) || "null");
    if (saved && Array.isArray(saved.stops)) return { ...EMPTY_PLAN, ...saved };
  } catch { /* storage unavailable or corrupt */ }
  return EMPTY_PLAN;
}

const keyOf = (plan: PlanState) => (canRoute(plan) ? JSON.stringify(planRequestBody(plan)) : null);

export function useRoutePlanner(allParks: ParkResponse[]) {
  const [isPlanning, setIsPlanning] = useState(false);
  const [plan, setPlanState] = useState<PlanState>(loadPlan);
  const planRef = useRef(plan);
  const history = useRef<PlanState[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const [result, setResult] = useState<PlanResult | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoPlanning, setAutoPlanning] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);
  const cache = useRef(new Map<string, PlanResult>());

  const [previewBeforeAdd, setPreviewBeforeAddState] = useState<boolean>(() => {
    try { return localStorage.getItem(PREVIEW_KEY) === "true"; } catch { return false; }
  });
  const setPreviewBeforeAdd = useCallback((value: boolean) => {
    setPreviewBeforeAddState(value);
    try { localStorage.setItem(PREVIEW_KEY, String(value)); } catch { /* storage unavailable */ }
  }, []);

  /** Replace the plan without adding an undo step (used for the server's automatic fixes). */
  const replacePlan = useCallback((next: PlanState) => {
    planRef.current = next;
    setPlanState(next);
  }, []);

  /** Change the plan as one undoable step. */
  const commit = useCallback((update: (prev: PlanState) => PlanState) => {
    const prev = planRef.current;
    const next = update(prev);
    if (next === prev) return;
    history.current.push(prev);
    if (history.current.length > 60) history.current.shift();
    setCanUndo(true);
    replacePlan(next);
  }, [replacePlan]);

  useEffect(() => {
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(plan)); } catch { /* storage unavailable */ }
  }, [plan]);

  // ── Snap to paths whenever the plan changes ──
  const key = useMemo(() => keyOf(plan), [plan]);

  const acceptResult = useCallback((r: PlanResult, forKey: string) => {
    let shownKey = forKey;
    const adjusted = applyAdjustments(planRef.current, r);
    if (adjusted !== planRef.current) {
      // The server moved some park stops onto paths inside the park — show them there. The route
      // for the new positions is the one we already have, so remember it and skip a second request.
      shownKey = keyOf(adjusted)!;
      cache.current.set(shownKey, { ...r, adjustedStops: r.adjustedStops.map(() => null) });
      replacePlan(adjusted);
    }
    setResult(r);
    setResultKey(shownKey);
    setError(null);
  }, [replacePlan]);

  useEffect(() => {
    if (!isPlanning) return;
    if (!key) { setResult(null); setResultKey(null); setError(null); return; }
    const cached = cache.current.get(key);
    if (cached) { acceptResult(cached, key); return; }
    setError(null);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetchPlan(planRef.current, ctrl.signal);
        cache.current.set(key, r);
        if (cache.current.size > 200) cache.current.delete(cache.current.keys().next().value!);
        if (!ctrl.signal.aborted) acceptResult(r, key);
      } catch (e) {
        if (!ctrl.signal.aborted) setError((e as Error).message);
      }
    }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [key, isPlanning, acceptResult]);

  const isRouting = isPlanning && key !== null && key !== resultKey && !error;

  // ── Lookups ──
  const parksById = useMemo(() => new Map(allParks.map((p) => [p.id, p])), [allParks]);
  const parkIds = useMemo(() => new Set(plan.stops.filter((s) => s.parkId != null).map((s) => s.parkId!)), [plan.stops]);
  /** Will each planned park count? Only from a result that matches the current plan. */
  const parkStatus = useMemo(
    () => new Map((result && resultKey === key ? result.parks : []).map((p) => [p.parkId, p])),
    [result, resultKey, key],
  );

  // ── Actions ──
  const addPark = useCallback((park: ParkResponse) => {
    commit((prev) => {
      if (prev.stops.some((s) => s.parkId === park.id)) return prev;
      const stop = parkStop(park);
      if (!stop) return prev;
      const at = bestInsertIndex(prev, [stop.lat, stop.lng]);
      return { ...prev, stops: [...prev.stops.slice(0, at), stop, ...prev.stops.slice(at)] };
    });
    setIsPlanning(true);
  }, [commit]);

  const togglePark = useCallback((park: ParkResponse) => {
    if (planRef.current.stops.some((s) => s.parkId === park.id)) {
      commit((prev) => ({ ...prev, stops: prev.stops.filter((s) => s.parkId !== park.id) }));
    } else {
      addPark(park);
    }
  }, [commit, addPark]);

  const removeStop = useCallback((id: string) => {
    commit((prev) => {
      if (prev.start?.id === id) return { ...prev, start: null };
      if (prev.end?.id === id) return { ...prev, end: null };
      return { ...prev, stops: prev.stops.filter((s) => s.id !== id) };
    });
  }, [commit]);

  const setStart = useCallback((p: LocationPoint | null) => {
    commit((prev) => ({ ...prev, start: p ? pointStop("start", p) : null }));
  }, [commit]);

  const setEnd = useCallback((p: LocationPoint | null) => {
    commit((prev) => ({ ...prev, end: p ? pointStop("end", p) : null, mode: p ? "oneway" : prev.mode }));
  }, [commit]);

  const setMode = useCallback((mode: RouteMode) => {
    commit((prev) => (prev.mode === mode ? prev : { ...prev, mode }));
  }, [commit]);

  /** A point was dragged on the map. Pinned, so the server leaves it where the user put it. */
  const moveStop = useCallback((id: string, lat: number, lng: number) => {
    const move = (s: PlanStop | null) => (s && s.id === id ? { ...s, lat, lng, pinned: true } : s);
    commit((prev) => ({ ...prev, start: move(prev.start), end: move(prev.end), stops: prev.stops.map((s) => move(s)!) }));
  }, [commit]);

  /** The route line was dragged or tapped: add a shaping point on that stretch (leg) of the route. */
  const insertVia = useCallback((afterWaypoint: number, lat: number, lng: number) => {
    commit((prev) => {
      const at = stopsIndexAfterWaypoint(prev, afterWaypoint);
      const via: PlanStop = { id: newStopId("via"), kind: "via", lat, lng, name: "Shaping point", pinned: true };
      return { ...prev, stops: [...prev.stops.slice(0, at), via, ...prev.stops.slice(at)] };
    });
  }, [commit]);

  /** "Add point here" from tapping the map: slot it in where it adds least distance. */
  const addVia = useCallback((lat: number, lng: number) => {
    commit((prev) => {
      const at = bestInsertIndex(prev, [lat, lng]);
      const via: PlanStop = { id: newStopId("via"), kind: "via", lat, lng, name: "Shaping point", pinned: true };
      return { ...prev, stops: [...prev.stops.slice(0, at), via, ...prev.stops.slice(at)] };
    });
  }, [commit]);

  const moveInList = useCallback((from: number, to: number) => {
    commit((prev) => {
      if (to < 0 || to >= prev.stops.length || from === to) return prev;
      const stops = [...prev.stops];
      const [s] = stops.splice(from, 1);
      stops.splice(to, 0, s);
      return { ...prev, stops };
    });
  }, [commit]);

  const autoOrder = useCallback(() => commit(autoOrderPlan), [commit]);

  const clear = useCallback(() => {
    commit((prev) => (prev.start || prev.stops.length || prev.end ? { ...EMPTY_PLAN, mode: prev.mode, start: prev.start } : prev));
  }, [commit]);

  const undo = useCallback(() => {
    const prev = history.current.pop();
    setCanUndo(history.current.length > 0);
    if (prev) replacePlan(prev);
  }, [replacePlan]);

  /**
   * Suggest a loop of about `targetKm` from the start that collects the most parks you haven't
   * done yet. Plans once with a typical detour factor, then once more using the real one.
   */
  const autoPlan = useCallback(async (targetKm: number): Promise<PlannerNotice | null> => {
    const base = planRef.current;
    if (!base.start) return { kind: "error", message: "Set a start point first." };
    const start: LatLng = [base.start.lat, base.start.lng];
    const candidates = allParks.filter((p) => !p.completed);
    setAutoPlanning(true);
    setError(null);
    try {
      let detour = 1.3;
      let best: { plan: PlanState; r: PlanResult } | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const picked = suggestLoop(start, targetKm, candidates, detour, MAX_AUTO_PARKS);
        if (picked.length === 0) return { kind: "error", message: "No new parks within reach — try a longer distance." };
        const candidate: PlanState = {
          ...base, mode: "loop", end: null,
          stops: picked.map(parkStop).filter((s): s is PlanStop => s !== null),
        };
        const r = await fetchPlan(candidate);
        const miss = (x: PlanResult) => Math.abs(x.distanceKm - targetKm) + (x.distanceKm > targetKm * 1.1 ? targetKm : 0);
        if (!best || miss(r) < miss(best.r)) best = { plan: candidate, r };
        if (Math.abs(r.distanceKm - targetKm) / targetKm <= 0.1) break;
        detour = Math.min(2, Math.max(1.1, r.distanceKm / straightKm(orderedStops(candidate), true)));
      }
      const chosen = best!;
      cache.current.set(keyOf(chosen.plan)!, chosen.r);
      commit(() => chosen.plan);
      setFitSignal((n) => n + 1);
      // Dense areas (like the City) hit the park limit long before the distance
      if (chosen.plan.stops.length >= MAX_AUTO_PARKS && chosen.r.distanceKm < targetKm * 0.8) {
        return {
          kind: "info",
          message: `That's the most parks it picks in one go (${MAX_AUTO_PARKS}), so the loop is ${chosen.r.distanceKm.toFixed(1)} km rather than ${targetKm} km. Add more by tapping parks.`,
        };
      }
      return null;
    } catch (e) {
      return { kind: "error", message: (e as Error).message };
    } finally {
      setAutoPlanning(false);
    }
  }, [allParks, commit]);

  return {
    isPlanning,
    open: useCallback(() => setIsPlanning(true), []),
    close: useCallback(() => setIsPlanning(false), []),
    toggle: useCallback(() => setIsPlanning((v) => !v), []),

    plan,
    ordered: useMemo(() => orderedStops(plan), [plan]),
    result,
    /** The route on screen is from before the latest change (a new one is on its way). */
    isStale: result !== null && resultKey !== key,
    isRouting,
    autoPlanning,
    error,
    fitSignal,
    requestFit: useCallback(() => setFitSignal((n) => n + 1), []),

    parksById,
    parkStatus,
    parkCount: parkIds.size,
    hasPark: useCallback((id: number) => parkIds.has(id), [parkIds]),

    /** Tapping a park on the map adds it straight away (true) or shows its info first (false). */
    addsOnClick: !previewBeforeAdd,
    previewBeforeAdd,
    setPreviewBeforeAdd,

    togglePark, addPark, removeStop, setStart, setEnd, setMode, moveStop, insertVia, addVia,
    moveInList, autoOrder, clear, undo, canUndo, autoPlan,
  };
}

export type RoutePlanner = ReturnType<typeof useRoutePlanner>;

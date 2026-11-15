import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 767px)";
const mql = typeof window !== "undefined" ? window.matchMedia(QUERY) : null;

/**
 * True on phone-sized screens (under 768px wide). Unlike hooks/use-mobile, this knows the answer
 * on the very first render, so phones never flash the desktop layout.
 */
export function useIsPhone() {
  return useSyncExternalStore(
    (cb) => {
      mql?.addEventListener("change", cb);
      return () => mql?.removeEventListener("change", cb);
    },
    () => !!mql?.matches,
    () => false,
  );
}

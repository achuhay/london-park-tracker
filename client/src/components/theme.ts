import { useSyncExternalStore } from "react";

/**
 * Light / dark mode.
 *
 * "system" (the default) follows the phone or computer setting. The choice is remembered on this
 * device. The script in index.html applies it before the page paints so there's no flash.
 */
export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "detour-theme";
const listeners = new Set<() => void>();
const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function readChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

let choice: ThemeChoice = typeof window !== "undefined" ? readChoice() : "system";

function isDark(): boolean {
  return choice === "dark" || (choice === "system" && !!media?.matches);
}

function apply() {
  const dark = isDark();
  document.documentElement.classList.toggle("dark", dark);
  listeners.forEach((l) => l());
}

media?.addEventListener("change", () => {
  if (choice === "system") apply();
});

export function setThemeChoice(next: ThemeChoice) {
  choice = next;
  try {
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage unavailable — the choice still applies until the page is closed */
  }
  apply();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The current theme choice and whether the app is showing dark right now. */
export function useTheme() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  const current = useSyncExternalStore(subscribe, () => choice, () => "system" as ThemeChoice);
  return { choice: current, dark, setChoice: setThemeChoice };
}

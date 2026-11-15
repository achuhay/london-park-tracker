import { Map as MapIcon, List, Route as RouteIcon, Activity, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

export type MobileTab = "map" | "parks" | "runs" | "progress";

interface MobileBottomNavProps {
  activeTab: MobileTab;
  onChange: (tab: MobileTab) => void;
  /** The raised button in the middle: opens the route planner */
  onPlan: () => void;
  planning?: boolean;
  /** Parks currently in the route, shown as a badge */
  planCount?: number;
}

const LEFT: { id: MobileTab; label: string; icon: typeof MapIcon }[] = [
  { id: "map", label: "Map", icon: MapIcon },
  { id: "parks", label: "Parks", icon: List },
];
const RIGHT: { id: MobileTab; label: string; icon: typeof MapIcon }[] = [
  { id: "runs", label: "Runs", icon: Activity },
  { id: "progress", label: "Progress", icon: Trophy },
];

/** Phone tab bar. Sits above the iPhone home indicator (safe-area padding). */
export function MobileBottomNav({ activeTab, onChange, onPlan, planning, planCount = 0 }: MobileBottomNavProps) {
  const Tab = ({ id, label, icon: Icon }: (typeof LEFT)[number]) => {
    const on = activeTab === id && !planning;
    return (
      <button
        type="button"
        onClick={() => onChange(id)}
        aria-current={on ? "page" : undefined}
        className={cn(
          "flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors",
          on ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <Icon className="size-[22px]" strokeWidth={on ? 2.4 : 2} />
        {label}
      </button>
    );
  };

  return (
    <nav
      aria-label="Main"
      className="glass fixed inset-x-0 bottom-0 z-30 border-t md:hidden"
      style={{ paddingBottom: "var(--safe-bottom)", paddingLeft: "var(--safe-left)", paddingRight: "var(--safe-right)" }}
    >
      <div className="grid h-tabbar grid-cols-5">
        {LEFT.map((t) => (
          <Tab key={t.id} {...t} />
        ))}
        <button type="button" onClick={onPlan} aria-pressed={planning} className="flex flex-col items-center justify-center gap-1 text-[11px] font-semibold text-foreground">
          <span
            className={cn(
              "relative -mt-5 grid size-12 place-items-center rounded-2xl text-primary-foreground shadow-[0_10px_20px_-10px_hsl(var(--ember)/0.9)] transition-transform active:scale-95",
              planning ? "bg-foreground text-background" : "bg-primary",
            )}
          >
            <RouteIcon className="size-[22px]" />
            {planCount > 0 && (
              <span className="num absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full border-2 border-background bg-foreground px-1 text-[10px] font-bold text-background">
                {planCount}
              </span>
            )}
          </span>
          Plan
        </button>
        {RIGHT.map((t) => (
          <Tab key={t.id} {...t} />
        ))}
      </div>
    </nav>
  );
}

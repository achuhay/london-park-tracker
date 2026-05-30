import { Map, List, BarChart2, Medal } from "lucide-react";

export type MobileTab = "map" | "list" | "stats" | "achievements";

interface MobileBottomNavProps {
  activeTab: MobileTab;
  onChange: (tab: MobileTab) => void;
}

const TABS: { id: MobileTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "map",          label: "Map",    icon: Map     },
  { id: "list",         label: "Parks",  icon: List    },
  { id: "stats",        label: "Stats",  icon: BarChart2 },
  { id: "achievements", label: "Badges", icon: Medal   },
];

export function MobileBottomNav({ activeTab, onChange }: MobileBottomNavProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-[2000] bg-[#F5EDD9] border-t border-[#e8dfc8] md:hidden">
      <div className="flex">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-0.5 transition-colors ${
              activeTab === id ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className={`text-[10px] ${activeTab === id ? "font-bold" : "font-semibold"}`}>
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

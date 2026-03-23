import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export interface EllipseState {
  a: [number, number] | null;
  b: [number, number] | null;
  /** 0.05 = 5% extra distance — very tight ellipse by default */
  detourFactor: number;
  /** When true, clicking a park inside the zone adds directly to basket */
  basketMode: boolean;
  pickMode: "A" | "B" | null;
  active: boolean;
}

interface EllipsePlannerPanelProps {
  ellipse: EllipseState;
  parkCount: number;
  onEllipseChange: (update: Partial<EllipseState>) => void;
  onClose: () => void;
}

/**
 * Collapsible options panel — only the slider and basket-mode toggle.
 * A/B address inputs live permanently in the RouteBasket header.
 */
export function EllipsePlannerPanel({
  ellipse,
  onEllipseChange,
}: EllipsePlannerPanelProps) {
  const pct = Math.round(ellipse.detourFactor * 100);

  return (
    <div className="pt-2 space-y-3">
      {/* Detour width slider: 0–20% */}
      <div>
        <Label className="text-[10px] font-medium text-muted-foreground mb-1.5 block">
          Detour width —{" "}
          <span className="text-foreground font-semibold">+{pct}%</span>
        </Label>
        <Slider
          min={0}
          max={20}
          step={1}
          value={[pct]}
          onValueChange={([v]) => onEllipseChange({ detourFactor: v / 100 })}
          className="w-full"
        />
        <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
          <span>tight</span>
          <span>+20%</span>
        </div>
      </div>

      {/* One-click basket mode */}
      <div className="flex items-center gap-2">
        <Switch
          id="basket-mode"
          checked={ellipse.basketMode}
          onCheckedChange={(v) => onEllipseChange({ basketMode: v })}
          className="data-[state=checked]:bg-sky-500 h-4 w-7"
        />
        <Label htmlFor="basket-mode" className="text-[10px] text-muted-foreground cursor-pointer">
          One-click basket — skip popup
        </Label>
      </div>
    </div>
  );
}

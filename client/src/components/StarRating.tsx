import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  /** Current rating, 1–5, or null when unrated */
  value: number | null;
  /** Called with the new rating; tapping the current rating again clears it (null) */
  onChange: (rating: number | null) => void;
  size?: "sm" | "md";
  label?: string;
}

export function StarRating({ value, onChange, size = "md", label = "Your rating" }: StarRatingProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = hovered ?? value ?? 0;
  // Stars stay small, but each one has a finger-sized tap area around it
  const iconSize = size === "sm" ? "size-[18px]" : "size-[22px]";
  const hit = size === "sm" ? "size-8" : "size-9";

  return (
    <div className="flex items-center -mx-1" role="radiogroup" aria-label={label} onMouseLeave={() => setHovered(null)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          title={value === n ? "Tap again to clear" : `${n} star${n > 1 ? "s" : ""}`}
          onClick={(e) => {
            e.stopPropagation(); // don't let the map treat this as a click on the park
            onChange(value === n ? null : n);
          }}
          onMouseEnter={() => setHovered(n)}
          className={cn("grid place-items-center rounded-full transition-transform active:scale-90", hit)}
        >
          <Star className={cn(iconSize, "transition-colors", n <= shown ? "fill-gold text-gold" : "text-muted-foreground/40")} />
        </button>
      ))}
    </div>
  );
}

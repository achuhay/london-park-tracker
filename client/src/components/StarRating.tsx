import { useState } from "react";
import { Star } from "lucide-react";

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
  const iconSize = size === "sm" ? "w-4 h-4" : "w-5 h-5";

  return (
    <div className="flex items-center gap-0.5" role="radiogroup" aria-label={label} onMouseLeave={() => setHovered(null)}>
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
          className="p-0.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
        >
          <Star className={`${iconSize} transition-colors ${n <= shown ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`} />
        </button>
      ))}
    </div>
  );
}

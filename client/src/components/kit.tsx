/**
 * Small building blocks shared by the redesigned screens.
 * Everything here takes its colours from the theme tokens in index.css, so it works in light and dark.
 */
import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { decodePolyline } from "@/hooks/use-strava";

/** The Detour wordmark. Drawn in the current text colour, so it works on any background. */
export function DetourLogo({ className, title = "Detour" }: { className?: string; title?: string }) {
  return (
    <span
      role="img"
      aria-label={title}
      className={cn("inline-block aspect-[2.507] bg-current", className)}
      style={{
        WebkitMaskImage: "url(/detour-logo-white.svg)",
        maskImage: "url(/detour-logo-white.svg)",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}

/** Circular progress, e.g. "10% of London". */
export function ProgressRing({
  value,
  size = 64,
  stroke = 7,
  className,
  children,
}: {
  value: number; // 0–100
  size?: number;
  stroke?: number;
  className?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  // Always show a sliver so 0.3% doesn't look like nothing
  const dash = pct > 0 ? Math.max(circ * (pct / 100), stroke * 0.9) : 0;
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(var(--ember))"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.32,0.72,0,1)" }}
        />
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center">{children}</div>}
    </div>
  );
}

/** A row of mutually exclusive options (like iOS's segmented control). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="tablist"
      className={cn("grid gap-1 rounded-xl bg-muted p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[10px] font-semibold transition-all duration-200",
            size === "sm" ? "h-8 text-[13px]" : "h-9 text-sm",
            value === o.value
              ? "bg-card text-foreground shadow-[0_1px_3px_hsl(var(--shadow-color)/0.15)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Friendly "nothing here yet" block with an optional action. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center text-center gap-3 px-6 py-12", className)}>
      {icon && <div className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">{icon}</div>}
      <div className="space-y-1 max-w-[30ch]">
        <p className="font-display text-lg font-semibold">{title}</p>
        {children && <div className="text-sm text-muted-foreground">{children}</div>}
      </div>
      {action}
    </div>
  );
}

/** Small uppercase heading above a group of rows. */
export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-2 px-1", className)}>
      <h3 className="font-sans text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{children}</h3>
      {action}
    </div>
  );
}

/** A tiny drawing of a run's route, made from Strava's encoded polyline. */
export function RouteThumb({ polyline, className, strokeWidth = 2.2 }: { polyline?: string | null; className?: string; strokeWidth?: number }) {
  const path = useMemo(() => {
    if (!polyline) return null;
    let pts: [number, number][];
    try {
      pts = decodePolyline(polyline);
    } catch {
      return null;
    }
    if (pts.length < 2) return null;
    // Squash longitude by latitude so London doesn't look stretched
    const k = Math.cos((pts[0][0] * Math.PI) / 180);
    const xs = pts.map(([, lng]) => lng * k);
    const ys = pts.map(([lat]) => -lat);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const pad = 6, size = 48 - pad * 2;
    const ox = pad + (size - ((maxX - minX) / span) * size) / 2;
    const oy = pad + (size - ((maxY - minY) / span) * size) / 2;
    // Keep at most ~120 points; plenty for a 48px drawing
    const step = Math.max(1, Math.floor(pts.length / 120));
    let d = "";
    for (let i = 0; i < pts.length; i += step) {
      const x = ox + ((xs[i] - minX) / span) * size;
      const y = oy + ((ys[i] - minY) / span) * size;
      d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return d;
  }, [polyline]);

  return (
    <div className={cn("grid size-12 shrink-0 place-items-center rounded-xl bg-muted", className)}>
      {path ? (
        <svg viewBox="0 0 48 48" className="size-full" aria-hidden>
          <path d={path} fill="none" stroke="hsl(var(--ember))" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="size-5 text-muted-foreground" aria-hidden>
          <path d="M4 18c3-6 6 2 9-4s5-6 7-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}

/** Grey placeholder bars shown while something loads. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="size-12 rounded-xl bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-2/3 rounded-full bg-muted animate-pulse" />
            <div className="h-3 w-1/3 rounded-full bg-muted animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Format metres as "8.2 km". */
export const formatKm = (m?: number | null, digits = 1) => (m ? `${(m / 1000).toFixed(digits)} km` : "");

/** Format seconds as "1h 05m" or "42m". */
export function formatDuration(s?: number | null) {
  if (!s) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export const formatDate = (iso: string | Date, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
  new Date(iso).toLocaleDateString("en-GB", opts);

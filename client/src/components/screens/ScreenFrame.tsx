import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ScreenVariant = "mobile" | "panel";

interface ScreenFrameProps {
  variant: ScreenVariant;
  title: string;
  subtitle?: ReactNode;
  /** Buttons shown at the top right of the title */
  actions?: ReactNode;
  /** Sticky content under the title (e.g. a search box) */
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Wrapper for the Parks / Runs / Progress screens.
 *
 * On phones it's a full-screen page over the map with a big title that shrinks into a
 * compact bar as you scroll (like iOS). In the desktop side panel it's just the content —
 * the panel's tabs already say where you are.
 */
export function ScreenFrame({ variant, title, subtitle, actions, toolbar, children, className }: ScreenFrameProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el || variant !== "mobile") return;
    const onScroll = () => setScrolled(el.scrollTop > 36);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [variant]);

  if (variant === "panel") {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
        {(actions || toolbar) && (
          <div className="space-y-3 border-b px-4 pb-3 pt-1">
            {actions && <div className="flex items-center justify-between gap-2">{subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : <span />}{actions}</div>}
            {toolbar}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-4">{children}</div>
      </div>
    );
  }

  return (
    <div className={cn("fixed inset-0 z-20 flex flex-col bg-background animate-in fade-in-0 duration-200 md:hidden", className)}>
      {/* Compact bar that appears once the big title scrolls away */}
      <div
        className={cn(
          "glass absolute inset-x-0 top-0 z-10 border-b transition-opacity duration-200",
          scrolled ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        style={{ paddingTop: "var(--safe-top)" }}
      >
        <div className="flex h-12 items-center justify-center px-4">
          <span className="font-display text-[17px] font-semibold">{title}</span>
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ paddingTop: "var(--safe-top)" }}>
        <header className="flex items-end justify-between gap-3 px-5 pb-3 pt-6">
          <div className="min-w-0">
            <h1 className="text-[34px] font-bold leading-none">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
        {toolbar && <div className="sticky top-0 z-[5] bg-background/95 px-5 pb-3 pt-1 backdrop-blur">{toolbar}</div>}
        <div className="px-5 pt-2" style={{ paddingBottom: "calc(var(--tabbar-h) + var(--safe-bottom) + 24px)" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

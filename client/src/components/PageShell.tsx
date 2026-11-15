import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageShellProps {
  title: string;
  subtitle?: ReactNode;
  /** Where the back button goes (defaults to the map) */
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Content width: "md" for lists, "lg" for dashboards */
  width?: "md" | "lg";
}

/**
 * Layout for pages outside the map (Trophies, Leaderboards, Marathon…):
 * a sticky top bar with a back button, a big title, then the content.
 * The bar respects the iPhone notch (safe-area) and turns frosted once you scroll.
 */
export function PageShell({ title, subtitle, backHref = "/", backLabel = "Back", actions, children, width = "md" }: PageShellProps) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-[100dvh] bg-background">
      <div
        className={cn("sticky top-0 z-30 transition-colors", scrolled ? "glass border-b" : "bg-transparent")}
        style={{ paddingTop: "var(--safe-top)" }}
      >
        <div className={cn("mx-auto flex h-14 items-center justify-between gap-2 px-2", width === "lg" ? "max-w-5xl" : "max-w-2xl")}>
          <Link href={backHref} className="inline-flex h-11 items-center gap-0.5 rounded-full pl-1.5 pr-3 text-[15px] font-semibold text-foreground hover:bg-muted">
            <ChevronLeft className="size-5" />
            {backLabel}
          </Link>
          <span className={cn("truncate font-display text-[17px] font-semibold transition-opacity", scrolled ? "opacity-100" : "opacity-0")}>{title}</span>
          <div className="flex min-w-[88px] justify-end">{actions}</div>
        </div>
      </div>
      <main
        className={cn("mx-auto px-5", width === "lg" ? "max-w-5xl" : "max-w-2xl")}
        style={{ paddingBottom: "calc(var(--safe-bottom) + 40px)" }}
      >
        <header className="pb-6 pt-2">
          <h1 className="text-[34px] font-bold leading-none">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] text-muted-foreground">{subtitle}</p>}
        </header>
        {children}
      </main>
    </div>
  );
}

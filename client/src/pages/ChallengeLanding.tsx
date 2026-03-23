import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { MapPin, Trophy, Target, Users, Leaf, ChevronRight, CheckCircle2 } from "lucide-react";

const CHALLENGE_GOAL = 500;
const TOTAL_PARKS = 3000;

export default function ChallengeLanding() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("submitting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/challenge/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined }),
      });
      if (res.ok) {
        setStatus("done");
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error || "Something went wrong. Please try again.");
        setStatus("error");
      }
    } catch {
      setErrorMsg("Could not connect. Please try again.");
      setStatus("error");
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* Nav */}
      <nav className="border-b border-border/50 px-6 py-4 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/80 shadow-md flex items-center justify-center">
            <span className="text-lg font-bold text-primary-foreground">L</span>
          </div>
          <span className="text-lg font-bold font-display tracking-tight">
            ParkRun<span className="text-primary">.LDN</span>
          </span>
        </a>
        <a href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
          Open map <ChevronRight className="w-4 h-4" />
        </a>
      </nav>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-16 text-center space-y-6">
        <div className="inline-flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/25 rounded-full px-4 py-1.5 text-sm font-semibold text-yellow-700 dark:text-yellow-400">
          <Target className="w-4 h-4" />
          2026 Challenge
        </div>

        <h1 className="text-5xl sm:text-6xl font-extrabold font-display leading-tight tracking-tight">
          Run every park<br />
          <span className="text-primary">in London.</span>
        </h1>

        <p className="text-xl text-muted-foreground max-w-xl mx-auto leading-relaxed">
          London has over {TOTAL_PARKS.toLocaleString()} public parks. Our 2026 challenge:
          explore <strong className="text-foreground">{CHALLENGE_GOAL}</strong> of them on foot — and track every single one.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Button
            size="lg"
            className="gap-2 text-base px-8"
            onClick={() => document.getElementById("register")?.scrollIntoView({ behavior: "smooth" })}
          >
            Register interest
            <ChevronRight className="w-5 h-5" />
          </Button>
          <Button size="lg" variant="outline" className="gap-2 text-base px-8" asChild>
            <a href="/">Explore the map</a>
          </Button>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-muted/30 border-y border-border/50 py-10">
        <div className="max-w-3xl mx-auto px-6 grid grid-cols-3 gap-6 text-center">
          <div className="space-y-1">
            <p className="text-4xl font-extrabold font-display text-primary">{TOTAL_PARKS.toLocaleString()}</p>
            <p className="text-sm text-muted-foreground font-medium">Public parks in London</p>
          </div>
          <div className="space-y-1">
            <p className="text-4xl font-extrabold font-display text-yellow-600">{CHALLENGE_GOAL}</p>
            <p className="text-sm text-muted-foreground font-medium">2026 challenge target</p>
          </div>
          <div className="space-y-1">
            <p className="text-4xl font-extrabold font-display text-foreground">32</p>
            <p className="text-sm text-muted-foreground font-medium">London boroughs</p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-3xl mx-auto px-6 py-20 space-y-12">
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold font-display">How it works</h2>
          <p className="text-muted-foreground">Simple, free, and built for London runners</p>
        </div>

        <div className="grid sm:grid-cols-3 gap-6">
          {[
            {
              icon: <MapPin className="w-6 h-6 text-primary" />,
              bg: "bg-primary/10",
              title: "Explore the map",
              desc: "Browse all of London's parks on our interactive map, filtered by borough, type, or access.",
            },
            {
              icon: <Trophy className="w-6 h-6 text-yellow-600" />,
              bg: "bg-yellow-500/10",
              title: "Log your runs",
              desc: "Connect Strava to automatically detect which parks you ran through and mark them complete.",
            },
            {
              icon: <Target className="w-6 h-6 text-orange-500" />,
              bg: "bg-orange-500/10",
              title: "Hit 500 in 2026",
              desc: "Track your progress toward the 500-park challenge and share your milestones.",
            },
          ].map(({ icon, bg, title, desc }) => (
            <div key={title} className="bg-card border border-border rounded-2xl p-6 space-y-4">
              <div className={`w-12 h-12 rounded-xl ${bg} flex items-center justify-center`}>{icon}</div>
              <div>
                <h3 className="font-bold text-lg">{title}</h3>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Challenge progress teaser */}
      <section className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border-y border-yellow-500/20 py-16">
        <div className="max-w-3xl mx-auto px-6 space-y-6">
          <div className="flex items-center gap-3">
            <Leaf className="w-6 h-6 text-yellow-600 flex-shrink-0" />
            <h2 className="text-2xl font-bold font-display">The 2026 Challenge</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Run {CHALLENGE_GOAL} of London's {TOTAL_PARKS.toLocaleString()} public parks before the end of 2026.
            From the grand Royal Parks to hidden community gardens in every borough —
            there's always a new green space to discover.
          </p>
          <div className="space-y-2">
            <div className="flex justify-between text-sm font-medium">
              <span className="text-muted-foreground">Challenge progress (example)</span>
              <span className="text-foreground font-bold">47 / {CHALLENGE_GOAL} parks (9%)</span>
            </div>
            <Progress value={9} className="h-3" />
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {[
              "Automatic detection via Strava",
              "Track runs across all 32 boroughs",
              "Discover hidden gems with Gardens Trust facts",
              "Share your progress on Strava",
            ].map(item => (
              <li key={item} className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Registration */}
      <section id="register" className="max-w-xl mx-auto px-6 py-20 space-y-8">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-2">
            <Users className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-3xl font-bold font-display">Join the challenge</h2>
          <p className="text-muted-foreground">
            Register your interest and we'll keep you updated as the community grows.
          </p>
        </div>

        {status === "done" ? (
          <div className="bg-primary/10 border border-primary/30 rounded-2xl p-8 text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 text-primary mx-auto" />
            <h3 className="text-xl font-bold">You're on the list!</h3>
            <p className="text-muted-foreground text-sm">
              Thanks for registering. We'll be in touch as ParkRun.LDN grows.
            </p>
            <Button className="mt-2" asChild>
              <a href="/">Start exploring the map</a>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-8 space-y-4">
            <div className="space-y-1">
              <label htmlFor="reg-name" className="text-sm font-medium">
                Name <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="reg-name"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={status === "submitting"}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="reg-email" className="text-sm font-medium">
                Email <span className="text-destructive">*</span>
              </label>
              <Input
                id="reg-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={status === "submitting"}
              />
            </div>
            {status === "error" && (
              <p className="text-sm text-destructive">{errorMsg}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={status === "submitting" || !email.trim()}
            >
              {status === "submitting" ? "Registering..." : "Register interest"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              No spam — just occasional updates about ParkRun.LDN.
            </p>
          </form>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 px-6 text-center text-sm text-muted-foreground">
        <p>
          <a href="/" className="hover:text-foreground transition-colors font-medium">ParkRun.LDN</a>
          {" "}· Run every park in London ·{" "}
          <a href="/" className="hover:text-foreground transition-colors">Open the map</a>
        </p>
      </footer>
    </div>
  );
}

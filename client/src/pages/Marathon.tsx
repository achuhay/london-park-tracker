import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, subWeeks } from "date-fns";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { ArrowLeft, Trophy, Timer, TrendingUp, Target, SendHorizontal, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StoredRun {
  id: number;
  stravaId: string;
  name: string;
  activityType: string;
  startDate: string;
  distance: number;
  movingTime: number;
  parkCount: number;
}

interface MarathonGoal {
  raceDate: string;
  goalHours: number;
  goalMinutes: number;
}

const GOAL_KEY = "marathonGoal";

function loadGoal(): MarathonGoal | null {
  try {
    const raw = localStorage.getItem(GOAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, "0")} /km`;
}

function formatTime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

export default function Marathon() {
  const saved = loadGoal();
  const [raceDate, setRaceDate] = useState(saved?.raceDate ?? "");
  const [goalHours, setGoalHours] = useState(saved?.goalHours ?? 4);
  const [goalMinutes, setGoalMinutes] = useState(saved?.goalMinutes ?? 0);
  const [savedGoal, setSavedGoal] = useState<MarathonGoal | null>(saved);

  // Chat state
  const [messages, setMessages] = useState<{ role: "user" | "coach"; text: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendQuestion() {
    const q = chatInput.trim();
    if (!q || chatLoading) return;
    setChatInput("");
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setChatLoading(true);
    try {
      const ctx = {
        total4wk: heroStats.total4wk,
        avg8wk: heroStats.avg8wk,
        longestEver: heroStats.longestEver,
        currentLongRun: weeklyData.slice(-4).reduce((max, w) => Math.max(max, w.maxKm), 0),
        last4Weeks: weeklyData.slice(-4).map((w) => w.totalKm),
        goal: savedGoal
          ? {
              raceDate: savedGoal.raceDate,
              goalHours: savedGoal.goalHours,
              goalMinutes: savedGoal.goalMinutes,
              weeksLeft: readiness?.weeksLeft ?? 0,
              targetLongRun: readiness?.targetLongRun ?? 0,
              racePaceSec:
                (savedGoal.goalHours * 3600 + savedGoal.goalMinutes * 60) / 42.195,
            }
          : null,
      };
      const res = await fetch("/api/marathon/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ question: q, context: ctx }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "coach", text: data.answer ?? data.error ?? "Sorry, something went wrong." },
      ]);
    } catch {
      setMessages((prev) => [...prev, { role: "coach", text: "Sorry, I couldn't connect. Try again." }]);
    } finally {
      setChatLoading(false);
    }
  }

  function handleSaveGoal() {
    if (!raceDate) return;
    const g: MarathonGoal = { raceDate, goalHours, goalMinutes };
    localStorage.setItem(GOAL_KEY, JSON.stringify(g));
    setSavedGoal(g);
  }

  const { data: runs = [], isLoading } = useQuery<StoredRun[]>({
    queryKey: ["/api/strava/runs"],
  });

  // Include all run-type activities
  const runActivities = useMemo(
    () => runs.filter((r) => r.activityType?.toLowerCase().includes("run")),
    [runs]
  );

  // Group into 16-week buckets (Mon–Sun)
  const weeklyData = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 16 }, (_, i) => {
      const weekStart = startOfWeek(subWeeks(now, 15 - i), { weekStartsOn: 1 });
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const weekRuns = runActivities.filter((r) => {
        const d = new Date(r.startDate);
        return d >= weekStart && d < weekEnd;
      });

      const totalKm = parseFloat(
        weekRuns.reduce((acc, r) => acc + (r.distance || 0) / 1000, 0).toFixed(1)
      );
      const maxKm = parseFloat(
        (weekRuns.length > 0
          ? Math.max(...weekRuns.map((r) => (r.distance || 0) / 1000))
          : 0
        ).toFixed(1)
      );

      return { week: format(weekStart, "d MMM"), totalKm, maxKm };
    });
  }, [runActivities]);

  // Hero stats
  const heroStats = useMemo(() => {
    const last4 = weeklyData.slice(-4);
    const last8 = weeklyData.slice(-8);
    const total4wk = parseFloat(last4.reduce((a, w) => a + w.totalKm, 0).toFixed(1));
    const avg8wk = parseFloat((last8.reduce((a, w) => a + w.totalKm, 0) / 8).toFixed(1));
    const longestEver = parseFloat(
      (runActivities.length > 0
        ? Math.max(...runActivities.map((r) => (r.distance || 0) / 1000))
        : 0
      ).toFixed(1)
    );
    return { total4wk, avg8wk, longestEver };
  }, [weeklyData, runActivities]);

  // Race readiness
  const readiness = useMemo(() => {
    if (!savedGoal?.raceDate) return null;
    const today = new Date();
    const race = new Date(savedGoal.raceDate);
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weeksLeft = Math.max(0, Math.round((race.getTime() - today.getTime()) / msPerWeek));

    // Longest run in last 4 weeks
    const currentLongRun = parseFloat(
      weeklyData.slice(-4).reduce((max, w) => Math.max(max, w.maxKm), 0).toFixed(1)
    );
    // Target long run: peaks at 32 km ~3 weeks out, min 10 km
    const targetLongRun = parseFloat(
      Math.max(10, Math.min(32, 32 * (1 - weeksLeft / 18))).toFixed(1)
    );
    const ratio = targetLongRun > 0 ? currentLongRun / targetLongRun : 1;
    const status: "green" | "amber" | "red" =
      ratio >= 0.9 ? "green" : ratio >= 0.7 ? "amber" : "red";

    // Load trend: last 4 weeks vs prior 4 weeks
    const recent4Avg = weeklyData.slice(-4).reduce((a, w) => a + w.totalKm, 0) / 4;
    const prior4Avg = weeklyData.slice(-8, -4).reduce((a, w) => a + w.totalKm, 0) / 4;
    const loadTrending = recent4Avg >= prior4Avg * 0.9;

    return { weeksLeft, currentLongRun, targetLongRun, status, loadTrending };
  }, [savedGoal, weeklyData]);

  // Pace guide
  const paceGuide = useMemo(() => {
    if (!savedGoal) return null;
    const totalSec = savedGoal.goalHours * 3600 + savedGoal.goalMinutes * 60;
    if (totalSec === 0) return null;
    const racePaceSec = totalSec / 42.195;
    return {
      race: formatPace(racePaceSec),
      easy: formatPace(racePaceSec + 75),
      tempo: formatPace(racePaceSec - 20),
      half: formatTime(totalSec * Math.pow(21.0975 / 42.195, 1.06)),
      fiveK: formatTime(totalSec * Math.pow(5 / 42.195, 1.06)),
    };
  }, [savedGoal]);

  const statusStyle = {
    green: "bg-green-50 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800",
    amber: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800",
    red: "bg-red-50 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800",
  };
  const statusLabel = { green: "On track", amber: "Almost there", red: "Build up more" };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-background sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <a href="/">
            <Button variant="ghost" size="sm" className="gap-1.5">
              <ArrowLeft className="w-4 h-4" />
              Back to map
            </Button>
          </a>
          <div>
            <h1 className="text-xl font-bold">Marathon Planner</h1>
            <p className="text-xs text-muted-foreground">Based on your Strava training data</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Hero stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Last 4 weeks", value: isLoading ? "—" : `${heroStats.total4wk} km`, sub: "total distance" },
            { label: "Weekly average (8wk)", value: isLoading ? "—" : `${heroStats.avg8wk} km`, sub: "per week" },
            { label: "Longest run ever", value: isLoading ? "—" : `${heroStats.longestEver} km`, sub: "straight-line" },
          ].map((s) => (
            <div key={s.label} className="bg-card rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
              <p className="text-3xl font-bold text-foreground leading-none">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Goal setter + Pace guide */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Goal setter */}
          <div className="bg-card rounded-xl border border-border p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-sm">Race Goal</h2>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Race date</label>
                <input
                  type="date"
                  value={raceDate}
                  onChange={(e) => setRaceDate(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">Target finish time</label>
                <div className="flex items-center gap-2">
                  <select
                    value={goalHours}
                    onChange={(e) => setGoalHours(Number(e.target.value))}
                    className="flex-1 rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {[2, 3, 4, 5, 6, 7].map((h) => (
                      <option key={h} value={h}>{h}h</option>
                    ))}
                  </select>
                  <select
                    value={goalMinutes}
                    onChange={(e) => setGoalMinutes(Number(e.target.value))}
                    className="flex-1 rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                      <option key={m} value={m}>{String(m).padStart(2, "0")}m</option>
                    ))}
                  </select>
                  <Button size="sm" onClick={handleSaveGoal} disabled={!raceDate}>
                    Save
                  </Button>
                </div>
              </div>
            </div>

            {/* Readiness */}
            {readiness && (
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground text-xs">Race in</span>
                  <span className="font-semibold">{readiness.weeksLeft} weeks</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground text-xs">Current long run</span>
                  <span className="font-semibold">{readiness.currentLongRun} km</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground text-xs">Target long run now</span>
                  <span className="font-semibold">{readiness.targetLongRun} km</span>
                </div>
                <div
                  className={`mt-1 px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-between ${statusStyle[readiness.status]}`}
                >
                  <span>Long run readiness</span>
                  <span>{statusLabel[readiness.status]}</span>
                </div>
                <div
                  className={`px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-between ${
                    readiness.loadTrending ? statusStyle.green : statusStyle.amber
                  }`}
                >
                  <span>Weekly volume trend</span>
                  <span>{readiness.loadTrending ? "Trending up" : "Plateauing"}</span>
                </div>
              </div>
            )}
          </div>

          {/* Pace guide */}
          <div className="bg-card rounded-xl border border-border p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Timer className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-sm">Pace Guide</h2>
              {savedGoal && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {savedGoal.goalHours}h {String(savedGoal.goalMinutes).padStart(2, "0")}m goal
                </span>
              )}
            </div>

            {paceGuide ? (
              <div className="space-y-2">
                {[
                  { label: "Marathon race pace", value: paceGuide.race, accent: true },
                  { label: "Easy / long run", value: paceGuide.easy, accent: false },
                  { label: "Tempo run", value: paceGuide.tempo, accent: false },
                ].map((row) => (
                  <div
                    key={row.label}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg ${
                      row.accent
                        ? "bg-primary/10 border border-primary/20"
                        : "bg-muted/30 border border-border/50"
                    }`}
                  >
                    <span className="text-xs text-muted-foreground">{row.label}</span>
                    <span className={`text-sm font-bold font-mono ${row.accent ? "text-primary" : ""}`}>
                      {row.value}
                    </span>
                  </div>
                ))}

                <p className="text-xs text-muted-foreground pt-1">Predicted equivalents</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-muted/30 rounded-lg border border-border/50 p-2.5 text-center">
                    <p className="text-xs text-muted-foreground">Half marathon</p>
                    <p className="text-sm font-bold font-mono">{paceGuide.half}</p>
                  </div>
                  <div className="bg-muted/30 rounded-lg border border-border/50 p-2.5 text-center">
                    <p className="text-xs text-muted-foreground">5 km</p>
                    <p className="text-sm font-bold font-mono">{paceGuide.fiveK}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                <Timer className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm">Set a race goal to see your target paces</p>
              </div>
            )}
          </div>
        </div>

        {/* Charts */}
        {!isLoading && runActivities.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Weekly mileage bar chart */}
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-primary" />
                <h2 className="font-semibold text-sm">Weekly mileage</h2>
                <span className="ml-auto text-xs text-muted-foreground">last 16 weeks</span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={weeklyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    interval={3}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    unit=" km"
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [`${v} km`, "Weekly total"]}
                  />
                  <Bar dataKey="totalKm" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Long run progression line chart */}
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center gap-2 mb-4">
                <Trophy className="w-4 h-4 text-amber-500" />
                <h2 className="font-semibold text-sm">Long run progression</h2>
                <span className="ml-auto text-xs text-muted-foreground">last 16 weeks</span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={weeklyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    interval={3}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    unit=" km"
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [`${v} km`, "Long run"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="maxKm"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "hsl(var(--primary))" }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Coach chat */}
        {!isLoading && runActivities.length > 0 && (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-sm">Ask your coach</h2>
              <span className="ml-auto text-xs text-muted-foreground">Powered by Claude</span>
            </div>

            {/* Message history */}
            <div className="h-64 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="h-full flex items-center justify-center text-center text-muted-foreground">
                  <div>
                    <Bot className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    <p className="text-sm font-medium">Ask me anything about your training</p>
                    <p className="text-xs mt-1 opacity-70">e.g. "Am I on track for sub 4:30?" or "What should my taper look like?"</p>
                  </div>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "coach" && (
                    <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                    </div>
                  )}
                  <div
                    className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted/60 text-foreground rounded-bl-sm"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex gap-2.5 justify-start">
                  <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="bg-muted/60 px-3.5 py-2.5 rounded-2xl rounded-bl-sm">
                    <span className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:300ms]" />
                    </span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-border flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendQuestion()}
                placeholder="Ask anything about your training…"
                disabled={chatLoading}
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
              <Button
                size="icon"
                onClick={sendQuestion}
                disabled={!chatInput.trim() || chatLoading}
                className="flex-shrink-0"
              >
                <SendHorizontal className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && runActivities.length === 0 && (
          <div className="bg-card rounded-xl border border-border p-10 text-center text-muted-foreground">
            <Trophy className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="font-medium">No runs synced yet</p>
            <p className="text-sm mt-1 max-w-xs mx-auto">
              Connect Strava and sync your runs on the home page to see your training data here.
            </p>
            <a href="/">
              <Button variant="outline" size="sm" className="mt-4">
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                Go to home page
              </Button>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

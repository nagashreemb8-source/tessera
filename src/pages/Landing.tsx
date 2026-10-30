import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  FlaskConical,
  Microscope,
  Route as RouteIcon,
  Search,
  X,
} from "lucide-react";
import { Logo } from "@/components/ui/tessera";

function MiniReplay() {
  const nodes = [
    { y: 30, label: "Variance", tone: "developing" },
    { y: 110, label: "Expected Value", tone: "focus" },
    { y: 190, label: "Random Variables", tone: "mastered" },
  ];
  return (
    <div
      className="panel relative overflow-hidden p-5 shadow-2xl"
      aria-label="Product preview: Root Cause Replay"
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="eyebrow">Root Cause Replay</p>
        <span className="text-[11px] text-muted-foreground">Sample student</span>
      </div>
      <div className="grid gap-5 sm:grid-cols-[150px_1fr]">
        <svg viewBox="0 0 150 230" className="h-56 w-full" aria-hidden="true">
          <line
            x1="75"
            y1="52"
            x2="75"
            y2="88"
            className="stroke-primary animate-dash"
            strokeWidth="1.5"
          />
          <line
            x1="75"
            y1="132"
            x2="75"
            y2="168"
            className="stroke-muted-foreground/40"
            strokeWidth="1.2"
          />
          {nodes.map((n) => (
            <g key={n.label} transform={`translate(5,${n.y})`}>
              {n.tone === "focus" && (
                <rect
                  x="-3"
                  y="-3"
                  width="146"
                  height="50"
                  rx="10"
                  className="fill-primary/10 animate-soft-pulse"
                />
              )}
              <rect
                width="140"
                height="44"
                rx="7"
                strokeWidth={n.tone === "focus" ? 1.8 : 1}
                className={
                  n.tone === "focus"
                    ? "fill-surface-2 stroke-primary"
                    : n.tone === "developing"
                      ? "fill-developing/10 stroke-developing/60"
                      : "fill-primary/5 stroke-primary/30"
                }
              />
              <text
                x="14"
                y="27"
                className="fill-foreground"
                style={{ fontSize: 12.5, fontWeight: 500 }}
              >
                {n.label}
              </text>
            </g>
          ))}
        </svg>
        <div className="space-y-3 text-sm">
          <div className="panel-raised p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              Possible foundational gap
            </p>
            <p className="mt-1 font-display text-xl">Expected Value</p>
          </div>
          <ul className="space-y-2 text-xs text-muted-foreground">
            <li className="flex gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-developing" />
              Q3: chose 10, the unweighted average of 0, 10 and 20.
            </li>
            <li className="flex gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-developing" />
              Both variance questions missed. Variance builds on expected value.
            </li>
          </ul>
          <div className="flex items-center gap-2 border-t border-border pt-3 text-xs">
            <FlaskConical className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            <span>Next: test the hypothesis with one follow-up.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Logo />
        <Link to="/app" className="btn btn-quiet">
          Open app <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </header>

      <section className="bg-hero relative">
        <div
          className="grid-lines pointer-events-none absolute inset-0 opacity-40"
          aria-hidden="true"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-24 pt-16 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div className="animate-fade-up">
            <p className="eyebrow mb-5 text-primary">AI-powered learning intelligence</p>
            <h1 className="text-5xl leading-[1.05] md:text-6xl lg:text-7xl">
              Your mistakes have a reason.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Tessera traces the concepts behind your answers, uncovers possible knowledge gaps, and
              builds a learning path that starts where you actually need it.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/app/diagnose" className="btn btn-primary h-11 px-5">
                Start a diagnostic <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <a href="#method" className="btn btn-secondary h-11 px-5">
                Explore the method
              </a>
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              Probability &amp; Statistics · 8 questions · about 6 minutes
            </p>
          </div>
          <div className="animate-fade-up [animation-delay:120ms]">
            <MiniReplay />
          </div>
        </div>
      </section>

      <section id="method" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-24">
        <p className="eyebrow mb-3">The method</p>
        <h2 className="max-w-2xl text-4xl">Don't just learn what you got wrong. Discover why.</h2>
        <ol className="mt-12 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
          {[
            {
              icon: Search,
              n: "01",
              t: "Diagnose",
              d: "Answer a short set of targeted questions. No grades shown mid-quiz, no pressure.",
            },
            {
              icon: Microscope,
              n: "02",
              t: "Investigate",
              d: "Trace answer patterns back through prerequisite concepts to form a hypothesis, then test it.",
            },
            {
              icon: RouteIcon,
              n: "03",
              t: "Improve",
              d: "Follow a prioritized path that respects what each concept depends on.",
            },
          ].map((s) => (
            <li key={s.t} className="bg-surface p-7">
              <div className="flex items-center justify-between">
                <s.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                <span className="font-display text-sm text-muted-foreground">{s.n}</span>
              </div>
              <h3 className="mt-6 text-2xl">{s.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-24">
        <h2 className="text-3xl">A score tells you where. Evidence tells you why.</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="panel p-7">
            <p className="eyebrow">Score reporting</p>
            <p className="mt-4 font-display text-6xl text-muted-foreground">3/8</p>
            <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
              {[
                "Question 3: incorrect",
                "Question 4: incorrect",
                "Question 5: incorrect",
                "Question 6: incorrect",
                "Question 8: incorrect",
              ].map((x) => (
                <li key={x} className="flex items-center gap-2">
                  <X className="h-3.5 w-3.5" aria-hidden="true" /> {x}
                </li>
              ))}
            </ul>
          </div>
          <div className="panel relative p-7 glow-ring">
            <p className="eyebrow text-primary">Evidence-based diagnosis</p>
            <dl className="mt-4 space-y-4 text-sm">
              {[
                ["Observed evidence", "Missed both variance and both expected-value questions."],
                ["Suspected prerequisite", "Expected Value, which variance is built on."],
                ["Hypothesis test", "One follow-up question to check before concluding anything."],
                ["Learning path", "Review Expected Value → Revisit Variance → Continue."],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <dt className="font-medium">{k}</dt>
                    <dd className="text-muted-foreground">{v}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-10 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <span className="text-foreground">
              <Logo />
            </span>
            <span>Don't just learn what you got wrong. Discover why.</span>
          </div>
          <p>Hackathon prototype. Sample data only.</p>
        </div>
      </footer>
    </div>
  );
}

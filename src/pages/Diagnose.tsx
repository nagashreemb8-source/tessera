import { useNavigate } from "@tanstack/react-router";
import { BackendDiagnosePage } from "@/pages/BackendDiagnose";
import { useStudy } from "@/state/useStudy";
import { ArrowLeft, ArrowRight, Pencil, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Bar } from "@/components/ui/tessera";
import { conceptName } from "@/data/concepts";
import { QUESTIONS } from "@/data/questions";
import { cn } from "@/lib/utils";
import { useTessera } from "@/state/AppState";
import type { OptionKey } from "@/types";

const MICROCOPY = [
  "Take your time. There's no timer.",
  "Nice. Answers aren't revealed until the end.",
  "Keep going at your own pace.",
  "Halfway there soon. Guessing is fine; it just adds less evidence.",
  "You're past halfway.",
  "Every answer helps Tessera form a better hypothesis.",
  "Almost there.",
  "Last one. You can review everything next.",
];

const KEYS: OptionKey[] = ["A", "B", "C", "D"];

export function DiagnosePage({
  concept,
  followup,
}: {
  concept?: string | undefined;
  followup?: boolean | undefined;
}) {
  const study = useStudy();
  // AI mode: quizzes are generated from the student's own documents and graded on the backend.
  if (study.mode === "backend") {
    return <BackendDiagnosePage concept={concept} followup={followup} />;
  }
  return <DemoDiagnosePage />;
}

function DemoDiagnosePage() {
  const { state, dispatch } = useTessera();
  const navigate = useNavigate();
  const [index, setIndex] = useState(() => {
    const firstOpen = QUESTIONS.findIndex((q) => !state.answers[q.id]);
    return firstOpen === -1 || state.results ? 0 : firstOpen;
  });
  const [mode, setMode] = useState<"quiz" | "review" | "analyzing">("quiz");
  const [confirm, setConfirm] = useState(false);
  const answeredCount = QUESTIONS.filter((q) => state.answers[q.id]).length;

  useEffect(() => {
    if (mode !== "analyzing") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => navigate({ to: "/app/results" }), reduce ? 300 : 1400);
    return () => clearTimeout(t);
  }, [mode, navigate]);

  if (mode === "analyzing") {
    return (
      <div className="mx-auto max-w-xl py-16" role="status" aria-live="polite">
        <p className="eyebrow mb-3 text-primary">Demo engine</p>
        <h1 className="text-3xl">Analyzing your answers…</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Mapping each answer to its concepts and checking prerequisites. Runs locally with demo
          rules.
        </p>
        <div className="mt-8 space-y-3">
          {["Scoring answers", "Tracing prerequisites", "Forming hypotheses"].map((s, i) => (
            <div key={s} className="panel flex items-center gap-4 p-4">
              <span
                className="h-2 w-2 rounded-full bg-primary animate-soft-pulse"
                style={{ animationDelay: `${i * 200}ms` }}
              />
              <span className="text-sm">{s}</span>
              <div className="ml-auto h-2 w-32 animate-pulse rounded bg-surface-2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const submit = () => {
    dispatch({ type: "submit" });
    setConfirm(false);
    setMode("analyzing");
  };

  const dialog = (
    <AlertDialog open={confirm} onOpenChange={setConfirm}>
      <AlertDialogContent className="border-border bg-surface">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-2xl font-medium">
            Submit your answers?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {answeredCount < QUESTIONS.length
              ? `${QUESTIONS.length - answeredCount} question(s) are unanswered. That's fine: unanswered questions simply add no evidence.`
              : "All 8 answered. Tessera will look for patterns, not just count mistakes."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="btn btn-secondary">Keep reviewing</AlertDialogCancel>
          <AlertDialogAction className="btn btn-primary" onClick={submit}>
            Submit and analyze
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (mode === "review") {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="eyebrow mb-2">Probability &amp; Statistics · Review</p>
        <h1 className="text-3xl">Review your answers</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Change anything before you submit. Nothing is graded yet.
        </p>
        {answeredCount < QUESTIONS.length && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-developing/40 bg-developing/10 px-4 py-2 text-sm text-developing"
          >
            {QUESTIONS.length - answeredCount} unanswered. You can still submit.
          </p>
        )}
        <ol className="mt-6 space-y-2">
          {QUESTIONS.map((q, i) => {
            const a = state.answers[q.id];
            return (
              <li key={q.id} className="panel flex items-center gap-4 p-4">
                <span className="font-display text-lg text-muted-foreground">{q.id}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{q.prompt}</p>
                  <p className={cn("text-xs", a ? "text-muted-foreground" : "text-developing")}>
                    {a ? `Your answer: ${a}. ${q.options[a]}` : "Not answered"}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    setIndex(i);
                    setMode("quiz");
                  }}
                  aria-label={`Change answer to question ${q.id}`}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" /> Change
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-6 flex justify-between">
          <button type="button" className="btn btn-secondary" onClick={() => setMode("quiz")}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to questions
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setConfirm(true)}>
            Submit
          </button>
        </div>
        {dialog}
      </div>
    );
  }

  const q = QUESTIONS[index]!;
  const chosen = state.answers[q.id];

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-border-strong px-2.5 py-0.5 text-muted-foreground">
            Probability &amp; Statistics
          </span>
          <span className="rounded-full bg-surface-2 px-2.5 py-0.5">
            {q.conceptIds.map(conceptName).join(", ")}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-quiet text-xs"
          onClick={() => dispatch({ type: "loadSampleAnswers" })}
        >
          <Wand2 className="h-3.5 w-3.5" aria-hidden="true" /> Load sample answers
        </button>
      </div>

      {state.results && (
        <p className="mb-4 rounded-md border border-border bg-surface-2 px-4 py-2 text-xs text-muted-foreground">
          Your previous results are saved. Submitting again replaces them and resets your learning
          progress.
        </p>
      )}
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Question {index + 1} of {QUESTIONS.length}
        </span>
        <span>{answeredCount} answered</span>
      </div>
      <Bar
        value={(index + 1) / QUESTIONS.length}
        label={`Question ${index + 1} of ${QUESTIONS.length}`}
      />

      <p
        key={`m${index}`}
        className="animate-fade-up mt-8 text-sm text-muted-foreground"
        aria-live="polite"
      >
        {MICROCOPY[index]}
      </p>
      <fieldset key={q.id} className="animate-fade-up mt-3">
        <legend className="font-display text-2xl leading-snug md:text-[1.7rem]">{q.prompt}</legend>
        <div role="radiogroup" className="mt-6 grid gap-3">
          {KEYS.map((k) => {
            const selected = chosen === k;
            return (
              <label
                key={k}
                className={cn(
                  "flex min-h-14 cursor-pointer items-center gap-4 rounded-lg border px-4 py-3 transition-all focus-within:outline-2 focus-within:outline-primary",
                  selected
                    ? "border-primary bg-primary/10 glow-ring"
                    : "border-border bg-surface hover:border-border-strong hover:bg-surface-2",
                )}
              >
                <input
                  type="radio"
                  name={`q${q.id}`}
                  value={k}
                  checked={selected}
                  onChange={() => dispatch({ type: "answer", questionId: q.id, option: k })}
                  className="sr-only"
                />
                <span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-md border text-xs font-semibold",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border-strong text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  {k}
                </span>
                <span className="text-base">{q.options[k]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-8 flex justify-between">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Previous
        </button>
        {index < QUESTIONS.length - 1 ? (
          <button type="button" className="btn btn-primary" onClick={() => setIndex(index + 1)}>
            {chosen ? "Next" : "Skip for now"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setMode("review")}>
            Review answers <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {answeredCount === QUESTIONS.length && index < QUESTIONS.length - 1 && (
        <div className="mt-4 text-right">
          <button type="button" className="btn btn-quiet text-xs" onClick={() => setMode("review")}>
            All answered · go to review
          </button>
        </div>
      )}
    </div>
  );
}

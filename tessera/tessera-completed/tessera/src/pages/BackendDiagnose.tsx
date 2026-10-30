import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  FlaskConical,
  Loader2,
  Pencil,
  Sparkles,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Bar, PageHeader } from "@/components/ui/tessera";
import { api, ApiClientError } from "@/services/api";
import type { PublicQuestion, PublicQuiz } from "@/services/apiTypes";
import { useBackend } from "@/state/BackendContext";
import { cn } from "@/lib/utils";

const KEYS = ["A", "B", "C", "D"] as const;
type OptionKey = (typeof KEYS)[number];

const MICROCOPY = [
  "Take your time. Answers aren't revealed until the end.",
  "These questions were generated from your own documents.",
  "Keep going at your own pace.",
  "Every answer adds evidence to the diagnosis.",
  "You're past halfway.",
  "Wrong answers are useful here: they reveal error patterns.",
  "Almost there.",
  "Last one. You can review everything next.",
];

export function BackendDiagnosePage({
  concept,
  followup,
}: {
  concept?: string | undefined;
  followup?: boolean | undefined;
}) {
  const backend = useBackend();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"setup" | "generating" | "quiz" | "review" | "submitting">(
    "setup",
  );
  const [numQuestions, setNumQuestions] = useState(8);
  const [selectedConcepts, setSelectedConcepts] = useState<string[]>(concept ? [concept] : []);
  const [quiz, setQuiz] = useState<PublicQuiz | null>(null);
  const [answers, setAnswers] = useState<Record<string, OptionKey>>({});
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const startedAt = useRef<number>(Date.now());
  const autoStarted = useRef(false);

  const analysisReady = backend.analysis?.status === "ready" && backend.concepts.length > 0;
  const readableDocuments = backend.documents.filter((doc) => doc.status !== "rejected");

  const generate = useCallback(
    async (asFollowUp: boolean) => {
      setPhase("generating");
      setError(null);
      try {
        const created = asFollowUp
          ? await api.followUpQuiz({
              concept_ids: concept ? [concept] : selectedConcepts,
              num_questions: 3,
            })
          : await api.createQuiz({
              num_questions: numQuestions,
              concept_ids: selectedConcepts.length ? selectedConcepts : undefined,
            });
        const loaded = await api.getQuiz(created.id);
        const requested = asFollowUp ? 3 : numQuestions;
        setNotice(
          loaded.questions.length < requested
            ? `The model produced ${loaded.questions.length} of the ${requested} questions you asked for. Answer these, then generate another quiz if you want more evidence.`
            : null,
        );
        setQuiz(loaded);
        setAnswers({});
        setIndex(0);
        startedAt.current = Date.now();
        setPhase("quiz");
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : "Could not generate a quiz.");
        setPhase("setup");
      }
    },
    [concept, numQuestions, selectedConcepts],
  );

  useEffect(() => {
    if (followup && concept && analysisReady && !autoStarted.current) {
      autoStarted.current = true;
      void generate(true);
    }
  }, [followup, concept, analysisReady, generate]);

  const submit = async () => {
    if (!quiz) return;
    setConfirm(false);
    setPhase("submitting");
    setError(null);
    try {
      const payload: Record<string, string | null> = {};
      for (const question of quiz.questions) payload[question.id] = answers[question.id] ?? null;
      const attempt = await api.submitQuiz(
        quiz.id,
        payload,
        Math.round((Date.now() - startedAt.current) / 1000),
      );
      const diagnosis = await api.diagnose(attempt.attempt_id);
      backend.setDiagnosis(diagnosis);
      await Promise.all([
        backend.refreshProgress(),
        backend.refreshPath(),
        backend.refreshQuizzes(),
      ]);
      navigate({ to: "/app/results" });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not submit your answers.");
      setPhase("quiz");
    }
  };

  if (backend.loading) {
    return (
      <div className="mx-auto max-w-xl py-16" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <p className="mt-3 text-sm text-muted-foreground">Loading your study set…</p>
      </div>
    );
  }

  if (readableDocuments.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Diagnose" title="Take a diagnostic quiz" />
        <div className="panel p-8 text-center">
          <h2 className="text-2xl">Upload a PDF first</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Quizzes are generated from your own documents, so there is nothing to test yet.
          </p>
          <Link to="/app/upload" className="btn btn-primary mt-5">
            Upload PDFs
          </Link>
        </div>
      </>
    );
  }

  if (!analysisReady) {
    return (
      <>
        <PageHeader eyebrow="Diagnose" title="Analysis needed first" />
        <div className="panel p-8 text-center">
          <h2 className="text-2xl">Analyse your documents first</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Quizzes are built from your document's concept map, so analysis has to finish before
            questions can be generated.
          </p>
          <Link to="/app/analysis" className="btn btn-primary mt-5">
            Open analysis
          </Link>
        </div>
      </>
    );
  }

  if (phase === "generating") {
    return (
      <div className="mx-auto max-w-xl py-16" role="status" aria-live="polite">
        <p className="eyebrow mb-3 text-primary">Your documents</p>
        <h1 className="text-3xl">
          {followup ? "Writing follow-up questions…" : "Generating your quiz…"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Retrieving passages, writing questions and checking that every item is grounded with a
          page citation.
        </p>
        <div className="mt-8 space-y-3">
          {[
            "Retrieving document passages",
            "Writing questions and misconceptions",
            "Validating structure and citations",
          ].map((step, i) => (
            <div key={step} className="panel flex items-center gap-4 p-4">
              <span
                className="h-2 w-2 animate-soft-pulse rounded-full bg-primary"
                style={{ animationDelay: `${i * 200}ms` }}
              />
              <span className="text-sm">{step}</span>
              <div className="ml-auto h-2 w-32 animate-pulse rounded bg-surface-2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (phase === "submitting") {
    return (
      <div className="mx-auto max-w-xl py-16" role="status" aria-live="polite">
        <p className="eyebrow mb-3 text-primary">Grading</p>
        <h1 className="text-3xl">Tracing your answers…</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Answers are graded deterministically on the server, then the evidence is traced through
          prerequisites to form hypotheses.
        </p>
        <div className="mt-8 space-y-3">
          {["Grading answers", "Grouping evidence by concept", "Tracing prerequisites"].map(
            (step, i) => (
              <div key={step} className="panel flex items-center gap-4 p-4">
                <span
                  className="h-2 w-2 animate-soft-pulse rounded-full bg-primary"
                  style={{ animationDelay: `${i * 200}ms` }}
                />
                <span className="text-sm">{step}</span>
                <div className="ml-auto h-2 w-32 animate-pulse rounded bg-surface-2" />
              </div>
            ),
          )}
        </div>
      </div>
    );
  }

  if (phase === "setup" || !quiz) {
    return (
      <>
        <PageHeader
          eyebrow={followup ? "Follow-up quiz" : "Diagnose"}
          title={followup ? "Test the hypothesis" : "Build a diagnostic quiz"}
          sub="Questions are generated fresh from your documents every time, so nothing comes from a fixed bank."
        />
        {error && (
          <p role="alert" className="panel mb-4 flex gap-2 p-4 text-sm text-developing">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
          </p>
        )}
        <section className="panel p-6">
          {followup && concept && (
            <p className="mb-4 rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
              Targeting{" "}
              <span className="font-medium">
                {backend.concepts.find((item) => item.id === concept)?.name ?? concept}
              </span>{" "}
              with fresh questions.
            </p>
          )}
          <label className="eyebrow block" htmlFor="quiz-size">
            Questions
          </label>
          <select
            id="quiz-size"
            className="input mt-1 max-w-40"
            value={numQuestions}
            onChange={(event) => setNumQuestions(Number(event.target.value))}
          >
            {[5, 6, 8, 10, 12].map((value) => (
              <option key={value} value={value}>
                {value} questions
              </option>
            ))}
          </select>

          <p className="eyebrow mt-6">Concepts to test</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Leave empty to cover the whole map, including prerequisites.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {backend.concepts.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={selectedConcepts.includes(item.id)}
                onClick={() =>
                  setSelectedConcepts((prev) =>
                    prev.includes(item.id)
                      ? prev.filter((id) => id !== item.id)
                      : [...prev, item.id],
                  )
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                  selectedConcepts.includes(item.id)
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-border-strong",
                )}
              >
                {item.name}
              </button>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void generate(!!followup)}
            >
              {followup ? (
                <FlaskConical className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Wand2 className="h-4 w-4" aria-hidden="true" />
              )}
              {followup ? "Generate follow-up questions" : "Generate quiz"}
            </button>
            <Link to="/app/analysis" className="btn btn-secondary">
              Review analysis first
            </Link>
          </div>
        </section>
      </>
    );
  }

  const answeredCount = Object.keys(answers).length;

  if (phase === "review") {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="eyebrow mb-2">Review · {quiz.questions.length} questions</p>
        <h1 className="text-3xl">Review your answers</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Change anything before submitting. Nothing is graded yet.
        </p>
        {answeredCount < quiz.questions.length && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-developing/40 bg-developing/10 px-4 py-2 text-sm text-developing"
          >
            {quiz.questions.length - answeredCount} unanswered. Unanswered questions add no evidence
            but you can still submit, or answer them now.
          </p>
        )}
        <ol className="mt-6 space-y-2">
          {quiz.questions.map((question, position) => {
            const chosen = answers[question.id];
            return (
              <li key={question.id} className="panel flex flex-wrap items-center gap-4 p-4">
                <span className="font-display text-lg text-muted-foreground">{position + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{question.prompt}</p>
                  <p
                    className={cn("text-xs", chosen ? "text-muted-foreground" : "text-developing")}
                  >
                    {chosen
                      ? `Your answer: ${chosen}. ${question.options[chosen]}`
                      : "Not answered"}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    setIndex(position);
                    setPhase("quiz");
                  }}
                  aria-label={`Change answer to question ${position + 1}`}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" /> Change
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-6 flex justify-between">
          <button type="button" className="btn btn-secondary" onClick={() => setPhase("quiz")}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to questions
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setConfirm(true)}>
            Submit and diagnose
          </button>
        </div>
        {error && <p className="mt-4 text-sm text-developing">{error}</p>}

        <AlertDialog open={confirm} onOpenChange={setConfirm}>
          <AlertDialogContent className="border-border bg-surface">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display text-2xl font-medium">
                Submit your answers?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {answeredCount < quiz.questions.length
                  ? `${quiz.questions.length - answeredCount} question(s) are unanswered. They will count as no evidence.`
                  : "All answered. The server grades them and traces the evidence through prerequisite concepts."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="btn btn-secondary">Keep reviewing</AlertDialogCancel>
              <AlertDialogAction className="btn btn-primary" onClick={() => void submit()}>
                Submit and analyze
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  const question = quiz.questions[index]!;
  const chosen = answers[question.id];

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-border-strong px-2.5 py-0.5 text-muted-foreground">
            From your PDFs
          </span>
          <span className="rounded-full bg-surface-2 px-2.5 py-0.5">
            {question.tested_concept_names.join(", ")}
          </span>
          <span className="rounded-full bg-surface-2 px-2.5 py-0.5 capitalize">
            {question.difficulty}
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {question.source_pages[0]
            ? `${question.source_pages[0].document_name} p.${question.source_pages[0].page}`
            : "Grounded in your documents"}
        </span>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-developing/40 bg-developing/10 px-4 py-2 text-sm text-developing"
        >
          {error}
        </p>
      )}

      {notice && index === 0 && (
        <p className="mb-4 rounded-md border border-border-strong bg-surface-2 px-4 py-2 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Question {index + 1} of {quiz.questions.length}
        </span>
        <span>{answeredCount} answered</span>
      </div>
      <Bar
        value={(index + 1) / quiz.questions.length}
        label={`Question ${index + 1} of ${quiz.questions.length}`}
      />

      <p
        key={`micro-${index}`}
        className="animate-fade-up mt-8 text-sm text-muted-foreground"
        aria-live="polite"
      >
        {MICROCOPY[index % MICROCOPY.length]}
      </p>
      <fieldset key={question.id} className="animate-fade-up mt-3">
        <legend className="font-display text-2xl leading-snug md:text-[1.7rem]">
          {question.prompt}
        </legend>
        <div role="radiogroup" className="mt-6 grid gap-3">
          {KEYS.map((key) => {
            const isSelected = chosen === key;
            return (
              <label
                key={key}
                className={cn(
                  "flex min-h-14 cursor-pointer items-center gap-4 rounded-lg border px-4 py-3 transition-all focus-within:outline-2 focus-within:outline-primary",
                  isSelected
                    ? "border-primary bg-primary/10 glow-ring"
                    : "border-border bg-surface hover:border-border-strong hover:bg-surface-2",
                )}
              >
                <input
                  type="radio"
                  name={`q-${question.id}`}
                  value={key}
                  checked={isSelected}
                  onChange={() => setAnswers((prev) => ({ ...prev, [question.id]: key }))}
                  className="sr-only"
                />
                <span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-md border text-xs font-semibold",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border-strong text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  {key}
                </span>
                <span className="text-base">{question.options[key]}</span>
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
        {index < quiz.questions.length - 1 ? (
          <button type="button" className="btn btn-primary" onClick={() => setIndex(index + 1)}>
            {chosen ? "Next" : "Skip for now"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setPhase("review")}>
            Review answers <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="mt-6 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Sparkles className="h-3 w-3" aria-hidden="true" /> Correct answers are held on the server
        and only revealed after you submit.
      </p>
    </div>
  );
}

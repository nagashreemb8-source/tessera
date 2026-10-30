import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  FlaskConical,
  Loader2,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { StillConfused } from "@/components/StillConfused";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EmptyState, PageHeader, StatusPill } from "@/components/ui/tessera";
import { conceptName, getConcept, isConceptId } from "@/data/concepts";
import { getConceptContent } from "@/data/conceptContent";
import { getPractice, practiceComplete } from "@/data/practice";
import { api, ApiClientError } from "@/services/api";
import type { MaterialItem } from "@/services/apiTypes";
import { useBackend } from "@/state/BackendContext";
import { useStudy } from "@/state/useStudy";
import { cn } from "@/lib/utils";
import { useTessera } from "@/state/AppState";
import type { ConceptId, OptionKey } from "@/types";

const KEYS: OptionKey[] = ["A", "B", "C", "D"];

export function ConceptPage({ id }: { id: string }) {
  const study = useStudy();
  if (study.mode === "backend") {
    return <BackendConcept key={id} conceptId={id} />;
  }
  if (!isConceptId(id)) {
    return (
      <>
        <PageHeader eyebrow="Lesson" title="Concept not found" />
        <EmptyState
          title="That concept doesn't exist"
          body="Pick a concept from the knowledge map or your learning path."
        >
          <Link to="/app/map" className="btn btn-primary">
            Open knowledge map
          </Link>
          <Link to="/app/path" className="btn btn-secondary">
            Learning path
          </Link>
        </EmptyState>
      </>
    );
  }
  return <Lesson conceptId={id} />;
}

function BackendConcept({ conceptId }: { conceptId: string }) {
  const study = useStudy();
  const backend = useBackend();
  const concept = study.conceptById(conceptId);
  const node = backend.analysis?.result?.concepts.find((item) => item.id === conceptId);
  const gap = study.diagnosis?.gaps.find((item) => item.conceptId === conceptId);
  const done = study.completedSteps.includes(conceptId);
  const [material, setMaterial] = useState<MaterialItem | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<{
    name: string;
    page: number;
    text: string | null;
    error: string | null;
  } | null>(null);

  if (!concept || !node) {
    return (
      <>
        <PageHeader eyebrow="Concept" title="Concept not found" />
        <EmptyState
          title="That concept isn't in this study set"
          body="Pick a concept from the knowledge map or your learning path."
        >
          <Link to="/app/map" className="btn btn-primary">
            Open knowledge map
          </Link>
        </EmptyState>
      </>
    );
  }

  const names = new Map(study.concepts.map((item) => [item.id, item.name]));

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const result = await api.generateMaterial("simplified-explanation", {
        concept_ids: [conceptId],
      });
      setMaterial(result);
      await backend.refreshMaterials();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not generate an explanation.");
    } finally {
      setGenerating(false);
    }
  };

  const openPage = async (documentId: string, name: string, pageNo: number) => {
    setPage({ name, page: pageNo, text: null, error: null });
    try {
      const payload = await api.getPage(documentId, pageNo);
      setPage({ name, page: pageNo, text: payload.text, error: null });
    } catch (err) {
      setPage({
        name,
        page: pageNo,
        text: null,
        error: err instanceof ApiClientError ? err.message : "Could not load that page.",
      });
    }
  };

  return (
    <>
      <nav aria-label="Lesson navigation" className="mb-4">
        <Link to="/app/path" className="btn btn-quiet -ml-3">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Learning path
        </Link>
      </nav>

      <PageHeader
        eyebrow="Concept from your documents"
        title={concept.name}
        sub={concept.description}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {study.statuses && <StatusPill status={study.statuses[conceptId] ?? "untested"} />}
            <button
              type="button"
              className={cn("btn", done ? "btn-quiet" : "btn-secondary")}
              onClick={() => study.toggleStep(conceptId)}
            >
              {done ? (
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              )}
              {done ? "Mark not done" : "Mark done"}
            </button>
          </div>
        }
      />

      {concept.prerequisites.length > 0 && (
        <p className="-mt-4 mb-6 text-sm text-muted-foreground">
          Builds on:{" "}
          {concept.prerequisites.map((prerequisite, index) => (
            <span key={prerequisite}>
              {index > 0 && ", "}
              <Link
                to="/app/concept/$id"
                params={{ id: prerequisite }}
                className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-primary"
              >
                {names.get(prerequisite) ?? prerequisite}
              </Link>
            </span>
          ))}
        </p>
      )}

      {gap && (
        <p className="mb-6 rounded-md border border-border bg-surface-2 p-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Why this concept? </span>
          {gap.summary} This is a hypothesis from your answers, not a conclusion.
        </p>
      )}

      {page && (
        <Sheet open onOpenChange={(open) => !open && setPage(null)}>
          <SheetContent className="w-full border-border bg-surface sm:max-w-lg">
            <SheetHeader>
              <p className="eyebrow">{page.name}</p>
              <SheetTitle className="font-display text-2xl font-medium">
                Page {page.page}
              </SheetTitle>
              <SheetDescription>Text extracted from your uploaded PDF.</SheetDescription>
            </SheetHeader>
            <div className="mt-4 max-h-[65vh] overflow-y-auto whitespace-pre-wrap px-4 text-sm leading-relaxed">
              {page.text ??
                (page.error ? (
                  <span className="text-developing">{page.error}</span>
                ) : (
                  "Loading page…"
                ))}
            </div>
          </SheetContent>
        </Sheet>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <section className="panel p-6" aria-labelledby="explain">
            <h2 id="explain" className="text-2xl">
              From your material
            </h2>
            <p className="mt-3 leading-relaxed">{node.description || concept.description}</p>
            {(node.source_pages ?? []).length > 0 && (
              <>
                <p className="mt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Source pages
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {node.source_pages.map((ref) => (
                    <li key={ref.document_id}>
                      <button
                        type="button"
                        className="btn btn-secondary h-8 min-h-8 px-2.5 text-[11px]"
                        onClick={() =>
                          void openPage(
                            ref.document_id,
                            backend.documents.find((doc) => doc.id === ref.document_id)?.filename ??
                              "Document",
                            ref.pages[0] ?? 1,
                          )
                        }
                      >
                        <BookOpen className="h-3 w-3" aria-hidden="true" /> Pages{" "}
                        {ref.pages.join(", ")}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="panel p-6" aria-labelledby="simple">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="simple" className="text-2xl">
                Explain it simply
              </h2>
              <button
                type="button"
                className="btn btn-primary h-9 text-xs"
                disabled={generating}
                onClick={() => void generate()}
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {generating ? "Generating…" : "Generate explanation"}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Grounds a plain-language explanation and an analogy in the passages about this
              concept.
            </p>
            {error && (
              <p role="alert" className="mt-3 text-sm text-developing">
                {error}
              </p>
            )}
            {material ? (
              <div className="mt-4 animate-fade-up">
                <p className="font-display text-xl">{material.payload.title}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                  {material.payload.explanation}
                </p>
                {material.payload.analogy && (
                  <p className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                    <span className="font-medium text-primary">Analogy. </span>
                    {material.payload.analogy}
                  </p>
                )}
              </div>
            ) : (
              !generating && (
                <p className="mt-4 text-sm text-muted-foreground">Nothing generated yet.</p>
              )
            )}
          </section>
        </div>

        <aside className="panel h-fit p-6 lg:sticky lg:top-20" aria-labelledby="actions">
          <h2 id="actions" className="text-2xl">
            Work on this concept
          </h2>
          <div className="mt-4 flex flex-col gap-2">
            <Link to="/app/tutor" className="btn btn-primary">
              Ask the tutor about it
            </Link>
            <Link to="/app/materials" className="btn btn-secondary">
              Generate flashcards or notes
            </Link>
            <Link to="/app/diagnose" className="btn btn-secondary">
              Quiz me on this
            </Link>
            {gap && (
              <Link to="/app/replay" search={{ concept: conceptId }} className="btn btn-secondary">
                <FlaskConical className="h-4 w-4" aria-hidden="true" /> Investigate this hypothesis
              </Link>
            )}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Lessons for AI mode are generated from your PDFs. Demo mode has hand-written lessons for
            the sample subject.
          </p>
        </aside>
      </div>
    </>
  );
}

function Lesson({ conceptId }: { conceptId: ConceptId }) {
  const { state, dispatch, statuses, path } = useTessera();
  const [picks, setPicks] = useState<Record<string, OptionKey>>({});
  const concept = getConcept(conceptId);
  const content = getConceptContent(conceptId);
  const questions = getPractice(conceptId);
  const completed = state.completedSteps.includes(conceptId);
  const gap = state.diagnosis?.gaps.find((g) => g.conceptId === conceptId);
  const nextStep = path.find(
    (s) => s.conceptId !== conceptId && !state.completedSteps.includes(s.conceptId),
  );

  // ConceptPage only renders Lesson for ids that exist in the demo subject.
  if (!concept || !content) return null;

  const check = (qid: string) => {
    const option = picks[qid];
    const q = questions.find((x) => x.id === qid);
    if (!option || !q) return;
    dispatch({ type: "practiceAnswer", key: qid, option });
    const after = { ...state.lessonAnswers, [qid]: option };
    if (practiceComplete(conceptId, after) && !completed) {
      dispatch({ type: "completeLesson", conceptId });
      toast.success(`${concept.name} complete`, {
        description: "Your path, map and overview are updated.",
      });
    }
  };

  const answeredCount = questions.filter((q) => state.lessonAnswers[q.id] === q.correct).length;
  const maxBar = Math.max(...content.bars.map((b) => b.value), 0.01);

  return (
    <>
      <nav aria-label="Lesson navigation" className="mb-4">
        <Link to="/app/path" className="btn btn-quiet -ml-3">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Learning path
        </Link>
      </nav>

      <PageHeader
        eyebrow="Lesson"
        title={concept.name}
        sub={concept.description}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {statuses && <StatusPill status={statuses[conceptId] ?? "untested"} />}
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {concept.minutes} min
            </span>
          </div>
        }
      />

      {concept.prerequisites.length > 0 && (
        <p className="-mt-4 mb-6 text-sm text-muted-foreground">
          Builds on:{" "}
          {concept.prerequisites.map((p, i) => (
            <span key={p}>
              {i > 0 && ", "}
              <Link
                to="/app/concept/$id"
                params={{ id: p }}
                className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-primary"
              >
                {conceptName(p)}
              </Link>
            </span>
          ))}
        </p>
      )}

      {gap && (
        <p className="mb-6 rounded-md border border-border bg-surface-2 p-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Why this lesson? </span>
          {gap.summary} This is a hypothesis from a short diagnostic, not a conclusion.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <section className="panel p-6" aria-labelledby="explain">
            <h2 id="explain" className="text-2xl">
              The idea
            </h2>
            <div className="mt-3 space-y-3 leading-relaxed">
              {content.explanation.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            <p className="mt-4 overflow-x-auto rounded-md border border-border bg-surface-2 px-4 py-3 font-mono text-sm">
              {content.formula}
            </p>
          </section>

          <section className="panel p-6" aria-labelledby="example">
            <h2 id="example" className="text-2xl">
              Worked example
            </h2>
            <p className="mt-3 font-display text-lg">{content.example.prompt}</p>
            <ol className="mt-4 space-y-2 text-sm">
              {content.example.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs text-muted-foreground"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{s}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 rounded-md bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
              Answer: {content.example.answer}
            </p>
          </section>

          <section className="panel p-6" aria-labelledby="visual">
            <h2 id="visual" className="text-xl">
              See it
            </h2>
            <div
              className="mt-5 flex h-32 items-end gap-3"
              role="img"
              aria-label={content.barsCaption}
            >
              {content.bars.map((b, i) => (
                <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1.5">
                  <div
                    className="w-full max-w-14 rounded-t-sm bg-primary/70"
                    style={{ height: `${Math.max(2, (b.value / maxBar) * 100)}%` }}
                  />
                  <span className="text-[11px] text-muted-foreground">{b.label}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{content.barsCaption}</p>
          </section>
        </div>

        <section className="panel h-fit p-6 lg:sticky lg:top-20" aria-labelledby="practice">
          <div className="flex items-center justify-between">
            <h2 id="practice" className="text-2xl">
              Practice
            </h2>
            <span className="text-xs text-muted-foreground">
              {answeredCount} of {questions.length} correct
            </span>
          </div>

          <div className="mt-5 space-y-7">
            {questions.map((q, qi) => {
              const submitted = state.lessonAnswers[q.id];
              const picked = picks[q.id];
              const right = submitted === q.correct;
              return (
                <fieldset key={q.id}>
                  <legend className="font-display text-lg leading-snug">
                    <span className="mr-2 text-muted-foreground">{qi + 1}.</span>
                    {q.prompt}
                  </legend>
                  <div role="radiogroup" className="mt-3 grid gap-2">
                    {KEYS.map((k) => {
                      const selected = (submitted ?? picked) === k;
                      const showCorrect = submitted !== undefined && k === q.correct;
                      const showWrong = submitted === k && !right;
                      return (
                        <label
                          key={k}
                          className={cn(
                            "flex min-h-12 items-center gap-3 rounded-md border px-3 text-sm transition-colors focus-within:outline-2 focus-within:outline-primary",
                            submitted === undefined ? "cursor-pointer" : "cursor-default",
                            showCorrect && "border-primary bg-primary/10",
                            showWrong && "border-developing bg-developing/10",
                            !showCorrect &&
                              !showWrong &&
                              (selected
                                ? "border-primary bg-primary/10"
                                : "border-border hover:border-border-strong"),
                          )}
                        >
                          <input
                            type="radio"
                            name={q.id}
                            value={k}
                            checked={selected}
                            disabled={submitted !== undefined}
                            onChange={() => setPicks((p) => ({ ...p, [q.id]: k }))}
                            className="sr-only"
                          />
                          <span className="text-xs font-semibold text-muted-foreground">{k}</span>
                          {q.options[k]}
                        </label>
                      );
                    })}
                  </div>

                  {submitted === undefined ? (
                    <button
                      type="button"
                      className="btn btn-primary mt-3"
                      disabled={!picked}
                      onClick={() => check(q.id)}
                    >
                      Check answer
                    </button>
                  ) : (
                    <div className="animate-fade-up mt-3" role="status" aria-live="polite">
                      <p
                        className={cn(
                          "flex items-center gap-2 text-sm font-medium",
                          right ? "text-primary" : "text-developing",
                        )}
                      >
                        {right ? (
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <XCircle className="h-4 w-4" aria-hidden="true" />
                        )}
                        {right ? "Correct" : "Not quite"}
                      </p>
                      {!right && q.wrongNotes[submitted] && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {q.wrongNotes[submitted]}
                        </p>
                      )}
                      <p className="mt-1 text-sm text-muted-foreground">{q.explanation}</p>
                      {!right && (
                        <button
                          type="button"
                          className="btn btn-secondary mt-3"
                          onClick={() => {
                            dispatch({ type: "practiceReset", key: q.id });
                            setPicks((p) => {
                              const n = { ...p };
                              delete n[q.id];
                              return n;
                            });
                          }}
                        >
                          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Try again
                        </button>
                      )}
                    </div>
                  )}
                </fieldset>
              );
            })}
          </div>

          <div className="mt-7 flex items-center justify-between gap-2 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              Answer both correctly to complete this lesson.
            </p>
            <StillConfused
              conceptId={conceptId}
              questionIds={gap?.supportingQuestionIds.filter(
                (x): x is number => typeof x === "number",
              )}
            />
          </div>
        </section>
      </div>

      {completed && (
        <section
          className="panel animate-fade-up mt-6 border-primary/40 p-6"
          role="status"
          aria-label="Lesson complete"
        >
          <p className="eyebrow flex items-center gap-2 text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Lesson complete
          </p>
          <h2 className="mt-2 text-2xl">{concept.name} is now marked as mastered.</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your knowledge map, path and overview have been updated.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {nextStep && (
              <Link
                to="/app/concept/$id"
                params={{ id: nextStep.conceptId }}
                className="btn btn-primary"
              >
                Next: {conceptName(nextStep.conceptId)}{" "}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
            <Link to="/app/path" className="btn btn-secondary">
              Learning path
            </Link>
            <Link to="/app" className={cn("btn", nextStep ? "btn-quiet" : "btn-primary")}>
              Back to overview
            </Link>
          </div>
        </section>
      )}
    </>
  );
}

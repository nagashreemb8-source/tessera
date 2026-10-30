import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  BookOpen,
  CheckCircle2,
  FlaskConical,
  HelpCircle,
  Loader2,
  Plus,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { StillConfused } from "@/components/StillConfused";
import { EmptyState, EvidenceMeter, PageHeader, StatusPill } from "@/components/ui/tessera";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FOLLOW_UPS } from "@/data/questions";
import { evaluateHypothesis } from "@/engine/diagnose";
import { api, ApiClientError } from "@/services/api";
import type {
  ConceptId,
  GapPageReference,
  HypothesisOutcome,
  OptionKey,
  SuspectedGap,
} from "@/types";
import { useTessera } from "@/state/AppState";
import { useStudy } from "@/state/useStudy";
import { cn } from "@/lib/utils";

const OUTCOME_STYLE: Record<HypothesisOutcome, { icon: typeof CheckCircle2; cls: string }> = {
  "possible-gap": {
    icon: TriangleAlert,
    cls: "border-developing/50 bg-developing/10 text-developing",
  },
  "more-evidence": { icon: HelpCircle, cls: "border-violet/50 bg-violet/10 text-violet" },
  supported: { icon: ShieldCheck, cls: "border-primary/50 bg-primary/10 text-primary" },
};

export function ReplayPage({ concept }: { concept?: ConceptId | undefined }) {
  const study = useStudy();
  const demo = useTessera();
  const navigate = useNavigate();
  const gaps = study.diagnosis?.gaps ?? [];
  const gap = gaps.find((item) => item.conceptId === concept) ?? gaps[0];
  const [selectedQ, setSelectedQ] = useState<string | number | null>(null);
  const [testing, setTesting] = useState(false);
  const [pick, setPick] = useState<OptionKey | null>(null);
  const [page, setPage] = useState<GapPageReference | null>(null);
  const [pageText, setPageText] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  if (!study.diagnosis || !study.statuses) {
    return (
      <>
        <PageHeader eyebrow="Root Cause Replay" title="Nothing to investigate yet" />
        <EmptyState
          title={study.mode === "backend" ? "Run a quiz first" : "Run a diagnostic first"}
          body="Root Cause Replay traces your answers back through prerequisite concepts. It needs answers to work with."
        >
          <Link to="/app/diagnose" className="btn btn-primary">
            {study.mode === "backend" ? "Generate a quiz" : "Start a diagnostic"}
          </Link>
        </EmptyState>
      </>
    );
  }
  if (!gap) {
    return (
      <>
        <PageHeader eyebrow="Root Cause Replay" title="No suspected gaps" />
        <EmptyState
          title="Every tested concept looked solid"
          body="There's nothing to trace back this time. Explore the knowledge map to see what's next."
        >
          <Link to="/app/map" className="btn btn-primary">
            Open knowledge map
          </Link>
        </EmptyState>
      </>
    );
  }

  const observed = study.diagnosis.observed.find((item) =>
    gap.supportingQuestionIds.includes(item.questionId),
  );
  const gapConcept = study.conceptById(gap.conceptId);
  const trail: ConceptId[] = [];
  if (gap.kind === "prerequisite" && gap.dependentConceptIds[0])
    trail.push(gap.dependentConceptIds[0]);
  trail.push(gap.conceptId);
  if (gapConcept?.prerequisites[0]) trail.push(gapConcept.prerequisites[0]);

  const localResult = demo.state.hypotheses[gap.conceptId];
  const outcome: HypothesisOutcome | null =
    study.mode === "demo" ? (localResult?.outcome ?? null) : (gap.hypothesisOutcome ?? null);
  const followUp = FOLLOW_UPS[gap.conceptId];

  const openPage = async (ref: GapPageReference) => {
    setPage(ref);
    setPageText(null);
    setPageError(null);
    try {
      const payload = await api.getPage(ref.documentId, ref.page);
      setPageText(payload.text);
    } catch (err) {
      setPageError(err instanceof ApiClientError ? err.message : "Could not load that page.");
    }
  };

  const runTest = () => {
    if (!pick) return;
    const result = evaluateHypothesis(gap.conceptId, pick);
    demo.dispatch({ type: "hypothesis", result });
    toast(result.title, { description: `${study.conceptName(gap.conceptId)} status updated.` });
  };

  const startBackendFollowUp = () => {
    navigate({ to: "/app/diagnose", search: { concept: gap.conceptId, followup: true } });
  };

  return (
    <>
      <PageHeader
        eyebrow="Root Cause Replay"
        title={`Why did ${study.conceptName(trail[0] ?? gap.conceptId).toLowerCase()} go wrong?`}
        sub="Tessera is testing a hypothesis about a concept, not judging you."
        actions={
          gaps.length > 1 ? (
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Suspected gaps">
              {gaps.map((item) => (
                <button
                  key={item.conceptId}
                  role="tab"
                  aria-selected={item.conceptId === gap.conceptId}
                  className={cn(
                    "btn h-9 text-xs",
                    item.conceptId === gap.conceptId ? "btn-secondary" : "btn-quiet",
                  )}
                  onClick={() => {
                    setSelectedQ(null);
                    setTesting(false);
                    setPick(null);
                    navigate({ to: "/app/replay", search: { concept: item.conceptId } });
                  }}
                >
                  {item.conceptName ?? study.conceptName(item.conceptId)}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px_minmax(0,1.15fr)]">
        {/* Evidence */}
        <section className="panel p-5" aria-labelledby="ev">
          <p id="ev" className="eyebrow">
            Evidence
          </p>
          <ul
            className="mt-3 flex flex-wrap gap-1.5"
            role="listbox"
            aria-label="Supporting questions"
          >
            {gap.supportingQuestionIds.map((id, index) => (
              <li key={String(id)}>
                <button
                  type="button"
                  role="option"
                  aria-selected={id === (selectedQ ?? gap.supportingQuestionIds[0])}
                  onClick={() => setSelectedQ(id)}
                  className={cn(
                    "h-9 rounded-md border px-3 text-sm transition-colors",
                    id === (selectedQ ?? gap.supportingQuestionIds[0])
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
                  )}
                >
                  Question {index + 1}
                </button>
              </li>
            ))}
          </ul>
          {observed ? (
            <div key={String(observed.questionId)} className="animate-fade-up mt-5">
              <p className="text-xs text-muted-foreground">
                Observed ·{" "}
                {observed.conceptNames?.join(", ") ??
                  observed.conceptIds.map(study.conceptName).join(", ")}
                {observed.unanswered && " · unanswered"}
              </p>
              <p className="mt-1 font-display text-lg leading-snug">
                {observed.prompt ?? "Question"}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div className="panel-raised p-3">
                  <dt className="text-xs text-muted-foreground">Your answer</dt>
                  <dd className="mt-1 font-medium text-developing">
                    {observed.chosen
                      ? `${observed.chosen} · ${observed.options?.[observed.chosen] ?? ""}`
                      : observed.unanswered
                        ? "Not answered"
                        : "—"}
                  </dd>
                </div>
                <div className="panel-raised p-3">
                  <dt className="text-xs text-muted-foreground">Correct</dt>
                  <dd className="mt-1 font-medium text-primary">
                    {observed.correctAnswer} · {observed.options?.[observed.correctAnswer] ?? ""}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Observed error pattern
              </p>
              <p className="mt-1 text-sm">{observed.pattern}</p>
            </div>
          ) : (
            <p className="mt-5 text-sm text-muted-foreground">
              No individual question evidence was retained for this hypothesis.
            </p>
          )}
        </section>

        {/* Concept trail */}
        <section className="panel relative overflow-hidden p-5" aria-labelledby="trail">
          <div
            className="grid-lines pointer-events-none absolute inset-0 opacity-30"
            aria-hidden="true"
          />
          <p id="trail" className="eyebrow relative">
            Concept trail
          </p>
          <ol className="relative mt-5 flex flex-col items-stretch">
            {trail.map((id, i) => {
              const focus = id === gap.conceptId;
              return (
                <li key={`${id}-${i}`} className="flex flex-col items-center">
                  {i > 0 && (
                    <div className="flex h-12 flex-col items-center" aria-hidden="true">
                      <svg width="12" height="48">
                        <line
                          x1="6"
                          y1="0"
                          x2="6"
                          y2="40"
                          strokeWidth="1.5"
                          className={cn(
                            i === 1 || focus
                              ? "stroke-primary animate-dash"
                              : "stroke-muted-foreground/40",
                          )}
                        />
                      </svg>
                    </div>
                  )}
                  <Link
                    to="/app/concept/$id"
                    params={{ id }}
                    className={cn(
                      "block w-full rounded-lg border p-4 transition-all",
                      focus
                        ? "border-primary bg-surface-2 glow-ring"
                        : "border-border bg-surface hover:border-border-strong",
                    )}
                  >
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {i === 0 && trail.length > 2
                        ? "Where it showed up"
                        : focus
                          ? "Under investigation"
                          : "Builds on"}
                    </span>
                    <span className="mt-1 block font-display text-lg">{study.conceptName(id)}</span>
                    <StatusPill status={study.statuses?.[id] ?? "untested"} className="mt-2" />
                  </Link>
                </li>
              );
            })}
          </ol>
          <p className="relative mt-5 flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
            <ArrowDown className="h-3 w-3" aria-hidden="true" /> advanced → foundational
          </p>
        </section>

        {/* Investigation result */}
        <section className="panel p-5" aria-labelledby="inv">
          <p id="inv" className="eyebrow">
            Investigation result
          </p>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-primary">
            {gap.needsMoreEvidence
              ? "More evidence needed"
              : gap.kind === "prerequisite"
                ? "Possible foundational gap"
                : "Possible gap"}
          </p>
          <h2 className="mt-1 text-3xl">{gap.conceptName ?? study.conceptName(gap.conceptId)}</h2>
          <p className="mt-3 text-sm text-muted-foreground">{gap.summary}</p>
          {gap.why && <p className="mt-2 text-sm text-muted-foreground">{gap.why}</p>}
          {gap.supportedPrerequisites.length > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              Prerequisite understanding supported:{" "}
              {gap.supportedPrerequisites.map(study.conceptName).join(", ")}.
            </p>
          )}

          <div className="mt-5">
            <EvidenceMeter level={gap.evidence} />
            <p className="mt-1 text-xs text-muted-foreground">
              {gap.supportingQuestionIds.length} supporting answer(s)
            </p>
          </div>

          {gap.pageReferences && gap.pageReferences.length > 0 && (
            <div className="mt-5">
              <p className="text-sm font-medium">Where to read this in your PDF</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {gap.pageReferences.map((ref) => (
                  <li key={`${ref.documentId}-${ref.page}`}>
                    <button
                      type="button"
                      className="btn btn-secondary h-8 min-h-8 px-2.5 text-[11px]"
                      onClick={() => void openPage(ref)}
                    >
                      <BookOpen className="h-3 w-3" aria-hidden="true" /> {ref.documentName} p.
                      {ref.page}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5">
            <p className="text-sm font-medium">Other explanations to consider</p>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              {gap.alternatives.map((alternative) => (
                <li key={alternative} className="flex gap-2">
                  <span
                    className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground"
                    aria-hidden="true"
                  />
                  {alternative}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6 border-t border-border pt-5">
            {outcome ? (
              <div className="animate-fade-up" aria-live="polite">
                {(() => {
                  const style = OUTCOME_STYLE[outcome];
                  const copy =
                    study.mode === "demo"
                      ? localResult?.explanation
                      : outcome === "supported"
                        ? "Your follow-up answers supported your understanding of this concept, so it is no longer treated as the likely gap."
                        : outcome === "possible-gap"
                          ? "The follow-up answers repeated a misconception, so this remains a plausible gap."
                          : "The follow-up did not settle the question. Another short quiz would add evidence.";
                  return (
                    <div className={cn("rounded-lg border p-4", style.cls)}>
                      <p className="flex items-center gap-2 font-medium">
                        <style.icon className="h-4 w-4" aria-hidden="true" />
                        {outcome === "supported"
                          ? "Understanding supported"
                          : outcome === "possible-gap"
                            ? "Possible gap detected"
                            : "More evidence needed"}
                      </p>
                      <p className="mt-2 text-sm text-foreground">{copy}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Status now: {study.statuses?.[gap.conceptId] ?? "untested"}.
                      </p>
                    </div>
                  );
                })()}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => navigate({ to: "/app/path" })}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" /> Go to learning path
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setPick(null);
                      setTesting(true);
                      if (study.mode === "demo")
                        demo.dispatch({
                          type: "log",
                          label: "Retrying follow-up",
                          detail: study.conceptName(gap.conceptId),
                        });
                    }}
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" /> Test again
                  </button>
                </div>
              </div>
            ) : !testing ? (
              <button
                type="button"
                className="btn btn-primary h-12 w-full text-base"
                onClick={() => {
                  if (study.mode === "backend") startBackendFollowUp();
                  else setTesting(true);
                }}
              >
                <FlaskConical className="h-4 w-4" aria-hidden="true" /> Test this hypothesis
              </button>
            ) : null}

            {study.mode === "backend" && gap.recommendedFollowUp && (
              <p className="mt-3 rounded-md border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
                Recommended confirming follow-up: {gap.recommendedFollowUp.prompt}
              </p>
            )}

            {study.mode === "demo" && followUp && testing && (!localResult || pick === null) && (
              <fieldset className={cn("animate-fade-up", localResult && "mt-5")}>
                <legend className="text-sm font-medium">Follow-up question</legend>
                <p className="mt-2 font-display text-lg leading-snug">{followUp.prompt}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(Object.keys(followUp.options) as OptionKey[]).map((key) => (
                    <label
                      key={key}
                      className={cn(
                        "flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 text-sm transition-all focus-within:outline-2 focus-within:outline-primary",
                        pick === key
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-border-strong",
                      )}
                    >
                      <input
                        type="radio"
                        name="followup"
                        className="sr-only"
                        checked={pick === key}
                        onChange={() => setPick(key)}
                      />
                      <span className="text-xs font-semibold text-muted-foreground">{key}</span>
                      {followUp.options[key]}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-primary mt-3 w-full"
                  disabled={!pick}
                  onClick={() => {
                    runTest();
                    setTesting(false);
                  }}
                >
                  Check my answer
                </button>
              </fieldset>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between gap-2 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              Tessera is testing a hypothesis about a concept, not judging you.
            </p>
            <StillConfused
              conceptId={gap.conceptId}
              questionIds={gap.supportingQuestionIds.filter(
                (id): id is number => typeof id === "number",
              )}
            />
          </div>
        </section>
      </div>

      <Dialog open={!!page} onOpenChange={(open) => !open && setPage(null)}>
        <DialogContent className="max-w-2xl border-border bg-surface">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-medium">
              {page?.documentName}
            </DialogTitle>
            <DialogDescription>
              Page {page?.page} · extracted text from your upload
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
            {pageText ??
              (pageError ? (
                <span className="text-developing">{pageError}</span>
              ) : (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading page…
                </span>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

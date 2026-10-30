import { Link } from "@tanstack/react-router";
import { ArrowRight, Eye, Microscope } from "lucide-react";
import { EmptyState, EvidenceMeter, PageHeader, StatusPill } from "@/components/ui/tessera";
import { QUESTION_BY_ID } from "@/data/questions";
import { useBackend } from "@/state/BackendContext";
import { useStudy } from "@/state/useStudy";

export function ResultsPage() {
  const study = useStudy();
  const backend = useBackend();
  const { diagnosis, statuses } = study;

  if (!diagnosis || !statuses) {
    return (
      <>
        <PageHeader title="Diagnostic summary" />
        <EmptyState
          title="No results yet"
          body={
            study.mode === "backend"
              ? "Generate and submit a quiz from your documents first. Results show observed mistakes and suspected gaps side by side."
              : "Run the diagnostic first. Results show observed mistakes and suspected gaps side by side."
          }
        >
          <Link to="/app/diagnose" className="btn btn-primary">
            {study.mode === "backend" ? "Generate a quiz" : "Start a diagnostic"}
          </Link>
        </EmptyState>
      </>
    );
  }

  const latestAttempt = backend.progress?.attempts.at(-1);
  const score =
    study.mode === "demo"
      ? study.results
        ? `${study.results.score}/${study.results.total}`
        : null
      : latestAttempt
        ? `${latestAttempt.score}/${latestAttempt.total}`
        : null;
  const answeredNote =
    study.mode === "demo" && study.results && study.results.answered < study.results.total
      ? ` · ${study.results.total - study.results.answered} unanswered`
      : "";

  return (
    <>
      <PageHeader
        eyebrow="Diagnostic summary"
        title="Here's what your answers suggest."
        sub="Observed mistakes are facts. Suspected gaps are hypotheses, and every hypothesis can be tested."
        actions={
          score ? (
            <span className="panel-raised px-3 py-2 text-sm text-muted-foreground">
              Score {score}
              {answeredNote}
            </span>
          ) : undefined
        }
      />

      <section aria-labelledby="breakdown" className="panel p-6">
        <h2 id="breakdown" className="text-xl">
          Concept status
        </h2>
        {study.concepts.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No concepts in this study set yet.</p>
        ) : (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {study.concepts.map((concept) => {
              const stats = study.conceptStats(concept.id);
              return (
                <li key={concept.id} className="panel-raised p-3">
                  <p className="text-sm font-medium">{concept.name}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <StatusPill status={statuses[concept.id] ?? "untested"} />
                    <span className="text-right text-xs text-muted-foreground">
                      {stats.answered
                        ? `${stats.correct}/${stats.answered} correct`
                        : "no questions"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="observed" className="panel p-6">
          <h2 id="observed" className="flex items-center gap-2 text-xl">
            <Eye className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Observed mistakes
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">What you actually answered.</p>
          {diagnosis.observed.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No mistakes observed.</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {diagnosis.observed.map((observed) => {
                const localQuestion =
                  typeof observed.questionId === "number"
                    ? QUESTION_BY_ID[observed.questionId]
                    : undefined;
                const prompt = observed.prompt ?? localQuestion?.prompt ?? "Question";
                const options = observed.options ?? localQuestion?.options;
                const names =
                  observed.conceptNames?.join(", ") ??
                  observed.conceptIds.map(study.conceptName).join(", ");
                return (
                  <li key={String(observed.questionId)} className="py-4">
                    <p className="text-xs text-muted-foreground">{names}</p>
                    <p className="mt-1 text-sm">{prompt}</p>
                    <p className="mt-2 text-sm">
                      <span className="text-developing">
                        Chose{" "}
                        {observed.chosen
                          ? `${observed.chosen}${options?.[observed.chosen] ? ` (${options[observed.chosen]})` : ""}`
                          : "nothing"}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}
                        · correct {observed.correctAnswer}
                        {options?.[observed.correctAnswer]
                          ? ` (${options[observed.correctAnswer]})`
                          : ""}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Likely pattern: {observed.pattern}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="suspected" className="panel p-6">
          <h2 id="suspected" className="flex items-center gap-2 text-xl">
            <Microscope className="h-4 w-4 text-primary" aria-hidden="true" /> Suspected gaps
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Hypotheses consistent with the pattern. Not conclusions.
          </p>
          {diagnosis.gaps.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No gaps suspected.{" "}
              {study.mode === "backend"
                ? "Answer more questions to strengthen the evidence."
                : "Nice work."}
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {diagnosis.gaps.map((gap) => (
                <li key={gap.conceptId} className="panel-raised p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                    {gap.needsMoreEvidence
                      ? "More evidence needed"
                      : gap.kind === "prerequisite"
                        ? "Possible foundational gap"
                        : "Possible gap"}
                  </p>
                  <p className="mt-1 font-display text-2xl">
                    {gap.conceptName ?? study.conceptName(gap.conceptId)}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{gap.summary}</p>
                  <div className="mt-3">
                    <EvidenceMeter level={gap.evidence} />
                  </div>
                  <Link
                    to="/app/replay"
                    search={{ concept: gap.conceptId }}
                    className="btn btn-primary mt-4"
                  >
                    Investigate in Root Cause Replay{" "}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section
        className="panel mt-5 flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between"
        aria-label="Next steps"
      >
        <div>
          <h2 className="text-xl">What next?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Test a hypothesis, see how concepts connect, or go straight to your learning path.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/map" className="btn btn-secondary">
            Knowledge map
          </Link>
          <Link to="/app/path" className="btn btn-primary">
            Learning path <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </>
  );
}

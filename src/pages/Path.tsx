import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Check, Clock, Undo2 } from "lucide-react";
import { Bar, EmptyState, PageHeader, StatusPill } from "@/components/ui/tessera";
import { useStudy } from "@/state/useStudy";
import { cn } from "@/lib/utils";

export function PathPage() {
  const study = useStudy();
  const { statuses, path } = study;

  if (!study.diagnosis || !statuses) {
    return (
      <>
        <PageHeader eyebrow="Learning path" title="Your personalised path" />
        <EmptyState
          title="No path yet"
          body={
            study.mode === "backend"
              ? "Your path is built from graded quizzes and the concept map in your documents, so it needs a diagnostic first."
              : "Your path is built from your diagnostic results, so Tessera needs them first."
          }
        >
          <Link to="/app/diagnose" className="btn btn-primary">
            {study.mode === "backend" ? "Take a quiz" : "Start a diagnostic"}
          </Link>
        </EmptyState>
      </>
    );
  }

  if (path.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Learning path" title="Your personalised path" />
        <EmptyState
          title="Nothing to review right now"
          body="Every concept you were tested on looked solid. Explore the knowledge map to see what's next."
        >
          <Link to="/app/map" className="btn btn-primary">
            Open knowledge map
          </Link>
        </EmptyState>
      </>
    );
  }

  const isDone = (conceptId: string) => study.completedSteps.includes(conceptId);
  const completed = path.filter((step) => isDone(step.conceptId)).length;
  const minutesFor = (conceptId: string, stepMinutes?: number) =>
    stepMinutes ?? study.conceptById(conceptId)?.minutes ?? 15;
  const minutesTotal = path.reduce(
    (total, step) => total + minutesFor(step.conceptId, step.minutes),
    0,
  );
  const minutesLeft = path
    .filter((step) => !isDone(step.conceptId))
    .reduce((total, step) => total + minutesFor(step.conceptId, step.minutes), 0);
  const next = path.find((step) => !isDone(step.conceptId));

  return (
    <>
      <PageHeader
        eyebrow="Learning path"
        title="Your personalised path"
        sub="Ordered so that no lesson comes before the concepts it builds on. Reading references point into your own PDFs."
        actions={
          next ? (
            <Link to="/app/concept/$id" params={{ id: next.conceptId }} className="btn btn-primary">
              {completed === 0 ? "Start" : "Continue"}: {study.conceptName(next.conceptId)}{" "}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : (
            <Link to="/app" className="btn btn-primary">
              Back to overview
            </Link>
          )
        }
      />

      <section className="panel mb-6 p-5" aria-label="Path progress">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium">
            {completed} of {path.length} steps complete
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {minutesLeft === 0 ? "All done" : `about ${minutesLeft} of ${minutesTotal} min left`}
          </span>
        </div>
        <div className="mt-3">
          <Bar
            value={completed / path.length}
            label={`${completed} of ${path.length} learning steps complete`}
          />
        </div>
        {completed === path.length && (
          <p className="mt-4 text-sm text-primary" role="status">
            Path complete.{" "}
            {study.mode === "backend"
              ? "Take another quiz to see how the picture has changed."
              : "Retake the diagnostic from Progress to see how your picture has changed."}
          </p>
        )}
      </section>

      <ol className="space-y-3">
        {path.map((step, index) => {
          const concept = study.conceptById(step.conceptId);
          const done = isDone(step.conceptId);
          const waiting = step.prerequisitesInPath.filter((prerequisite) => !isDone(prerequisite));
          const isNext = next?.conceptId === step.conceptId;
          const references = step.pageReferences ?? [];
          return (
            <li
              key={`${step.conceptId}-${index}`}
              className={cn(
                "panel p-5 transition-colors",
                isNext && !done && "border-primary/50",
                done && "opacity-80",
              )}
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-start">
                <div className="flex items-start gap-4 md:flex-1">
                  <span
                    className={cn(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-full border text-sm font-semibold",
                      done
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border-strong text-muted-foreground",
                    )}
                    aria-hidden="true"
                  >
                    {done ? <Check className="h-4 w-4" /> : index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Step {index + 1} · {step.verb}
                      {done && " · complete"}
                    </p>
                    <h2 className="mt-0.5 text-2xl">
                      {concept?.name ?? step.conceptName ?? step.conceptId}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">{step.reason}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <StatusPill status={statuses[step.conceptId] ?? "untested"} />
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" aria-hidden="true" />{" "}
                        {minutesFor(step.conceptId, step.minutes)} min
                      </span>
                      {!done && waiting.length > 0 && (
                        <span>Best after {waiting.map(study.conceptName).join(" and ")}</span>
                      )}
                    </div>

                    {references.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {references.map((reference) => (
                          <span
                            key={`${reference.documentId}-${reference.pages.join(",")}`}
                            className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            <BookOpen className="h-3 w-3" aria-hidden="true" />
                            {reference.documentName} · p.{reference.pages.join(", ")}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <Link
                    to="/app/concept/$id"
                    params={{ id: step.conceptId }}
                    className={cn("btn", isNext && !done ? "btn-primary" : "btn-secondary")}
                  >
                    {done ? "Review" : "Open"}
                  </Link>
                  <Link to="/app/materials" className="btn btn-quiet">
                    Materials
                  </Link>
                  <button
                    type="button"
                    className={cn("btn", done ? "btn-quiet" : "btn-secondary")}
                    onClick={() => study.toggleStep(step.conceptId)}
                    aria-label={
                      done
                        ? `Mark ${concept?.name ?? step.conceptId} as not complete`
                        : `Mark ${concept?.name ?? step.conceptId} as complete`
                    }
                  >
                    {done ? (
                      <Undo2 className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    )}
                    {done ? "Undo" : "Mark done"}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

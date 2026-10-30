import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  FileText,
  Loader2,
  Microscope,
  RotateCw,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Bar, EmptyState, PageHeader, StatusPill } from "@/components/ui/tessera";
import { SAMPLE_STUDENT, SAMPLE_WEEK } from "@/data/sampleStudent";
import { useBackend } from "@/state/BackendContext";
import { useTessera } from "@/state/AppState";
import { useStudy } from "@/state/useStudy";

export function OverviewPage() {
  const study = useStudy();
  const demo = useTessera();
  const backend = useBackend();
  const [retrying, setRetrying] = useState(false);

  if (study.mode === "backend") {
    const documents = backend.documents.filter((doc) => doc.status !== "rejected");
    const analysisReady = backend.analysis?.status === "ready";
    const analysisRunning = backend.analysis?.status === "running";
    const topGap = study.diagnosis?.gaps[0];
    const firstOpen = study.path.find((step) => !study.completedSteps.includes(step.conceptId));
    const mastered = study.concepts.filter(
      (concept) => study.statuses?.[concept.id] === "mastered",
    ).length;
    const attempted = (backend.progress?.attempts.length ?? 0) > 0;

    return (
      <>
        <PageHeader
          eyebrow="Your study set"
          title="Your learning, decoded."
          sub="Everything below is generated from the documents you uploaded — not from a fixed subject."
          actions={
            <Link to="/app/upload" className="btn btn-secondary">
              <FileText className="h-4 w-4" aria-hidden="true" /> Manage documents
            </Link>
          }
        />

        {backend.error && (
          <div role="alert" className="panel mb-5 flex flex-col gap-3 p-5">
            <AlertTriangle className="h-5 w-5 text-developing" aria-hidden="true" />
            <div>
              <h2 className="text-xl">The backend isn't answering</h2>
              <p className="mt-1 text-sm text-muted-foreground">{backend.error}</p>
            </div>
            <button
              type="button"
              className="btn btn-secondary w-fit"
              disabled={retrying}
              onClick={async () => {
                setRetrying(true);
                await backend.refresh();
                setRetrying(false);
              }}
            >
              <RotateCw
                className={retrying ? "h-4 w-4 animate-spin" : "h-4 w-4"}
                aria-hidden="true"
              />{" "}
              {retrying ? "Retrying…" : "Retry connection"}
            </button>
          </div>
        )}

        {documents.length === 0 ? (
          <EmptyState
            title="Start with a PDF"
            body="Upload lecture notes, a textbook chapter or a paper. Tessera extracts the concepts, tutors you from the text and diagnoses why answers go wrong."
          >
            <Link to="/app/upload" className="btn btn-primary">
              Upload a PDF
            </Link>
          </EmptyState>
        ) : (
          <div className="grid gap-5 lg:grid-cols-3">
            <section
              className="panel relative overflow-hidden p-7 lg:col-span-2"
              aria-labelledby="next"
            >
              <div
                className="bg-hero pointer-events-none absolute inset-0 opacity-70"
                aria-hidden="true"
              />
              <div className="relative">
                <p className="eyebrow flex items-center gap-2 text-primary">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Your next breakthrough
                </p>
                {analysisRunning ? (
                  <>
                    <h2 className="mt-4 text-3xl">Analysing your documents</h2>
                    <p className="mt-3 max-w-xl text-sm text-muted-foreground">
                      {backend.analysis?.stage || "Working…"}
                    </p>
                    <div className="mt-5 max-w-md">
                      <Bar value={backend.analysis?.progress ?? 0} label="Analysis progress" />
                    </div>
                  </>
                ) : !analysisReady ? (
                  <>
                    <h2 id="next" className="mt-4 max-w-xl text-3xl">
                      Your documents are ready to analyse.
                    </h2>
                    <p className="mt-3 max-w-xl text-sm text-muted-foreground">
                      Analysis builds the concept map that powers quizzes, the tutor's focus and
                      root-cause diagnosis.
                    </p>
                    <Link to="/app/analysis" className="btn btn-primary mt-6">
                      <Microscope className="h-4 w-4" aria-hidden="true" /> Open analysis
                    </Link>
                  </>
                ) : topGap ? (
                  <>
                    <h2 id="next" className="mt-4 max-w-xl text-3xl">
                      {topGap.kind === "prerequisite" && topGap.dependentConceptNames?.[0]
                        ? `Review ${study.conceptName(topGap.conceptId).toLowerCase()} before moving deeper into ${topGap.dependentConceptNames[0].toLowerCase()}.`
                        : `Take a closer look at ${study.conceptName(topGap.conceptId).toLowerCase()}.`}
                    </h2>
                    <p className="mt-3 max-w-xl text-sm text-muted-foreground">{topGap.summary}</p>
                    <Link
                      to="/app/replay"
                      search={{ concept: topGap.conceptId }}
                      className="btn btn-primary mt-6"
                    >
                      Investigate <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </>
                ) : firstOpen ? (
                  <>
                    <h2 id="next" className="mt-4 max-w-xl text-3xl">
                      {firstOpen.verb} {study.conceptName(firstOpen.conceptId)} next.
                    </h2>
                    <p className="mt-3 max-w-xl text-sm text-muted-foreground">
                      {firstOpen.reason}
                    </p>
                    <Link
                      to="/app/concept/$id"
                      params={{ id: firstOpen.conceptId }}
                      className="btn btn-primary mt-6"
                    >
                      Open the concept <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </>
                ) : attempted ? (
                  <>
                    <h2 id="next" className="mt-4 text-3xl">
                      No suspected gaps in your latest quiz.
                    </h2>
                    <p className="mt-3 text-sm text-muted-foreground">
                      Take another quiz to test more concepts, or explore your materials.
                    </p>
                    <Link to="/app/materials" className="btn btn-primary mt-6">
                      Study materials
                    </Link>
                  </>
                ) : (
                  <>
                    <h2 id="next" className="mt-4 text-3xl">
                      Test your understanding.
                    </h2>
                    <p className="mt-3 text-sm text-muted-foreground">
                      Generate a diagnostic quiz from your concept map. It is different every time
                      and never reveals answers early.
                    </p>
                    <Link to="/app/diagnose" className="btn btn-primary mt-6">
                      Generate a quiz <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </>
                )}
              </div>
            </section>

            <section className="panel p-6" aria-labelledby="mastery">
              <p className="eyebrow">Overall mastery</p>
              <p id="mastery" className="mt-3 font-display text-5xl">
                {mastered}
                <span className="text-2xl text-muted-foreground">
                  {" "}
                  / {study.concepts.length || "—"}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">concepts mastered</p>
              <div className="mt-4">
                <Bar
                  value={study.concepts.length ? mastered / study.concepts.length : 0}
                  label={`${mastered} of ${study.concepts.length} concepts mastered`}
                />
              </div>
              <dl className="mt-5 space-y-2 text-sm">
                {(["mastered", "developing", "untested"] as const).map((status) => (
                  <div key={status} className="flex items-center justify-between">
                    <dt>
                      <StatusPill status={status} />
                    </dt>
                    <dd className="font-medium tabular-nums">
                      {
                        study.concepts.filter(
                          (concept) => (study.statuses?.[concept.id] ?? "untested") === status,
                        ).length
                      }
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="panel p-6" aria-labelledby="study-set">
              <h2 id="study-set" className="text-xl">
                Study set
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {documents.length} document(s) · {study.concepts.length} concepts
              </p>
              <ul className="mt-3 space-y-1.5">
                {documents.slice(0, 4).map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{doc.filename}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/app/tutor" className="btn btn-secondary">
                  Ask the tutor
                </Link>
                <Link to="/app/materials" className="btn btn-secondary">
                  Materials
                </Link>
              </div>
            </section>

            <section className="panel p-6" aria-labelledby="attempts">
              <h2 id="attempts" className="text-xl">
                Recent attempts
              </h2>
              {(backend.progress?.attempts.length ?? 0) === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No quizzes submitted yet.</p>
              ) : (
                <ol className="mt-4 space-y-2">
                  {(backend.progress?.attempts ?? [])
                    .slice(-4)
                    .reverse()
                    .map((attempt) => (
                      <li
                        key={attempt.id}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="text-muted-foreground">
                          {new Date(attempt.created_at).toLocaleDateString()}
                        </span>
                        <span className="font-medium tabular-nums">
                          {attempt.score}/{attempt.total}
                        </span>
                      </li>
                    ))}
                </ol>
              )}
            </section>

            <section className="panel p-6" aria-labelledby="path-progress">
              <h2 id="path-progress" className="text-xl">
                Learning path
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {study.completedSteps.length} of {study.path.length} steps complete
              </p>
              <div className="mt-3">
                <Bar
                  value={study.path.length ? study.completedSteps.length / study.path.length : 0}
                  label="Learning path progress"
                />
              </div>
              {firstOpen && (
                <p className="mt-4 text-sm">
                  Up next:{" "}
                  <span className="font-medium">
                    {firstOpen.verb} {study.conceptName(firstOpen.conceptId)}
                  </span>
                </p>
              )}
              <div className="mt-4">
                <Link to="/app/path" className="btn btn-secondary">
                  Open path
                </Link>
              </div>
            </section>
          </div>
        )}
      </>
    );
  }

  /* ---------------- demo mode ---------------- */

  const header = (
    <PageHeader
      eyebrow={SAMPLE_STUDENT.subject}
      title="Your learning, decoded."
      sub="See what you understand, what needs attention, and what to explore next. This is the offline demo subject."
    />
  );

  if (demo.state.simulateFailure) {
    return (
      <>
        {header}
        <div role="alert" className="panel flex flex-col items-start gap-4 p-8">
          <AlertTriangle className="h-6 w-6 text-developing" aria-hidden="true" />
          <div>
            <h2 className="text-2xl">Your overview didn't load</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This is a simulated failure for the demo. Your answers are safe in memory.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              setTimeout(() => {
                demo.dispatch({ type: "simulateFailure", value: false });
                setRetrying(false);
              }, 600);
            }}
          >
            <RotateCw
              className={retrying ? "h-4 w-4 animate-spin" : "h-4 w-4"}
              aria-hidden="true"
            />{" "}
            {retrying ? "Retrying…" : "Retry"}
          </button>
        </div>
      </>
    );
  }

  if (!study.diagnosis || !study.statuses) {
    const inProgress = Object.keys(demo.state.answers).length;
    return (
      <>
        {header}
        <EmptyState
          title={inProgress > 0 ? "Diagnostic in progress" : "No diagnostic yet"}
          body={
            inProgress > 0
              ? `You've answered ${inProgress} of ${study.questions.length} questions. Pick up where you left off.`
              : "Take the diagnostic to see which concepts look solid and which might need a closer look."
          }
        >
          <Link to="/app/diagnose" className="btn btn-primary">
            {inProgress > 0 ? "Resume diagnostic" : "Start a diagnostic"}
          </Link>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => demo.dispatch({ type: "loadSampleResults" })}
          >
            Load sample results
          </button>
        </EmptyState>
      </>
    );
  }

  const counts = { mastered: 0, developing: 0, untested: 0 };
  study.concepts.forEach((concept) => counts[study.statuses?.[concept.id] ?? "untested"]++);
  const top = study.diagnosis.gaps[0];
  const firstOpen = study.path.find((step) => !study.completedSteps.includes(step.conceptId));
  const maxMin = Math.max(...SAMPLE_WEEK.map((day) => day.minutes));
  const strengths = study.concepts.filter((concept) => study.statuses?.[concept.id] === "mastered");
  const watch = study.concepts.filter((concept) => study.statuses?.[concept.id] === "developing");
  const untested = study.concepts.filter((concept) => study.statuses?.[concept.id] === "untested");

  return (
    <>
      {header}
      <div className="grid gap-5 lg:grid-cols-3">
        <section
          className="panel relative overflow-hidden p-7 lg:col-span-2"
          aria-labelledby="next"
        >
          <div
            className="bg-hero pointer-events-none absolute inset-0 opacity-70"
            aria-hidden="true"
          />
          <div className="relative">
            <p className="eyebrow flex items-center gap-2 text-primary">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Your next breakthrough
            </p>
            {top ? (
              <>
                <h2 id="next" className="mt-4 max-w-xl text-3xl">
                  {top.kind === "prerequisite" && top.dependentConceptIds[0]
                    ? `Review ${study.conceptName(top.conceptId).toLowerCase()} before moving deeper into ${study.conceptName(top.dependentConceptIds[0]).toLowerCase()}.`
                    : `Take a closer look at ${study.conceptName(top.conceptId).toLowerCase()}.`}
                </h2>
                <p className="mt-3 max-w-xl text-sm text-muted-foreground">{top.summary}</p>
                <Link to="/app/replay" className="btn btn-primary mt-6">
                  Investigate <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </>
            ) : (
              <>
                <h2 id="next" className="mt-4 text-3xl">
                  No suspected gaps in this diagnostic.
                </h2>
                <p className="mt-3 text-sm text-muted-foreground">
                  Every tested concept looked solid. Explore the knowledge map to see what's next.
                </p>
                <Link to="/app/path" className="btn btn-primary mt-6">
                  Open learning path
                </Link>
              </>
            )}
          </div>
        </section>

        <section className="panel p-6" aria-labelledby="mastery">
          <p className="eyebrow">Overall mastery</p>
          <p id="mastery" className="mt-3 font-display text-5xl">
            {counts.mastered}
            <span className="text-2xl text-muted-foreground"> / {study.concepts.length}</span>
          </p>
          <p className="text-sm text-muted-foreground">concepts mastered</p>
          <div className="mt-4">
            <Bar
              value={counts.mastered / study.concepts.length}
              label={`${counts.mastered} of ${study.concepts.length} concepts mastered`}
            />
          </div>
          <dl className="mt-5 space-y-2 text-sm">
            {(["mastered", "developing", "untested"] as const).map((status) => (
              <div key={status} className="flex items-center justify-between">
                <dt>
                  <StatusPill status={status} />
                </dt>
                <dd className="font-medium tabular-nums">{counts[status]}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="panel p-6 lg:col-span-3" aria-labelledby="sg">
          <h2 id="sg" className="text-xl">
            Strengths and areas to explore
          </h2>
          <div className="mt-4 grid gap-5 md:grid-cols-3">
            {(
              [
                ["Strengths", strengths, "No concept has been demonstrated yet."],
                ["Possible gaps", watch, "No possible gaps right now."],
                ["Not yet assessed", untested, "Everything has been assessed."],
              ] as const
            ).map(([title, list, none]) => (
              <div key={title}>
                <p className="eyebrow">{title}</p>
                {list.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">{none}</p>
                ) : (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {list.map((concept) => (
                      <li key={concept.id}>
                        <Link
                          to="/app/concept/$id"
                          params={{ id: concept.id }}
                          className="btn btn-secondary h-8 min-h-8 px-3 text-xs"
                        >
                          {concept.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="panel p-6" aria-labelledby="activity">
          <h2 id="activity" className="text-xl">
            Recent activity
          </h2>
          {study.activity.length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">Nothing yet.</p>
          )}
          <ol className="mt-4 space-y-3">
            {study.activity.slice(0, 5).map((item) => (
              <li key={item.id} className="border-l border-border pl-3">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.detail}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel p-6" aria-labelledby="week">
          <div className="flex items-center justify-between">
            <h2 id="week" className="text-xl">
              This week
            </h2>
            <span className="text-[11px] text-muted-foreground">Sample data</span>
          </div>
          <div
            className="mt-6 flex h-28 items-end gap-2"
            role="img"
            aria-label="Sample study minutes per day this week"
          >
            {SAMPLE_WEEK.map((day) => (
              <div key={day.day} className="flex flex-1 flex-col items-center gap-1.5">
                <div
                  className="w-full rounded-sm bg-primary/70"
                  style={{ height: `${Math.max(4, (day.minutes / maxMin) * 96)}px` }}
                />
                <span className="text-[10px] text-muted-foreground">{day.day}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Study minutes per day (illustrative).
          </p>
        </section>

        <section className="panel p-6" aria-labelledby="up-next">
          <h2 id="up-next" className="text-xl">
            Learning path
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {study.completedSteps.length} of {study.path.length} steps complete
          </p>
          <div className="mt-3">
            <Bar
              value={study.path.length ? study.completedSteps.length / study.path.length : 0}
              label="Learning path progress"
            />
          </div>
          {firstOpen && (
            <p className="mt-4 text-sm">
              Up next:{" "}
              <span className="font-medium">
                {firstOpen.verb} {study.conceptName(firstOpen.conceptId)}
              </span>
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {firstOpen && (
              <Link
                to="/app/concept/$id"
                params={{ id: firstOpen.conceptId }}
                className="btn btn-primary"
              >
                {study.completedSteps.length === 0 ? "Start" : "Continue"} lesson
              </Link>
            )}
            <Link to="/app/path" className="btn btn-secondary">
              Open path
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

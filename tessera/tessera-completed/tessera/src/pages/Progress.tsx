import { Link, useNavigate } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Bar, EmptyState, PageHeader, StatusPill } from "@/components/ui/tessera";
import { PRACTICE } from "@/data/practice";
import { useBackend } from "@/state/BackendContext";
import { useTessera } from "@/state/AppState";
import { useStudy } from "@/state/useStudy";

export function ProgressPage() {
  const study = useStudy();
  const backend = useBackend();
  const demo = useTessera();
  const navigate = useNavigate();

  if (study.mode === "backend") {
    const progress = backend.progress;
    const hasData = (progress?.attempts.length ?? 0) > 0;
    const mastered =
      progress?.concepts.filter((concept) => concept.status === "mastered").length ?? 0;
    const totalConcepts = progress?.concepts.length ?? 0;
    const latest = progress?.attempts.at(-1);
    const trendIcon = (trend: string) =>
      trend === "up" ? "↑" : trend === "down" ? "↓" : trend === "flat" ? "→" : "·";

    return (
      <>
        <PageHeader
          eyebrow="Progress"
          title="How you're doing"
          sub="Everything here comes from your actual answers, documents and follow-up quizzes. It persists across restarts."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link to="/app/diagnose" className="btn btn-primary">
                Take another quiz
              </Link>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={async () => {
                  await backend.refreshPath();
                  toast.success("Learning path refreshed");
                }}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> Refresh path
              </button>
            </div>
          }
        />

        {!hasData ? (
          <EmptyState
            title="No attempts yet"
            body="Upload a PDF, analyse it and submit a quiz. Progress, trends and resolved gaps build up from your own answers."
          >
            <Link to="/app/upload" className="btn btn-primary">
              Upload a PDF
            </Link>
            <Link to="/app/diagnose" className="btn btn-secondary">
              Take a quiz
            </Link>
          </EmptyState>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="panel p-5">
                <dt className="eyebrow">Latest score</dt>
                <dd className="mt-2 font-display text-4xl">
                  {latest ? `${latest.score}/${latest.total}` : "—"}
                </dd>
                <p className="mt-1 text-xs text-muted-foreground">
                  {latest ? new Date(latest.created_at).toLocaleString() : "no attempts"}
                </p>
              </div>
              <div className="panel p-5">
                <dt className="eyebrow">Concepts mastered</dt>
                <dd className="mt-2 font-display text-4xl">
                  {mastered}
                  <span className="text-2xl text-muted-foreground"> / {totalConcepts}</span>
                </dd>
                <p className="mt-1 text-xs text-muted-foreground">
                  from graded quizzes and follow-ups
                </p>
              </div>
              <div className="panel p-5">
                <dt className="eyebrow">Gaps resolved</dt>
                <dd className="mt-2 font-display text-4xl">{progress?.gaps_resolved ?? 0}</dd>
                <p className="mt-1 text-xs text-muted-foreground">
                  {progress?.gaps_open ?? 0} open hypothesis(es)
                </p>
              </div>
              <div className="panel p-5">
                <dt className="eyebrow">Study set</dt>
                <dd className="mt-2 font-display text-4xl">{progress?.document_count ?? 0}</dd>
                <p className="mt-1 text-xs text-muted-foreground">
                  documents · {progress?.quiz_count ?? 0} quizzes · {progress?.material_count ?? 0}{" "}
                  materials
                </p>
              </div>
            </dl>

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <section className="panel p-6" aria-labelledby="by-concept">
                <h2 id="by-concept" className="text-xl">
                  By concept
                </h2>
                <ul className="mt-4 divide-y divide-border">
                  {(progress?.concepts ?? []).map((concept) => (
                    <li
                      key={concept.concept_id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
                    >
                      <Link
                        to="/app/concept/$id"
                        params={{ id: concept.concept_id }}
                        className="min-w-0 flex-1 text-sm font-medium hover:text-primary"
                      >
                        {concept.name}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {concept.answered
                          ? `${concept.correct}/${concept.answered} correct`
                          : "Not assessed"}
                      </span>
                      <span
                        className="w-4 text-center text-xs text-muted-foreground"
                        title={`Trend: ${concept.trend}`}
                      >
                        {trendIcon(concept.trend)}
                      </span>
                      <StatusPill status={concept.status} />
                    </li>
                  ))}
                </ul>
              </section>

              <div className="space-y-5">
                <section className="panel p-6" aria-labelledby="overall">
                  <h2 id="overall" className="text-xl">
                    Overall mastery
                  </h2>
                  <div className="mt-4">
                    <Bar
                      value={totalConcepts ? mastered / totalConcepts : 0}
                      label={`${mastered} of ${totalConcepts} concepts mastered`}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Mastered means the latest attempt on that concept was fully correct, or a
                    follow-up confirmed it. Small samples can overstate understanding, so retest
                    later.
                  </p>
                </section>

                <section className="panel p-6" aria-labelledby="timeline">
                  <h2 id="timeline" className="text-xl">
                    Attempts
                  </h2>
                  <ol className="mt-4 space-y-2">
                    {(progress?.attempts ?? [])
                      .slice(-6)
                      .reverse()
                      .map((attempt) => (
                        <li
                          key={attempt.id}
                          className="flex items-center justify-between gap-2 border-l border-border pl-3 text-sm"
                        >
                          <span className="text-muted-foreground">
                            {new Date(attempt.created_at).toLocaleString()}
                          </span>
                          <span className="font-medium tabular-nums">
                            {attempt.score}/{attempt.total}
                          </span>
                        </li>
                      ))}
                  </ol>
                  <div className="mt-4 flex h-20 items-end gap-1.5" aria-hidden="true">
                    {(progress?.attempts ?? []).map((attempt) => (
                      <div
                        key={attempt.id}
                        className="flex-1 rounded-t-sm bg-primary/70"
                        style={{
                          height: `${Math.max(6, (attempt.score / Math.max(1, attempt.total)) * 72)}px`,
                        }}
                      />
                    ))}
                  </div>
                </section>

                <section className="panel p-6" aria-labelledby="log">
                  <h2 id="log" className="text-xl">
                    Activity
                  </h2>
                  {study.activity.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">Nothing yet.</p>
                  ) : (
                    <ol className="mt-4 space-y-3">
                      {study.activity.slice(0, 8).map((item) => (
                        <li
                          key={`${item.id}-${item.detail}`}
                          className="border-l border-border pl-3"
                        >
                          <p className="text-sm font-medium">{item.label}</p>
                          <p className="text-xs text-muted-foreground">{item.detail}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  const { results } = study;
  if (!results || !study.statuses) {
    return (
      <>
        <PageHeader eyebrow="Progress" title="How you're doing" />
        <EmptyState
          title="No progress to show yet"
          body="Take the diagnostic and your progress will build up here as you learn."
        />
      </>
    );
  }

  const mastered = study.concepts.filter(
    (concept) => study.statuses?.[concept.id] === "mastered",
  ).length;
  const lessonsDone = study.completedSteps.length;
  const minutesDone = study.concepts
    .filter((concept) => study.completedSteps.includes(concept.id))
    .reduce((total, concept) => total + concept.minutes, 0);

  const stats = [
    {
      label: "Diagnostic score",
      value: `${results.score}/${results.total}`,
      note:
        results.answered < results.total
          ? `${results.total - results.answered} unanswered`
          : "all answered",
    },
    {
      label: "Concepts mastered",
      value: `${mastered}/${study.concepts.length}`,
      note: "diagnostic + lessons",
    },
    {
      label: "Lessons completed",
      value: String(lessonsDone),
      note: study.path.length ? `of ${study.path.length} in your path` : "no path needed",
    },
    { label: "Study time in lessons", value: `${minutesDone} min`, note: "estimated from lessons" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Progress"
        title="How you're doing"
        sub="Everything here comes from your actual answers and completed lessons."
        actions={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              demo.dispatch({ type: "restart" });
              toast("Diagnostic restarted", {
                description: "Your previous answers and progress were cleared.",
              });
              navigate({ to: "/app/diagnose" });
            }}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Retake diagnostic
          </button>
        }
      />

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((item) => (
          <div key={item.label} className="panel p-5">
            <dt className="eyebrow">{item.label}</dt>
            <dd className="mt-2 font-display text-4xl">{item.value}</dd>
            <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>
          </div>
        ))}
      </dl>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="panel p-6" aria-labelledby="by-concept">
          <h2 id="by-concept" className="text-xl">
            By concept
          </h2>
          <ul className="mt-4 divide-y divide-border">
            {study.concepts.map((concept) => {
              const stats = study.conceptStats(concept.id);
              const practice = PRACTICE[concept.id] ?? [];
              const practiceCorrect = practice.filter(
                (question) => demo.state.lessonAnswers[question.id] === question.correct,
              ).length;
              return (
                <li key={concept.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <Link
                    to="/app/concept/$id"
                    params={{ id: concept.id }}
                    className="min-w-0 flex-1 text-sm font-medium hover:text-primary"
                  >
                    {concept.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {stats.answered
                      ? `Diagnostic ${stats.correct}/${stats.answered}`
                      : "Not assessed"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Practice {practiceCorrect}/{practice.length}
                  </span>
                  <StatusPill status={study.statuses?.[concept.id] ?? "untested"} />
                </li>
              );
            })}
          </ul>
        </section>

        <div className="space-y-5">
          <section className="panel p-6" aria-labelledby="overall">
            <h2 id="overall" className="text-xl">
              Overall mastery
            </h2>
            <div className="mt-4">
              <Bar
                value={mastered / Math.max(1, study.concepts.length)}
                label={`${mastered} of ${study.concepts.length} concepts mastered`}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Mastered means correct in the diagnostic or lesson practice. Small samples can
              overstate understanding, so retest later.
            </p>
          </section>

          <section className="panel p-6" aria-labelledby="log">
            <h2 id="log" className="text-xl">
              Activity
            </h2>
            {study.activity.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ol className="mt-4 space-y-3">
                {study.activity.map((item) => (
                  <li key={item.id} className="border-l border-border pl-3">
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

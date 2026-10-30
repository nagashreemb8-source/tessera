import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  Loader2,
  Microscope,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { BackendNotice } from "@/components/BackendNotice";
import { KnowledgeGraph, MapLegend } from "@/components/map/KnowledgeGraph";
import { Bar, EmptyState, PageHeader } from "@/components/ui/tessera";
import { useBackend } from "@/state/BackendContext";
import { useStudy } from "@/state/useStudy";

export function AnalysisPage() {
  const study = useStudy();
  const backend = useBackend();
  const [starting, setStarting] = useState(false);

  const inferred = useMemo(() => {
    const set = new Set<string>();
    for (const edge of backend.analysis?.result?.edges ?? []) {
      if (edge.source === "inferred") set.add(`${edge.from_id}::${edge.to_id}`);
    }
    return set;
  }, [backend.analysis]);

  if (study.mode === "demo") {
    return (
      <BackendNotice
        title="Document analysis"
        body="Analysis extracts topics, definitions, formulas and a prerequisite concept map from your own PDFs. It runs in the local backend, so demo mode has nothing to analyse."
      />
    );
  }

  const analysis = backend.analysis;
  const result = analysis?.result ?? null;
  const status = analysis?.status ?? "idle";

  const run = async () => {
    setStarting(true);
    try {
      await backend.runAnalysis();
    } finally {
      setStarting(false);
    }
  };

  const header = (
    <PageHeader
      eyebrow="Document analysis"
      title="What your documents actually cover"
      sub="Every item below cites the pages it came from. Inferred prerequisite links are hypotheses and are drawn with dashed lines."
      actions={
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void run()}
          disabled={starting || status === "running" || backend.documents.length === 0}
        >
          {starting || status === "running" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : status === "ready" ? (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Microscope className="h-4 w-4" aria-hidden="true" />
          )}
          {status === "running"
            ? "Analysing…"
            : status === "ready"
              ? "Re-analyse"
              : "Analyse documents"}
        </button>
      }
    />
  );

  if (backend.documents.filter((doc) => doc.status !== "rejected").length === 0) {
    return (
      <>
        {header}
        <EmptyState
          title="No documents yet"
          body="Upload at least one PDF before running analysis."
        >
          <Link to="/app/upload" className="btn btn-primary">
            Upload a PDF
          </Link>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      {header}

      <section className="panel p-5" aria-label="Analysis status">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium">
            {status === "ready" && "Analysis ready"}
            {status === "running" && (analysis?.stage || "Working…")}
            {status === "failed" && "Analysis failed"}
            {status === "idle" && "Not analysed yet"}
          </span>
          <span className="text-xs text-muted-foreground">
            {backend.documents.filter((doc) => doc.status !== "rejected").length} document(s)
          </span>
        </div>
        <div className="mt-3">
          <Bar
            value={status === "ready" ? 1 : (analysis?.progress ?? 0)}
            label={`Analysis progress ${Math.round((status === "ready" ? 1 : (analysis?.progress ?? 0)) * 100)}%`}
            tone={status === "failed" ? "developing" : "primary"}
          />
        </div>
        {status === "running" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Analysing section by section so large PDFs stay within the model's context limit. This
            page updates automatically.
          </p>
        )}
        {status === "failed" && analysis?.error && (
          <p
            role="alert"
            className="mt-3 flex gap-2 rounded-md border border-developing/40 bg-developing/10 px-4 py-2 text-sm text-developing"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{" "}
            {analysis.error}
          </p>
        )}
        {status === "idle" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Run analysis to build your concept map. It is required for quizzes, the learning path
            and diagnosis.
          </p>
        )}
      </section>

      {status === "ready" && result && (
        <>
          <section className="panel mt-5 p-6" aria-labelledby="summary">
            <p className="eyebrow flex items-center gap-2 text-primary">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Overview
            </p>
            <h2 id="summary" className="mt-3 text-2xl">
              {result.concepts.length} concepts across {result.topics.length} topics
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {result.overall_summary}
            </p>
            {result.document_summaries.length > 0 && (
              <ul className="mt-4 space-y-2">
                {result.document_summaries.map((doc) => (
                  <li key={doc.document_id} className="panel-raised p-3 text-sm">
                    <span className="font-medium">{doc.document_name}</span>
                    <span className="text-muted-foreground"> · {doc.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel mt-5 p-5" aria-label="Concept map">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-xl">Concept map</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Arrows run from a prerequisite to the concept built on it.
                </p>
              </div>
              <Link to="/app/map" className="btn btn-secondary h-9 text-xs">
                Open interactive map <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <div className="mt-4 overflow-x-auto">
              <KnowledgeGraph
                statuses={study.statuses ?? {}}
                concepts={study.concepts}
                edges={study.edges}
                inferredEdges={inferred}
              />
            </div>
            <div className="mt-4 border-t border-border pt-4">
              <MapLegend />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Dashed links are inferred prerequisites, not statements taken directly from your
                PDFs.
              </p>
            </div>
          </section>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <section className="panel p-6" aria-labelledby="topics">
              <h2 id="topics" className="text-xl">
                Topics
              </h2>
              {result.topics.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No topics extracted.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {result.topics.map((topic) => (
                    <li key={topic.name} className="panel-raised p-4">
                      <p className="font-medium">{topic.name}</p>
                      {topic.summary && (
                        <p className="mt-1 text-sm text-muted-foreground">{topic.summary}</p>
                      )}
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Pages: {topic.source_pages.map((ref) => ref.pages.join(", ")).join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel p-6" aria-labelledby="defs">
              <h2 id="defs" className="flex items-center gap-2 text-xl">
                <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{" "}
                Definitions
              </h2>
              {result.definitions.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No definitions extracted.</p>
              ) : (
                <dl className="mt-4 divide-y divide-border">
                  {result.definitions.map((definition) => (
                    <div key={definition.term} className="py-3">
                      <dt className="text-sm font-medium">{definition.term}</dt>
                      <dd className="mt-1 text-sm text-muted-foreground">
                        {definition.definition}
                      </dd>
                      <dd className="mt-1 text-[11px] text-muted-foreground">
                        Pages:{" "}
                        {definition.source_pages.map((ref) => ref.pages.join(", ")).join(" · ")}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          </div>

          {result.formulas.length > 0 && (
            <section className="panel mt-5 p-6" aria-labelledby="formulas">
              <h2 id="formulas" className="text-xl">
                Formulas
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {result.formulas.map((formula) => (
                  <li key={`${formula.name}-${formula.expression}`} className="panel-raised p-4">
                    <p className="text-sm font-medium">{formula.name}</p>
                    <p className="mt-1 overflow-x-auto font-mono text-sm">{formula.expression}</p>
                    {formula.meaning && (
                      <p className="mt-1 text-xs text-muted-foreground">{formula.meaning}</p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Pages: {formula.source_pages.map((ref) => ref.pages.join(", ")).join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section
            className="panel mt-5 flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between"
            aria-label="Next steps"
          >
            <div>
              <h2 className="text-xl">Ready to test your understanding?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Generate a diagnostic quiz from these concepts. It is different every time.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/app/tutor" className="btn btn-secondary">
                Ask the tutor
              </Link>
              <Link to="/app/diagnose" className="btn btn-primary">
                Take a quiz <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </section>
        </>
      )}
    </>
  );
}

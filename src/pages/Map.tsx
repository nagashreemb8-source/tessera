import { Link } from "@tanstack/react-router";
import { ArrowRight, Microscope } from "lucide-react";
import { useState } from "react";
import { KnowledgeGraph, MapLegend } from "@/components/map/KnowledgeGraph";
import { EmptyState, PageHeader, StatusPill } from "@/components/ui/tessera";
import { useBackend } from "@/state/BackendContext";
import { useStudy } from "@/state/useStudy";
import { cn } from "@/lib/utils";

export function MapPage() {
  const study = useStudy();
  const backend = useBackend();
  const [picked, setPicked] = useState<string | null>(null);

  if (!study.diagnosis || !study.statuses) {
    return (
      <>
        <PageHeader eyebrow="Knowledge map" title="How your concepts connect" />
        <EmptyState
          title="The map needs a diagnostic first"
          body={
            study.mode === "backend"
              ? "Each concept is coloured by your answers. Take a generated quiz to fill the map in; the structure itself comes from your documents."
              : "Each concept is coloured by what your answers showed. Take the diagnostic to fill the map in."
          }
        >
          <Link to="/app/diagnose" className="btn btn-primary">
            {study.mode === "backend" ? "Generate a quiz" : "Start a diagnostic"}
          </Link>
          {study.mode === "backend" && (
            <Link to="/app/analysis" className="btn btn-secondary">
              View analysis
            </Link>
          )}
        </EmptyState>
      </>
    );
  }

  if (study.concepts.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Knowledge map" title="How your concepts connect" />
        <EmptyState
          title="No concepts yet"
          body="Run document analysis to build a concept map from your PDFs."
        >
          <Link to="/app/analysis" className="btn btn-primary">
            Open analysis
          </Link>
        </EmptyState>
      </>
    );
  }

  const investigating = study.diagnosis.gaps[0]?.conceptId ?? null;
  const defaultPick =
    investigating ??
    study.concepts.find((concept) => study.statuses?.[concept.id] !== "mastered")?.id ??
    study.concepts[0]!.id;
  const selected = picked ?? defaultPick;
  const concept = study.conceptById(selected);
  const gap = study.diagnosis.gaps.find((item) => item.conceptId === selected);
  const stats = study.conceptStats(selected);
  const depthGroups = new Map<number, typeof study.concepts>();
  for (const item of study.concepts) {
    const depth = study.depthOf(item.id);
    depthGroups.set(depth, [...(depthGroups.get(depth) ?? []), item]);
  }
  const layers = [...depthGroups.entries()].sort((a, b) => a[0] - b[0]);

  if (!concept) {
    return (
      <>
        <PageHeader eyebrow="Knowledge map" title="How your concepts connect" />
        <EmptyState title="Concept not found" body="Pick a concept from the map." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Knowledge map"
        title="How your concepts connect"
        sub="Arrows point from a prerequisite to the concept built on it. Select any concept to see details and open its lesson."
        actions={
          study.mode === "backend" ? (
            <Link to="/app/analysis" className="btn btn-secondary">
              Analysis detail
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel p-5" aria-label="Concept map">
          <div className="hidden overflow-x-auto md:block">
            <KnowledgeGraph
              statuses={study.statuses}
              selected={selected}
              investigating={investigating}
              onSelect={setPicked}
              concepts={study.mode === "backend" ? study.concepts : undefined}
              edges={study.mode === "backend" ? study.edges : undefined}
              inferredEdges={
                study.mode === "backend"
                  ? new Set(
                      (backend.analysis?.result?.edges ?? [])
                        .filter((edge) => edge.source === "inferred")
                        .map((edge) => `${edge.from_id}::${edge.to_id}`),
                    )
                  : undefined
              }
            />
          </div>

          <ol className="space-y-5 md:hidden" aria-label="Concepts by depth, foundations first">
            {layers.map(([depth, list]) => (
              <li key={depth}>
                <p className="eyebrow mb-2">
                  {depth === 0 ? "Foundations" : `Builds on level ${depth}`}
                </p>
                <ul className="space-y-2">
                  {list.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setPicked(item.id)}
                        aria-pressed={selected === item.id}
                        className={cn(
                          "flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border px-4 py-2 text-left transition-colors",
                          selected === item.id
                            ? "border-primary bg-surface-2"
                            : "border-border bg-surface",
                        )}
                      >
                        <span className="text-sm font-medium">{item.name}</span>
                        <StatusPill status={study.statuses?.[item.id] ?? "untested"} />
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>

          <div className="mt-5 border-t border-border pt-4">
            <MapLegend />
          </div>
        </section>

        <aside
          className="panel p-6 lg:sticky lg:top-20 lg:self-start"
          aria-live="polite"
          aria-label="Selected concept"
        >
          <StatusPill status={study.statuses[selected] ?? "untested"} />
          <h2 className="mt-3 text-3xl">{concept.name}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{concept.description}</p>

          <dl className="mt-5 space-y-4 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                Diagnostic result
              </dt>
              <dd className="mt-1">
                {stats.answered > 0
                  ? `${stats.correct} of ${stats.answered} correct`
                  : "Not assessed yet"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Builds on</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {concept.prerequisites.length === 0 ? (
                  <span className="text-muted-foreground">Nothing: this is a foundation.</span>
                ) : (
                  concept.prerequisites.map((prerequisite) => (
                    <button
                      key={prerequisite}
                      type="button"
                      className="btn btn-secondary h-8 min-h-8 px-3 text-xs"
                      onClick={() => setPicked(prerequisite)}
                    >
                      {study.conceptName(prerequisite)}
                    </button>
                  ))
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Leads to</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {study.dependentsOf(selected).length === 0 ? (
                  <span className="text-muted-foreground">The end of this map.</span>
                ) : (
                  study.dependentsOf(selected).map((dependent) => (
                    <button
                      key={dependent}
                      type="button"
                      className="btn btn-secondary h-8 min-h-8 px-3 text-xs"
                      onClick={() => setPicked(dependent)}
                    >
                      {study.conceptName(dependent)}
                    </button>
                  ))
                )}
              </dd>
            </div>
          </dl>

          {gap && (
            <p className="mt-5 rounded-md border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Hypothesis, not a verdict. </span>
              {gap.summary}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-2">
            <Link to="/app/concept/$id" params={{ id: selected }} className="btn btn-primary">
              {study.mode === "backend" ? "Open concept" : `Open lesson · ${concept.minutes} min`}{" "}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link to="/app/materials" className="btn btn-secondary">
              Study materials for this set
            </Link>
            {gap && (
              <Link to="/app/replay" search={{ concept: selected }} className="btn btn-secondary">
                <Microscope className="h-4 w-4" aria-hidden="true" /> Investigate in Root Cause
                Replay
              </Link>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

import { Link } from "@tanstack/react-router";
import { BookOpen, Brain, ChevronDown, Layers, Loader2, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BackendNotice } from "@/components/BackendNotice";
import { EmptyState, PageHeader } from "@/components/ui/tessera";
import { api, ApiClientError } from "@/services/api";
import type { MaterialItem, MaterialPageRef } from "@/services/apiTypes";
import { useBackend } from "@/state/BackendContext";
import { useStudy } from "@/state/useStudy";
import { cn } from "@/lib/utils";

type Kind = "notes" | "flashcards" | "practice" | "simplified";
type Endpoint = "notes" | "flashcards" | "practice-questions" | "simplified-explanation";

const TABS: {
  kind: Kind;
  endpoint: Endpoint;
  label: string;
  icon: typeof BookOpen;
  hint: string;
}[] = [
  {
    kind: "notes",
    endpoint: "notes",
    label: "Revision notes",
    icon: BookOpen,
    hint: "Structured notes with definitions, formulas and page references.",
  },
  {
    kind: "flashcards",
    endpoint: "flashcards",
    label: "Flashcards",
    icon: Layers,
    hint: "Flip cards for active recall, each backed by a page.",
  },
  {
    kind: "practice",
    endpoint: "practice-questions",
    label: "Practice",
    icon: Brain,
    hint: "Open questions with worked answers grounded in your PDF.",
  },
  {
    kind: "simplified",
    endpoint: "simplified-explanation",
    label: "Plain language",
    icon: Sparkles,
    hint: "One concept explained simply, with an analogy.",
  },
];

function PageRefs({ refs }: { refs: MaterialPageRef[] }) {
  if (!refs.length) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
      {refs.map((ref) => (
        <span
          key={`${ref.document_id}-${ref.page}`}
          className="rounded border border-border px-1.5 py-0.5"
        >
          {ref.document_name} p.{ref.page}
        </span>
      ))}
    </p>
  );
}

function MaterialView({ material }: { material: MaterialItem }) {
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const payload = material.payload;

  if (material.kind === "notes") {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl">{payload.title ?? "Revision notes"}</h2>
        {(payload.sections ?? []).map((section) => (
          <article key={section.heading} className="panel-raised p-4">
            <h3 className="font-display text-xl">{section.heading}</h3>
            {section.key_points.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {section.key_points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            )}
            {section.definitions.length > 0 && (
              <dl className="mt-3 space-y-2 text-sm">
                {section.definitions.map((definition) => (
                  <div key={definition.term}>
                    <dt className="font-medium">{definition.term}</dt>
                    <dd className="text-muted-foreground">{definition.definition}</dd>
                    <PageRefs refs={definition.page_refs} />
                  </div>
                ))}
              </dl>
            )}
            {section.formulas.length > 0 && (
              <ul className="mt-3 space-y-2">
                {section.formulas.map((formula) => (
                  <li
                    key={`${formula.name}-${formula.expression}`}
                    className="rounded-md border border-border bg-surface-2 p-3"
                  >
                    <p className="text-sm font-medium">{formula.name}</p>
                    <p className="mt-1 overflow-x-auto font-mono text-sm">{formula.expression}</p>
                    {formula.meaning && (
                      <p className="mt-1 text-xs text-muted-foreground">{formula.meaning}</p>
                    )}
                    <PageRefs refs={formula.page_refs} />
                  </li>
                ))}
              </ul>
            )}
            <PageRefs refs={section.page_refs} />
          </article>
        ))}
      </div>
    );
  }

  if (material.kind === "flashcards") {
    return (
      <div>
        <h2 className="text-2xl">{payload.cards?.length ?? 0} cards</h2>
        <p className="mt-1 text-xs text-muted-foreground">Click a card to flip it.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(payload.cards ?? []).map((card, index) => (
            <button
              key={`${card.front}-${index}`}
              type="button"
              onClick={() => setFlipped((prev) => ({ ...prev, [index]: !prev[index] }))}
              className={cn(
                "min-h-36 rounded-lg border p-4 text-left text-sm transition-colors",
                flipped[index]
                  ? "border-primary bg-primary/10"
                  : "border-border bg-surface hover:border-border-strong",
              )}
              aria-pressed={!!flipped[index]}
            >
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {flipped[index] ? "Answer" : "Prompt"} · {card.concept_name}
              </p>
              <p className="mt-2 leading-relaxed">{flipped[index] ? card.back : card.front}</p>
              <PageRefs refs={card.page_refs} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (material.kind === "practice") {
    return (
      <div className="space-y-3">
        <h2 className="text-2xl">Practice questions</h2>
        {(payload.questions ?? []).map((question, index) => (
          <article key={`${question.prompt}-${index}`} className="panel-raised p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {question.concept_name} · {question.difficulty}
            </p>
            <p className="mt-1 text-sm font-medium">{question.prompt}</p>
            <button
              type="button"
              className="btn btn-quiet mt-2 h-8 min-h-8 px-2 text-xs"
              aria-expanded={!!open[index]}
              onClick={() => setOpen((prev) => ({ ...prev, [index]: !prev[index] }))}
            >
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", open[index] && "rotate-180")}
                aria-hidden="true"
              />
              {open[index] ? "Hide answer" : "Show answer"}
            </button>
            {open[index] && (
              <div className="mt-2 animate-fade-up border-t border-border pt-2 text-sm">
                <p className="font-medium text-primary">Answer: {question.answer}</p>
                <p className="mt-1 text-muted-foreground">{question.explanation}</p>
                <PageRefs refs={question.page_refs} />
              </div>
            )}
          </article>
        ))}
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl">{payload.title ?? payload.concept_name}</h2>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{payload.explanation}</p>
      {payload.analogy && (
        <p className="mt-4 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm">
          <span className="font-medium text-primary">Analogy. </span>
          {payload.analogy}
        </p>
      )}
      <PageRefs refs={payload.page_refs ?? []} />
    </div>
  );
}

export function MaterialsPage() {
  const study = useStudy();
  const backend = useBackend();
  const [tab, setTab] = useState<Kind>("notes");
  const [selectedConcepts, setSelectedConcepts] = useState<string[]>([]);
  const [count, setCount] = useState(6);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MaterialItem | null>(null);

  const current = TABS.find((item) => item.kind === tab)!;
  const ofKind = useMemo(
    () => backend.materials.filter((material) => material.kind === tab),
    [backend.materials, tab],
  );

  useEffect(() => {
    setSelected(ofKind[0] ?? null);
  }, [ofKind]);

  if (study.mode === "demo") {
    return (
      <BackendNotice
        title="Study materials"
        body="Notes, flashcards, practice questions and plain-language explanations are generated from your own PDFs with page references. Connect the backend to use them."
      />
    );
  }

  if (study.concepts.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Study materials" title="Generate from your documents" />
        <EmptyState
          title="Run document analysis first"
          body="Materials are grounded in your document's concept map, so analysis has to run before you generate them."
        >
          <Link to="/app/analysis" className="btn btn-primary">
            Open analysis
          </Link>
        </EmptyState>
      </>
    );
  }

  const toggleConcept = (id: string) => {
    if (tab === "simplified") {
      setSelectedConcepts([id]);
      return;
    }
    setSelectedConcepts((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id].slice(0, 6),
    );
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const body = {
        concept_ids: selectedConcepts,
        count: tab === "simplified" ? 1 : count,
        difficulty: "medium",
      };
      const material = await api.generateMaterial(current.endpoint, body);
      await backend.refreshMaterials();
      setSelected(material);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not generate that material.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Study materials"
        title="Turn your PDFs into study material"
        sub="Choose concepts, generate, and every item keeps a page reference back to your document."
        actions={
          <Link to="/app/tutor" className="btn btn-secondary">
            Ask the tutor
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="panel h-fit p-5 lg:sticky lg:top-20" aria-label="Generate materials">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Material type">
            {TABS.map((item) => (
              <button
                key={item.kind}
                role="tab"
                aria-selected={tab === item.kind}
                className={cn("btn h-9 text-xs", tab === item.kind ? "btn-primary" : "btn-quiet")}
                onClick={() => {
                  setTab(item.kind);
                  setSelectedConcepts([]);
                }}
              >
                <item.icon className="h-3.5 w-3.5" aria-hidden="true" /> {item.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{current.hint}</p>

          <p className="eyebrow mt-5">Concepts</p>
          <div className="mt-2 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
            {study.concepts.map((concept) => (
              <button
                key={concept.id}
                type="button"
                aria-pressed={selectedConcepts.includes(concept.id)}
                onClick={() => toggleConcept(concept.id)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                  selectedConcepts.includes(concept.id)
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-border-strong",
                )}
              >
                {concept.name}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {selectedConcepts.length === 0
              ? "No selection: the most important concepts are used."
              : `${selectedConcepts.length} selected`}
          </p>

          {tab !== "simplified" && (
            <>
              <label className="eyebrow mt-5 block" htmlFor="material-count">
                How many
              </label>
              <select
                id="material-count"
                className="input mt-1"
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
              >
                {[4, 6, 8, 10, 12].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </>
          )}

          <button
            type="button"
            className="btn btn-primary mt-5 w-full"
            disabled={generating}
            onClick={() => void generate()}
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Wand2 className="h-4 w-4" aria-hidden="true" />
            )}
            {generating ? "Generating…" : `Generate ${current.label.toLowerCase()}`}
          </button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Uses your backend's AI model; nothing is fabricated without a page citation.
          </p>

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-md border border-developing/40 bg-developing/10 px-3 py-2 text-xs text-developing"
            >
              {error}
            </p>
          )}

          {ofKind.length > 0 && (
            <>
              <p className="eyebrow mt-5">Saved</p>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {ofKind.map((material) => (
                  <li key={material.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(material)}
                      className={cn(
                        "w-full rounded-md border px-3 py-2 text-left text-xs transition-colors",
                        selected?.id === material.id
                          ? "border-primary bg-surface-2"
                          : "border-border hover:border-border-strong",
                      )}
                    >
                      <span className="block truncate">
                        {material.concept_names.join(", ") || material.kind}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(material.created_at).toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="panel min-h-[420px] p-6" aria-live="polite">
          {selected ? (
            <MaterialView material={selected} />
          ) : (
            <div className="py-20 text-center">
              <Wand2 className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <h2 className="mt-3 text-2xl">Nothing generated yet</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                Pick a material type and generate it from your document passages. Every item is
                saved so you can come back to it.
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

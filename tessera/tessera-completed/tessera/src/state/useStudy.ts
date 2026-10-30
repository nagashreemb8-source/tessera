// Unified view over the two modes:
//   demo    -> the offline sample subject and the deterministic local engine
//   backend -> the student's own PDFs, analysed by the FastAPI backend
// Screens consume this hook so they keep working in both modes.
import { useMemo } from "react";
import {
  CONCEPTS,
  CONCEPT_BY_ID,
  conceptName as demoConceptName,
  dependentsOf as demoDependents,
  depthOf as demoDepth,
} from "@/data/concepts";
import { QUESTIONS } from "@/data/questions";
import {
  diagnosisFromBackend,
  pathFromBackend,
  statusMap,
  statusesFromProgress,
} from "@/services/adapters";
import { useBackend } from "@/state/BackendContext";
import { useTessera, type Activity } from "@/state/AppState";
import type { Answers, Concept, Diagnosis, PathStep, QuizResults, Status } from "@/types";

export interface GraphEdge {
  from: string;
  to: string;
}

export interface StudyView {
  mode: "demo" | "backend";
  hydrated: boolean;
  concepts: Concept[];
  conceptById: (id: string | null | undefined) => Concept | undefined;
  conceptName: (id: string) => string;
  dependentsOf: (id: string) => string[];
  depthOf: (id: string) => number;
  /** Directed prerequisite edges (prerequisite -> dependent) for the knowledge map. */
  edges: GraphEdge[];
  statuses: Record<string, Status> | null;
  diagnosis: Diagnosis | null;
  path: PathStep[];
  completedSteps: string[];
  results: QuizResults | null;
  answers: Answers;
  activity: Activity[];
  questions: typeof QUESTIONS;
  conceptStats: (id: string) => { correct: number; answered: number };
  toggleStep: (id: string) => void;
}

export function useStudy(): StudyView {
  const demo = useTessera();
  const backend = useBackend();
  const mode: "demo" | "backend" = backend.configured ? "backend" : "demo";

  return useMemo<StudyView>(() => {
    if (mode === "demo") {
      return {
        mode,
        hydrated: demo.hydrated,
        concepts: CONCEPTS,
        conceptById: (id) => (id ? CONCEPT_BY_ID[id] : undefined),
        conceptName: (id) => (id in CONCEPT_BY_ID ? demoConceptName(id) : id),
        dependentsOf: (id) => (id in CONCEPT_BY_ID ? demoDependents(id) : []),
        depthOf: (id) => (id in CONCEPT_BY_ID ? demoDepth(id) : 0),
        edges: CONCEPTS.flatMap((concept) =>
          concept.prerequisites.map((prerequisite) => ({ from: prerequisite, to: concept.id })),
        ),
        statuses: demo.statuses,
        diagnosis: demo.state.diagnosis,
        path: demo.path,
        completedSteps: demo.state.completedSteps,
        results: demo.state.results,
        answers: demo.state.answers,
        activity: demo.state.activity,
        questions: QUESTIONS,
        conceptStats: (id) => {
          const result = demo.state.results?.concepts[id];
          return { correct: result?.correct ?? 0, answered: result?.answered ?? 0 };
        },
        toggleStep: (id) => demo.dispatch({ type: "toggleStep", conceptId: id }),
      };
    }

    const concepts = backend.concepts;
    const byId = new Map(concepts.map((concept) => [concept.id, concept]));
    const diagnosis = backend.diagnosis ? diagnosisFromBackend(backend.diagnosis) : null;
    const statuses =
      statusMap(backend.diagnosis?.statuses) ?? statusesFromProgress(backend.progress) ?? null;
    const path = pathFromBackend(backend.path);
    const progressConcepts = new Map(
      (backend.progress?.concepts ?? []).map((concept) => [concept.concept_id, concept]),
    );

    return {
      mode,
      hydrated: backend.ready,
      concepts,
      conceptById: (id) => (id ? byId.get(id) : undefined),
      conceptName: (id) => byId.get(id)?.name ?? id,
      dependentsOf: (id) =>
        concepts.filter((concept) => concept.prerequisites.includes(id)).map((c) => c.id),
      depthOf: (id) => {
        const walk = (current: string, seen: Set<string>): number => {
          if (seen.has(current)) return 0;
          const parents = byId.get(current)?.prerequisites ?? [];
          if (parents.length === 0) return 0;
          return (
            1 + Math.max(...parents.map((parent) => walk(parent, new Set([...seen, current]))))
          );
        };
        return walk(id, new Set());
      },
      edges: concepts.flatMap((concept) =>
        concept.prerequisites.map((prerequisite) => ({ from: prerequisite, to: concept.id })),
      ),
      statuses,
      diagnosis,
      path,
      completedSteps: path.filter((step) => step.completed).map((step) => step.conceptId),
      results: null,
      answers: {},
      activity: (backend.progress?.activity ?? []).map((item) => ({
        id: item.id,
        label: item.kind.charAt(0).toUpperCase() + item.kind.slice(1),
        detail: item.detail,
      })),
      questions: [],
      conceptStats: (id) => {
        const stats = progressConcepts.get(id);
        return { correct: stats?.correct ?? 0, answered: stats?.answered ?? 0 };
      },
      toggleStep: (id) => {
        const done = (backend.path?.steps ?? []).some(
          (step) => step.concept_id === id && step.completed,
        );
        void backend.completeStep(id, !done);
      },
    };
  }, [mode, demo, backend]);
}

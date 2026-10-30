// Adapters: backend payloads -> the UI types the existing screens already use.
// Keeping this in one place means most components work unchanged in both modes.
import type {
  BackendDiagnosis,
  ConceptEdge,
  ConceptNode,
  GradedAttempt,
  PathBackend,
  ProgressBackend,
} from "@/services/apiTypes";
import type {
  Concept,
  Diagnosis,
  EvidenceLevel,
  ObservedMistake,
  PathStep,
  QuizResults,
  Status,
  SuspectedGap,
} from "@/types";

export function conceptsFromGraph(nodes: ConceptNode[], edges: ConceptEdge[]): Concept[] {
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    description: node.description || "Extracted from your document.",
    prerequisites: edges.filter((edge) => edge.to_id === node.id).map((edge) => edge.from_id),
    minutes: 10 + Math.round((node.importance ?? 0.5) * 20),
  }));
}

export function statusMap(
  statuses: Record<string, string> | null | undefined,
): Record<string, Status> | null {
  if (!statuses) return null;
  const out: Record<string, Status> = {};
  for (const [key, value] of Object.entries(statuses)) {
    out[key] = value === "mastered" || value === "developing" ? value : "untested";
  }
  return out;
}

export function statusesFromProgress(
  progress: ProgressBackend | null,
): Record<string, Status> | null {
  if (!progress || progress.concepts.length === 0) return null;
  const out: Record<string, Status> = {};
  for (const concept of progress.concepts) out[concept.concept_id] = concept.status;
  return out;
}

export function diagnosisFromBackend(diagnosis: BackendDiagnosis): Diagnosis {
  const observed: ObservedMistake[] = diagnosis.observed.map((item) => ({
    questionId: item.question_id,
    conceptIds: item.concept_ids,
    conceptNames: item.concept_names,
    chosen: item.chosen ?? undefined,
    correctAnswer: item.correct_answer,
    pattern: item.pattern,
    unanswered: item.unanswered,
    prompt: item.prompt,
    options: item.options,
  }));

  const gaps: SuspectedGap[] = diagnosis.gaps.map((gap) => ({
    conceptId: gap.concept_id,
    conceptName: gap.concept_name,
    kind: gap.kind,
    supportingQuestionIds: gap.supporting_question_ids,
    dependentConceptIds: gap.dependent_concept_ids,
    dependentConceptNames: gap.dependent_concept_names,
    supportedPrerequisites: gap.supported_prerequisites,
    alternatives: gap.alternatives,
    evidence: gap.evidence as EvidenceLevel,
    needsMoreEvidence: gap.needs_more_evidence,
    summary: gap.summary,
    why: gap.why,
    pageReferences: gap.page_references.map((ref) => ({
      documentId: ref.document_id,
      documentName: ref.document_name,
      page: ref.page,
    })),
    recommendedFollowUp: gap.recommended_follow_up
      ? {
          conceptId: gap.recommended_follow_up.concept_id,
          conceptName: gap.recommended_follow_up.concept_name,
          prompt: gap.recommended_follow_up.prompt,
        }
      : undefined,
    hypothesisOutcome: gap.hypothesis_outcome,
  }));

  return {
    observed,
    statuses: statusMap(diagnosis.statuses) ?? {},
    gaps,
  };
}

export function pathFromBackend(path: PathBackend | null): PathStep[] {
  if (!path) return [];
  return path.steps.map((step) => ({
    conceptId: step.concept_id,
    conceptName: step.concept_name,
    verb: step.verb,
    reason: step.reason,
    prerequisitesInPath: step.prerequisites_in_path,
    minutes: step.minutes,
    pageReferences: step.page_references.map((ref) => ({
      documentId: ref.document_id,
      documentName: ref.document_name,
      pages: ref.pages,
    })),
    materialIds: step.material_ids,
    completed: step.completed,
  }));
}

export function quizResultsFromAttempt(attempt: GradedAttempt): QuizResults {
  return {
    questions: attempt.questions.map((question) => ({
      id: question.id,
      chosen: question.chosen ?? undefined,
      answered: question.answered,
      correct: question.correct,
    })),
    concepts: Object.fromEntries(
      attempt.concepts.map((score) => [
        score.concept_id,
        {
          conceptId: score.concept_id,
          correct: score.correct,
          answered: score.answered,
          wrongIds: score.wrong_question_ids,
        },
      ]),
    ) as QuizResults["concepts"],
    score: attempt.score,
    answered: attempt.answered,
    total: attempt.total,
  };
}

export function attemptConceptNames(attempt: GradedAttempt): Record<string, string> {
  return Object.fromEntries(attempt.concepts.map((score) => [score.concept_id, score.name]));
}

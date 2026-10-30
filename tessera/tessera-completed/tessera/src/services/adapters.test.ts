import { describe, expect, it } from "vitest";
import type {
  BackendDiagnosis,
  ConceptEdge,
  ConceptNode,
  GradedAttempt,
  PathBackend,
  ProgressBackend,
} from "@/services/apiTypes";
import {
  conceptsFromGraph,
  diagnosisFromBackend,
  pathFromBackend,
  quizResultsFromAttempt,
  statusMap,
  statusesFromProgress,
} from "@/services/adapters";

const node = (id: string, name: string, extra: Partial<ConceptNode> = {}): ConceptNode => ({
  id,
  name,
  description: "",
  level: 1,
  importance: 0.5,
  source_pages: [{ document_id: "doc-1", pages: [3] }],
  ...extra,
});

const edge = (from: string, to: string): ConceptEdge => ({
  from_id: from,
  to_id: to,
  rationale: "builds on",
  source: "document",
  confidence: 0.8,
  pages: [{ document_id: "doc-1", pages: [1] }],
});

describe("concept graph adapter", () => {
  it("turns prerequisite edges into the UI's prerequisites list", () => {
    const concepts = conceptsFromGraph(
      [
        node("mle", "Maximum Likelihood"),
        node("deriv", "Derivatives"),
        node("prob", "Probability"),
      ],
      [edge("deriv", "mle"), edge("prob", "deriv")],
    );

    expect(concepts.map((c) => c.id)).toEqual(["mle", "deriv", "prob"]);
    expect(concepts[0]?.prerequisites).toEqual(["deriv"]);
    expect(concepts[1]?.prerequisites).toEqual(["prob"]);
    expect(concepts[2]?.prerequisites).toEqual([]);
  });

  it("fills in a readable description and a positive time estimate", () => {
    const [concept] = conceptsFromGraph([node("mle", "Maximum Likelihood")], []);
    expect(concept?.description).toBe("Extracted from your document.");
    expect(concept?.minutes).toBeGreaterThan(0);
  });

  it("drops unknown statuses rather than trusting the wire value", () => {
    expect(
      statusMap({ mle: "mastered", deriv: "developing", prob: "untested", odd: "exploded" }),
    ).toEqual({ mle: "mastered", deriv: "developing", prob: "untested", odd: "untested" });
    expect(statusMap(null)).toBeNull();
  });

  it("reads statuses from progress and returns null when there is nothing to show", () => {
    const progress = {
      concepts: [
        {
          concept_id: "mle",
          name: "MLE",
          status: "developing",
          trend: "up",
          answered: 2,
          correct: 1,
          attempts: 1,
        },
      ],
    } as unknown as ProgressBackend;
    expect(statusesFromProgress(progress)).toEqual({ mle: "developing" });
    expect(statusesFromProgress({ concepts: [] } as unknown as ProgressBackend)).toBeNull();
    expect(statusesFromProgress(null)).toBeNull();
  });
});

describe("attempt adapter", () => {
  it("maps a graded attempt into the local QuizResults shape", () => {
    const attempt = {
      attempt_id: "attempt-1",
      quiz_id: "quiz-1",
      score: 1,
      total: 2,
      answered: 2,
      time_taken_seconds: 90,
      created_at: "2026-01-01T00:00:00Z",
      questions: [
        {
          id: "q1",
          prompt: "One?",
          options: { A: "1", B: "2", C: "3", D: "4" },
          chosen: "B",
          answered: true,
          correct: true,
          correct_option: "B",
          correct_text: "2",
          chosen_text: "2",
          misconception: null,
          explanation: "Because.",
          difficulty: "easy",
          tested_concept_ids: ["mle"],
          source_pages: [],
        },
        {
          id: "q2",
          prompt: "Two?",
          options: { A: "1", B: "2", C: "3", D: "4" },
          chosen: "A",
          answered: true,
          correct: false,
          correct_option: "C",
          correct_text: "3",
          chosen_text: "1",
          misconception: "Confused the two formulas.",
          explanation: "Because.",
          difficulty: "hard",
          tested_concept_ids: ["mle"],
          source_pages: [],
        },
      ],
      concepts: [
        { concept_id: "mle", name: "MLE", correct: 1, answered: 2, wrong_question_ids: ["q2"] },
      ],
    } as unknown as GradedAttempt;

    const results = quizResultsFromAttempt(attempt);
    expect(results.score).toBe(1);
    expect(results.total).toBe(2);
    expect(results.questions).toEqual([
      { id: "q1", chosen: "B", answered: true, correct: true },
      { id: "q2", chosen: "A", answered: true, correct: false },
    ]);
    expect(results.concepts["mle"]).toEqual({
      conceptId: "mle",
      correct: 1,
      answered: 2,
      wrongIds: ["q2"],
    });
  });
});

describe("diagnosis adapter", () => {
  const diagnosis = {
    id: "diag-1",
    attempt_id: "attempt-1",
    created_at: "2026-01-01T00:00:00Z",
    statuses: { mle: "developing" },
    concepts: [node("mle", "Maximum Likelihood"), node("deriv", "Derivatives")],
    observed: [
      {
        question_id: "q2",
        concept_ids: ["mle"],
        concept_names: ["Maximum Likelihood"],
        chosen: "A",
        correct_answer: "C",
        pattern: "Confused the two formulas.",
        unanswered: false,
        prompt: "Two?",
        options: { A: "1", B: "2", C: "3", D: "4" },
      },
    ],
    gaps: [
      {
        concept_id: "deriv",
        concept_name: "Derivatives",
        kind: "prerequisite",
        supporting_question_ids: ["q2"],
        dependent_concept_ids: ["mle"],
        dependent_concept_names: ["Maximum Likelihood"],
        supported_prerequisites: [],
        alternatives: ["Careless arithmetic."],
        evidence: "Limited",
        needs_more_evidence: true,
        summary: "Wrong answers in MLE are consistent with a gap in Derivatives.",
        why: "The same misconception appeared twice.",
        page_references: [
          {
            document_id: "doc-1",
            document_name: "notes.pdf",
            page: 7,
            snippet: "The derivative of log p(x) is ...",
          },
        ],
        recommended_follow_up: {
          concept_id: "deriv",
          concept_name: "Derivatives",
          prompt: "Differentiate log x.",
        },
        hypothesis_outcome: null,
      },
    ],
  } as unknown as BackendDiagnosis;

  it("keeps observed mistakes as facts and gaps as hypotheses", () => {
    const adapted = diagnosisFromBackend(diagnosis);
    expect(adapted.observed[0]?.pattern).toBe("Confused the two formulas.");
    expect(adapted.observed[0]?.correctAnswer).toBe("C");
    expect(adapted.gaps[0]?.kind).toBe("prerequisite");
    expect(adapted.gaps[0]?.needsMoreEvidence).toBe(true);
    expect(adapted.gaps[0]?.evidence).toBe("Limited");
  });

  it("maps page references, follow-ups and statuses", () => {
    const adapted = diagnosisFromBackend(diagnosis);
    expect(adapted.statuses).toEqual({ mle: "developing" });
    expect(adapted.gaps[0]?.pageReferences?.[0]).toEqual({
      documentId: "doc-1",
      documentName: "notes.pdf",
      page: 7,
    });
    expect(adapted.gaps[0]?.recommendedFollowUp?.conceptId).toBe("deriv");
  });
});

describe("path adapter", () => {
  const path = {
    id: "path-1",
    created_at: "2026-01-01T00:00:00Z",
    completed_count: 0,
    concepts: [],
    steps: [
      {
        concept_id: "deriv",
        concept_name: "Derivatives",
        verb: "Review",
        reason: "Suspected foundational gap.",
        prerequisites_in_path: [],
        minutes: 18,
        page_references: [{ document_id: "doc-1", document_name: "notes.pdf", pages: [4, 5] }],
        material_ids: ["mat-1"],
        completed: false,
        ord: 0,
      },
    ],
  } as unknown as PathBackend;

  it("maps backend steps, page ranges and completion state", () => {
    const steps = pathFromBackend(path);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      conceptId: "deriv",
      conceptName: "Derivatives",
      verb: "Review",
      minutes: 18,
      completed: false,
      prerequisitesInPath: [],
      materialIds: ["mat-1"],
    });
    expect(steps[0]?.pageReferences?.[0]?.pages).toEqual([4, 5]);
    expect(pathFromBackend(null)).toEqual([]);
  });
});

/**
 * Concept ids are free-form strings: the demo subject uses fixed ids, while a connected
 * backend derives ids from the student's own PDFs.
 */
export type ConceptId = string;

export type OptionKey = "A" | "B" | "C" | "D";
export type Status = "mastered" | "developing" | "untested";

export interface Concept {
  id: ConceptId;
  name: string;
  description: string;
  prerequisites: ConceptId[];
  minutes: number;
}

export interface Question {
  id: number;
  conceptIds: ConceptId[];
  /** Prerequisite this question also leans on (informational). */
  leansOn?: ConceptId | undefined;
  prompt: string;
  options: Record<OptionKey, string>;
  correct: OptionKey;
  commonErrors: Partial<Record<OptionKey, string>>;
}

export type Answers = Partial<Record<number, OptionKey>>;

export interface QuestionResult {
  id: number | string;
  chosen?: OptionKey | undefined;
  answered: boolean;
  correct: boolean;
}

export interface ConceptResult {
  conceptId: ConceptId;
  correct: number;
  answered: number;
  /** Demo questions use numeric ids; backend-generated questions use string ids. */
  wrongIds: Array<number | string>;
}

export interface QuizResults {
  questions: QuestionResult[];
  concepts: Record<ConceptId, ConceptResult>;
  score: number;
  answered: number;
  total: number;
}

export interface ObservedMistake {
  questionId: number | string;
  conceptIds: ConceptId[];
  conceptNames?: string[] | undefined;
  chosen?: OptionKey | undefined;
  correctAnswer: OptionKey;
  pattern: string;
  unanswered: boolean;
  /** Supplied by the backend so the UI can render without a local question bank. */
  prompt?: string | undefined;
  options?: Record<OptionKey, string> | undefined;
}

export type EvidenceLevel = "Limited" | "Some" | "Stronger";

export interface FollowUp {
  conceptId: ConceptId;
  prompt: string;
  options: Record<OptionKey, string>;
  correct: OptionKey;
  /** Options that repeat the misconception seen in the diagnostic. */
  misconception: OptionKey[];
  misconceptionNote: string;
}

export interface GapPageReference {
  documentId: string;
  documentName: string;
  page: number;
}

export interface SuspectedGap {
  conceptId: ConceptId;
  kind: "prerequisite" | "self";
  supportingQuestionIds: Array<number | string>;
  dependentConceptIds: ConceptId[];
  supportedPrerequisites: ConceptId[];
  alternatives: string[];
  evidence: EvidenceLevel;
  needsMoreEvidence: boolean;
  summary: string;
  /** Backend-only extras. */
  why?: string | undefined;
  pageReferences?: GapPageReference[] | undefined;
  recommendedFollowUp?: { conceptId: string; conceptName: string; prompt: string } | undefined;
  hypothesisOutcome?: HypothesisOutcome | null | undefined;
  conceptName?: string | undefined;
  dependentConceptNames?: string[] | undefined;
  followUp?: FollowUp | undefined;
}

export interface Diagnosis {
  observed: ObservedMistake[];
  statuses: Record<ConceptId, Status>;
  gaps: SuspectedGap[];
}

export type HypothesisOutcome = "possible-gap" | "more-evidence" | "supported";

export interface HypothesisResult {
  conceptId: ConceptId;
  answer: OptionKey;
  outcome: HypothesisOutcome;
  title: string;
  explanation: string;
}

export interface PathPageReference {
  documentId: string;
  documentName: string;
  pages: number[];
}

export interface PathStep {
  conceptId: ConceptId;
  verb: "Review" | "Revisit" | "Practice" | "Continue to" | "Reassess";
  reason: string;
  prerequisitesInPath: ConceptId[];
  /** Backend-only extras. */
  conceptName?: string | undefined;
  minutes?: number | undefined;
  pageReferences?: PathPageReference[] | undefined;
  materialIds?: string[] | undefined;
  completed?: boolean | undefined;
}

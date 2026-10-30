// Wire types for the Tessera backend. These mirror backend/app/models.py.
// Keep them in sync with the API; the client never sees API keys.

export type OptionKey = "A" | "B" | "C" | "D";
export type Difficulty = "easy" | "medium" | "hard";
export type EvidenceLevel = "Limited" | "Some" | "Stronger";

export interface SourceRef {
  document_id: string;
  pages: number[];
}

export interface PageCitation {
  document_id: string;
  document_name: string;
  page: number;
  snippet: string;
}

export interface HealthResponse {
  status: string;
  db: string;
  llm: {
    configured: boolean;
    api_key_set: boolean;
    base_url_set: boolean;
    model_set: boolean;
    embeddings_configured: boolean;
  };
  retrieval: string;
  limits: { max_upload_mb: number; max_files_per_session: number; max_pages_per_pdf: number };
}

export interface LlmHealthResponse {
  configured: boolean;
  reachable: boolean;
  model: string | null;
  base_url_set?: boolean;
  model_available?: boolean;
  available_models?: string[];
  error_code?: string;
  message: string;
}

export interface DocumentOut {
  id: string;
  filename: string;
  status: "processed" | "partial" | "rejected";
  page_count: number;
  chunk_count: number;
  size_bytes: number;
  warnings: string[];
  error_code: string | null;
  created_at: string;
}

export interface UploadFileResult {
  filename: string;
  status: "processed" | "partial" | "rejected";
  document_id: string | null;
  page_count: number;
  chunk_count: number;
  warnings: string[];
  error_code: string | null;
  message: string;
}

export interface UploadResponse {
  results: UploadFileResult[];
  documents: DocumentOut[];
}

export interface DocumentPage {
  document_id: string;
  filename: string;
  page_no: number;
  text: string;
  char_count: number;
}

export interface ConceptNode {
  id: string;
  name: string;
  description: string;
  level: number;
  importance: number;
  source_pages: SourceRef[];
}

export interface ConceptEdge {
  from_id: string;
  to_id: string;
  rationale: string;
  source: "document" | "inferred";
  confidence: number;
  pages: SourceRef[];
}

export interface TopicOut {
  name: string;
  summary: string;
  source_pages: SourceRef[];
}

export interface DefinitionOut {
  term: string;
  definition: string;
  source_pages: SourceRef[];
}

export interface FormulaOut {
  name: string;
  expression: string;
  meaning: string;
  source_pages: SourceRef[];
}

export interface AnalysisResult {
  overall_summary: string;
  document_summaries: { document_id: string; document_name: string; summary: string }[];
  topics: TopicOut[];
  definitions: DefinitionOut[];
  formulas: FormulaOut[];
  concepts: ConceptNode[];
  edges: ConceptEdge[];
}

export interface AnalysisResponse {
  id: string | null;
  status: "idle" | "running" | "ready" | "failed";
  progress: number;
  stage: string;
  error: string | null;
  created_at: string | null;
  updated_at: string | null;
  result: AnalysisResult | null;
}

export interface AnalysisStatus {
  status: "idle" | "running" | "ready" | "failed";
  progress: number;
  stage: string;
  error: string | null;
  running: boolean;
  document_count: number;
  chunk_count: number;
  updated_at: string | null;
}

export interface Passage {
  document_id: string;
  document_name: string;
  page_start: number;
  page_end: number;
  text: string;
  score: number;
}

export interface TutorResponse {
  answer: string;
  supported: boolean;
  not_found: boolean;
  citations: PageCitation[];
  passages: Passage[];
}

export interface TutorHistoryTurn {
  id: number;
  role: "user" | "assistant";
  content: string;
  citations: PageCitation[];
  created_at: string;
}

export interface MaterialPageRef {
  document_id: string;
  document_name: string;
  page: number;
  snippet?: string;
}

export interface NoteSection {
  heading: string;
  key_points: string[];
  definitions: { term: string; definition: string; page_refs: MaterialPageRef[] }[];
  formulas: { name: string; expression: string; meaning: string; page_refs: MaterialPageRef[] }[];
  page_refs: MaterialPageRef[];
}

export interface Flashcard {
  front: string;
  back: string;
  concept_id: string;
  concept_name: string;
  page_refs: MaterialPageRef[];
}

export interface PracticeQuestion {
  prompt: string;
  difficulty: Difficulty;
  answer: string;
  explanation: string;
  concept_id: string;
  concept_name: string;
  page_refs: MaterialPageRef[];
}

export interface SimplifiedExplanation {
  title: string;
  explanation: string;
  analogy: string;
  concept_id: string;
  concept_name: string;
  page_refs: MaterialPageRef[];
}

export interface MaterialPayload {
  title?: string;
  sections?: NoteSection[];
  cards?: Flashcard[];
  questions?: PracticeQuestion[];
  explanation?: string;
  analogy?: string;
  concept_name?: string;
  concept_names?: string[];
  page_refs?: MaterialPageRef[];
}

export interface MaterialItem {
  id: string;
  kind: "notes" | "flashcards" | "practice" | "simplified";
  concept_ids: string[];
  concept_names: string[];
  created_at: string;
  payload: MaterialPayload;
}

export interface PublicQuestion {
  id: string;
  prompt: string;
  options: Record<OptionKey, string>;
  difficulty: Difficulty;
  tested_concept_ids: string[];
  tested_concept_names: string[];
  source_pages: PageCitation[];
}

export interface PublicQuiz {
  id: string;
  created_at: string;
  questions: PublicQuestion[];
}

export interface QuizSummary {
  id: string;
  created_at: string;
  status: string;
  question_count: number;
  concepts: string[];
  latest_score: number | null;
  latest_total: number | null;
  attempted: boolean;
}

export interface GradedQuestion {
  id: string;
  prompt: string;
  options: Record<OptionKey, string>;
  chosen: OptionKey | null;
  answered: boolean;
  correct: boolean;
  correct_option: OptionKey;
  correct_text: string;
  chosen_text: string | null;
  misconception: string | null;
  explanation: string;
  difficulty: Difficulty;
  tested_concept_ids: string[];
  source_pages: PageCitation[];
}

export interface ConceptScore {
  concept_id: string;
  name: string;
  correct: number;
  answered: number;
  wrong_question_ids: string[];
}

export interface GradedAttempt {
  attempt_id: string;
  quiz_id: string;
  score: number;
  total: number;
  answered: number;
  time_taken_seconds: number | null;
  created_at: string;
  questions: GradedQuestion[];
  concepts: ConceptScore[];
}

export interface BackendGap {
  concept_id: string;
  concept_name: string;
  kind: "prerequisite" | "self";
  supporting_question_ids: string[];
  dependent_concept_ids: string[];
  dependent_concept_names: string[];
  supported_prerequisites: string[];
  alternatives: string[];
  evidence: EvidenceLevel;
  needs_more_evidence: boolean;
  summary: string;
  why: string;
  page_references: PageCitation[];
  recommended_follow_up: { concept_id: string; concept_name: string; prompt: string } | null;
  hypothesis_outcome: "possible-gap" | "more-evidence" | "supported" | null;
}

export interface BackendObservedMistake {
  question_id: string;
  concept_ids: string[];
  concept_names: string[];
  chosen: OptionKey | null;
  correct_answer: OptionKey;
  pattern: string;
  unanswered: boolean;
  prompt: string;
  options: Record<OptionKey, string>;
}

export interface BackendDiagnosis {
  id: string;
  attempt_id: string;
  created_at: string;
  observed: BackendObservedMistake[];
  statuses: Record<string, string>;
  gaps: BackendGap[];
  concepts: ConceptNode[];
  hypotheses?: Record<string, { outcome: string; note: string; updated_at: string }>;
}

export interface PathStepBackend {
  concept_id: string;
  concept_name: string;
  verb: "Review" | "Revisit" | "Practice" | "Continue to" | "Reassess";
  reason: string;
  prerequisites_in_path: string[];
  minutes: number;
  page_references: { document_id: string; document_name: string; pages: number[] }[];
  material_ids: string[];
  completed: boolean;
  ord: number;
}

export interface PathBackend {
  id: string | null;
  created_at: string | null;
  steps: PathStepBackend[];
  concepts: ConceptNode[];
  completed_count: number;
}

export interface ProgressConcept {
  concept_id: string;
  name: string;
  status: "mastered" | "developing" | "untested";
  trend: "up" | "down" | "flat" | "unknown";
  answered: number;
  correct: number;
  attempts: number;
}

export interface AttemptTimelineItem {
  id: string;
  quiz_id: string;
  score: number;
  total: number;
  answered: number;
  created_at: string;
}

export interface ProgressBackend {
  concepts: ProgressConcept[];
  attempts: AttemptTimelineItem[];
  score_history: AttemptTimelineItem[];
  completed_steps: string[];
  gaps_open: number;
  gaps_resolved: number;
  activity: { id: number; kind: string; detail: string; created_at: string }[];
  document_count: number;
  quiz_count: number;
  material_count: number;
}

export interface ExplainPayload {
  title: string;
  paragraphs: string[];
  note?: string;
}

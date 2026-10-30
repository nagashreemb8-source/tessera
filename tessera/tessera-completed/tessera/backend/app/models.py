"""Pydantic schemas for API requests/responses and for every LLM JSON payload.

LLM output is always validated against one of these models before anything is stored,
so a malformed model reply cannot corrupt the database shape.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

OptionKey = Literal["A", "B", "C", "D"]
Difficulty = Literal["easy", "medium", "hard"]
OPTION_KEYS: tuple[str, ...] = ("A", "B", "C", "D")


# --------------------------------------------------------------------------- #
# Shared
# --------------------------------------------------------------------------- #
class SourceRef(BaseModel):
    model_config = ConfigDict(extra="ignore")

    document_id: str = Field(min_length=1, max_length=64)
    pages: list[int] = Field(min_length=1, max_length=10)

    @field_validator("pages")
    @classmethod
    def pages_positive(cls, v: list[int]) -> list[int]:
        clean = sorted({int(p) for p in v if int(p) >= 1})
        if not clean:
            raise ValueError("pages must contain at least one positive page number")
        return clean[:10]


class Citation(BaseModel):
    document_id: str
    document_name: str
    page: int
    snippet: str = ""


class Passage(BaseModel):
    document_id: str
    document_name: str
    page_start: int
    page_end: int
    text: str
    score: float


# --------------------------------------------------------------------------- #
# Sessions / documents
# --------------------------------------------------------------------------- #
class SessionOut(BaseModel):
    session_id: str
    created_at: str


class DocumentOut(BaseModel):
    id: str
    filename: str
    status: Literal["processed", "partial", "rejected"]
    page_count: int
    chunk_count: int
    size_bytes: int
    warnings: list[str] = Field(default_factory=list)
    error_code: str | None = None
    created_at: str


class UploadFileResult(BaseModel):
    filename: str
    status: Literal["processed", "partial", "rejected"]
    document_id: str | None = None
    page_count: int = 0
    chunk_count: int = 0
    warnings: list[str] = Field(default_factory=list)
    error_code: str | None = None
    message: str = ""


class UploadResponse(BaseModel):
    results: list[UploadFileResult]
    documents: list[DocumentOut]


class PageOut(BaseModel):
    document_id: str
    filename: str
    page_no: int
    text: str
    char_count: int


class DocumentDeleted(BaseModel):
    deleted_document_id: str
    invalidated: dict[str, int]


# --------------------------------------------------------------------------- #
# Analysis
# --------------------------------------------------------------------------- #
class ConceptNode(BaseModel):
    id: str
    name: str
    description: str = ""
    level: int = 0
    importance: float = 0.5
    source_pages: list[SourceRef] = Field(default_factory=list)


class ConceptEdge(BaseModel):
    from_id: str
    to_id: str
    rationale: str = ""
    source: Literal["document", "inferred"] = "inferred"
    confidence: float = 0.5
    pages: list[SourceRef] = Field(default_factory=list)


class TopicOut(BaseModel):
    name: str
    summary: str = ""
    source_pages: list[SourceRef] = Field(default_factory=list)


class DefinitionOut(BaseModel):
    term: str
    definition: str
    source_pages: list[SourceRef] = Field(default_factory=list)


class FormulaOut(BaseModel):
    name: str
    expression: str
    meaning: str = ""
    source_pages: list[SourceRef] = Field(default_factory=list)


class DocumentSummary(BaseModel):
    document_id: str
    document_name: str
    summary: str


class AnalysisResult(BaseModel):
    overall_summary: str = ""
    document_summaries: list[DocumentSummary] = Field(default_factory=list)
    topics: list[TopicOut] = Field(default_factory=list)
    definitions: list[DefinitionOut] = Field(default_factory=list)
    formulas: list[FormulaOut] = Field(default_factory=list)
    concepts: list[ConceptNode] = Field(default_factory=list)
    edges: list[ConceptEdge] = Field(default_factory=list)


class AnalysisOut(BaseModel):
    id: str | None = None
    status: Literal["idle", "running", "ready", "failed"]
    progress: float = 0.0
    stage: str = ""
    error: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    result: AnalysisResult | None = None


# --------------------------------------------------------------------------- #
# Tutor
# --------------------------------------------------------------------------- #
class HistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class TutorAskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    document_ids: list[str] = Field(default_factory=list, max_length=20)
    concept_id: str | None = Field(default=None, max_length=80)
    history: list[HistoryTurn] = Field(default_factory=list, max_length=12)
    allow_general_knowledge: bool = False


class TutorAnswer(BaseModel):
    answer: str
    supported: bool
    not_found: bool = False
    citations: list[Citation] = Field(default_factory=list)
    passages: list[Passage] = Field(default_factory=list)


class TutorTurnOut(BaseModel):
    id: int
    role: Literal["user", "assistant"]
    content: str
    citations: list[Citation] = Field(default_factory=list)
    created_at: str


# --------------------------------------------------------------------------- #
# Study materials
# --------------------------------------------------------------------------- #
MaterialKind = Literal["notes", "flashcards", "practice", "simplified"]


class MaterialsRequest(BaseModel):
    concept_ids: list[str] = Field(default_factory=list, max_length=12)
    document_ids: list[str] = Field(default_factory=list, max_length=20)
    page_start: int | None = Field(default=None, ge=1)
    page_end: int | None = Field(default=None, ge=1)
    count: int = Field(default=8, ge=1, le=30)
    difficulty: Difficulty = "medium"


class MaterialOut(BaseModel):
    id: str
    kind: MaterialKind
    concept_ids: list[str] = Field(default_factory=list)
    concept_names: list[str] = Field(default_factory=list)
    created_at: str
    payload: dict[str, Any]


class MaterialsListOut(BaseModel):
    materials: list[MaterialOut]


# --------------------------------------------------------------------------- #
# Quizzes
# --------------------------------------------------------------------------- #
class QuizCreateRequest(BaseModel):
    num_questions: int = Field(default=8, ge=3, le=20)
    concept_ids: list[str] = Field(default_factory=list, max_length=40)
    difficulty_mix: dict[str, float] = Field(
        default_factory=lambda: {"easy": 0.3, "medium": 0.5, "hard": 0.2}
    )

    @field_validator("difficulty_mix")
    @classmethod
    def check_mix(cls, v: dict[str, float]) -> dict[str, float]:
        allowed = {"easy", "medium", "hard"}
        if not v or set(v) - allowed or any(x < 0 for x in v.values()) or sum(v.values()) <= 0:
            raise ValueError("difficulty_mix must contain non-negative easy/medium/hard weights")
        return v


class PublicQuestion(BaseModel):
    id: str
    prompt: str
    options: dict[str, str]
    difficulty: Difficulty
    tested_concept_ids: list[str]
    tested_concept_names: list[str] = Field(default_factory=list)
    source_pages: list[Citation] = Field(default_factory=list)


class PublicQuiz(BaseModel):
    id: str
    created_at: str
    questions: list[PublicQuestion]


class QuizSummary(BaseModel):
    id: str
    created_at: str
    status: str
    question_count: int = 0
    concepts: list[str] = Field(default_factory=list)
    latest_score: int | None = None
    latest_total: int | None = None
    attempted: bool = False


class QuizSubmitRequest(BaseModel):
    answers: dict[str, str | None] = Field(default_factory=dict)
    time_taken_seconds: float | None = Field(default=None, ge=0, le=86400)

    @field_validator("answers")
    @classmethod
    def option_values(cls, v: dict[str, str | None]) -> dict[str, str | None]:
        for key, val in v.items():
            if val is not None and val not in OPTION_KEYS:
                raise ValueError(f"answer for {key} must be A, B, C or D")
        return v


class GradedQuestion(BaseModel):
    id: str
    prompt: str
    options: dict[str, str]
    chosen: str | None
    answered: bool
    correct: bool
    correct_option: OptionKey
    correct_text: str
    chosen_text: str | None
    misconception: str | None
    explanation: str
    difficulty: Difficulty
    tested_concept_ids: list[str]
    source_pages: list[Citation] = Field(default_factory=list)


class ConceptScore(BaseModel):
    concept_id: str
    name: str
    correct: int
    answered: int
    wrong_question_ids: list[str] = Field(default_factory=list)


class GradedAttempt(BaseModel):
    attempt_id: str
    quiz_id: str
    score: int
    total: int
    answered: int
    time_taken_seconds: float | None = None
    created_at: str
    questions: list[GradedQuestion]
    concepts: list[ConceptScore]


class FollowUpRequest(BaseModel):
    concept_ids: list[str] = Field(default_factory=list, max_length=10)
    num_questions: int = Field(default=3, ge=1, le=8)


# --------------------------------------------------------------------------- #
# Diagnosis
# --------------------------------------------------------------------------- #
class ObservedMistakeOut(BaseModel):
    question_id: str
    concept_ids: list[str]
    concept_names: list[str] = Field(default_factory=list)
    chosen: str | None = None
    correct_answer: OptionKey
    pattern: str
    unanswered: bool
    prompt: str = ""
    options: dict[str, str] = Field(default_factory=dict)


class FollowUpSuggestion(BaseModel):
    concept_id: str
    concept_name: str
    prompt: str


class GapOut(BaseModel):
    concept_id: str
    concept_name: str
    kind: Literal["prerequisite", "self"]
    supporting_question_ids: list[str]
    dependent_concept_ids: list[str] = Field(default_factory=list)
    dependent_concept_names: list[str] = Field(default_factory=list)
    supported_prerequisites: list[str] = Field(default_factory=list)
    alternatives: list[str] = Field(default_factory=list)
    evidence: Literal["Limited", "Some", "Stronger"]
    needs_more_evidence: bool
    summary: str
    why: str = ""
    page_references: list[Citation] = Field(default_factory=list)
    recommended_follow_up: FollowUpSuggestion | None = None
    hypothesis_outcome: str | None = None


class DiagnosisOut(BaseModel):
    id: str
    attempt_id: str
    created_at: str
    observed: list[ObservedMistakeOut]
    statuses: dict[str, str]
    gaps: list[GapOut]
    concepts: list[ConceptNode] = Field(default_factory=list)


class DiagnosisRequest(BaseModel):
    attempt_id: str = Field(min_length=1, max_length=64)


# --------------------------------------------------------------------------- #
# Path / progress
# --------------------------------------------------------------------------- #
class PathPageRef(BaseModel):
    document_id: str
    document_name: str
    pages: list[int]


class PathStepOut(BaseModel):
    concept_id: str
    concept_name: str
    verb: Literal["Review", "Revisit", "Practice", "Continue to", "Reassess"]
    reason: str
    prerequisites_in_path: list[str] = Field(default_factory=list)
    minutes: int = 15
    page_references: list[PathPageRef] = Field(default_factory=list)
    material_ids: list[str] = Field(default_factory=list)
    completed: bool = False
    ord: int = 0


class PathOut(BaseModel):
    id: str | None = None
    created_at: str | None = None
    steps: list[PathStepOut] = Field(default_factory=list)
    concepts: list[ConceptNode] = Field(default_factory=list)
    completed_count: int = 0


class ActivityOut(BaseModel):
    id: int
    kind: str
    detail: str
    created_at: str


class AttemptTimelineItem(BaseModel):
    id: str
    quiz_id: str
    score: int
    total: int
    answered: int
    created_at: str


class ConceptProgress(BaseModel):
    concept_id: str
    name: str
    status: Literal["mastered", "developing", "untested"]
    trend: Literal["up", "down", "flat", "unknown"]
    answered: int = 0
    correct: int = 0
    attempts: int = 0


class ProgressOut(BaseModel):
    concepts: list[ConceptProgress] = Field(default_factory=list)
    attempts: list[AttemptTimelineItem] = Field(default_factory=list)
    score_history: list[AttemptTimelineItem] = Field(default_factory=list)
    completed_steps: list[str] = Field(default_factory=list)
    gaps_open: int = 0
    gaps_resolved: int = 0
    activity: list[ActivityOut] = Field(default_factory=list)
    document_count: int = 0
    quiz_count: int = 0
    material_count: int = 0


# --------------------------------------------------------------------------- #
# Explain (legacy contract in docs/BACKEND_CONTRACT.md)
# --------------------------------------------------------------------------- #
class ExplainEvidence(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    question_id: str | int | None = Field(default=None, alias="questionId")
    prompt: str = ""
    chosen: str | None = None
    correct: str | None = None
    pattern: str | None = None


class ExplainRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    concept_id: str = Field(alias="conceptId", min_length=1, max_length=80)
    concept_name: str = Field(default="", alias="conceptName", max_length=200)
    evidence: list[ExplainEvidence] = Field(default_factory=list, max_length=20)


class ExplainResponse(BaseModel):
    title: str
    paragraphs: list[str]
    note: str | None = None


class ExplainLLM(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    paragraphs: list[str] = Field(min_length=1, max_length=6)
    note: str = Field(default="", max_length=400)


# --------------------------------------------------------------------------- #
# LLM output schemas
# --------------------------------------------------------------------------- #
class TopicExtract(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    summary: str = Field(default="", max_length=600)
    source_pages: list[SourceRef] = Field(default_factory=list, max_length=8)


class DefinitionExtract(BaseModel):
    term: str = Field(min_length=1, max_length=120)
    definition: str = Field(min_length=1, max_length=800)
    source_pages: list[SourceRef] = Field(default_factory=list, max_length=8)


class FormulaExtract(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    expression: str = Field(min_length=1, max_length=300)
    meaning: str = Field(default="", max_length=400)
    source_pages: list[SourceRef] = Field(default_factory=list, max_length=8)


class ConceptExtract(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    subtopics: list[str] = Field(default_factory=list, max_length=8)
    importance: float = Field(default=0.5, ge=0.0, le=1.0)
    source_pages: list[SourceRef] = Field(default_factory=list, max_length=8)


class PrereqExtract(BaseModel):
    prerequisite: str = Field(min_length=1, max_length=120)
    concept: str = Field(min_length=1, max_length=120)
    rationale: str = Field(default="", max_length=400)
    source: Literal["document", "inferred"] = "inferred"
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)


class BatchExtraction(BaseModel):
    summary: str = Field(default="", max_length=1200)
    topics: list[TopicExtract] = Field(default_factory=list, max_length=12)
    definitions: list[DefinitionExtract] = Field(default_factory=list, max_length=16)
    formulas: list[FormulaExtract] = Field(default_factory=list, max_length=12)
    concepts: list[ConceptExtract] = Field(default_factory=list, max_length=14)
    prerequisites: list[PrereqExtract] = Field(default_factory=list, max_length=20)


class MapSynthesis(BaseModel):
    """Model-assisted merging step: names only, matched back to extracted concepts."""

    concepts: list[ConceptExtract] = Field(default_factory=list, max_length=45)
    prerequisites: list[PrereqExtract] = Field(default_factory=list, max_length=90)
    overall_summary: str = Field(default="", max_length=1500)


class GeneratedQuestion(BaseModel):
    prompt: str = Field(min_length=10, max_length=1500)
    options: dict[str, str] = Field(min_length=4, max_length=4)
    correct_option: OptionKey
    difficulty: Difficulty
    tested_concepts: list[str] = Field(min_length=1, max_length=3)
    source_pages: list[SourceRef] = Field(min_length=1, max_length=6)
    misconceptions: dict[str, str] = Field(min_length=1, max_length=3)
    explanation: str = Field(min_length=1, max_length=1200)

    @field_validator("options")
    @classmethod
    def exactly_four_options(cls, v: dict[str, str]) -> dict[str, str]:
        if set(v) != set(OPTION_KEYS):
            raise ValueError("options must have exactly the keys A, B, C and D")
        cleaned = {k: str(v[k]).strip() for k in OPTION_KEYS}
        if any(not cleaned[k] for k in OPTION_KEYS):
            raise ValueError("options must not be empty")
        if len({cleaned[k].lower() for k in OPTION_KEYS}) != 4:
            raise ValueError("options must be distinct")
        return cleaned

    @model_validator(mode="after")
    def check_misconceptions(self) -> "GeneratedQuestion":
        wrong = {k for k in OPTION_KEYS if k != self.correct_option}
        if set(self.misconceptions) != wrong:
            raise ValueError("misconceptions must have exactly one entry for each wrong option")
        return self


class GeneratedQuiz(BaseModel):
    questions: list[GeneratedQuestion] = Field(min_length=1, max_length=10)


class TutorCitationOut(BaseModel):
    document_id: str
    page: int
    quote: str = ""


class TutorLLMAnswer(BaseModel):
    answer: str = Field(min_length=1, max_length=4000)
    supported_by_documents: bool = True
    not_found: bool = False
    citations: list[TutorCitationOut] = Field(default_factory=list, max_length=10)


class NoteSectionLLM(BaseModel):
    heading: str = Field(min_length=1, max_length=140)
    key_points: list[str] = Field(default_factory=list, max_length=10)
    definitions: list[DefinitionExtract] = Field(default_factory=list, max_length=10)
    formulas: list[FormulaExtract] = Field(default_factory=list, max_length=10)
    source_pages: list[SourceRef] = Field(default_factory=list, max_length=8)


class NotesLLM(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    sections: list[NoteSectionLLM] = Field(min_length=1, max_length=10)


class FlashcardLLM(BaseModel):
    front: str = Field(min_length=1, max_length=400)
    back: str = Field(min_length=1, max_length=900)
    concept_id: str = ""
    source_pages: list[SourceRef] = Field(default_factory=list, max_length=4)


class FlashcardSetLLM(BaseModel):
    cards: list[FlashcardLLM] = Field(min_length=1, max_length=40)


class PracticeQuestionLLM(BaseModel):
    prompt: str = Field(min_length=5, max_length=1200)
    difficulty: Difficulty = "medium"
    answer: str = Field(min_length=1, max_length=1500)
    explanation: str = Field(min_length=1, max_length=1500)
    concept_id: str = ""
    source_pages: list[SourceRef] = Field(default_factory=list, max_length=4)


class PracticeSetLLM(BaseModel):
    questions: list[PracticeQuestionLLM] = Field(min_length=1, max_length=30)


class SimplifiedLLM(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    explanation: str = Field(min_length=1, max_length=2500)
    analogy: str = Field(default="", max_length=800)
    source_pages: list[SourceRef] = Field(default_factory=list, max_length=8)


class DiagnosisPhrase(BaseModel):
    summary: str = Field(min_length=1, max_length=900)
    why: str = Field(default="", max_length=1200)


class DiagnosisPhrasingLLM(BaseModel):
    explanations: dict[str, DiagnosisPhrase] = Field(default_factory=dict)

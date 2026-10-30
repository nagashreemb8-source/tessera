"""Shared test fixtures.

Everything runs offline: a fake LLM client implements the same interface as the real
Nebius client, and PDFs are generated on the fly with PyMuPDF.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173,http://testserver")

from app.db import dumps, get_db, init_db, new_id, utcnow  # noqa: E402
from app.llm import set_llm_client  # noqa: E402
from app.models import (  # noqa: E402
    BatchExtraction,
    ConceptExtract,
    DefinitionExtract,
    DiagnosisPhrasingLLM,
    ExplainLLM,
    FlashcardLLM,
    FlashcardSetLLM,
    FormulaExtract,
    GeneratedQuestion,
    GeneratedQuiz,
    MapSynthesis,
    NoteSectionLLM,
    NotesLLM,
    PracticeQuestionLLM,
    PracticeSetLLM,
    PrereqExtract,
    SimplifiedLLM,
    SourceRef,
    TopicExtract,
    TutorCitationOut,
    TutorLLMAnswer,
)

PASSAGE_RE = re.compile(
    r"document_id=(\S+)\s+document_name=(.+?)\s+page[s]?\s+(\d+)(?:-(\d+))?"
)
DOC_HEADER_RE = re.compile(
    r"\[document_id=(\S+)\s*\|[^|]*\|\s*page[s]?\s+(\d+)(?:-(\d+))?\]"
)


def make_pdf_bytes(pages: list[str]) -> bytes:
    import fitz

    doc = fitz.open()
    for text in pages:
        page = doc.new_page()
        if text:
            page.insert_textbox(fitz.Rect(50, 50, 550, 780), text, fontsize=10)
    data = doc.tobytes()
    doc.close()
    return data


def make_encrypted_pdf_bytes(text: str = "secret content here") -> bytes:
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    data = doc.tobytes(
        encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="student"
    )
    doc.close()
    return data


def make_blank_pdf_bytes(page_count: int = 2) -> bytes:
    import fitz

    doc = fitz.open()
    for _ in range(page_count):
        doc.new_page()
    data = doc.tobytes()
    doc.close()
    return data


def first_passages(user: str) -> list[tuple[str, int]]:
    found = []
    for match in PASSAGE_RE.finditer(user):
        found.append((match.group(1), int(match.group(3))))
    # Deduplicate while preserving order.
    out = []
    for doc_id, page in found:
        if (doc_id, page) not in out:
            out.append((doc_id, page))
    return out


class FakeLLM:
    """Deterministic stand-in for the Nebius client (no network)."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def complete(self, **_: object) -> str:
        return "{}"

    async def list_models(self) -> list[dict]:
        return [{"id": "fake-model", "object": "model"}]

    async def json(self, *, system: str, user: str, schema, max_tokens: int = 2000, temperature: float = 0.0):
        self.calls.append(schema.__name__)
        passages = first_passages(user)
        fallback = ("doc-unknown", 1)
        doc_id, page = passages[0] if passages else fallback

        if schema is BatchExtraction:
            header = DOC_HEADER_RE.search(user)
            if header:
                doc_id, page = header.group(1), int(header.group(2))
            names = ["Random Variables", "Expected Value", "Variance"]
            return BatchExtraction(
                summary="This section defines random variables, expected value and variance.",
                topics=[
                    TopicExtract(
                        name=name,
                        summary=f"{name} is introduced here.",
                        source_pages=[SourceRef(document_id=doc_id, pages=[page])],
                    )
                    for name in names
                ],
                definitions=[
                    DefinitionExtract(
                        term="Expected value",
                        definition="The probability-weighted long-run average.",
                        source_pages=[SourceRef(document_id=doc_id, pages=[page])],
                    )
                ],
                formulas=[
                    FormulaExtract(
                        name="Expectation",
                        expression="E[X] = sum x P(X=x)",
                        meaning="Weight each value by its probability.",
                        source_pages=[SourceRef(document_id=doc_id, pages=[page])],
                    )
                ],
                concepts=[
                    ConceptExtract(
                        name=name,
                        description=f"{name} explained from the document.",
                        subtopics=[],
                        importance=0.9 - index * 0.15,
                        source_pages=[SourceRef(document_id=doc_id, pages=[page])],
                    )
                    for index, name in enumerate(names)
                ],
                prerequisites=[
                    PrereqExtract(
                        prerequisite="Random Variables",
                        concept="Expected Value",
                        rationale="The text defines expected value in terms of a random variable.",
                        source="document",
                        confidence=0.9,
                    ),
                    PrereqExtract(
                        prerequisite="Expected Value",
                        concept="Variance",
                        rationale="Variance uses the expected value as its centre.",
                        source="document",
                        confidence=0.85,
                    ),
                ],
            )

        if schema is MapSynthesis:
            names = re.findall(r"^- (.+)$", user, flags=re.MULTILINE) or ["Random Variables"]
            names = [n.strip() for n in names if n.strip()][:10]
            return MapSynthesis(
                concepts=[
                    ConceptExtract(
                        name=name,
                        description=f"{name} explained.",
                        importance=0.8,
                        source_pages=[],
                    )
                    for name in names
                ],
                prerequisites=[
                    PrereqExtract(
                        prerequisite=names[i],
                        concept=names[i + 1],
                        rationale="Later concept builds on the earlier one.",
                        source="inferred",
                        confidence=0.6,
                    )
                    for i in range(len(names) - 1)
                ],
                overall_summary="A short study set about probability foundations.",
            )

        if schema is GeneratedQuiz:
            concept_match = re.search(r"Concept: (.+?) \(([^)]+)\)", user)
            concept_name = concept_match.group(1) if concept_match else "Concept"
            concept_id = concept_match.group(2) if concept_match else doc_id
            count_match = re.search(r"Number of questions: (\d+)", user)
            count = int(count_match.group(1)) if count_match else 1
            difficulty_match = re.search(r"Difficulty: (easy|medium|hard)", user)
            difficulty = difficulty_match.group(1) if difficulty_match else "medium"
            questions = []
            for index in range(max(1, min(count, 4))):
                if not passages:
                    break
                quiz_doc, quiz_page = passages[index % len(passages)]
                questions.append(
                    GeneratedQuestion(
                        prompt=f"{concept_name}: which statement is correct? (variant {index + 1})",
                        options={
                            "A": "The statement consistent with the document.",
                            "B": "A common but incorrect shortcut.",
                            "C": "A reversed definition.",
                            "D": "A value that ignores probability weights.",
                        },
                        correct_option="A",
                        difficulty=difficulty,
                        tested_concepts=[concept_id],
                        source_pages=[SourceRef(document_id=quiz_doc, pages=[quiz_page])],
                        misconceptions={
                            "B": "Applied a shortcut that ignores weighting.",
                            "C": "Reversed the definition.",
                            "D": "Ignored the probability weights.",
                        },
                        explanation="The document states the correct relationship explicitly.",
                    )
                )
            return GeneratedQuiz(questions=questions)

        if schema is TutorLLMAnswer:
            if not passages:
                return TutorLLMAnswer(
                    answer="The documents do not contain that.",
                    supported_by_documents=False,
                    not_found=True,
                    citations=[],
                )
            return TutorLLMAnswer(
                answer=f"According to your document [page {page}], this is explained there.",
                supported_by_documents=True,
                not_found=False,
                citations=[TutorCitationOut(document_id=doc_id, page=page, quote="quoted text")],
            )

        if schema is NotesLLM:
            return NotesLLM(
                title="Revision notes",
                sections=[
                    NoteSectionLLM(
                        heading="Key idea",
                        key_points=["A point grounded in the document."],
                        definitions=[
                            DefinitionExtract(
                                term="Expected value",
                                definition="Weighted average.",
                                source_pages=[SourceRef(document_id=doc_id, pages=[page])],
                            )
                        ],
                        formulas=[
                            FormulaExtract(
                                name="E[X]",
                                expression="sum x P(X=x)",
                                meaning="Weighted average.",
                                source_pages=[SourceRef(document_id=doc_id, pages=[page])],
                            )
                        ],
                        source_pages=[SourceRef(document_id=doc_id, pages=[page])],
                    )
                ],
            )

        if schema is FlashcardSetLLM:
            return FlashcardSetLLM(
                cards=[
                    FlashcardLLM(
                        front="What is expected value?",
                        back="A probability-weighted average.",
                        concept_id="",
                        source_pages=[SourceRef(document_id=doc_id, pages=[page])],
                    )
                ]
            )

        if schema is PracticeSetLLM:
            return PracticeSetLLM(
                questions=[
                    PracticeQuestionLLM(
                        prompt="Compute an expectation for the example in the text.",
                        difficulty="medium",
                        answer="Use the weighted sum.",
                        explanation="Multiply each value by its probability and add.",
                        concept_id="",
                        source_pages=[SourceRef(document_id=doc_id, pages=[page])],
                    )
                ]
            )

        if schema is SimplifiedLLM:
            return SimplifiedLLM(
                title="A simpler view",
                explanation="It is a weighted average.",
                analogy="Like a class average where each score counts more or less.",
                source_pages=[SourceRef(document_id=doc_id, pages=[page])],
            )

        if schema is DiagnosisPhrasingLLM:
            return DiagnosisPhrasingLLM(explanations={})

        if schema is ExplainLLM:
            return ExplainLLM(
                title="Another way to see it",
                paragraphs=["Think of it as a weighted average."],
                note="Grounded in your documents.",
            )

        raise AssertionError(f"FakeLLM has no canned response for {schema.__name__}")


@pytest.fixture()
def fake_llm() -> FakeLLM:
    client = FakeLLM()
    set_llm_client(client)
    yield client
    set_llm_client(None)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("NEBIUS_API_KEY", "")
    monkeypatch.setenv("NEBIUS_BASE_URL", "")
    monkeypatch.setenv("NEBIUS_MODEL", "")
    from app.config import reset_settings_cache

    reset_settings_cache()
    init_db()
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
    set_llm_client(None)
    reset_settings_cache()


@pytest.fixture()
def session(client):
    response = client.post("/api/sessions")
    assert response.status_code == 200
    sid = response.json()["session_id"]
    return {"id": sid, "headers": {"X-Session-Id": sid}}


def upload_pdf(client, headers, pdf_bytes: bytes, name: str = "notes.pdf", content_type: str = "application/pdf"):
    return client.post(
        "/api/documents",
        headers=headers,
        files=[("files", (name, pdf_bytes, content_type))],
    )


TEXT_PAGES = [
    "Chapter 1 Random Variables. A random variable assigns a number to each outcome of an experiment. "
    "We write X for the random variable and P(X = x) for the probability of a value. "
    "Expected value is defined as the probability-weighted average of the possible values. "
    "Variance measures the spread of a random variable around its expected value.",
    "Chapter 2 Expected Value. The expected value E[X] is the sum of each value multiplied by its probability. "
    "For a fair die the expected value is 3.5 because each face has probability one sixth. "
    "Variance is the expected squared deviation from the mean, Var(X) = E[(X - E[X])^2]. "
    "Scaling a random variable by a constant squares the effect on variance.",
    "Chapter 3 Sampling. The sampling distribution of the mean describes how the sample average varies. "
    "Its standard error is the population standard deviation divided by the square root of the sample size. "
    "The central limit theorem says that averages of independent observations approach a normal shape.",
]


def upload_text_pdf(client, headers, name: str = "stats-notes.pdf") -> str:
    response = upload_pdf(client, headers, make_pdf_bytes(TEXT_PAGES), name=name)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["results"][0]["status"] in {"processed", "partial"}, payload
    return payload["results"][0]["document_id"]


# --------------------------------------------------------------------------- #
# Seeding helpers for deterministic diagnosis/path tests (no LLM involved)
# --------------------------------------------------------------------------- #
SEED_CONCEPTS = [
    {"id": "basics", "name": "Basics", "level": 0, "importance": 0.9, "prereqs": []},
    {"id": "variables", "name": "Random Variables", "level": 1, "importance": 0.8, "prereqs": ["basics"]},
    {"id": "expected", "name": "Expected Value", "level": 2, "importance": 0.9, "prereqs": ["variables"]},
    {"id": "variance", "name": "Variance", "level": 3, "importance": 0.8, "prereqs": ["expected"]},
    {"id": "distributions", "name": "Distributions", "level": 2, "importance": 0.6, "prereqs": ["variables"]},
    {"id": "clt", "name": "Central Limit Theorem", "level": 4, "importance": 0.5, "prereqs": ["variance"]},
]


def seed_analysis(session_id: str) -> str:
    """Insert a ready analysis with a known DAG (no LLM call)."""
    analysis_id = new_id()
    nodes = [
        {
            "id": c["id"],
            "name": c["name"],
            "description": f"{c['name']} description",
            "level": c["level"],
            "importance": c["importance"],
            "source_pages": [],
        }
        for c in SEED_CONCEPTS
    ]
    edges = [
        {
            "from_id": prereq,
            "to_id": c["id"],
            "rationale": f"{prereq} comes before {c['id']}",
            "source": "inferred",
            "confidence": 0.7,
            "pages": [],
        }
        for c in SEED_CONCEPTS
        for prereq in c["prereqs"]
    ]
    payload = {
        "overall_summary": "Seeded concept map for tests.",
        "document_summaries": [],
        "topics": [],
        "definitions": [],
        "formulas": [],
        "concepts": nodes,
        "edges": edges,
    }
    now = utcnow()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO analyses (id, session_id, status, progress, stage, error, payload, created_at, updated_at) "
            "VALUES (?, ?, 'ready', 1.0, 'Ready', NULL, ?, ?, ?)",
            (analysis_id, session_id, dumps(payload), now, now),
        )
        for edge in edges:
            conn.execute(
                "INSERT INTO concept_edges (analysis_id, session_id, from_id, to_id, rationale, source, confidence, pages) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, '[]')",
                (analysis_id, session_id, edge["from_id"], edge["to_id"], edge["rationale"], edge["source"], edge["confidence"]),
            )
    return analysis_id


def seed_quiz(session_id: str, questions: list[dict], followup: list[str] | None = None) -> str:
    """Insert a quiz directly. questions: prompt, tested (ids), correct, misconceptions."""
    quiz_id = new_id("quiz_")
    now = utcnow()
    params = {
        "requested": {},
        "followup_concepts": followup or [],
        "concepts": [{"id": c["id"], "name": c["name"]} for c in SEED_CONCEPTS],
        "question_count": len(questions),
    }
    with get_db() as conn:
        conn.execute(
            "INSERT INTO quizzes (id, session_id, status, params, analysis_id, created_at) "
            "VALUES (?, ?, 'generated', ?, NULL, ?)",
            (quiz_id, session_id, dumps(params), now),
        )
        for index, question in enumerate(questions):
            payload = {
                "id": new_id("q_"),
                "prompt": question["prompt"],
                "options": {
                    "A": question.get("correct_text", "Correct answer"),
                    "B": question.get("b", "Distractor B"),
                    "C": question.get("c", "Distractor C"),
                    "D": question.get("d", "Distractor D"),
                },
                "correct": question.get("correct", "A"),
                "difficulty": question.get("difficulty", "medium"),
                "tested_concept_ids": question["tested"],
                "misconceptions": {
                    key: question.get("misconceptions", {}).get(key, f"Error {key}")
                    for key in ("A", "B", "C", "D")
                    if key != question.get("correct", "A")
                },
                "explanation": "Grounded explanation.",
                "source_pages": [],
            }
            conn.execute(
                "INSERT INTO quiz_questions (id, quiz_id, session_id, ord, payload) VALUES (?, ?, ?, ?, ?)",
                (payload["id"], quiz_id, session_id, index, dumps(payload)),
            )
    return quiz_id


def submit_answers(client, headers, quiz_id: str, answers: dict[str, str | None]) -> dict:
    response = client.post(
        f"/api/quizzes/{quiz_id}/submit", headers=headers, json={"answers": answers}
    )
    assert response.status_code == 200, response.text
    return response.json()


def question_ids(session_id: str, quiz_id: str) -> list[str]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id FROM quiz_questions WHERE quiz_id = ? AND session_id = ? ORDER BY ord",
            (quiz_id, session_id),
        ).fetchall()
    return [row["id"] for row in rows]

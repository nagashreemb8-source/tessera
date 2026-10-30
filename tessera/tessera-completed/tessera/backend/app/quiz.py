"""Diagnostic quiz generation and deterministic grading.

The correct answers never leave the server before submission. Grading is pure Python:
the LLM is never asked whether an answer is right.
"""
from __future__ import annotations

import json
import logging
import math
import sqlite3
from typing import Any

from .analysis import get_concept_map
from .config import get_settings
from .db import dumps, get_db, loads, log_activity, new_id, utcnow
from .errors import ApiError
from .llm import LLMError, get_llm
from .models import (
    ConceptScore,
    Difficulty,
    GeneratedQuestion,
    GradedAttempt,
    GradedQuestion,
    OPTION_KEYS,
    PublicQuestion,
    PublicQuiz,
    QuizCreateRequest,
    QuizSubmitRequest,
)
from .prompts import quiz_prompt
from .retrieval import search, to_passages

log = logging.getLogger("tessera.quiz")

MAX_QUIZ_QUESTIONS = 20


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _difficulty_plan(num: int, mix: dict[str, float]) -> list[Difficulty]:
    total = sum(mix.values()) or 1.0
    counts = {k: int(math.floor(num * (mix.get(k, 0.0) / total))) for k in ("easy", "medium", "hard")}
    while sum(counts.values()) < num:
        # Give leftovers to the largest weight
        key = max(("easy", "medium", "hard"), key=lambda k: mix.get(k, 0.0))
        counts[key] += 1
    while sum(counts.values()) > num:
        key = max(("easy", "medium", "hard"), key=lambda k: counts[k])
        counts[key] -= 1
    plan: list[Difficulty] = []
    for key in ("easy", "medium", "hard"):
        plan.extend([key] * counts[key])  # type: ignore[list-item]
    return plan[:num]


def _concept_targets(nodes: list[dict], requested: list[str], num: int) -> list[dict]:
    pool = nodes
    if requested:
        wanted = [n for n in nodes if n["id"] in set(requested)]
        if not wanted:
            raise ApiError(400, "unknown_concepts", "None of the requested concepts exist in this study set.")
        pool = wanted
    ordered = sorted(pool, key=lambda n: (-float(n.get("importance") or 0.0), int(n.get("level") or 0)))
    if not ordered:
        return []
    targets: list[dict] = []
    round_index = 0
    while len(targets) < num:
        concept = ordered[round_index % len(ordered)]
        targets.append(concept)
        round_index += 1
        if round_index > MAX_QUIZ_QUESTIONS * 2:
            break
    return targets


def _prereq_names(nodes_by_id: dict[str, dict], edges: list[dict], concept_id: str) -> list[str]:
    parents = [e["from_id"] for e in edges if e["to_id"] == concept_id]
    return [nodes_by_id[p]["name"] for p in parents if p in nodes_by_id]


def _refs_to_citations(refs: list[dict], names: dict[str, str]) -> list[dict[str, Any]]:
    out = []
    seen = set()
    for ref in refs:
        for page in ref.get("pages", [])[:2]:
            key = (ref["document_id"], page)
            if key in seen:
                continue
            seen.add(key)
            out.append(
                {
                    "document_id": ref["document_id"],
                    "document_name": names.get(ref["document_id"], "document"),
                    "page": int(page),
                    "snippet": "",
                }
            )
    return out


def _validate_question(
    question: GeneratedQuestion,
    allowed_concepts: set[str],
    allowed_pages: dict[str, set[int]],
    supplied_pages: dict[str, tuple[int, int]],
) -> tuple[GeneratedQuestion | None, str]:
    unknown = [c for c in question.tested_concepts if c not in allowed_concepts]
    if unknown:
        return None, f"unknown concept ids {unknown}"
    refs: list[dict[str, Any]] = []
    for ref in question.source_pages:
        valid_pages = allowed_pages.get(ref.document_id, set())
        window = supplied_pages.get(ref.document_id)
        pages = [
            p
            for p in ref.pages
            if p in valid_pages and (window is None or window[0] <= p <= window[1])
        ]
        if pages:
            refs.append({"document_id": ref.document_id, "pages": sorted(set(pages))})
    if not refs:
        return None, "no citation on a supplied page"
    normalised = question.model_copy(
        update={
            "source_pages": [
                type(question.source_pages[0])(document_id=r["document_id"], pages=r["pages"])
                for r in refs
            ]
        }
    )
    return normalised, ""


def _existing_prompts(session_id: str) -> set[str]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT payload FROM quiz_questions WHERE session_id = ?", (session_id,)
        ).fetchall()
    out = set()
    for row in rows:
        payload = loads(row["payload"], {}) or {}
        out.add(_prompt_key(payload.get("prompt", "")))
    return out


def _prompt_key(prompt: str) -> str:
    return " ".join(prompt.lower().split())[:160]


async def generate_quiz(
    session_id: str,
    request: QuizCreateRequest,
    *,
    followup_concepts: list[str] | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    with get_db() as conn:
        nodes, edges, analysis_id = get_concept_map(conn, session_id)
        names = {
            row["id"]: row["filename"]
            for row in conn.execute(
                "SELECT id, filename FROM documents WHERE session_id = ?", (session_id,)
            ).fetchall()
        }
        allowed_pages: dict[str, set[int]] = {}
        for row in conn.execute(
            "SELECT document_id, page_no FROM pages WHERE session_id = ?", (session_id,)
        ).fetchall():
            allowed_pages.setdefault(row["document_id"], set()).add(int(row["page_no"]))

    if not nodes:
        raise ApiError(
            409,
            "analysis_required",
            "Run document analysis first: quizzes are generated from your documents' concept map.",
        )

    nodes_by_id = {n["id"]: n for n in nodes}
    requested = followup_concepts if followup_concepts else request.concept_ids
    num = min(max(1, request.num_questions), MAX_QUIZ_QUESTIONS)
    targets = _concept_targets(nodes, requested, num)
    plan = _difficulty_plan(len(targets), request.difficulty_mix)
    existing = _existing_prompts(session_id)

    # Group concept/difficulty pairs so we do not waste calls.
    work: list[tuple[dict, Difficulty, int]] = []
    grouped: dict[tuple[str, str], int] = {}
    for concept, difficulty in zip(targets, plan):
        key = (concept["id"], difficulty)
        grouped[key] = grouped.get(key, 0) + 1
    for (concept_id, difficulty), count in grouped.items():
        work.append((nodes_by_id[concept_id], difficulty, min(count, 4)))

    questions: list[dict[str, Any]] = []
    llm = get_llm()
    for concept, difficulty, count in work:
        query = " ".join(
            [
                concept["name"],
                concept.get("description", "")[:200],
                " ".join(_prereq_names(nodes_by_id, edges, concept["id"])),
            ]
        )
        results, _ = search(
            _conn_for_search(session_id),
            session_id,
            query,
            k=settings.retrieval_top_k,
        )
        if not results:
            # Fall back to the concept's own source pages.
            refs = concept.get("source_pages") or []
            if refs:
                doc_ids = [r["document_id"] for r in refs]
                results, _ = search(
                    _conn_for_search(session_id), session_id, concept["name"], k=6, document_ids=doc_ids
                )
        if not results:
            log.info("no passages for concept %s; skipping quiz questions", concept["id"])
            continue
        passages = to_passages(results, max_chars=min(6000, settings.llm_max_prompt_chars // 3))
        supplied_pages: dict[str, tuple[int, int]] = {}
        for passage in passages:
            lo, hi = supplied_pages.get(passage.document_id, (passage.page_start, passage.page_end))
            supplied_pages[passage.document_id] = (min(lo, passage.page_start), max(hi, passage.page_end))
        prereq_ids = [e["from_id"] for e in edges if e["to_id"] == concept["id"]]
        system, user = quiz_prompt(
            concept_id=concept["id"],
            concept_name=concept["name"],
            concept_description=concept.get("description", ""),
            prerequisites=prereq_ids,
            difficulty=difficulty,
            count=count,
            passages=passages,
        )
        allowed_ids = set(nodes_by_id)
        for attempt in range(2):
            try:
                from .models import GeneratedQuiz

                generated = await llm.json(
                    system=system, user=user, schema=GeneratedQuiz, max_tokens=3000
                )
            except LLMError as exc:
                log.warning("quiz generation failed for %s: %s", concept["id"], exc.code)
                break
            for question in generated.questions:
                if len(questions) >= num:
                    break
                valid, reason = _validate_question(
                    question, allowed_ids, allowed_pages, supplied_pages
                )
                if valid is None:
                    log.info("rejected generated question: %s", reason)
                    continue
                key = _prompt_key(valid.prompt)
                if key in existing:
                    continue
                existing.add(key)
                questions.append(
                    {
                        "id": new_id("q_"),
                        "prompt": valid.prompt.strip(),
                        "options": valid.options,
                        "correct": valid.correct_option,
                        "difficulty": valid.difficulty,
                        "tested_concept_ids": valid.tested_concepts,
                        "misconceptions": valid.misconceptions,
                        "explanation": valid.explanation.strip(),
                        "source_pages": valid.source_pages
                        and [
                            {"document_id": r.document_id, "pages": r.pages}
                            for r in valid.source_pages
                        ],
                    }
                )
            if len(questions) >= num:
                break
            # Top up with a second attempt if this call under-delivered.
            remaining = count - sum(1 for q in questions if concept["id"] in q["tested_concept_ids"])
            if remaining <= 0:
                break
            system, user = quiz_prompt(
                concept_id=concept["id"],
                concept_name=concept["name"],
                concept_description=concept.get("description", ""),
                prerequisites=prereq_ids,
                difficulty=difficulty,
                count=remaining,
                passages=passages,
            )

    if len(questions) < 1:
        raise ApiError(
            502,
            "quiz_generation_failed",
            "The AI model could not produce valid questions from these documents. Try running analysis again "
            "or uploading a document with more explanatory text.",
        )
    questions = questions[:num]

    quiz_id = new_id("quiz_")
    created = utcnow()
    params = {
        "requested": request.model_dump(),
        "followup_concepts": followup_concepts or [],
        "concepts": [
            {"id": n["id"], "name": n["name"], "description": n.get("description", "")} for n in nodes
        ],
        "question_count": len(questions),
    }
    with get_db() as conn:
        conn.execute(
            "INSERT INTO quizzes (id, session_id, status, params, analysis_id, created_at) "
            "VALUES (?, ?, 'generated', ?, ?, ?)",
            (quiz_id, session_id, dumps(params), analysis_id, created),
        )
        for index, question in enumerate(questions):
            conn.execute(
                "INSERT INTO quiz_questions (id, quiz_id, session_id, ord, payload) VALUES (?, ?, ?, ?, ?)",
                (question["id"], quiz_id, session_id, index, dumps(question)),
            )
        log_activity(
            conn,
            session_id,
            "quiz",
            f"Generated a {len(questions)}-question diagnostic quiz",
        )
    log.info("quiz %s generated with %d questions", quiz_id, len(questions))
    return {"id": quiz_id, "question_count": len(questions), "created_at": created}


def _conn_for_search(session_id: str) -> sqlite3.Connection:  # pragma: no cover - thin wrapper
    # `search` needs a live connection; callers own the transaction boundary.
    return _CONN.get(session_id)  # type: ignore[return-value]


class _ConnRegistry:
    """Search runs inside a short-lived connection per call (SQLite is local and fast)."""

    def __init__(self) -> None:
        self._conns: dict[str, sqlite3.Connection] = {}

    def get(self, session_id: str) -> sqlite3.Connection:
        conn = self._conns.get(session_id)
        if conn is None:
            from .db import connect

            conn = connect()
            self._conns[session_id] = conn
        return conn


_CONN = _ConnRegistry()


# --------------------------------------------------------------------------- #
# Read / take
# --------------------------------------------------------------------------- #
def _load_quiz(conn: sqlite3.Connection, quiz_id: str, session_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM quizzes WHERE id = ? AND session_id = ?", (quiz_id, session_id)
    ).fetchone()
    if row is None:
        raise ApiError(404, "quiz_not_found", "That quiz does not exist in your session.")
    return row


def _load_questions(conn: sqlite3.Connection, quiz_id: str, session_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT payload FROM quiz_questions WHERE quiz_id = ? AND session_id = ? ORDER BY ord",
        (quiz_id, session_id),
    ).fetchall()
    return [loads(row["payload"], {}) for row in rows]


def public_quiz(session_id: str, quiz_id: str) -> dict[str, Any]:
    with get_db() as conn:
        quiz = _load_quiz(conn, quiz_id, session_id)
        questions = _load_questions(conn, quiz_id, session_id)
        names = {
            row["id"]: row["filename"]
            for row in conn.execute(
                "SELECT id, filename FROM documents WHERE session_id = ?", (session_id,)
            ).fetchall()
        }
        analysis_concepts = {
            c["id"]: c["name"]
            for c in (loads(quiz["params"], {}) or {}).get("concepts", [])
        }
    public = []
    for question in questions:
        public.append(
            PublicQuestion(
                id=question["id"],
                prompt=question["prompt"],
                options=question["options"],
                difficulty=question["difficulty"],
                tested_concept_ids=question["tested_concept_ids"],
                tested_concept_names=[
                    analysis_concepts.get(c, c) for c in question["tested_concept_ids"]
                ],
                source_pages=_refs_to_citations(question.get("source_pages") or [], names),
            )
        )
    return PublicQuiz(
        id=quiz["id"], created_at=quiz["created_at"], questions=public
    ).model_dump()


def list_quizzes(session_id: str) -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM quizzes WHERE session_id = ? ORDER BY created_at DESC", (session_id,)
        ).fetchall()
        out = []
        for row in rows:
            params = loads(row["params"], {}) or {}
            attempt = conn.execute(
                "SELECT score, total FROM attempts WHERE quiz_id = ? AND session_id = ? "
                "ORDER BY created_at DESC LIMIT 1",
                (row["id"], session_id),
            ).fetchone()
            concept_ids = []
            for question in _load_questions(conn, row["id"], session_id):
                for cid in question.get("tested_concept_ids", []):
                    if cid not in concept_ids:
                        concept_ids.append(cid)
            names = {c["id"]: c["name"] for c in params.get("concepts", [])}
            out.append(
                {
                    "id": row["id"],
                    "created_at": row["created_at"],
                    "status": row["status"],
                    "question_count": params.get("question_count", 0),
                    "concepts": [names.get(c, c) for c in concept_ids],
                    "latest_score": attempt["score"] if attempt else None,
                    "latest_total": attempt["total"] if attempt else None,
                    "attempted": attempt is not None,
                }
            )
    return out


def quiz_attempts(session_id: str, quiz_id: str) -> list[dict[str, Any]]:
    with get_db() as conn:
        _load_quiz(conn, quiz_id, session_id)
        rows = conn.execute(
            "SELECT * FROM attempts WHERE quiz_id = ? AND session_id = ? ORDER BY created_at",
            (quiz_id, session_id),
        ).fetchall()
    return [loads(row["results"], {}) for row in rows]


# --------------------------------------------------------------------------- #
# Grading (deterministic)
# --------------------------------------------------------------------------- #
def grade_attempt(session_id: str, quiz_id: str, submission: QuizSubmitRequest) -> dict[str, Any]:
    with get_db() as conn:
        quiz = _load_quiz(conn, quiz_id, session_id)
        if quiz["status"] == "submitted":
            raise ApiError(
                409,
                "quiz_already_submitted",
                "This quiz was already submitted. Generate a new quiz to try again.",
            )
        questions = _load_questions(conn, quiz_id, session_id)
        params = loads(quiz["params"], {}) or {}
        names = {c["id"]: c["name"] for c in params.get("concepts", [])}
        documents = {
            row["id"]: row["filename"]
            for row in conn.execute(
                "SELECT id, filename FROM documents WHERE session_id = ?", (session_id,)
            ).fetchall()
        }
        if not questions:
            raise ApiError(409, "empty_quiz", "This quiz has no questions.")

        graded: list[GradedQuestion] = []
        concept_stats: dict[str, dict[str, Any]] = {}
        score = 0
        answered_count = 0

        for question in questions:
            qid = question["id"]
            chosen = submission.answers.get(qid)
            if chosen is not None and chosen not in OPTION_KEYS:
                chosen = None
            answered = chosen is not None
            correct = answered and chosen == question["correct"]
            if answered:
                answered_count += 1
            if correct:
                score += 1
            for concept_id in question["tested_concept_ids"]:
                stats = concept_stats.setdefault(
                    concept_id,
                    {
                        "concept_id": concept_id,
                        "name": names.get(concept_id, concept_id),
                        "correct": 0,
                        "answered": 0,
                        "wrong_question_ids": [],
                    },
                )
                if answered:
                    stats["answered"] += 1
                    if correct:
                        stats["correct"] += 1
                    else:
                        stats["wrong_question_ids"].append(qid)
            misconception = (
                question["misconceptions"].get(chosen) if answered and not correct else None
            )
            graded.append(
                GradedQuestion(
                    id=qid,
                    prompt=question["prompt"],
                    options=question["options"],
                    chosen=chosen,
                    answered=answered,
                    correct=correct,
                    correct_option=question["correct"],
                    correct_text=question["options"][question["correct"]],
                    chosen_text=question["options"].get(chosen) if chosen else None,
                    misconception=misconception,
                    explanation=question["explanation"],
                    difficulty=question["difficulty"],
                    tested_concept_ids=question["tested_concept_ids"],
                    source_pages=_refs_to_citations(question.get("source_pages") or [], documents),
                )
            )

        attempt_id = new_id("att_")
        created = utcnow()
        results = {
            "attempt_id": attempt_id,
            "quiz_id": quiz_id,
            "score": score,
            "total": len(questions),
            "answered": answered_count,
            "time_taken_seconds": submission.time_taken_seconds,
            "created_at": created,
            "questions": [g.model_dump() for g in graded],
            "concepts": [ConceptScore(**stats).model_dump() for stats in concept_stats.values()],
        }
        conn.execute(
            "INSERT INTO attempts (id, quiz_id, session_id, answers, results, score, total, answered, "
            "time_taken_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                attempt_id,
                quiz_id,
                session_id,
                dumps(submission.answers),
                dumps(results),
                score,
                len(questions),
                answered_count,
                submission.time_taken_seconds,
                created,
            ),
        )
        conn.execute(
            "UPDATE quizzes SET status = 'submitted' WHERE id = ? AND session_id = ?",
            (quiz_id, session_id),
        )
        log_activity(
            conn,
            session_id,
            "attempt",
            f"Submitted quiz: {score}/{len(questions)} correct",
        )
    return results


def latest_attempt(session_id: str) -> sqlite3.Row | None:
    with get_db() as conn:
        return conn.execute(
            "SELECT * FROM attempts WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (session_id,),
        ).fetchone()


def attempt_payload(session_id: str, attempt_id: str) -> dict[str, Any]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM attempts WHERE id = ? AND session_id = ?", (attempt_id, session_id)
        ).fetchone()
    if row is None:
        raise ApiError(404, "attempt_not_found", "That attempt does not exist in your session.")
    return loads(row["results"], {}) or {}


def update_hypotheses_from_attempt(session_id: str, attempt: dict[str, Any]) -> None:
    """Follow-up quizzes update the hypothesis outcomes shown in Root Cause Replay."""
    with get_db() as conn:
        quiz = conn.execute(
            "SELECT params FROM quizzes WHERE id = ? AND session_id = ?",
            (attempt["quiz_id"], session_id),
        ).fetchone()
        if quiz is None:
            return
        params = loads(quiz["params"], {}) or {}
        followup = params.get("followup_concepts") or []
        if not followup:
            return
        for concept_id in followup:
            targeted = [
                q
                for q in attempt["questions"]
                if q["tested_concept_ids"] and q["tested_concept_ids"][0] == concept_id
            ]
            answered = [q for q in targeted if q["answered"]]
            if not answered:
                outcome, note = "more-evidence", "The follow-up was left unanswered, so the hypothesis is still open."
            elif all(q["correct"] for q in answered):
                outcome, note = (
                    "supported",
                    "Answering the follow-up correctly supports your understanding of this concept; the "
                    "original mistakes may come from elsewhere.",
                )
            else:
                repeated = next(
                    (q["misconception"] for q in answered if not q["correct"] and q["misconception"]),
                    None,
                )
                outcome = "possible-gap"
                note = (
                    f"The follow-up repeated a misconception: {repeated}."
                    if repeated
                    else "The follow-up was answered incorrectly, so the hypothesis remains plausible."
                )
            conn.execute(
                "INSERT INTO hypotheses (id, session_id, concept_id, diagnosis_id, outcome, note, updated_at) "
                "VALUES (?, ?, ?, NULL, ?, ?, ?)",
                (new_id("hyp_"), session_id, concept_id, outcome, note, utcnow()),
            )
        log_activity(conn, session_id, "diagnosis", "Follow-up quiz updated your open hypotheses")


def generate_followup(session_id: str, concept_ids: list[str], num_questions: int) -> dict[str, Any]:
    with get_db() as conn:
        nodes, _, _ = get_concept_map(conn, session_id)
    nodes_by_id = {n["id"]: n for n in nodes}
    gaps = [c for c in concept_ids if c in nodes_by_id]
    if not gaps:
        latest = _latest_gap_concepts(session_id)
        gaps = latest
    if not gaps:
        raise ApiError(
            409,
            "no_gaps_to_test",
            "There is no suspected gap to follow up on yet. Generate a diagnostic quiz first.",
        )
    gaps = gaps[:3]
    per_gap = max(1, min(3, num_questions // len(gaps)))
    request = QuizCreateRequest(
        num_questions=per_gap * len(gaps),
        concept_ids=gaps,
        difficulty_mix={"easy": 0.0, "medium": 1.0, "hard": 0.0},
    )
    return generate_quiz(session_id, request, followup_concepts=gaps)


def _latest_gap_concepts(session_id: str) -> list[str]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT payload FROM diagnoses WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (session_id,),
        ).fetchone()
    if row is None:
        return []
    payload = loads(row["payload"], {}) or {}
    return [gap["concept_id"] for gap in payload.get("gaps", [])][:3]


def quiz_concept_snapshot(session_id: str, quiz_id: str) -> list[dict]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT params FROM quizzes WHERE id = ? AND session_id = ?", (quiz_id, session_id)
        ).fetchone()
    if row is None:
        return []
    return (loads(row["params"], {}) or {}).get("concepts", [])


def attempt_timeline(session_id: str) -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, quiz_id, score, total, answered, created_at FROM attempts "
            "WHERE session_id = ? ORDER BY created_at",
            (session_id,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "quiz_id": row["quiz_id"],
            "score": row["score"],
            "total": row["total"],
            "answered": row["answered"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


__all__ = [
    "GradedAttempt",
    "attempt_payload",
    "attempt_timeline",
    "generate_followup",
    "generate_quiz",
    "grade_attempt",
    "latest_attempt",
    "list_quizzes",
    "public_quiz",
    "quiz_attempts",
    "quiz_concept_snapshot",
    "update_hypotheses_from_attempt",
    "json",
]

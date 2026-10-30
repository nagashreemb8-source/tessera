"""Document-grounded tutor.

Retrieval happens before the model is called. The model only sees this session's
passages, labelled with document and page. Every returned citation is checked against
the retrieved set; citations to pages that were not supplied are removed, and inline
page references that were never retrieved are stripped.
"""
from __future__ import annotations

import logging
import re

from .db import dumps, get_db, loads, log_activity, utcnow
from .errors import ApiError
from .llm import LLMError, get_llm
from .models import Citation, Passage, TutorAskRequest, TutorLLMAnswer
from .prompts import tutor_prompt
from .retrieval import search, to_passages

log = logging.getLogger("tessera.tutor")

MAX_HISTORY_TURNS = 8


def _retrieved_pages(passages: list[Passage]) -> dict[str, set[int]]:
    allowed: dict[str, set[int]] = {}
    for passage in passages:
        allowed.setdefault(passage.document_id, set()).update(
            range(passage.page_start, passage.page_end + 1)
        )
    return allowed


def _validate_citations(citations: list, passages: list[Passage]) -> list[Citation]:
    allowed = _retrieved_pages(passages)
    by_key = {(p.document_id, p.page_start) : p for p in passages}
    out: list[Citation] = []
    seen: set[tuple[str, int]] = set()
    for citation in citations:
        pages = allowed.get(citation.document_id)
        if not pages or citation.page not in pages:
            continue
        key = (citation.document_id, int(citation.page))
        if key in seen:
            continue
        seen.add(key)
        passage = by_key.get(key)
        snippet = (citation.quote or "").strip()
        if not snippet and passage:
            snippet = passage.text[:220]
        out.append(
            Citation(
                document_id=citation.document_id,
                document_name=passage.document_name if passage else "document",
                page=int(citation.page),
                snippet=snippet[:280],
            )
        )
    return out


def _strip_invalid_inline_pages(answer: str, passages: list[Passage]) -> str:
    allowed = {page for pages in _retrieved_pages(passages).values() for page in pages}

    def repl(match: re.Match[str]) -> str:
        page = int(match.group(1))
        return match.group(0) if page in allowed else ""

    return re.sub(r"\[?\bpage[s]?\s+(\d+)\b\]?", repl, answer, flags=re.IGNORECASE)


def stored_history(session_id: str, limit: int = MAX_HISTORY_TURNS) -> list[dict[str, str]]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT role, content FROM tutor_turns WHERE session_id = ? ORDER BY id DESC LIMIT ?",
            (session_id, limit),
        ).fetchall()
    return [{"role": row["role"], "content": row["content"]} for row in reversed(rows)]


def history_payload(session_id: str) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, role, content, citations, created_at FROM tutor_turns "
            "WHERE session_id = ? ORDER BY id",
            (session_id,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "role": row["role"],
            "content": row["content"],
            "citations": loads(row["citations"], []),
            "created_at": row["created_at"],
        }
        for row in rows
    ]


async def ask(session_id: str, request: TutorAskRequest) -> dict:
    question = request.question.strip()
    if not question:
        raise ApiError(400, "empty_question", "Ask a question about your documents.")

    concept_name = None
    with get_db() as conn:
        chunks = conn.execute(
            "SELECT COUNT(*) AS c FROM chunks WHERE session_id = ?", (session_id,)
        ).fetchone()["c"]
        if not chunks:
            raise ApiError(
                400,
                "no_documents",
                "Upload a PDF first: the tutor answers only from your own documents.",
            )
        if request.concept_id:
            row = conn.execute(
                "SELECT payload FROM analyses WHERE session_id = ? AND status = 'ready' "
                "ORDER BY created_at DESC LIMIT 1",
                (session_id,),
            ).fetchone()
            if row:
                payload = loads(row["payload"], {}) or {}
                for concept in payload.get("concepts", []):
                    if concept.get("id") == request.concept_id:
                        concept_name = concept.get("name")
                        break
        db_history = stored_history(session_id)

    query = question if not concept_name else f"{concept_name} {question}"
    try:
        results, confidence = _retrieve(session_id, query, request.document_ids)
    except ApiError:
        raise
    passages = to_passages(results, max_chars=6000)

    history = (
        [turn.model_dump() for turn in request.history]
        if request.history
        else db_history[-MAX_HISTORY_TURNS:]
    )

    with get_db() as conn:
        conn.execute(
            "INSERT INTO tutor_turns (session_id, role, content, citations, created_at) VALUES (?, 'user', ?, '[]', ?)",
            (session_id, question, utcnow()),
        )

    if not results or confidence < 0.2:
        answer = (
            "I could not find an answer to this in your uploaded documents. "
            "Nothing in the passages I retrieved covers that question. "
            + (
                "Try rephrasing with terms used in the PDF, or upload the relevant chapter."
                if not request.allow_general_knowledge
                else "You allowed general knowledge, but I will not guess without a source: try rephrasing or upload the relevant chapter."
            )
        )
        citations: list[Citation] = []
        _store_answer(session_id, answer, citations)
        return {
            "answer": answer,
            "supported": False,
            "not_found": True,
            "citations": [],
            "passages": [p.model_dump() for p in passages],
        }

    system, user = tutor_prompt(
        question=question,
        passages=passages,
        history=history,
        allow_general_knowledge=request.allow_general_knowledge,
        concept_hint=concept_name,
    )
    result: TutorLLMAnswer = await get_llm().json(
        system=system, user=user, schema=TutorLLMAnswer, max_tokens=1800
    )

    citations = _validate_citations(result.citations, passages)
    answer_text = result.answer.strip()
    if result.not_found:
        answer_text = (
            answer_text
            if answer_text
            else "The retrieved passages do not contain the answer to that question."
        )
        citations = []
        supported = False
    else:
        answer_text = _strip_invalid_inline_pages(answer_text, passages)
        supported = bool(result.supported_by_documents and citations)
        if result.supported_by_documents and not citations:
            answer_text += (
                "\n\nNote: the model's page citations could not be verified against the retrieved passages, "
                "so treat this answer as unverified."
            )
            supported = False

    _store_answer(session_id, answer_text, citations)
    return {
        "answer": answer_text,
        "supported": supported,
        "not_found": bool(result.not_found),
        "citations": [c.model_dump() for c in citations],
        "passages": [p.model_dump() for p in passages],
    }


def _retrieve(session_id: str, query: str, document_ids: list[str]):
    from .db import connect

    conn = connect()
    try:
        return search(
            conn,
            session_id,
            query,
            k=8,
            document_ids=document_ids or None,
        )
    finally:
        conn.close()


def _store_answer(session_id: str, answer: str, citations: list[Citation]) -> None:
    with get_db() as conn:
        conn.execute(
            "INSERT INTO tutor_turns (session_id, role, content, citations, created_at) VALUES (?, 'assistant', ?, ?, ?)",
            (session_id, answer, dumps([c.model_dump() for c in citations]), utcnow()),
        )
        log_activity(conn, session_id, "tutor", "Asked the document tutor a question")


__all__ = ["ask", "history_payload", "stored_history", "LLMError"]

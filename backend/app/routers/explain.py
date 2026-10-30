"""Backwards-compatible POST /api/explain.

Request/response shape matches docs/BACKEND_CONTRACT.md exactly. When a valid
X-Session-Id is supplied and that session has documents, the explanation is also
grounded in retrieved passages.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..db import get_db
from ..llm import get_llm
from ..models import ExplainRequest, ExplainResponse, ExplainResponse as ExplainOut
from ..prompts import explain_prompt
from ..ratelimit import check_llm_rate
from ..retrieval import search, to_passages
from ..sessions import optional_session_id
from ..models import ExplainLLM

router = APIRouter(prefix="/api", tags=["explain"])


def _evidence_text(request: ExplainRequest) -> str:
    if not request.evidence:
        return "No specific wrong answers were supplied."
    lines = []
    for item in request.evidence[:8]:
        line = f"- Question {item.question_id or '?'}: "
        if item.prompt:
            line += f"{item.prompt[:220]} "
        if item.chosen:
            line += f"chose {item.chosen}"
        if item.correct:
            line += f" (correct: {item.correct})"
        if item.pattern:
            line += f"; likely error pattern: {item.pattern}"
        lines.append(line)
    return "\n".join(lines)


@router.post("/explain", response_model=ExplainResponse)
async def explain(
    request: ExplainRequest,
    session_id: str | None = Depends(optional_session_id),
) -> ExplainOut:
    if session_id:
        check_llm_rate(session_id)

    passages = []
    if session_id:
        with get_db() as conn:
            chunk_count = conn.execute(
                "SELECT COUNT(*) AS c FROM chunks WHERE session_id = ?", (session_id,)
            ).fetchone()["c"]
            if chunk_count:
                results, _ = search(
                    conn,
                    session_id,
                    f"{request.concept_name} {request.concept_id}",
                    k=4,
                )
                passages = to_passages(results, max_chars=3500)

    system, user = explain_prompt(
        request.concept_name or request.concept_id, _evidence_text(request), passages
    )
    result: ExplainLLM = await get_llm().json(
        system=system, user=user, schema=ExplainLLM, max_tokens=1400
    )
    note = "Generated from your answers" + (
        " and grounded in your uploaded documents." if passages else " by the connected AI model."
    )
    return ExplainOut(title=result.title, paragraphs=result.paragraphs, note=note)

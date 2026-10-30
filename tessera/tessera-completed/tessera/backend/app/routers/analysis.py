"""Document analysis endpoints (background job + status polling)."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..analysis import analysis_payload, get_concept_map, is_running, start_analysis
from ..db import get_db
from ..models import AnalysisOut
from ..sessions import get_session_id

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.post("")
async def run_analysis(session_id: str = Depends(get_session_id)) -> dict:
    # Must be `async` so the background job can be scheduled on the running event loop.
    return start_analysis(session_id)


@router.get("", response_model=AnalysisOut)
def get_analysis(session_id: str = Depends(get_session_id)) -> AnalysisOut:
    return AnalysisOut(**analysis_payload(session_id))


@router.get("/status")
def get_status(session_id: str = Depends(get_session_id)) -> dict:
    payload = analysis_payload(session_id)
    with get_db() as conn:
        doc_count = conn.execute(
            "SELECT COUNT(*) AS c FROM documents WHERE session_id = ? AND status != 'rejected'",
            (session_id,),
        ).fetchone()["c"]
        chunk_count = conn.execute(
            "SELECT COUNT(*) AS c FROM chunks WHERE session_id = ?", (session_id,)
        ).fetchone()["c"]
    return {
        "status": payload["status"],
        "progress": payload["progress"],
        "stage": payload["stage"],
        "error": payload["error"],
        "running": is_running(session_id),
        "document_count": doc_count,
        "chunk_count": chunk_count,
        "updated_at": payload["updated_at"],
    }


@router.get("/concepts")
def get_concepts(session_id: str = Depends(get_session_id)) -> dict:
    with get_db() as conn:
        nodes, edges, analysis_id = get_concept_map(conn, session_id)
    return {"analysis_id": analysis_id, "concepts": nodes, "edges": edges}

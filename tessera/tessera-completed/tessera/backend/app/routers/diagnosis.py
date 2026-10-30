"""Root cause diagnosis endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..db import get_db, loads
from ..diagnosis import diagnose_attempt, latest_diagnosis
from ..errors import ApiError
from ..models import DiagnosisRequest
from ..ratelimit import check_llm_rate
from ..sessions import get_session_id

router = APIRouter(prefix="/api/diagnosis", tags=["diagnosis"])


@router.post("")
async def run_diagnosis(request: DiagnosisRequest, session_id: str = Depends(get_session_id)) -> dict:
    check_llm_rate(session_id)
    return await diagnose_attempt(session_id, request.attempt_id)


@router.get("/latest")
def get_latest(session_id: str = Depends(get_session_id)) -> dict:
    payload = latest_diagnosis(session_id)
    if payload is None:
        return {"diagnosis": None}
    return {"diagnosis": payload}


@router.get("/{diagnosis_id}")
def get_one(diagnosis_id: str, session_id: str = Depends(get_session_id)) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT payload FROM diagnoses WHERE id = ? AND session_id = ?",
            (diagnosis_id, session_id),
        ).fetchone()
    if row is None:
        raise ApiError(404, "diagnosis_not_found", "That diagnosis does not exist in your session.")
    return loads(row["payload"], {}) or {}

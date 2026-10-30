"""Document-grounded tutor endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..models import TutorAskRequest
from ..ratelimit import check_llm_rate
from ..sessions import get_session_id
from ..tutor import ask, history_payload

router = APIRouter(prefix="/api/tutor", tags=["tutor"])


@router.post("/ask")
async def ask_tutor(request: TutorAskRequest, session_id: str = Depends(get_session_id)) -> dict:
    check_llm_rate(session_id)
    return await ask(session_id, request)


@router.get("/history")
def get_history(session_id: str = Depends(get_session_id)) -> dict:
    return {"turns": history_payload(session_id)}

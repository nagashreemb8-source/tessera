"""Learning path endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..learning_path import build_path, latest_path, set_step_completed
from ..sessions import get_session_id

router = APIRouter(prefix="/api/path", tags=["path"])


@router.get("")
def get_path(session_id: str = Depends(get_session_id)) -> dict:
    return latest_path(session_id)


@router.post("/refresh")
def refresh_path(session_id: str = Depends(get_session_id)) -> dict:
    return build_path(session_id)


@router.post("/steps/{concept_id}/complete")
def complete_step(concept_id: str, session_id: str = Depends(get_session_id)) -> dict:
    return set_step_completed(session_id, concept_id, True)


@router.post("/steps/{concept_id}/uncomplete")
def uncomplete_step(concept_id: str, session_id: str = Depends(get_session_id)) -> dict:
    return set_step_completed(session_id, concept_id, False)

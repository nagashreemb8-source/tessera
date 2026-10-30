"""Aggregate progress endpoint."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..models import ProgressOut
from ..progress import progress_payload
from ..sessions import get_session_id

router = APIRouter(prefix="/api", tags=["progress"])


@router.get("/progress", response_model=ProgressOut)
def get_progress(session_id: str = Depends(get_session_id)) -> ProgressOut:
    return ProgressOut(**progress_payload(session_id))

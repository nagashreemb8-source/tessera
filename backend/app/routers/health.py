"""Health, session lifecycle and session data deletion."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from ..analysis import is_running
from ..config import get_settings
from ..db import get_db
from ..errors import ApiError
from ..llm import LLMError, get_llm
from ..models import SessionOut
from ..sessions import create_session, delete_session_data, get_session_id

router = APIRouter(prefix="/api", tags=["system"])
log = logging.getLogger("tessera.health")


def _db_ok() -> bool:
    try:
        with get_db() as conn:
            conn.execute("SELECT 1").fetchone()
        return True
    except Exception:  # noqa: BLE001
        return False


@router.get("/health")
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok" if _db_ok() else "degraded",
        "db": "ok" if _db_ok() else "error",
        "llm": {
            "configured": settings.llm_configured,
            "api_key_set": bool(settings.nebius_api_key),
            "base_url_set": bool(settings.nebius_base_url),
            "model_set": bool(settings.nebius_model),
            "embeddings_configured": bool(settings.nebius_embedding_model),
        },
        "retrieval": "bm25",
        "limits": {
            "max_upload_mb": settings.max_upload_mb,
            "max_files_per_session": settings.max_files_per_session,
            "max_pages_per_pdf": settings.max_pages_per_pdf,
        },
    }


@router.get("/health/llm")
async def health_llm() -> dict:
    """Verify the configured provider without leaking the key or raw provider errors."""
    settings = get_settings()
    message = settings.llm_config_error()
    if message:
        return {
            "configured": False,
            "reachable": False,
            "model": settings.nebius_model or None,
            "base_url_set": bool(settings.nebius_base_url),
            "message": message,
        }
    try:
        models = await get_llm().list_models()
    except LLMError as exc:
        return {
            "configured": True,
            "reachable": False,
            "model": settings.nebius_model,
            "base_url_set": True,
            "error_code": exc.code,
            "message": exc.message,
        }
    except Exception as exc:  # noqa: BLE001
        log.warning("model listing failed: %s", type(exc).__name__)
        return {
            "configured": True,
            "reachable": False,
            "model": settings.nebius_model,
            "base_url_set": True,
            "message": "The provider could not be reached. Check the base URL and your network.",
        }
    ids = [str(m.get("id")) for m in models if m.get("id")]
    return {
        "configured": True,
        "reachable": True,
        "model": settings.nebius_model,
        "model_available": settings.nebius_model in ids,
        "available_models": ids[:50],
        "message": "Provider reachable."
        if settings.nebius_model in ids
        else "Provider reachable, but NEBIUS_MODEL is not in the returned model list. Run scripts/list_models.py.",
    }


@router.post("/sessions", response_model=SessionOut)
def new_session() -> SessionOut:
    return SessionOut(**create_session())


@router.delete("/sessions/{session_id}/data")
def wipe_session(session_id: str, header_session: str = Depends(get_session_id)) -> dict:
    # A session may only delete its own data.
    if session_id != header_session:
        raise ApiError(404, "session_not_found", "That session does not exist.")
    deleted = delete_session_data(session_id)
    return {"deleted": True, "records": deleted}

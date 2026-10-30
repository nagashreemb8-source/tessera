"""Study material endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..models import MaterialKind, MaterialsRequest
from ..ratelimit import check_llm_rate
from ..sessions import get_session_id
from ..study_materials import delete_material, generate_material, get_material, list_materials

router = APIRouter(prefix="/api/materials", tags=["materials"])


@router.post("/notes")
async def create_notes(request: MaterialsRequest, session_id: str = Depends(get_session_id)) -> dict:
    check_llm_rate(session_id)
    return await generate_material(session_id, "notes", request)


@router.post("/flashcards")
async def create_flashcards(request: MaterialsRequest, session_id: str = Depends(get_session_id)) -> dict:
    check_llm_rate(session_id)
    return await generate_material(session_id, "flashcards", request)


@router.post("/practice-questions")
async def create_practice(request: MaterialsRequest, session_id: str = Depends(get_session_id)) -> dict:
    check_llm_rate(session_id)
    return await generate_material(session_id, "practice", request)


@router.post("/simplified-explanation")
async def create_simplified(request: MaterialsRequest, session_id: str = Depends(get_session_id)) -> dict:
    check_llm_rate(session_id)
    return await generate_material(session_id, "simplified", request)


@router.get("")
def get_materials(kind: MaterialKind | None = None, session_id: str = Depends(get_session_id)) -> dict:
    return {"materials": list_materials(session_id, kind)}


@router.get("/{material_id}")
def get_one(material_id: str, session_id: str = Depends(get_session_id)) -> dict:
    return get_material(session_id, material_id)


@router.delete("/{material_id}")
def remove(material_id: str, session_id: str = Depends(get_session_id)) -> dict:
    delete_material(session_id, material_id)
    return {"deleted": True, "material_id": material_id}

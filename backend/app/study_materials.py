"""Study material generation (notes, flashcards, practice, simplified explanations).

Everything is generated from retrieved passages for the selected concepts/pages, and every
item carries page references that are validated against the passages that were actually
supplied. Items whose citations cannot be verified are dropped.
"""
from __future__ import annotations

import logging
from typing import Any

from .analysis import get_concept_map
from .db import dumps, get_db, loads, log_activity, new_id, utcnow
from .errors import ApiError
from .llm import LLMError, get_llm
from .models import (
    FlashcardSetLLM,
    MaterialsRequest,
    NotesLLM,
    Passage,
    PracticeSetLLM,
    SimplifiedLLM,
)
from .prompts import flashcards_prompt, notes_prompt, practice_prompt, simplified_prompt
from .retrieval import search, to_passages

log = logging.getLogger("tessera.materials")

MAX_MATERIAL_PASSAGES = 8


def _select_nodes(nodes: list[dict], requested: list[str]) -> list[dict]:
    if requested:
        wanted = [n for n in nodes if n["id"] in set(requested)]
        if not wanted:
            raise ApiError(400, "unknown_concepts", "None of those concepts exist in this study set.")
        return wanted
    ordered = sorted(nodes, key=lambda n: -float(n.get("importance") or 0.0))
    return ordered[:3]


def _allowed_pages(passages: list[Passage]) -> dict[str, set[int]]:
    out: dict[str, set[int]] = {}
    for passage in passages:
        out.setdefault(passage.document_id, set()).update(
            range(passage.page_start, passage.page_end + 1)
        )
    return out


def _citations(refs: list, passages: list[Passage], names: dict[str, str], limit: int = 6) -> list[dict[str, Any]]:
    allowed = _allowed_pages(passages)
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for ref in refs:
        for page in ref.pages:
            if page not in allowed.get(ref.document_id, set()):
                continue
            key = (ref.document_id, int(page))
            if key in seen:
                continue
            seen.add(key)
            out.append(
                {
                    "document_id": ref.document_id,
                    "document_name": names.get(ref.document_id, "document"),
                    "page": int(page),
                    "snippet": "",
                }
            )
            if len(out) >= limit:
                return out
    return out


def _valid_refs(refs: list, allowed: dict[str, set[int]]) -> bool:
    return any(
        any(page in allowed.get(ref.document_id, set()) for page in ref.pages) for ref in refs
    )


def _gather(
    session_id: str,
    nodes: list[dict],
    request: MaterialsRequest,
) -> tuple[list[Passage], dict[str, str], dict[str, set[int]]]:
    from .db import connect

    conn = connect()
    names: dict[str, str] = {}
    try:
        names = {
            row["id"]: row["filename"]
            for row in conn.execute(
                "SELECT id, filename FROM documents WHERE session_id = ?", (session_id,)
            ).fetchall()
        }
        collected: dict[tuple[str, int, str], Passage] = {}
        page_range = None
        if request.page_start and request.page_end:
            page_range = (request.page_start, request.page_end)
        for node in nodes:
            query = " ".join([node["name"], node.get("description", "")[:240]])
            results, _ = search(
                conn,
                session_id,
                query,
                k=4,
                document_ids=request.document_ids or None,
                page_range=page_range,
            )
            if not results:
                results, _ = search(
                    conn,
                    session_id,
                    node["name"],
                    k=4,
                    document_ids=[
                        ref["document_id"]
                        for ref in node.get("source_pages", [])
                    ]
                    or None,
                )
            for passage in to_passages(results, max_chars=4500):
                key = (passage.document_id, passage.page_start, passage.text[:80])
                collected.setdefault(key, passage)
    finally:
        conn.close()

    passages = list(collected.values())[:MAX_MATERIAL_PASSAGES]
    if not passages:
        raise ApiError(
            400,
            "no_material_text",
            "No document text matched those concepts/pages. Try a different concept or page range.",
        )
    return passages, names, _allowed_pages(passages)


async def generate_material(session_id: str, kind: str, request: MaterialsRequest) -> dict[str, Any]:
    with get_db() as conn:
        nodes, _, _ = get_concept_map(conn, session_id)
        has_chunks = conn.execute(
            "SELECT COUNT(*) AS c FROM chunks WHERE session_id = ?", (session_id,)
        ).fetchone()["c"]
    if not has_chunks:
        raise ApiError(400, "no_documents", "Upload a PDF before generating study materials.")
    if not nodes:
        raise ApiError(409, "analysis_required", "Run document analysis first so materials can use your concept map.")

    selected = _select_nodes(nodes, request.concept_ids)
    concept_names = [n["name"] for n in selected]
    concept_ids = [n["id"] for n in selected]
    passages, names, allowed = _gather(session_id, selected, request)
    llm = get_llm()

    if kind == "notes":
        system, user = notes_prompt(concept_names, passages)
        data: NotesLLM = await llm.json(system=system, user=user, schema=NotesLLM, max_tokens=2600)
        sections = []
        for section in data.sections:
            if not _valid_refs(section.source_pages, allowed):
                continue
            sections.append(
                {
                    "heading": section.heading,
                    "key_points": section.key_points,
                    "definitions": [
                        {
                            "term": d.term,
                            "definition": d.definition,
                            "page_refs": _citations(d.source_pages, passages, names, 3),
                        }
                        for d in section.definitions
                        if _valid_refs(d.source_pages, allowed)
                    ],
                    "formulas": [
                        {
                            "name": f.name,
                            "expression": f.expression,
                            "meaning": f.meaning,
                            "page_refs": _citations(f.source_pages, passages, names, 3),
                        }
                        for f in section.formulas
                        if _valid_refs(f.source_pages, allowed)
                    ],
                    "page_refs": _citations(section.source_pages, passages, names, 4),
                }
            )
        if not sections:
            raise ApiError(
                502, "material_generation_failed", "The model did not produce notes with verifiable page citations. Please retry."
            )
        payload = {"title": data.title, "sections": sections, "concept_names": concept_names}

    elif kind == "flashcards":
        system, user = flashcards_prompt(concept_names, request.count, passages)
        data = await llm.json(system=system, user=user, schema=FlashcardSetLLM, max_tokens=2600)
        cards = []
        for card in data.cards:
            if not _valid_refs(card.source_pages, allowed):
                continue
            cid = card.concept_id if card.concept_id in concept_ids else concept_ids[0]
            refs = _citations(card.source_pages, passages, names, 2)
            cards.append(
                {
                    "front": card.front,
                    "back": card.back,
                    "concept_id": cid,
                    "concept_name": next((n["name"] for n in selected if n["id"] == cid), ""),
                    "page_refs": refs,
                }
            )
        if not cards:
            raise ApiError(502, "material_generation_failed", "The model did not produce verifiable flashcards. Please retry.")
        payload = {"cards": cards[: request.count], "concept_names": concept_names}

    elif kind == "practice":
        system, user = practice_prompt(concept_names, request.count, request.difficulty, passages)
        data = await llm.json(system=system, user=user, schema=PracticeSetLLM, max_tokens=2800)
        questions = []
        for question in data.questions:
            if not _valid_refs(question.source_pages, allowed):
                continue
            cid = question.concept_id if question.concept_id in concept_ids else concept_ids[0]
            questions.append(
                {
                    "prompt": question.prompt,
                    "difficulty": question.difficulty,
                    "answer": question.answer,
                    "explanation": question.explanation,
                    "concept_id": cid,
                    "concept_name": next((n["name"] for n in selected if n["id"] == cid), ""),
                    "page_refs": _citations(question.source_pages, passages, names, 3),
                }
            )
        if not questions:
            raise ApiError(502, "material_generation_failed", "The model did not produce verifiable practice questions. Please retry.")
        payload = {"questions": questions[: request.count], "concept_names": concept_names}

    elif kind == "simplified":
        node = selected[0]
        system, user = simplified_prompt(node["name"], node["id"], passages)
        data: SimplifiedLLM = await llm.json(system=system, user=user, schema=SimplifiedLLM, max_tokens=1800)
        if not _valid_refs(data.source_pages, allowed):
            raise ApiError(502, "material_generation_failed", "The explanation had no verifiable page citations. Please retry.")
        payload = {
            "title": data.title,
            "explanation": data.explanation,
            "analogy": data.analogy,
            "concept_id": node["id"],
            "concept_name": node["name"],
            "page_refs": _citations(data.source_pages, passages, names, 6),
        }
        concept_ids = [node["id"]]
        concept_names = [node["name"]]
    else:  # pragma: no cover - router constrains the value
        raise ApiError(400, "unknown_material_kind", "Unknown material kind.")

    material_id = new_id("mat_")
    created = utcnow()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO materials (id, session_id, kind, concept_ids, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (material_id, session_id, kind, dumps(concept_ids), dumps(payload), created),
        )
        log_activity(conn, session_id, "material", f"Generated {kind} study material")
    return {
        "id": material_id,
        "kind": kind,
        "concept_ids": concept_ids,
        "concept_names": concept_names,
        "created_at": created,
        "payload": payload,
    }


def _material_row(session_id: str, material_id: str) -> dict[str, Any]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM materials WHERE id = ? AND session_id = ?", (material_id, session_id)
        ).fetchone()
        if row is None:
            raise ApiError(404, "material_not_found", "That material does not exist in your session.")
        analysis = conn.execute(
            "SELECT payload FROM analyses WHERE session_id = ? AND status = 'ready' "
            "ORDER BY created_at DESC LIMIT 1",
            (session_id,),
        ).fetchone()
        concept_names: dict[str, str] = {}
        if analysis is not None:
            for concept in (loads(analysis["payload"], {}) or {}).get("concepts", []):
                concept_names[concept["id"]] = concept["name"]
        cids = loads(row["concept_ids"], []) or []
        return {
            "id": row["id"],
            "kind": row["kind"],
            "concept_ids": cids,
            "concept_names": [concept_names.get(c, c) for c in cids],
            "created_at": row["created_at"],
            "payload": loads(row["payload"], {}) or {},
        }


def list_materials(session_id: str, kind: str | None = None) -> list[dict[str, Any]]:
    with get_db() as conn:
        if kind:
            rows = conn.execute(
                "SELECT id FROM materials WHERE session_id = ? AND kind = ? ORDER BY created_at DESC",
                (session_id, kind),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id FROM materials WHERE session_id = ? ORDER BY created_at DESC",
                (session_id,),
            ).fetchall()
    return [_material_row(session_id, row["id"]) for row in rows]


def get_material(session_id: str, material_id: str) -> dict[str, Any]:
    return _material_row(session_id, material_id)


def delete_material(session_id: str, material_id: str) -> None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT 1 FROM materials WHERE id = ? AND session_id = ?", (material_id, session_id)
        ).fetchone()
        if row is None:
            raise ApiError(404, "material_not_found", "That material does not exist in your session.")
        conn.execute("DELETE FROM materials WHERE id = ? AND session_id = ?", (material_id, session_id))


__all__ = ["delete_material", "generate_material", "get_material", "list_materials", "LLMError", "log"]

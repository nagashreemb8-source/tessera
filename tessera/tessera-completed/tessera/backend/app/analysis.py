"""Document analysis: map-reduce extraction, concept map construction and DAG validation.

Pipeline
  1. Batch the session's chunks so no single prompt exceeds the configured size.
  2. Extract topics/definitions/formulas/concepts/prerequisites per batch (map).
  3. Merge + deduplicate deterministically, then optionally consolidate with the model
     (reduce) while only accepting concept names that were actually extracted.
  4. Normalise into a validated concept map: unique slugs, no dangling edges, no
     self-loops, no cycles (weakest edge in a cycle is dropped), capped node count.
  5. Persist the structured result and the edges used by diagnosis/paths.

Every LLM payload is validated with Pydantic. Source references are checked against the
real pages of the session's documents; items that cannot be cited are dropped.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import sqlite3
from typing import Any

from pydantic import ValidationError

from .config import get_settings
from .db import dumps, get_db, loads, log_activity, new_id, utcnow
from .errors import ApiError
from .llm import LLMError, LLMOutputError, get_llm
from .models import (
    AnalysisResult,
    BatchExtraction,
    ConceptEdge,
    ConceptNode,
    DocumentSummary,
    DefinitionOut,
    FormulaOut,
    MapSynthesis,
    SourceRef,
    TopicOut,
)
from .pdf_processing import normalise_text
from .prompts import BASE_SYSTEM, extraction_prompt, synthesis_prompt

log = logging.getLogger("tessera.analysis")

_PROMPT_OVERHEAD = 7000
_MAX_NODES = 40


# --------------------------------------------------------------------------- #
# Queries
# --------------------------------------------------------------------------- #
def latest_analysis_row(conn: sqlite3.Connection, session_id: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM analyses WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
        (session_id,),
    ).fetchone()


def analysis_payload(session_id: str) -> dict[str, Any]:
    with get_db() as conn:
        row = latest_analysis_row(conn, session_id)
    if row is None:
        return {
            "id": None,
            "status": "idle",
            "progress": 0.0,
            "stage": "",
            "error": None,
            "created_at": None,
            "updated_at": None,
            "result": None,
        }
    payload = loads(row["payload"], {}) or {}
    result = payload if row["status"] == "ready" else None
    return {
        "id": row["id"],
        "status": row["status"],
        "progress": float(row["progress"] or 0.0),
        "stage": row["stage"] or "",
        "error": row["error"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "result": result,
    }


def get_concept_map(conn: sqlite3.Connection, session_id: str) -> tuple[list[dict], list[dict], str | None]:
    """Return (nodes, edges, analysis_id) from the latest ready analysis."""
    row = conn.execute(
        "SELECT * FROM analyses WHERE session_id = ? AND status = 'ready' "
        "ORDER BY created_at DESC, rowid DESC LIMIT 1",
        (session_id,),
    ).fetchone()
    if row is None:
        return [], [], None
    payload = loads(row["payload"], {}) or {}
    nodes = payload.get("concepts") or []
    edges = payload.get("edges") or []
    return nodes, edges, row["id"]


def document_fingerprint(conn: sqlite3.Connection, session_id: str) -> str:
    rows = conn.execute(
        "SELECT id, sha256 FROM documents WHERE session_id = ? AND status != 'rejected' ORDER BY id",
        (session_id,),
    ).fetchall()
    raw = "|".join(f"{r['id']}:{r['sha256']}" for r in rows)
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _norm(name: str) -> str:
    base = re.sub(r"[^a-z0-9 ]+", " ", name.lower())
    base = re.sub(r"\s+", " ", base).strip()
    words = base.split()
    if words and len(words[-1]) > 3 and words[-1].endswith("s") and not words[-1].endswith("ss"):
        words[-1] = words[-1][:-1]
    return " ".join(words)


def _slug(name: str, used: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48] or "concept"
    candidate = base
    i = 2
    while candidate in used:
        candidate = f"{base}-{i}"
        i += 1
    used.add(candidate)
    return candidate


def _allowed_pages(conn: sqlite3.Connection, session_id: str) -> dict[str, set[int]]:
    rows = conn.execute(
        "SELECT document_id, page_no FROM pages WHERE session_id = ?", (session_id,)
    ).fetchall()
    allowed: dict[str, set[int]] = {}
    for row in rows:
        allowed.setdefault(row["document_id"], set()).add(int(row["page_no"]))
    return allowed


def _clean_refs(refs: list[SourceRef], allowed: dict[str, set[int]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for ref in refs:
        valid = [p for p in ref.pages if p in allowed.get(ref.document_id, set())]
        if not valid:
            continue
        key = (ref.document_id, min(valid))
        if key in seen:
            continue
        seen.add(key)
        out.append({"document_id": ref.document_id, "pages": sorted(set(valid))})
    return out


def _merge_refs(base: list[dict], extra: list[dict]) -> list[dict]:
    by_doc: dict[str, set[int]] = {}
    for ref in base + extra:
        by_doc.setdefault(ref["document_id"], set()).update(ref["pages"])
    return [{"document_id": doc, "pages": sorted(pages)} for doc, pages in by_doc.items()]


def build_batches(chunks: list[sqlite3.Row], budget: int) -> list[list[sqlite3.Row]]:
    batches: list[list[sqlite3.Row]] = []
    current: list[sqlite3.Row] = []
    size = 0
    for chunk in chunks:
        length = len(chunk["text"]) + 180
        if current and size + length > budget:
            batches.append(current)
            current = []
            size = 0
        current.append(chunk)
        size += length
    if current:
        batches.append(current)
    return batches


def _batch_text(batch: list[sqlite3.Row], names: dict[str, str]) -> str:
    parts: list[str] = []
    for chunk in batch:
        doc = names.get(chunk["document_id"], chunk["document_id"])
        pages = (
            f"page {chunk['page_start']}"
            if chunk["page_start"] == chunk["page_end"]
            else f"pages {chunk['page_start']}-{chunk['page_end']}"
        )
        parts.append(
            f"[document_id={chunk['document_id']} | {doc} | {pages}]\n<<<DOCUMENT\n"
            f"{chunk['text'].replace('<<<', '< < <')}\nEND DOCUMENT>>>"
        )
    return "\n\n".join(parts)


def _merge_extractions(
    extractions: list[BatchExtraction], allowed: dict[str, set[int]]
) -> dict[str, Any]:
    topics: dict[str, dict] = {}
    definitions: dict[str, dict] = {}
    formulas: dict[str, dict] = {}
    concepts: dict[str, dict] = {}
    prereqs: list[dict] = []
    summaries: list[str] = []

    for batch in extractions:
        if batch.summary:
            summaries.append(batch.summary.strip())
        for topic in batch.topics:
            refs = _clean_refs(topic.source_pages, allowed)
            if not refs:
                continue
            key = _norm(topic.name)
            existing = topics.get(key)
            if existing:
                existing["source_pages"] = _merge_refs(existing["source_pages"], refs)
                if len(topic.summary) > len(existing["summary"]):
                    existing["summary"] = topic.summary
            else:
                topics[key] = {
                    "name": topic.name.strip(),
                    "summary": topic.summary.strip(),
                    "source_pages": refs,
                }
        for definition in batch.definitions:
            refs = _clean_refs(definition.source_pages, allowed)
            if not refs:
                continue
            key = _norm(definition.term)
            existing = definitions.get(key)
            if existing:
                existing["source_pages"] = _merge_refs(existing["source_pages"], refs)
                if len(definition.definition) > len(existing["definition"]):
                    existing["definition"] = definition.definition.strip()
            else:
                definitions[key] = {
                    "term": definition.term.strip(),
                    "definition": definition.definition.strip(),
                    "source_pages": refs,
                }
        for formula in batch.formulas:
            refs = _clean_refs(formula.source_pages, allowed)
            if not refs:
                continue
            key = _norm(formula.name) + "|" + _norm(formula.expression)
            if key not in formulas:
                formulas[key] = {
                    "name": formula.name.strip(),
                    "expression": formula.expression.strip(),
                    "meaning": formula.meaning.strip(),
                    "source_pages": refs,
                }
        for concept in batch.concepts:
            refs = _clean_refs(concept.source_pages, allowed)
            key = _norm(concept.name)
            existing = concepts.get(key)
            if existing:
                existing["source_pages"] = _merge_refs(existing["source_pages"], refs)
                if len(concept.description) > len(existing["description"]):
                    existing["description"] = concept.description.strip()
                existing["importance"] = max(existing["importance"], concept.importance)
                for sub in concept.subtopics:
                    if sub.strip() and sub.strip() not in existing["subtopics"]:
                        existing["subtopics"].append(sub.strip())
            elif refs:
                concepts[key] = {
                    "name": concept.name.strip(),
                    "description": concept.description.strip(),
                    "subtopics": [s.strip() for s in concept.subtopics if s.strip()][:8],
                    "importance": concept.importance,
                    "source_pages": refs,
                }
        for rel in batch.prerequisites:
            prereqs.append(
                {
                    "prerequisite": rel.prerequisite.strip(),
                    "concept": rel.concept.strip(),
                    "rationale": rel.rationale.strip(),
                    "source": rel.source,
                    "confidence": rel.confidence,
                }
            )

    return {
        "topics": list(topics.values()),
        "definitions": list(definitions.values()),
        "formulas": list(formulas.values()),
        "concepts": list(concepts.values()),
        "prerequisites": prereqs,
        "summaries": summaries,
    }


def _find_cycle(nodes: list[str], edges: list[dict]) -> list[int] | None:
    adjacency: dict[str, list[tuple[str, int]]] = {n: [] for n in nodes}
    for i, edge in enumerate(edges):
        adjacency.setdefault(edge["from_id"], []).append((edge["to_id"], i))
    state: dict[str, int] = {n: 0 for n in nodes}
    stack: list[int] = []

    def visit(node: str) -> list[int] | None:
        state[node] = 1
        for neighbour, edge_index in adjacency.get(node, []):
            if state.get(neighbour, 0) == 0:
                stack.append(edge_index)
                found = visit(neighbour)
                if found:
                    return found
                stack.pop()
            elif state.get(neighbour) == 1:
                # back edge: cycle from neighbour .. node -> neighbour
                try:
                    start = next(
                        i
                        for i, e in enumerate(stack)
                        if edges[e]["from_id"] == neighbour
                    )
                except StopIteration:
                    start = 0
                return stack[start:] + [edge_index]
        state[node] = 2
        return None

    for node in nodes:
        if state.get(node, 0) == 0:
            found = visit(node)
            if found:
                return found
    return None


def break_cycles(nodes: list[str], edges: list[dict]) -> tuple[list[dict], list[dict]]:
    """Drop the weakest edge of each cycle until the graph is a DAG."""
    working = list(edges)
    removed: list[dict] = []
    guard = 0
    while guard < len(edges) + 5:
        guard += 1
        cycle = _find_cycle(nodes, working)
        if not cycle:
            break
        victim = min(cycle, key=lambda i: working[i].get("confidence", 0.5))
        removed.append(working.pop(victim))
    return working, removed


def _levels(nodes: list[dict], edges: list[dict]) -> None:
    parents: dict[str, list[str]] = {n["id"]: [] for n in nodes}
    for edge in edges:
        parents.setdefault(edge["to_id"], []).append(edge["from_id"])

    resolved: dict[str, int] = {}

    def depth(node_id: str, trail: set[str]) -> int:
        if node_id in resolved:
            return resolved[node_id]
        if node_id in trail:
            return 0
        ps = parents.get(node_id, [])
        value = 0 if not ps else 1 + max(depth(p, trail | {node_id}) for p in ps)
        resolved[node_id] = value
        return value

    for node in nodes:
        node["level"] = depth(node["id"], set())


async def _synthesise(
    merged: dict[str, Any], allowed: dict[str, set[int]]
) -> MapSynthesis | None:
    settings = get_settings()
    names = [c["name"] for c in merged["concepts"]][:60]
    if len(names) < 2:
        return None
    candidate_names = {_norm(n) for n in names}
    edge_names = [
        (rel["prerequisite"], rel["concept"], rel["source"])
        for rel in merged["prerequisites"]
        if _norm(rel["prerequisite"]) in candidate_names and _norm(rel["concept"]) in candidate_names
    ][:40]
    summaries = "\n".join(f"- {s}" for s in merged["summaries"][:12])[:6000]
    system, user = synthesis_prompt(names, edge_names, summaries)
    if len(system) + len(user) > settings.llm_max_prompt_chars:
        user = user[: settings.llm_max_prompt_chars - len(system) - 100]
    try:
        return await get_llm().json(
            system=system, user=user, schema=MapSynthesis, max_tokens=3500
        )
    except LLMError as exc:
        # Synthesis is an enhancement: extraction is already validated and stored.
        log.warning("concept-map synthesis skipped: %s", exc.code)
        return None


def build_concept_map(
    merged: dict[str, Any], synthesis: MapSynthesis | None
) -> tuple[list[dict], list[dict], str]:
    concepts = list(merged["concepts"])
    by_norm = {_norm(c["name"]): c for c in concepts}
    prereqs = list(merged["prerequisites"])
    overall = ""

    if synthesis:
        for suggested in synthesis.concepts:
            target = by_norm.get(_norm(suggested.name))
            if target and len(suggested.description) > len(target["description"]):
                target["description"] = suggested.description.strip()
            if target and suggested.importance:
                target["importance"] = max(target["importance"], suggested.importance)
        prereqs.extend(
            {
                "prerequisite": rel.prerequisite,
                "concept": rel.concept,
                "rationale": rel.rationale,
                "source": rel.source,
                "confidence": rel.confidence,
            }
            for rel in synthesis.prerequisites
        )
        overall = synthesis.overall_summary.strip()

    if not concepts:
        raise LLMOutputError(
            "The model could not produce any concepts from this document set. Try a document with more prose text."
        )

    # Collapse near-duplicates: if one extracted name is a superset phrase of another, keep the more important one.
    deduped: list[dict] = []
    for concept in sorted(concepts, key=lambda c: c["importance"], reverse=True):
        name = _norm(concept["name"])
        duplicate = None
        for kept in deduped:
            other = _norm(kept["name"])
            if name == other or (len(name) > 6 and (name.startswith(other + " ") or other.startswith(name + " "))):
                duplicate = kept
                break
        if duplicate is None:
            deduped.append(concept)
        else:
            duplicate["importance"] = max(duplicate["importance"], concept["importance"])
            duplicate["source_pages"] = _merge_refs(duplicate["source_pages"], concept["source_pages"])
            if len(concept["description"]) > len(duplicate["description"]):
                duplicate["description"] = concept["description"]
    concepts = deduped

    if len(concepts) > _MAX_NODES:
        concepts = sorted(concepts, key=lambda c: c["importance"], reverse=True)[:_MAX_NODES]

    used: set[str] = set()
    nodes: list[dict] = []
    id_by_norm: dict[str, str] = {}
    for concept in concepts:
        node_id = _slug(concept["name"], used)
        id_by_norm[_norm(concept["name"])] = node_id
        nodes.append(
            {
                "id": node_id,
                "name": concept["name"].strip()[:120],
                "description": concept["description"].strip()[:500],
                "level": 0,
                "importance": round(float(concept["importance"]), 3),
                "source_pages": concept["source_pages"],
            }
        )

    edges: dict[tuple[str, str], dict] = {}
    for rel in prereqs:
        from_id = id_by_norm.get(_norm(rel["prerequisite"]))
        to_id = id_by_norm.get(_norm(rel["concept"]))
        if not from_id or not to_id or from_id == to_id:
            continue
        confidence = max(0.05, min(1.0, float(rel.get("confidence") or 0.5)))
        key = (from_id, to_id)
        existing = edges.get(key)
        if existing and existing["confidence"] >= confidence:
            continue
        pages = next((n["source_pages"] for n in nodes if n["id"] == from_id), [])
        edges[key] = {
            "from_id": from_id,
            "to_id": to_id,
            "rationale": (rel.get("rationale") or "").strip()[:400],
            "source": "document" if rel.get("source") == "document" else "inferred",
            "confidence": round(confidence, 3),
            "pages": pages,
        }

    edge_list, removed = break_cycles([n["id"] for n in nodes], list(edges.values()))
    if removed:
        log.info("concept map: removed %d edge(s) to keep the graph acyclic", len(removed))
    _levels(nodes, edge_list)
    return nodes, edge_list, overall


# --------------------------------------------------------------------------- #
# Job orchestration
# --------------------------------------------------------------------------- #
_running: dict[str, asyncio.Task[None]] = {}


def is_running(session_id: str) -> bool:
    task = _running.get(session_id)
    return task is not None and not task.done()


def start_analysis(session_id: str) -> dict[str, Any]:
    if is_running(session_id):
        return analysis_payload(session_id)
    with get_db() as conn:
        doc_count = conn.execute(
            "SELECT COUNT(*) AS c FROM documents WHERE session_id = ? AND status != 'rejected'",
            (session_id,),
        ).fetchone()["c"]
        if not doc_count:
            raise ApiError(
                400,
                "no_documents",
                "Upload at least one readable PDF before running analysis.",
            )
        analysis_id = new_id()
        now = utcnow()
        conn.execute(
            "INSERT INTO analyses (id, session_id, status, progress, stage, error, payload, created_at, updated_at) "
            "VALUES (?, ?, 'running', 0.0, 'Preparing passages', NULL, NULL, ?, ?)",
            (analysis_id, session_id, now, now),
        )
        log_activity(conn, session_id, "analysis", "Document analysis started")
    task = asyncio.create_task(_run(session_id, analysis_id))
    _running[session_id] = task
    task.add_done_callback(lambda _t: _cleanup(session_id))
    return analysis_payload(session_id)


def _cleanup(session_id: str) -> None:
    task = _running.get(session_id)
    if task is not None and task.done():
        _running.pop(session_id, None)


def _set_status(analysis_id: str, **fields: Any) -> None:
    if not fields:
        return
    fields["updated_at"] = utcnow()
    assignments = ", ".join(f"{key} = ?" for key in fields)
    with get_db() as conn:
        conn.execute(
            f"UPDATE analyses SET {assignments} WHERE id = ?",
            (*fields.values(), analysis_id),
        )


async def _run(session_id: str, analysis_id: str) -> None:
    settings = get_settings()
    try:
        with get_db() as conn:
            docs = conn.execute(
                "SELECT id, filename FROM documents WHERE session_id = ? AND status != 'rejected' "
                "ORDER BY created_at",
                (session_id,),
            ).fetchall()
            names = {row["id"]: row["filename"] for row in docs}
            chunks = conn.execute(
                "SELECT id, document_id, chunk_index, page_start, page_end, text FROM chunks "
                "WHERE session_id = ? ORDER BY document_id, chunk_index",
                (session_id,),
            ).fetchall()
            allowed = _allowed_pages(conn, session_id)
            fingerprint = document_fingerprint(conn, session_id)
            previous = conn.execute(
                "SELECT payload FROM analyses WHERE session_id = ? AND status = 'failed' "
                "ORDER BY created_at DESC, rowid DESC LIMIT 1",
                (session_id,),
            ).fetchone()

        if not chunks:
            raise ApiError(
                400,
                "no_text",
                "None of your documents contain extractable text, so analysis cannot run.",
            )

        resume: dict[str, Any] = {}
        if previous:
            saved = loads(previous["payload"], {}) or {}
            if saved.get("fingerprint") == fingerprint and saved.get("partial"):
                resume = saved

        budget = max(4000, settings.llm_max_prompt_chars - _PROMPT_OVERHEAD)
        batches = build_batches(chunks, budget)
        total = len(batches)
        extractions: list[BatchExtraction] = []
        completed_keys: list[str] = []

        saved_by_key: dict[str, dict] = {
            item["key"]: item["batch"] for item in resume.get("partial", [])
        }
        for key, raw in saved_by_key.items():
            try:
                extractions.append(BatchExtraction.model_validate(raw))
                completed_keys.append(key)
            except ValidationError:
                continue

        _set_status(
            analysis_id,
            progress=0.05,
            stage=f"Extracting structure from {total} section(s)"
            + (f" (resuming {len(extractions)} done)" if extractions else ""),
        )

        for index, batch in enumerate(batches):
            key = hashlib.sha256(
                "|".join(chunk["id"] for chunk in batch).encode()
            ).hexdigest()[:16]
            if key in saved_by_key:
                continue
            system, user = extraction_prompt(_batch_text(batch, names), names)
            try:
                batch_result = await get_llm().json(
                    system=system,
                    user=user,
                    schema=BatchExtraction,
                    max_tokens=3000,
                )
            except LLMOutputError:
                # One bad section must not destroy a long document: skip it and keep going.
                log.warning("analysis batch %d/%d returned invalid structure; skipping", index + 1, total)
                batch_result = BatchExtraction(summary="")
            extractions.append(batch_result)
            completed_keys.append(key)
            progress = 0.1 + 0.6 * ((index + 1) / max(1, total))
            _set_status(
                analysis_id,
                progress=progress,
                stage=f"Analysed section {index + 1} of {total}",
                payload=dumps(
                    {
                        "fingerprint": fingerprint,
                        "partial": [
                            {"key": completed_keys[i], "batch": ext.model_dump()}
                            for i, ext in enumerate(extractions)
                        ],
                    }
                ),
            )

        _set_status(analysis_id, progress=0.75, stage="Merging concepts and prerequisites")

        merged = _merge_extractions(extractions, allowed)
        if not merged["concepts"]:
            # Fall back to topics (still extracted from the real document text).
            merged["concepts"] = [
                {
                    "name": topic["name"],
                    "description": topic["summary"][:400],
                    "subtopics": [],
                    "importance": 0.5,
                    "source_pages": topic["source_pages"],
                }
                for topic in merged["topics"][:20]
            ]

        _set_status(analysis_id, progress=0.82, stage="Consolidating the concept map")
        synthesis = await _synthesise(merged, allowed)

        nodes, edges, overall = build_concept_map(merged, synthesis)

        document_summaries: list[DocumentSummary] = []
        for doc_id, doc_name in names.items():
            doc_topics = [
                t["name"]
                for t in merged["topics"]
                if any(ref["document_id"] == doc_id for ref in t["source_pages"])
            ]
            if doc_topics:
                summary = (
                    f"Covers {', '.join(doc_topics[:6])}."
                    if len(doc_topics) <= 6
                    else f"Covers {', '.join(doc_topics[:6])} and {len(doc_topics) - 6} more topics."
                )
            else:
                summary = "No distinct topics were extracted from this document."
            document_summaries.append(
                DocumentSummary(document_id=doc_id, document_name=doc_name, summary=summary)
            )

        overall_summary = overall or (
            " ".join(merged["summaries"])[:1200]
            or f"Extracted {len(nodes)} concepts and {len(edges)} prerequisite links from your documents."
        )

        result = AnalysisResult(
            overall_summary=overall_summary,
            document_summaries=document_summaries,
            topics=[TopicOut(**topic) for topic in merged["topics"][:40]],
            definitions=[DefinitionOut(**d) for d in merged["definitions"][:60]],
            formulas=[FormulaOut(**f) for f in merged["formulas"][:40]],
            concepts=[ConceptNode(**node) for node in nodes],
            edges=[
                ConceptEdge(
                    from_id=edge["from_id"],
                    to_id=edge["to_id"],
                    rationale=edge["rationale"],
                    source=edge["source"],
                    confidence=edge["confidence"],
                    pages=[SourceRef(**ref) for ref in edge["pages"]],
                )
                for edge in edges
            ],
        )

        with get_db() as conn:
            conn.execute(
                "UPDATE analyses SET status = 'ready', progress = 1.0, stage = 'Ready', error = NULL, "
                "payload = ?, updated_at = ? WHERE id = ?",
                (dumps(result.model_dump()), utcnow(), analysis_id),
            )
            conn.execute("DELETE FROM concept_edges WHERE analysis_id = ?", (analysis_id,))
            for edge in edges:
                conn.execute(
                    "INSERT INTO concept_edges (analysis_id, session_id, from_id, to_id, rationale, source, confidence, pages) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        analysis_id,
                        session_id,
                        edge["from_id"],
                        edge["to_id"],
                        edge["rationale"],
                        edge["source"],
                        edge["confidence"],
                        dumps(edge["pages"]),
                    ),
                )
            log_activity(
                conn,
                session_id,
                "analysis",
                f"Analysis ready: {len(nodes)} concepts, {len(edges)} prerequisite links",
            )
        log.info(
            "analysis %s ready for session %s: %d nodes, %d edges",
            analysis_id,
            session_id[:8],
            len(nodes),
            len(edges),
        )
    except ApiError as exc:
        _fail(analysis_id, exc.message)
    except LLMError as exc:
        _fail(analysis_id, exc.message)
    except Exception as exc:  # noqa: BLE001
        log.exception("analysis failed")
        _fail(analysis_id, "Analysis failed unexpectedly. Please retry.")
        log.warning("analysis exception type: %s", type(exc).__name__)


def _fail(analysis_id: str, message: str) -> None:
    with get_db() as conn:
        conn.execute(
            "UPDATE analyses SET status = 'failed', stage = 'Failed', error = ?, updated_at = ? WHERE id = ?",
            (message[:500], utcnow(), analysis_id),
        )


def mark_interrupted_analyses() -> None:
    """On startup, jobs from a previous process cannot still be running."""
    with get_db() as conn:
        conn.execute(
            "UPDATE analyses SET status = 'failed', stage = 'Failed', "
            "error = 'The server restarted while analysis was running. Please retry.', updated_at = ? "
            "WHERE status = 'running'",
            (utcnow(),),
        )


def concept_lookup(nodes: list[dict]) -> dict[str, dict]:
    return {node["id"]: node for node in nodes}


def pages_by_document(conn: sqlite3.Connection, session_id: str) -> dict[str, str]:
    rows = conn.execute(
        "SELECT id, filename FROM documents WHERE session_id = ?", (session_id,)
    ).fetchall()
    return {row["id"]: row["filename"] for row in rows}


def citations_for_refs(
    refs: list[dict], names: dict[str, str], limit: int = 6
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for ref in refs:
        for page in ref.get("pages", [])[:3]:
            out.append(
                {
                    "document_id": ref["document_id"],
                    "document_name": names.get(ref["document_id"], "document"),
                    "page": int(page),
                    "snippet": "",
                }
            )
            if len(out) >= limit:
                return out
    return out


__all__ = [
    "analysis_payload",
    "build_batches",
    "break_cycles",
    "build_concept_map",
    "citations_for_refs",
    "document_fingerprint",
    "get_concept_map",
    "is_running",
    "latest_analysis_row",
    "mark_interrupted_analyses",
    "start_analysis",
]

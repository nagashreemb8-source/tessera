"""Personalised learning path.

The path is a topological ordering of the concept DAG, prioritising supported root-cause
hypotheses first, then concepts answered wrong, then untested concepts. A prerequisite
can never appear after a concept that depends on it. Mastered concepts drop out, and each
remediation step is followed by a "Reassess" step so the fix can be confirmed.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from .analysis import get_concept_map
from .db import dumps, get_db, loads, log_activity, new_id, utcnow
from .diagnosis import concept_evidence, compute_statuses, latest_diagnosis, latest_hypotheses
from .errors import ApiError
from .models import PathOut, PathPageRef, PathStepOut

EVIDENCE_RANK = {"Stronger": 0, "Some": 1, "Limited": 2}


def _priorities(
    nodes: list[dict],
    statuses: dict[str, str],
    gaps: list[dict],
    evidence: dict[str, dict[str, Any]],
) -> dict[str, tuple[int, int]]:
    """(bucket, sub-priority) — lower sorts first."""
    gap_by_id = {gap["concept_id"]: gap for gap in gaps}
    out: dict[str, tuple[int, int]] = {}
    for node in nodes:
        cid = node["id"]
        gap = gap_by_id.get(cid)
        if gap and gap["kind"] == "prerequisite":
            bucket = 0
            sub = EVIDENCE_RANK.get(gap["evidence"], 2) * 10 + len(gap.get("dependent_concept_ids", []))
        elif gap:
            bucket = 1
            sub = EVIDENCE_RANK.get(gap["evidence"], 2) * 10
        elif statuses.get(cid) == "developing":
            bucket = 2
            sub = -len(evidence.get(cid, {}).get("wrong_question_ids", []))
        elif statuses.get(cid) == "untested":
            bucket = 3
            sub = int(node.get("level") or 0)
        else:
            continue  # mastered concepts are skipped
        out[cid] = (bucket, sub)
    return out


def _topological(nodes: list[dict], edges: list[dict], priorities: dict[str, tuple[int, int]]) -> list[str]:
    selected = set(priorities)
    parents: dict[str, list[str]] = {n["id"]: [] for n in nodes}
    for edge in edges:
        if edge["from_id"] in selected and edge["to_id"] in selected:
            parents.setdefault(edge["to_id"], []).append(edge["from_id"])
    done: list[str] = []
    placed: set[str] = set()
    guard = 0
    while len(done) < len(selected) and guard < len(selected) * len(selected) + 5:
        guard += 1
        ready = [
            cid
            for cid in selected
            if cid not in placed and all(p in placed for p in parents.get(cid, []))
        ]
        if not ready:
            # Remaining nodes form a cycle (should not happen: analysis breaks cycles).
            ready = [cid for cid in selected if cid not in placed]
        ready.sort(key=lambda cid: priorities[cid])
        chosen = ready[0]
        placed.add(chosen)
        done.append(chosen)
    return done


def _page_references(node: dict, names: dict[str, str]) -> list[dict[str, Any]]:
    grouped: dict[str, set[int]] = {}
    for ref in node.get("source_pages", []):
        grouped.setdefault(ref["document_id"], set()).update(int(p) for p in ref.get("pages", []))
    return [
        {
            "document_id": doc_id,
            "document_name": names.get(doc_id, "document"),
            "pages": sorted(pages)[:6],
        }
        for doc_id, pages in grouped.items()
        if pages
    ]


def _verb_and_reason(
    node: dict,
    gap: dict | None,
    status: str,
    evidence: dict[str, Any],
    dependents: list[str],
    predecessors: list[str],
) -> tuple[str, str]:
    name = node["name"]
    prereq_text = ", ".join(predecessors) if predecessors else "the basics"
    if gap and gap["kind"] == "prerequisite":
        return (
            "Review",
            f"Suspected foundational gap from your diagnostic. {', '.join(dependents) or 'Later concepts'} "
            f"build on {name}, so it comes first. Evidence: {gap['evidence'].lower()}.",
        )
    if gap:
        return (
            "Revisit",
            f"Your answers suggested a possible gap in {name} itself. Revisit it after {prereq_text}.",
        )
    if status == "developing":
        wrong = len(evidence.get("wrong_question_ids", []))
        verb = "Revisit" if wrong >= 2 else "Practice"
        return (
            verb,
            f"{wrong or 'A few'} answer(s) here were wrong. Practise {name} after {prereq_text}.",
        )
    if status == "untested":
        return (
            "Continue to",
            f"Not assessed yet. Continue to {name} once {prereq_text} feel solid.",
        )
    return "Practice", f"Keep {name} solid: {', '.join(dependents) or 'later topics'} depend on it."


def build_path(session_id: str, *, persist: bool = True) -> dict[str, Any]:
    with get_db() as conn:
        nodes, edges, _ = get_concept_map(conn, session_id)
        names = {
            row["id"]: row["filename"]
            for row in conn.execute(
                "SELECT id, filename FROM documents WHERE session_id = ?", (session_id,)
            ).fetchall()
        }
        materials = conn.execute(
            "SELECT id, concept_ids FROM materials WHERE session_id = ?", (session_id,)
        ).fetchall()
        completions = {
            row["concept_id"]
            for row in conn.execute(
                "SELECT DISTINCT ps.concept_id FROM path_steps ps "
                "WHERE ps.session_id = ? AND ps.completed_at IS NOT NULL",
                (session_id,),
            ).fetchall()
        }
        evidence = concept_evidence(conn, session_id)
        hypotheses = latest_hypotheses(conn, session_id)

    if not nodes:
        return {
            "id": None,
            "created_at": None,
            "steps": [],
            "concepts": [],
            "completed_count": 0,
        }

    statuses = compute_statuses(session_id, nodes)
    diagnosis = latest_diagnosis(session_id) or {}
    gaps = diagnosis.get("gaps", [])
    gap_by_id = {gap["concept_id"]: gap for gap in gaps}
    priorities = _priorities(nodes, statuses, gaps, evidence)
    nodes_by_id = {n["id"]: n for n in nodes}

    order = _topological(nodes, edges, priorities) if priorities else []

    children: dict[str, list[str]] = {}
    parents: dict[str, list[str]] = {}
    for edge in edges:
        children.setdefault(edge["from_id"], []).append(edge["to_id"])
        parents.setdefault(edge["to_id"], []).append(edge["from_id"])

    material_lookup: dict[str, list[str]] = {}
    for row in materials:
        for cid in loads(row["concept_ids"], []) or []:
            material_lookup.setdefault(cid, []).append(row["id"])

    steps: list[dict[str, Any]] = []
    for index, cid in enumerate(order):
        node = nodes_by_id[cid]
        gap = gap_by_id.get(cid)
        verb, reason = _verb_and_reason(
            node,
            gap,
            statuses.get(cid, "untested"),
            evidence.get(cid, {}),
            [nodes_by_id[d]["name"] for d in children.get(cid, []) if d in nodes_by_id][:3],
            [nodes_by_id[p]["name"] for p in parents.get(cid, []) if p in priorities][:3],
        )
        minutes = 10 + int(round(float(node.get("importance") or 0.5) * 20))
        steps.append(
            {
                "concept_id": cid,
                "concept_name": node["name"],
                "verb": verb,
                "reason": reason,
                "prerequisites_in_path": [
                    p for p in parents.get(cid, []) if p in priorities
                ],
                "minutes": minutes,
                "page_references": _page_references(node, names),
                "material_ids": material_lookup.get(cid, [])[:3],
                "completed": cid in completions,
                "ord": index,
            }
        )

    # Reassess steps after remediation: confirm the fix instead of assuming it.
    reassess_concepts = [
        gap["concept_id"]
        for gap in gaps
        if gap["concept_id"] in {s["concept_id"] for s in steps} and gap["evidence"] != "Limited"
    ][:3]
    if hypotheses:
        reassess_concepts = [c for c in reassess_concepts if (hypotheses.get(c) or {}).get("outcome") != "supported"]
    for offset, cid in enumerate(reassess_concepts, start=len(steps)):
        node = nodes_by_id.get(cid)
        if not node:
            continue
        steps.append(
            {
                "concept_id": cid,
                "concept_name": node["name"],
                "verb": "Reassess",
                "reason": f"After revising {node['name']}, retest it with fresh questions to see whether the gap closed.",
                "prerequisites_in_path": [
                    p for p in parents.get(cid, []) if p in priorities
                ],
                "minutes": 8,
                "page_references": _page_references(node, names),
                "material_ids": material_lookup.get(cid, [])[:3],
                "completed": False,
                "ord": offset,
            }
        )

    payload = {
        "id": new_id("path_"),
        "created_at": utcnow(),
        "steps": steps,
        "concepts": [
            {
                "id": n["id"],
                "name": n["name"],
                "description": n.get("description", ""),
                "level": int(n.get("level") or 0),
                "importance": float(n.get("importance") or 0.5),
                "source_pages": n.get("source_pages", []),
            }
            for n in nodes
        ],
        "completed_count": sum(1 for s in steps if s["completed"]),
    }

    if persist:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO path_versions (id, session_id, payload, created_at) VALUES (?, ?, ?, ?)",
                (payload["id"], session_id, dumps(payload), payload["created_at"]),
            )
            for step in steps:
                conn.execute(
                    "INSERT INTO path_steps (id, path_id, session_id, concept_id, ord, completed_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        new_id("pstep_"),
                        payload["id"],
                        session_id,
                        step["concept_id"],
                        step["ord"],
                        utcnow() if step["completed"] else None,
                    ),
                )
            log_activity(
                conn,
                session_id,
                "path",
                f"Learning path built with {len(steps)} step(s)",
            )
    return payload


def latest_path(session_id: str, *, create: bool = True) -> dict[str, Any]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM path_versions WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (session_id,),
        ).fetchone()
    if row is None:
        return build_path(session_id) if create else {"id": None, "created_at": None, "steps": [], "concepts": [], "completed_count": 0}
    payload = loads(row["payload"], {}) or {}
    with get_db() as conn:
        completed = {
            r["concept_id"]
            for r in conn.execute(
                "SELECT concept_id FROM path_steps WHERE path_id = ? AND session_id = ? AND completed_at IS NOT NULL",
                (row["id"], session_id),
            ).fetchall()
        }
    for step in payload.get("steps", []):
        step["completed"] = step["concept_id"] in completed
    payload["completed_count"] = sum(1 for s in payload.get("steps", []) if s["completed"])
    return payload


def set_step_completed(session_id: str, concept_id: str, completed: bool) -> dict[str, Any]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM path_versions WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (session_id,),
        ).fetchone()
        if row is None:
            raise ApiError(404, "path_not_found", "There is no learning path yet.")
        step = conn.execute(
            "SELECT * FROM path_steps WHERE path_id = ? AND concept_id = ? AND session_id = ?",
            (row["id"], concept_id, session_id),
        ).fetchone()
        if step is None:
            raise ApiError(404, "step_not_found", "That concept is not a step in your current path.")
        conn.execute(
            "UPDATE path_steps SET completed_at = ? WHERE id = ? AND session_id = ?",
            (utcnow() if completed else None, step["id"], session_id),
        )
        log_activity(
            conn,
            session_id,
            "path",
            f"Marked {concept_id} as {'complete' if completed else 'not complete'}",
        )
    return latest_path(session_id, create=False)


def path_out(session_id: str) -> dict[str, Any]:
    path = latest_path(session_id)
    PathOut(
        id=path.get("id"),
        created_at=path.get("created_at"),
        steps=[PathStepOut(**step) for step in path.get("steps", [])],
        concepts=path.get("concepts", []),
        completed_count=path.get("completed_count", 0),
    )
    return path


__all__ = ["build_path", "latest_path", "path_out", "set_step_completed", "PathPageRef", "sqlite3"]

"""Aggregate progress across documents, attempts, diagnosis and the learning path.

All of this is recomputed from SQLite on request, so it survives backend restarts.
"""
from __future__ import annotations

from typing import Any

from .analysis import get_concept_map
from .db import get_db, loads
from .diagnosis import compute_statuses, gap_counters
from .learning_path import latest_path
from .quiz import attempt_timeline


def _trend(rows: list[dict[str, Any]]) -> str:
    """Compare the last two attempts that tested this concept."""
    values = [row for row in rows if row.get("answered")]
    if len(values) < 2:
        return "unknown"
    prev = values[-2]["correct"] / max(1, values[-2]["answered"])
    last = values[-1]["correct"] / max(1, values[-1]["answered"])
    if last > prev + 0.001:
        return "up"
    if last < prev - 0.001:
        return "down"
    return "flat"


def progress_payload(session_id: str) -> dict[str, Any]:
    with get_db() as conn:
        nodes, _, _ = get_concept_map(conn, session_id)
        attempts = conn.execute(
            "SELECT * FROM attempts WHERE session_id = ? ORDER BY created_at, rowid",
            (session_id,),
        ).fetchall()
        documents = conn.execute(
            "SELECT COUNT(*) AS c FROM documents WHERE session_id = ? AND status != 'rejected'",
            (session_id,),
        ).fetchone()["c"]
        quizzes = conn.execute(
            "SELECT COUNT(*) AS c FROM quizzes WHERE session_id = ?", (session_id,)
        ).fetchone()["c"]
        materials = conn.execute(
            "SELECT COUNT(*) AS c FROM materials WHERE session_id = ?", (session_id,)
        ).fetchone()["c"]
        activity_rows = conn.execute(
            "SELECT id, kind, detail, created_at FROM activity WHERE session_id = ? "
            "ORDER BY id DESC LIMIT 20",
            (session_id,),
        ).fetchall()
        history: dict[str, list[dict[str, Any]]] = {}
        for attempt_row in attempts:
            results = loads(attempt_row["results"], {}) or {}
            for stat in results.get("concepts", []):
                history.setdefault(stat["concept_id"], []).append(stat)

    statuses = compute_statuses(session_id, nodes)
    path = latest_path(session_id, create=False)
    completed = [step["concept_id"] for step in path.get("steps", []) if step.get("completed")]
    open_gaps, resolved_gaps = gap_counters(session_id)

    concept_progress = []
    for node in nodes:
        cid = node["id"]
        rows = history.get(cid, [])
        concept_progress.append(
            {
                "concept_id": cid,
                "name": node["name"],
                "status": statuses.get(cid, "untested"),
                "trend": _trend(rows),
                "answered": sum(r.get("answered", 0) for r in rows),
                "correct": sum(r.get("correct", 0) for r in rows),
                "attempts": len([r for r in rows if r.get("answered")]),
            }
        )

    timeline = attempt_timeline(session_id)
    return {
        "concepts": concept_progress,
        "attempts": timeline,
        "score_history": timeline,
        "completed_steps": completed,
        "gaps_open": open_gaps,
        "gaps_resolved": resolved_gaps,
        "activity": [
            {
                "id": row["id"],
                "kind": row["kind"],
                "detail": row["detail"],
                "created_at": row["created_at"],
            }
            for row in activity_rows
        ],
        "document_count": int(documents),
        "quiz_count": int(quizzes),
        "material_count": int(materials),
    }

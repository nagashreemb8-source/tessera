"""Anonymous sessions and the isolation guarantee.

There is no login. A session id is an unguessable random token created by the backend.
Every data access goes through `session_id`, and a resource that belongs to another
session is reported as 404 (never 403) so ids cannot be probed.
"""
from __future__ import annotations

import re
import shutil
import sqlite3
import uuid

from fastapi import Header

from .db import get_db, log_activity, new_id, utcnow
from .errors import ApiError

SESSION_HEADER = "X-Session-Id"
_SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")


def valid_session_id(value: str) -> bool:
    return bool(_SESSION_RE.match(value or ""))


def create_session() -> dict[str, str]:
    session_id = uuid.uuid4().hex + uuid.uuid4().hex[:8]
    now = utcnow()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO sessions (id, created_at, last_seen_at) VALUES (?, ?, ?)",
            (session_id, now, now),
        )
        log_activity(conn, session_id, "session", "New study session started")
    return {"session_id": session_id, "created_at": now}


def session_exists(session_id: str) -> bool:
    with get_db() as conn:
        row = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
        return row is not None


def get_session_id(x_session_id: str | None = Header(default=None, alias=SESSION_HEADER)) -> str:
    """FastAPI dependency: validates and registers the session header."""
    if not x_session_id:
        raise ApiError(
            400,
            "session_required",
            "Missing X-Session-Id header. Create a session with POST /api/sessions first.",
        )
    if not valid_session_id(x_session_id):
        raise ApiError(400, "invalid_session", "The X-Session-Id header is not a valid session id.")
    with get_db() as conn:
        row = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (x_session_id,)).fetchone()
        if not row:
            raise ApiError(
                404,
                "session_not_found",
                "This study session no longer exists. Start a new session and upload your PDFs again.",
            )
        conn.execute(
            "UPDATE sessions SET last_seen_at = ? WHERE id = ?", (utcnow(), x_session_id)
        )
    return x_session_id


def optional_session_id(
    x_session_id: str | None = Header(default=None, alias=SESSION_HEADER),
) -> str | None:
    """For legacy endpoints that must work without a session (e.g. /api/explain)."""
    if not x_session_id or not valid_session_id(x_session_id):
        return None
    return x_session_id if session_exists(x_session_id) else None


def require_owned(
    conn: sqlite3.Connection,
    table: str,
    resource_id: str,
    session_id: str,
    *,
    code: str = "not_found",
    message: str = "This resource does not exist in your session.",
) -> sqlite3.Row:
    if table not in {"documents", "quizzes", "attempts", "diagnoses", "materials", "analyses"}:
        raise ValueError(f"unsupported table {table}")
    row = conn.execute(
        f"SELECT * FROM {table} WHERE id = ? AND session_id = ?", (resource_id, session_id)
    ).fetchone()
    if row is None:
        raise ApiError(404, code, message)
    return row


def delete_session_data(session_id: str) -> dict[str, int]:
    """Wipe every record and uploaded file for a session."""
    from .config import get_settings

    with get_db() as conn:
        row = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            raise ApiError(404, "session_not_found", "This study session no longer exists.")
        deleted: dict[str, int] = {}
        statements = [
            ("tutor_turns", "DELETE FROM tutor_turns WHERE session_id = ?"),
            ("quiz_questions", "DELETE FROM quiz_questions WHERE session_id = ?"),
            ("attempts", "DELETE FROM attempts WHERE session_id = ?"),
            ("diagnoses", "DELETE FROM diagnoses WHERE session_id = ?"),
            ("hypotheses", "DELETE FROM hypotheses WHERE session_id = ?"),
            ("quizzes", "DELETE FROM quizzes WHERE session_id = ?"),
            ("materials", "DELETE FROM materials WHERE session_id = ?"),
            ("path_steps", "DELETE FROM path_steps WHERE session_id = ?"),
            ("path_versions", "DELETE FROM path_versions WHERE session_id = ?"),
            ("concept_edges", "DELETE FROM concept_edges WHERE session_id = ?"),
            ("analyses", "DELETE FROM analyses WHERE session_id = ?"),
            ("chunks", "DELETE FROM chunks WHERE session_id = ?"),
            ("pages", "DELETE FROM pages WHERE session_id = ?"),
            ("documents", "DELETE FROM documents WHERE session_id = ?"),
            ("activity", "DELETE FROM activity WHERE session_id = ?"),
            ("sessions", "DELETE FROM sessions WHERE id = ?"),
        ]
        for name, sql in statements:
            cursor = conn.execute(sql, (session_id,))
            deleted[name] = cursor.rowcount
    folder = get_settings().uploads_dir / session_id
    if folder.exists():
        shutil.rmtree(folder, ignore_errors=True)
    from . import retrieval

    retrieval.invalidate(session_id)
    return deleted


def new_session_folder(session_id: str) -> "object":
    from .config import get_settings

    folder = get_settings().uploads_dir / session_id
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def record(session_id: str, kind: str, detail: str) -> None:
    with get_db() as conn:
        log_activity(conn, session_id, kind, detail)


def fresh_id(prefix: str = "") -> str:
    return new_id(prefix)

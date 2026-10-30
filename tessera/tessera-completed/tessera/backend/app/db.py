"""SQLite storage. No ORM, no migrations: the schema is created on startup.

Every table that holds user data carries `session_id`; every query filters on it.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

from .config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 0,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    error_code TEXT,
    warnings TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    UNIQUE (session_id, sha256)
);
CREATE INDEX IF NOT EXISTS idx_documents_session ON documents(session_id);

CREATE TABLE IF NOT EXISTS pages (
    document_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    page_no INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (document_id, page_no)
);
CREATE INDEX IF NOT EXISTS idx_pages_session ON pages(session_id);

CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    page_start INTEGER NOT NULL,
    page_end INTEGER NOT NULL,
    text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session_id);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);

CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    stage TEXT,
    error TEXT,
    payload TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analyses_session ON analyses(session_id);

CREATE TABLE IF NOT EXISTS concept_edges (
    analysis_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    rationale TEXT NOT NULL,
    source TEXT NOT NULL,
    confidence REAL NOT NULL,
    pages TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (analysis_id, from_id, to_id)
);

CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    concept_ids TEXT NOT NULL DEFAULT '[]',
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_materials_session ON materials(session_id);

CREATE TABLE IF NOT EXISTS tutor_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    citations TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tutor_session ON tutor_turns(session_id);

CREATE TABLE IF NOT EXISTS quizzes (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    analysis_id TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quizzes_session ON quizzes(session_id);

CREATE TABLE IF NOT EXISTS quiz_questions (
    id TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    ord INTEGER NOT NULL,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz ON quiz_questions(quiz_id);

CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    answers TEXT NOT NULL,
    results TEXT NOT NULL,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    answered INTEGER NOT NULL,
    time_taken_seconds REAL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempts(session_id);

CREATE TABLE IF NOT EXISTS diagnoses (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_diagnoses_session ON diagnoses(session_id);

CREATE TABLE IF NOT EXISTS hypotheses (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    diagnosis_id TEXT,
    outcome TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hypotheses_session ON hypotheses(session_id);

CREATE TABLE IF NOT EXISTS path_versions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_path_versions_session ON path_versions(session_id);

CREATE TABLE IF NOT EXISTS path_steps (
    id TEXT PRIMARY KEY,
    path_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    ord INTEGER NOT NULL,
    completed_at TEXT,
    UNIQUE (path_id, concept_id)
);

CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_session ON activity(session_id);
"""


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(prefix: str = "") -> str:
    raw = uuid.uuid4().hex
    return f"{prefix}{raw}" if prefix else raw


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def loads(value: str | None, default: Any = None) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return default


def connect() -> sqlite3.Connection:
    settings = get_settings()
    conn = sqlite3.connect(settings.db_path, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def get_db() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    get_settings().resolved_data_dir.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        conn.executescript(SCHEMA)


def log_activity(conn: sqlite3.Connection, session_id: str, kind: str, detail: str) -> None:
    conn.execute(
        "INSERT INTO activity (session_id, kind, detail, created_at) VALUES (?, ?, ?, ?)",
        (session_id, kind, detail, utcnow()),
    )

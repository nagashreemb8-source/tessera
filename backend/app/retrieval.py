"""Lexical retrieval (BM25) over a session's document chunks.

The interface is deliberately small (`search`, `confidence`) so an embeddings-backed
retriever could be swapped in later without touching callers. Lexical retrieval needs
no external service and works offline.
"""
from __future__ import annotations

import math
import re
import sqlite3
import threading
from collections import Counter
from dataclasses import dataclass

from .models import Passage

_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9'+./-]*")
_STOPWORDS = set(
    """a an the and or but of to in for on with without is are was were be been being this that these those
    it its as at by from not no if then than so such can could may might will would should we you your
    they their there here which who whom what when where how why all any each more most other some only
    also into about over under between during before after above below up down out off again further once
    """.split()
)


def tokenize(text: str) -> list[str]:
    out: list[str] = []
    for raw in _TOKEN_RE.findall(text.lower()):
        token = raw.strip(".-/")
        if token and token not in _STOPWORDS and (len(token) > 1 or token.isdigit()):
            out.append(token)
    return out


@dataclass
class ChunkDoc:
    id: str
    document_id: str
    document_name: str
    page_start: int
    page_end: int
    text: str
    tokens: list[str]


class BM25Index:
    """Okapi BM25 with k1=1.5, b=0.75."""

    def __init__(self, docs: list[ChunkDoc], k1: float = 1.5, b: float = 0.75) -> None:
        self.docs = docs
        self.k1 = k1
        self.b = b
        self.n = len(docs)
        self.doc_len = [len(d.tokens) for d in docs]
        self.avgdl = (sum(self.doc_len) / self.n) if self.n else 0.0
        self.tf = [Counter(d.tokens) for d in docs]
        df: Counter[str] = Counter()
        for tokens in self.tf:
            df.update(tokens.keys())
        self.idf = {
            term: math.log(1.0 + (self.n - freq + 0.5) / (freq + 0.5)) for term, freq in df.items()
        }

    def search(self, query: str, k: int = 8, document_ids: set[str] | None = None) -> list[tuple[ChunkDoc, float]]:
        q_tokens = tokenize(query)
        if not q_tokens or not self.n:
            return []
        q_terms = Counter(q_tokens)
        scored: list[tuple[ChunkDoc, float]] = []
        for i, doc in enumerate(self.docs):
            if document_ids and doc.document_id not in document_ids:
                continue
            dl = self.doc_len[i] or 1
            score = 0.0
            for term, qf in q_terms.items():
                freq = self.tf[i].get(term, 0)
                if not freq:
                    continue
                idf = self.idf.get(term, 0.0)
                denom = freq + self.k1 * (1 - self.b + self.b * dl / (self.avgdl or 1.0))
                score += idf * (freq * (self.k1 + 1)) / denom * min(qf, 3)
            if score > 0:
                scored.append((doc, score))
        scored.sort(key=lambda pair: pair[1], reverse=True)
        return scored[:k]


def query_coverage(query: str, results: list[tuple[ChunkDoc, float]]) -> float:
    """Fraction of meaningful query terms that actually appear in the retrieved text.

    A cheap, transparent confidence signal: if the documents never mention the words the
    student used, we should not let the model invent an answer.
    """
    terms = set(tokenize(query))
    if not terms:
        return 0.0
    top = results[:3]
    present: set[str] = set()
    for doc, _ in top:
        present.update(doc.tokens)
    return len(terms & present) / len(terms)


# --------------------------------------------------------------------------- #
# Per-session index cache
# --------------------------------------------------------------------------- #
_cache: dict[str, tuple[tuple[int, int, int], BM25Index]] = {}
_lock = threading.Lock()


def invalidate(session_id: str) -> None:
    with _lock:
        _cache.pop(session_id, None)


def _load_docs(conn: sqlite3.Connection, session_id: str) -> list[ChunkDoc]:
    rows = conn.execute(
        """
        SELECT c.id, c.document_id, c.page_start, c.page_end, c.text, d.filename
        FROM chunks c JOIN documents d ON d.id = c.document_id
        WHERE c.session_id = ? AND d.session_id = ?
        ORDER BY c.document_id, c.chunk_index
        """,
        (session_id, session_id),
    ).fetchall()
    return [
        ChunkDoc(
            id=row["id"],
            document_id=row["document_id"],
            document_name=row["filename"],
            page_start=row["page_start"],
            page_end=row["page_end"],
            text=row["text"],
            tokens=tokenize(row["text"]),
        )
        for row in rows
    ]


def get_index(conn: sqlite3.Connection, session_id: str) -> BM25Index:
    fingerprint_row = conn.execute(
        "SELECT COUNT(*) AS c, COALESCE(SUM(LENGTH(text)), 0) AS s, COALESCE(MAX(LENGTH(text)), 0) AS m "
        "FROM chunks WHERE session_id = ?",
        (session_id,),
    ).fetchone()
    fingerprint = (int(fingerprint_row["c"]), int(fingerprint_row["s"]), int(fingerprint_row["m"]))
    with _lock:
        cached = _cache.get(session_id)
        if cached and cached[0] == fingerprint:
            return cached[1]
    index = BM25Index(_load_docs(conn, session_id))
    with _lock:
        _cache[session_id] = (fingerprint, index)
    return index


def search(
    conn: sqlite3.Connection,
    session_id: str,
    query: str,
    k: int = 8,
    document_ids: list[str] | None = None,
    page_range: tuple[int, int] | None = None,
) -> tuple[list[tuple[ChunkDoc, float]], float]:
    index = get_index(conn, session_id)
    allowed = set(document_ids) if document_ids else None
    results = index.search(query, k=max(k, 1) * 3, document_ids=allowed)
    if page_range:
        lo, hi = page_range
        results = [
            (doc, score)
            for doc, score in results
            if not (doc.page_end < lo or doc.page_start > hi)
        ]
    results = results[:k]
    return results, query_coverage(query, results)


def to_passages(results: list[tuple[ChunkDoc, float]], max_chars: int = 4000) -> list[Passage]:
    passages: list[Passage] = []
    budget = max_chars
    for doc, score in results:
        if budget <= 0:
            break
        text = doc.text
        if len(text) > budget:
            text = text[:budget]
        budget -= len(text)
        passages.append(
            Passage(
                document_id=doc.document_id,
                document_name=doc.document_name,
                page_start=doc.page_start,
                page_end=doc.page_end,
                text=text,
                score=round(float(score), 3),
            )
        )
    return passages

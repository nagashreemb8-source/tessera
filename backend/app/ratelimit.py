"""Simple in-memory sliding-window limiter for LLM-heavy endpoints.

One process, one student: this is intentionally not distributed. It protects the demo
from accidental request storms (double-clicks, refresh loops).
"""
from __future__ import annotations

import threading
import time
from collections import deque

from .config import get_settings
from .errors import ApiError

_lock = threading.Lock()
_hits: dict[str, deque[float]] = {}


def check_llm_rate(session_id: str) -> None:
    limit = max(1, get_settings().llm_rate_limit_per_minute)
    now = time.monotonic()
    with _lock:
        bucket = _hits.setdefault(session_id, deque())
        while bucket and now - bucket[0] > 60:
            bucket.popleft()
        if len(bucket) >= limit:
            retry_after = int(60 - (now - bucket[0])) + 1
            raise ApiError(
                429,
                "rate_limited",
                f"Too many AI requests. Wait about {retry_after}s and try again.",
                {"retry_after_seconds": retry_after},
            )
        bucket.append(now)

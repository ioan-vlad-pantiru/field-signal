"""In-memory, time-limited sessions.

Per the project rules we do not store phone numbers or locations beyond the
session: keys are SHA-256 hashes of the sender, entries expire after the TTL,
and nothing is written to disk. A restart forgets everything.
"""

from __future__ import annotations

import hashlib
import threading
import time
from dataclasses import dataclass, field

import anyio

from .models import FieldAnalysis, Lang


@dataclass
class Session:
    lang: Lang
    analysis: FieldAnalysis | None = None
    history: list[dict[str, str]] = field(default_factory=list)
    touched: float = field(default_factory=time.monotonic)
    # Keeps one farmer's chat replies in order when they type fast.
    lock: anyio.Lock = field(default_factory=anyio.Lock)

    def remember(self, role: str, content: str, max_turns: int) -> None:
        self.history.append({"role": role, "content": content})
        del self.history[: max(0, len(self.history) - 2 * max_turns)]


class SessionStore:
    def __init__(self, ttl_s: int, default_lang: Lang) -> None:
        self._ttl = ttl_s
        self._default_lang = default_lang
        self._data: dict[str, Session] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _key(sender: str) -> str:
        return hashlib.sha256(sender.encode()).hexdigest()

    def get(self, sender: str) -> Session:
        now = time.monotonic()
        with self._lock:
            self._purge(now)
            key = self._key(sender)
            s = self._data.get(key)
            if s is None:
                s = Session(lang=self._default_lang)
                self._data[key] = s
            s.touched = now
            return s

    def _purge(self, now: float) -> None:
        expired = [k for k, s in self._data.items() if now - s.touched > self._ttl]
        for k in expired:
            del self._data[k]

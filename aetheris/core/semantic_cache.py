"""Semantic response cache.

The existing response cache keys on an exact payload hash. This one keys
on a *signature embedding* of the prompt (plus model/mode), so a near-
duplicate question can reuse a previous answer. Entries expire by TTL
and can be invalidated by tag.

It is deliberately conservative: the default similarity threshold is
high enough that "hello" will not collide with "help me design a
rate limiter".
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field

from .embeddings import cosine, signature_embed


class CachePut(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=40_000)
    response: str = Field(..., min_length=1, max_length=80_000)
    model: str = Field(default="")
    mode: str = Field(default="")
    tags: list[str] = Field(default_factory=list)
    ttl_seconds: float | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class CacheLookup(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=40_000)
    model: str = Field(default="")
    mode: str = Field(default="")
    threshold: float | None = None


@dataclass
class _Entry:
    id: str
    prompt: str
    response: str
    model: str
    mode: str
    tags: list[str]
    vec: list[float]
    metadata: dict[str, Any]
    created_at: float
    expires_at: float
    hits: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "prompt": self.prompt[:200],
            "model": self.model,
            "mode": self.mode,
            "tags": list(self.tags),
            "created_at": self.created_at,
            "expires_at": self.expires_at,
            "hits": self.hits,
            "metadata": self.metadata,
        }


class SemanticCache:
    def __init__(
        self,
        *,
        threshold: float = 0.82,
        ttl_seconds: float = 600.0,
        max_entries: int = 2_000,
    ) -> None:
        self._lock = Lock()
        self._entries: dict[str, _Entry] = {}
        self.threshold = threshold
        self.ttl_seconds = ttl_seconds
        self._max = max_entries
        self._lookups = 0
        self._hits = 0
        self._misses = 0

    def _expired(self, entry: _Entry, now: float) -> bool:
        return entry.expires_at > 0 and now >= entry.expires_at

    def _evict_locked(self, now: float) -> None:
        dead = [eid for eid, e in self._entries.items() if self._expired(e, now)]
        for eid in dead:
            del self._entries[eid]
        while len(self._entries) >= self._max:
            oldest = min(self._entries.values(), key=lambda e: e.created_at)
            del self._entries[oldest.id]

    def put(self, body: CachePut) -> _Entry:
        now = time.time()
        ttl = self.ttl_seconds if body.ttl_seconds is None else body.ttl_seconds
        entry = _Entry(
            id=f"sc_{uuid.uuid4().hex[:10]}",
            prompt=body.prompt,
            response=body.response,
            model=body.model,
            mode=body.mode,
            tags=list(body.tags),
            vec=signature_embed(self._key_text(body.prompt, body.model, body.mode)),
            metadata=dict(body.metadata),
            created_at=now,
            expires_at=now + ttl if ttl > 0 else 0.0,
        )
        with self._lock:
            self._evict_locked(now)
            self._entries[entry.id] = entry
        return entry

    @staticmethod
    def _key_text(prompt: str, model: str, mode: str) -> str:
        return f"{model}|{mode}|{prompt.strip()}"

    def lookup(self, body: CacheLookup) -> dict[str, Any]:
        now = time.time()
        qv = signature_embed(self._key_text(body.prompt, body.model, body.mode))
        threshold = self.threshold if body.threshold is None else body.threshold
        with self._lock:
            self._lookups += 1
            self._evict_locked(now)
            best: tuple[float, _Entry] | None = None
            for entry in self._entries.values():
                if body.model and entry.model and entry.model != body.model:
                    continue
                if body.mode and entry.mode and entry.mode != body.mode:
                    continue
                score = cosine(qv, entry.vec)
                if best is None or score > best[0]:
                    best = (score, entry)
            if best is None or best[0] < threshold:
                self._misses += 1
                return {"hit": False, "score": round(best[0], 4) if best else 0.0, "threshold": threshold}
            best[1].hits += 1
            self._hits += 1
            return {
                "hit": True,
                "score": round(best[0], 4),
                "threshold": threshold,
                "entry": best[1].to_dict(),
                "response": best[1].response,
            }

    def invalidate(self, *, tag: str | None = None, entry_id: str | None = None) -> int:
        with self._lock:
            if entry_id:
                return 1 if self._entries.pop(entry_id, None) else 0
            if tag:
                dead = [eid for eid, e in self._entries.items() if tag in e.tags]
                for eid in dead:
                    del self._entries[eid]
                return len(dead)
            n = len(self._entries)
            self._entries.clear()
            return n

    def list_entries(self, *, tag: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            items = list(self._entries.values())
        if tag:
            items = [e for e in items if tag in e.tags]
        items.sort(key=lambda e: -e.created_at)
        return [e.to_dict() for e in items[:limit]]

    def stats(self) -> dict[str, Any]:
        with self._lock:
            hit_rate = self._hits / max(self._lookups, 1)
            return {
                "entries": len(self._entries),
                "lookups": self._lookups,
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate": round(hit_rate, 4),
                "threshold": self.threshold,
                "ttl_seconds": self.ttl_seconds,
            }


_cache: SemanticCache | None = None


def get_semantic_cache() -> SemanticCache:
    global _cache
    if _cache is None:
        _cache = SemanticCache()
    return _cache


__all__ = ["SemanticCache", "CachePut", "CacheLookup", "get_semantic_cache"]

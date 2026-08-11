"""Response caching layer for Aetheris.

Provides a TTL-based in-memory cache for chat completions. Identical requests
within the TTL window return the cached result instantly, saving tokens and
latency. Cache keys are derived from a hash of the model, mode, and message
content, so only truly identical requests hit the cache.

Cache is:
* Per-model and per-mode (different modes never share cache)
* TTL-based with configurable expiry
* Bounded in size (LRU eviction)
* Inspectable via the API
* Selectively bypassable via a request header
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

logger = logging.getLogger("aetheris.cache")


@dataclass
class _CacheEntry:
    key: str
    value: Any
    created_at: float
    expires_at: float
    hit_count: int = 0


class ResponseCache:
    """Thread-safe TTL-based LRU response cache."""

    def __init__(self, max_entries: int = 1000, default_ttl: float = 300.0) -> None:
        self._entries: OrderedDict[str, _CacheEntry] = OrderedDict()
        self._lock = Lock()
        self._max = max_entries
        self._default_ttl = default_ttl
        self._stats = {"hits": 0, "misses": 0, "evictions": 0, "sets": 0}

    @staticmethod
    def make_key(
        model: str | None,
        mode: str | None,
        messages: list[dict],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        """Derive a deterministic cache key from request parameters."""
        payload = json.dumps({
            "model": model or "",
            "mode": mode or "",
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }, sort_keys=True, default=str)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def get(self, key: str) -> Any | None:
        """Look up a cached response. Returns None on miss or expiry."""
        now = time.time()
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                self._stats["misses"] += 1
                return None
            if now > entry.expires_at:
                del self._entries[key]
                self._stats["misses"] += 1
                self._stats["evictions"] += 1
                return None
            # LRU: move to end
            self._entries.move_to_end(key)
            entry.hit_count += 1
            self._stats["hits"] += 1
        return entry.value

    def set(self, key: str, value: Any, ttl: float | None = None) -> None:
        """Store a response in the cache."""
        now = time.time()
        ttl = ttl if ttl is not None else self._default_ttl
        with self._lock:
            if len(self._entries) >= self._max:
                # Evict oldest (LRU)
                oldest = next(iter(self._entries))
                del self._entries[oldest]
                self._stats["evictions"] += 1
            self._entries[key] = _CacheEntry(
                key=key, value=value,
                created_at=now, expires_at=now + ttl,
            )
            self._stats["sets"] += 1

    def invalidate(self, key: str) -> bool:
        """Remove a specific cache entry."""
        with self._lock:
            return self._entries.pop(key, None) is not None

    def clear(self) -> int:
        """Clear all cache entries."""
        with self._lock:
            count = len(self._entries)
            self._entries.clear()
        return count

    def stats(self) -> dict[str, Any]:
        now = time.time()
        with self._lock:
            total = len(self._entries)
            expired = sum(1 for e in self._entries.values() if now > e.expires_at)
            return {
                "total_entries": total,
                "active_entries": total - expired,
                "expired_entries": expired,
                "max_entries": self._max,
                "default_ttl": self._default_ttl,
                **dict(self._stats),
                "hit_rate": (
                    self._stats["hits"] / (self._stats["hits"] + self._stats["misses"])
                    if (self._stats["hits"] + self._stats["misses"]) > 0
                    else 0.0
                ),
            }


_cache: ResponseCache | None = None


def get_response_cache() -> ResponseCache:
    global _cache
    if _cache is None:
        from .config import settings
        _cache = ResponseCache(
            max_entries=settings.cache_max_entries,
            default_ttl=settings.cache_default_ttl,
        )
    return _cache


__all__ = ["ResponseCache", "get_response_cache"]

"""Playground history for Aetheris.

Stores a record of every chat completion request and response for later
review, search, and replay. The playground enables:

* Browsing past completions with filters
* Replaying a previous request with the same or modified parameters
* Comparing responses across different models/temperatures
* Exporting playground sessions
"""

from __future__ import annotations

import hashlib
import time
import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Any, Literal

from pydantic import BaseModel, Field


class PlaygroundEntryCreate(BaseModel):
    """Record a playground completion."""
    model: str = Field(default="pro", description="Model used.")
    mode: str = Field(default="general", description="Inference mode.")
    messages: list[dict[str, str]] = Field(..., description="Input messages.")
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=4096, ge=1)
    system_prompt: str = Field(default="")
    tools_used: list[str] = Field(default_factory=list)
    response_content: str = Field(default="", description="Assistant response content.")
    response_tokens: int = Field(default=0)
    prompt_tokens: int = Field(default=0)
    latency_ms: float = Field(default=0.0, ge=0.0)
    is_streamed: bool = Field(default=False)
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class PlaygroundEntryInfo(BaseModel):
    id: str
    model: str
    mode: str
    message_count: int
    temperature: float
    max_tokens: int
    system_prompt: str
    tools_used: list[str]
    response_tokens: int
    prompt_tokens: int
    latency_ms: float
    is_streamed: bool
    tags: list[str]
    created_at: float
    fingerprint: str


# --- Internal -----------------------------------------------------------------

@dataclass
class _PlaygroundEntry:
    id: str
    model: str
    mode: str
    messages: list[dict[str, str]]
    temperature: float
    max_tokens: int
    system_prompt: str
    tools_used: list[str]
    response_content: str
    response_tokens: int
    prompt_tokens: int
    latency_ms: float
    is_streamed: bool
    tags: list[str]
    created_at: float
    metadata: dict[str, Any]
    fingerprint: str

    def to_info(self) -> PlaygroundEntryInfo:
        return PlaygroundEntryInfo(
            id=self.id, model=self.model, mode=self.mode,
            message_count=len(self.messages), temperature=self.temperature,
            max_tokens=self.max_tokens, system_prompt=self.system_prompt,
            tools_used=self.tools_used, response_tokens=self.response_tokens,
            prompt_tokens=self.prompt_tokens, latency_ms=self.latency_ms,
            is_streamed=self.is_streamed, tags=self.tags,
            created_at=self.created_at, fingerprint=self.fingerprint,
        )

    def request_hash(self) -> str:
        """Deterministic hash of the request for dedup/replay."""
        import json
        payload = json.dumps({
            "model": self.model, "mode": self.mode,
            "messages": self.messages, "temperature": self.temperature,
            "system_prompt": self.system_prompt,
        }, sort_keys=True)
        return hashlib.sha256(payload.encode()).hexdigest()[:16]


# --- Store --------------------------------------------------------------------

class PlaygroundStore:
    """Thread-safe in-memory playground history store."""

    def __init__(self, max_entries: int = 10_000) -> None:
        self._entries: dict[str, _PlaygroundEntry] = {}
        self._lock = Lock()
        self._max = max_entries

    def create(self, body: PlaygroundEntryCreate) -> _PlaygroundEntry:
        with self._lock:
            if len(self._entries) >= self._max:
                # Remove oldest entries
                sorted_ids = sorted(self._entries, key=lambda eid: self._entries[eid].created_at)
                for eid in sorted_ids[:self._max // 4]:
                    del self._entries[eid]
            entry = _PlaygroundEntry(
                id=f"pg_{uuid.uuid4().hex[:8]}",
                model=body.model, mode=body.mode,
                messages=body.messages, temperature=body.temperature,
                max_tokens=body.max_tokens, system_prompt=body.system_prompt,
                tools_used=body.tools_used, response_content=body.response_content,
                response_tokens=body.response_tokens, prompt_tokens=body.prompt_tokens,
                latency_ms=body.latency_ms, is_streamed=body.is_streamed,
                tags=body.tags, created_at=time.time(),
                metadata=body.metadata,
                fingerprint="",
            )
            entry.fingerprint = entry.request_hash()
            self._entries[entry.id] = entry
        return entry

    def get(self, entry_id: str) -> _PlaygroundEntry | None:
        with self._lock:
            return self._entries.get(entry_id)

    def delete(self, entry_id: str) -> bool:
        with self._lock:
            return self._entries.pop(entry_id, None) is not None

    def list_entries(
        self,
        *,
        model: str | None = None,
        mode: str | None = None,
        limit: int = 50,
    ) -> list[_PlaygroundEntry]:
        with self._lock:
            entries = list(self._entries.values())
        if model:
            entries = [e for e in entries if e.model == model]
        if mode:
            entries = [e for e in entries if e.mode == mode]
        entries.sort(key=lambda e: e.created_at, reverse=True)
        return entries[:limit]

    def search(self, query: str, *, limit: int = 20) -> list[_PlaygroundEntry]:
        """Search entries by content in messages or response."""
        import re
        pattern = re.compile(re.escape(query), re.IGNORECASE)
        with self._lock:
            entries = list(self._entries.values())
        results = []
        for e in entries:
            # Search in response content and message content
            texts = [e.response_content] + [m.get("content", "") for m in e.messages]
            if any(pattern.search(t) for t in texts):
                results.append(e)
        results.sort(key=lambda e: e.created_at, reverse=True)
        return results[:limit]

    def get_replay_request(self, entry_id: str) -> dict[str, Any] | None:
        """Get the request parameters for replaying an entry."""
        entry = self.get(entry_id)
        if entry is None:
            return None
        return {
            "model": entry.model,
            "mode": entry.mode,
            "messages": entry.messages,
            "temperature": entry.temperature,
            "max_tokens": entry.max_tokens,
            "system_prompt": entry.system_prompt,
        }

    def clear(self) -> int:
        """Clear all entries. Returns count cleared."""
        with self._lock:
            count = len(self._entries)
            self._entries.clear()
        return count

    def stats(self) -> dict[str, Any]:
        with self._lock:
            by_model: dict[str, int] = {}
            for e in self._entries.values():
                by_model[e.model] = by_model.get(e.model, 0) + 1
            return {
                "total": len(self._entries),
                "by_model": by_model,
                "total_tokens": sum(e.prompt_tokens + e.response_tokens for e in self._entries.values()),
            }


_store: PlaygroundStore | None = None


def get_playground_store() -> PlaygroundStore:
    global _store
    if _store is None:
        _store = PlaygroundStore()
    return _store


__all__ = ["PlaygroundStore", "PlaygroundEntryCreate", "PlaygroundEntryInfo", "get_playground_store"]

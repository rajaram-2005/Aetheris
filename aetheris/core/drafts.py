"""Drafts — auto-saved drafts for conversations and documents.

Drafts are autosaved snapshots of in-progress edits with conflict detection.
When two clients update the same draft concurrently, the second writer receives
a conflict error unless they supply the expected revision (ETag-style).
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


# --- Schemas -----------------------------------------------------------------

class DraftCreate(BaseModel):
    entity_type: str = Field(..., min_length=1, max_length=64, description="conversation | document | prompt | canvas")
    entity_id: str = Field(default="", max_length=128, description="Target entity id (empty for new).")
    title: str = Field(default="Untitled draft", max_length=200)
    content: str = Field(default="")
    client_id: str = Field(default="anonymous", max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)


class DraftUpdate(BaseModel):
    content: str = Field(default="")
    expected_revision: int | None = Field(default=None, description="For optimistic concurrency control.")
    client_id: str = Field(default="anonymous", max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)


class DraftInfo(BaseModel):
    id: str
    entity_type: str
    entity_id: str
    title: str
    content_preview: str
    revision: int
    created_by: str
    updated_by: str
    created_at: float
    updated_at: float
    is_auto_saved: bool
    metadata: dict[str, Any]


class DraftDetail(DraftInfo):
    content: str
    history: list[dict[str, Any]]


class DraftConflict(BaseModel):
    draft_id: str
    current_revision: int
    message: str
    server_updated_at: float


# --- Internal dataclass ------------------------------------------------------

@dataclass
class _Revision:
    revision: int
    content: str
    client_id: str
    timestamp: float
    is_auto_saved: bool


@dataclass
class _Draft:
    id: str
    entity_type: str
    entity_id: str
    title: str
    created_by: str
    created_at: float
    revisions: list[_Revision] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def current(self) -> _Revision:
        return self.revisions[-1]

    @property
    def revision(self) -> int:
        return self.current.revision if self.revisions else 0


# --- Manager -----------------------------------------------------------------

class DraftManager:
    """Thread-safe autosave draft manager with optimistic concurrency control."""

    PREVIEW_LEN = 160

    def __init__(self, max_drafts: int = 1000, max_revisions: int = 50) -> None:
        self._lock = Lock()
        self._drafts: dict[str, _Draft] = {}
        self._max_drafts = max_drafts
        self._max_revs = max_revisions
        self._order: list[str] = []

    def create(self, body: DraftCreate, *, is_auto_saved: bool = False) -> _Draft:
        with self._lock:
            if len(self._drafts) >= self._max_drafts:
                oldest = self._order.pop(0)
                self._drafts.pop(oldest, None)
            did = f"draft_{uuid.uuid4().hex[:10]}"
            now = time.time()
            d = _Draft(
                id=did, entity_type=body.entity_type, entity_id=body.entity_id,
                title=body.title, created_by=body.client_id, created_at=now,
                metadata=body.metadata,
            )
            d.revisions.append(_Revision(revision=1, content=body.content, client_id=body.client_id, timestamp=now, is_auto_saved=is_auto_saved))
            self._drafts[did] = d
            self._order.append(did)
            return d

    def get(self, draft_id: str) -> _Draft | None:
        with self._lock:
            return self._drafts.get(draft_id)

    def update(self, draft_id: str, body: DraftUpdate, *, is_auto_saved: bool = False) -> tuple[_Draft | None, dict | None]:
        """Returns (draft, conflict_dict). On conflict, draft is None."""
        with self._lock:
            d = self._drafts.get(draft_id)
            if d is None:
                return None, None
            if body.expected_revision is not None and body.expected_revision != d.revision:
                return None, {
                    "draft_id": draft_id,
                    "current_revision": d.revision,
                    "message": "Conflict: draft was updated by another client.",
                    "server_updated_at": d.current.timestamp,
                }
            if body.content == d.current.content and not body.metadata:
                return d, None
            new_rev = _Revision(
                revision=d.revision + 1,
                content=body.content,
                client_id=body.client_id,
                timestamp=time.time(),
                is_auto_saved=is_auto_saved,
            )
            d.revisions.append(new_rev)
            if body.metadata:
                d.metadata.update(body.metadata)
            if len(d.revisions) > self._max_revs:
                d.revisions = d.revisions[-self._max_revs:]
                for i, r in enumerate(d.revisions, start=1):
                    r.revision = i
            return d, None

    def autosave(self, draft_id: str, content: str, client_id: str = "anonymous", metadata: dict | None = None) -> tuple[_Draft | None, dict | None]:
        return self.update(draft_id, DraftUpdate(content=content, client_id=client_id, metadata=metadata or {}), is_auto_saved=True)

    def list_drafts(self, *, entity_type: str | None = None, entity_id: str | None = None, client_id: str | None = None) -> list[_Draft]:
        with self._lock:
            items = list(self._drafts.values())
        if entity_type:
            items = [d for d in items if d.entity_type == entity_type]
        if entity_id:
            items = [d for d in items if d.entity_id == entity_id]
        if client_id:
            items = [d for d in items if d.created_by == client_id or d.current.client_id == client_id]
        return sorted(items, key=lambda d: -d.current.timestamp)

    def delete(self, draft_id: str) -> bool:
        with self._lock:
            if draft_id not in self._drafts:
                return False
            del self._drafts[draft_id]
            try:
                self._order.remove(draft_id)
            except ValueError:
                pass
            return True

    def publish(self, draft_id: str) -> dict[str, Any] | None:
        """Mark draft as published (i.e., merged into target entity). Returns a summary."""
        with self._lock:
            d = self._drafts.get(draft_id)
            if d is None:
                return None
            out = {
                "draft_id": d.id,
                "entity_type": d.entity_type,
                "entity_id": d.entity_id,
                "title": d.title,
                "content": d.current.content,
                "revisions": len(d.revisions),
                "published_at": time.time(),
            }
            return out

    def revert(self, draft_id: str, revision: int, client_id: str = "system") -> _Draft | None:
        with self._lock:
            d = self._drafts.get(draft_id)
            if d is None:
                return None
            if revision < 1 or revision > len(d.revisions):
                return None
            target = d.revisions[revision - 1]
            d.revisions.append(_Revision(
                revision=len(d.revisions) + 1, content=target.content,
                client_id=client_id, timestamp=time.time(), is_auto_saved=False,
            ))
            return d

    def stats(self) -> dict[str, Any]:
        with self._lock:
            by_entity: dict[str, int] = {}
            for d in self._drafts.values():
                by_entity[d.entity_type] = by_entity.get(d.entity_type, 0) + 1
            return {
                "total": len(self._drafts),
                "by_entity_type": by_entity,
                "max_drafts": self._max_drafts,
                "max_revisions_per_draft": self._max_revs,
            }


def _info(d: _Draft) -> DraftInfo:
    cur = d.current
    return DraftInfo(
        id=d.id, entity_type=d.entity_type, entity_id=d.entity_id, title=d.title,
        content_preview=cur.content[:DraftManager.PREVIEW_LEN],
        revision=d.revision, created_by=d.created_by, updated_by=cur.client_id,
        created_at=d.created_at, updated_at=cur.timestamp, is_auto_saved=cur.is_auto_saved,
        metadata=d.metadata,
    )


def _detail(d: _Draft) -> DraftDetail:
    cur = d.current
    return DraftDetail(
        id=d.id, entity_type=d.entity_type, entity_id=d.entity_id, title=d.title,
        content_preview=cur.content[:DraftManager.PREVIEW_LEN],
        revision=d.revision, created_by=d.created_by, updated_by=cur.client_id,
        created_at=d.created_at, updated_at=cur.timestamp, is_auto_saved=cur.is_auto_saved,
        metadata=d.metadata, content=cur.content,
        history=[
            {"revision": r.revision, "client_id": r.client_id, "timestamp": r.timestamp,
             "is_auto_saved": r.is_auto_saved, "length": len(r.content)}
            for r in d.revisions
        ],
    )


_manager: DraftManager | None = None


def get_draft_manager() -> DraftManager:
    global _manager
    if _manager is None:
        _manager = DraftManager()
    return _manager


__all__ = [
    "DraftManager", "DraftCreate", "DraftUpdate", "DraftInfo", "DraftDetail", "DraftConflict",
    "get_draft_manager", "_info", "_detail",
]

"""Inline comments / annotation threads.

Attach comment threads to any entity (conversation message, document chunk,
canvas cell, prompt template). Comments support nesting (replies), resolution,
reactions, and @-mentions.
"""

from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


_MENTION_RE = re.compile(r"@([A-Za-z0-9_.-]+)")


# --- Schemas -----------------------------------------------------------------

class CommentCreate(BaseModel):
    entity_type: str = Field(..., min_length=1, max_length=64)
    entity_id: str = Field(..., min_length=1, max_length=128)
    thread_id: str | None = Field(default=None, description="Set for replies.")
    body: str = Field(..., min_length=1, max_length=10_000)
    author: str = Field(default="anonymous", max_length=128)
    anchor: dict[str, Any] | None = Field(default=None, description="Selection anchor: {start, end, text}")
    reactions: dict[str, list[str]] = Field(default_factory=dict)


class CommentUpdate(BaseModel):
    body: str | None = Field(default=None, max_length=10_000)
    resolved: bool | None = None


class ReactionCreate(BaseModel):
    emoji: str = Field(..., min_length=1, max_length=16)
    user: str = Field(default="anonymous", max_length=128)


class CommentInfo(BaseModel):
    id: str
    thread_id: str
    entity_type: str
    entity_id: str
    parent_id: str | None
    body: str
    author: str
    created_at: float
    updated_at: float
    resolved: bool
    resolved_by: str | None
    resolved_at: float | None
    anchor: dict[str, Any]
    reactions: dict[str, list[str]]
    replies_count: int
    mentions: list[str]


# --- Internal dataclass ------------------------------------------------------

@dataclass
class _Comment:
    id: str
    thread_id: str
    entity_type: str
    entity_id: str
    parent_id: str | None
    body: str
    author: str
    created_at: float
    updated_at: float
    resolved: bool = False
    resolved_by: str | None = None
    resolved_at: float | None = None
    anchor: dict[str, Any] = field(default_factory=dict)
    reactions: dict[str, list[str]] = field(default_factory=dict)
    reply_ids: list[str] = field(default_factory=list)
    deleted: bool = False


# --- Manager -----------------------------------------------------------------

class CommentManager:
    def __init__(self, max_comments: int = 20_000) -> None:
        self._lock = Lock()
        self._comments: dict[str, _Comment] = {}
        self._threads: dict[str, list[str]] = {}  # thread_id -> root ids (or thread root + replies)
        self._entity_index: dict[tuple[str, str], list[str]] = {}
        self._max = max_comments

    def create(self, body: CommentCreate) -> _Comment:
        with self._lock:
            if len(self._comments) >= self._max:
                # Evict oldest resolved threads first
                self._evict_locked(100)
            now = time.time()
            cid = f"cmt_{uuid.uuid4().hex[:10]}"
            parent = self._comments.get(body.thread_id) if body.thread_id else None
            # If thread_id references a reply, find its root thread
            root_id = None
            if parent is not None:
                root_id = parent.thread_id
            else:
                root_id = cid
            c = _Comment(
                id=cid, thread_id=root_id, entity_type=body.entity_type, entity_id=body.entity_id,
                parent_id=parent.id if parent else None, body=body.body, author=body.author,
                created_at=now, updated_at=now, anchor=body.anchor or {}, reactions=dict(body.reactions),
            )
            self._comments[cid] = c
            self._threads.setdefault(root_id, []).append(cid)
            if parent is not None:
                parent.reply_ids.append(cid)
            self._entity_index.setdefault((body.entity_type, body.entity_id), []).append(cid)
            return c

    def _evict_locked(self, n: int) -> None:
        # Evict resolved threads oldest-first
        candidates = sorted(
            (c for c in self._comments.values() if c.resolved and not c.deleted),
            key=lambda c: c.updated_at,
        )
        for c in candidates[:n]:
            self._delete_locked(c.id)

    def get(self, comment_id: str) -> _Comment | None:
        with self._lock:
            c = self._comments.get(comment_id)
            return None if (c is None or c.deleted) else c

    def update(self, comment_id: str, body: CommentUpdate, actor: str = "anonymous") -> _Comment | None:
        with self._lock:
            c = self._comments.get(comment_id)
            if c is None or c.deleted:
                return None
            if body.body is not None:
                c.body = body.body
                c.updated_at = time.time()
            if body.resolved is not None:
                # Resolve thread root + all descendants
                root_id = c.thread_id
                if body.resolved:
                    for tid in self._threads.get(root_id, []):
                        t = self._comments.get(tid)
                        if t and not t.resolved:
                            t.resolved = True
                            t.resolved_by = actor
                            t.resolved_at = time.time()
                            t.updated_at = time.time()
                else:
                    c.resolved = False
                    c.resolved_by = None
                    c.resolved_at = None
                    c.updated_at = time.time()
            return c

    def react(self, comment_id: str, body: ReactionCreate) -> _Comment | None:
        with self._lock:
            c = self._comments.get(comment_id)
            if c is None or c.deleted:
                return None
            users = c.reactions.setdefault(body.emoji, [])
            if body.user in users:
                users.remove(body.user)  # toggle off
            else:
                users.append(body.user)
            c.updated_at = time.time()
            return c

    def delete(self, comment_id: str) -> bool:
        with self._lock:
            return self._delete_locked(comment_id)

    def _delete_locked(self, comment_id: str) -> bool:
        c = self._comments.get(comment_id)
        if c is None or c.deleted:
            return False
        c.deleted = True
        c.body = "[deleted]"
        c.reactions.clear()
        c.updated_at = time.time()
        # Delete replies too
        for rid in list(c.reply_ids):
            self._delete_locked(rid)
        return True

    def list_for_entity(self, entity_type: str, entity_id: str, *, include_resolved: bool = True) -> list[_Comment]:
        with self._lock:
            ids = list(self._entity_index.get((entity_type, entity_id), []))
            out = []
            seen_threads: set[str] = set()
            for cid in ids:
                c = self._comments.get(cid)
                if c is None or c.deleted or c.parent_id:
                    continue
                if not include_resolved and c.resolved:
                    continue
                if c.thread_id in seen_threads:
                    continue
                seen_threads.add(c.thread_id)
                out.append(c)
            return sorted(out, key=lambda c: c.created_at)

    def thread(self, thread_id: str) -> list[_Comment]:
        with self._lock:
            ids = self._threads.get(thread_id, [])
            return [self._comments[i] for i in ids if i in self._comments and not self._comments[i].deleted]

    def search(self, query: str, *, limit: int = 20) -> list[_Comment]:
        q = query.lower()
        with self._lock:
            hits = [c for c in self._comments.values() if not c.deleted and q in c.body.lower()]
            return sorted(hits, key=lambda c: -c.updated_at)[:limit]

    def stats(self) -> dict[str, Any]:
        with self._lock:
            total = sum(1 for c in self._comments.values() if not c.deleted)
            resolved = sum(1 for c in self._comments.values() if not c.deleted and c.resolved)
            by_entity: dict[str, int] = {}
            for c in self._comments.values():
                if c.deleted or c.parent_id:
                    continue
                by_entity[c.entity_type] = by_entity.get(c.entity_type, 0) + 1
            return {
                "total_comments": total,
                "resolved": resolved,
                "unresolved": total - resolved,
                "threads": len(self._threads),
                "by_entity_type": by_entity,
            }


def _info(c: _Comment, *, replies: list[_Comment] | None = None) -> CommentInfo:
    return CommentInfo(
        id=c.id, thread_id=c.thread_id, entity_type=c.entity_type, entity_id=c.entity_id,
        parent_id=c.parent_id, body=c.body, author=c.author, created_at=c.created_at,
        updated_at=c.updated_at, resolved=c.resolved, resolved_by=c.resolved_by,
        resolved_at=c.resolved_at, anchor=c.anchor, reactions=dict(c.reactions),
        replies_count=len(c.reply_ids), mentions=_MENTION_RE.findall(c.body),
    )


_manager: CommentManager | None = None


def get_comment_manager() -> CommentManager:
    global _manager
    if _manager is None:
        _manager = CommentManager()
    return _manager


__all__ = [
    "CommentManager", "CommentCreate", "CommentUpdate", "ReactionCreate", "CommentInfo",
    "get_comment_manager", "_info",
]

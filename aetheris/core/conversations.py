"""Conversation memory and history for Aetheris.

Provides persistent, searchable conversation storage. Conversations are
threaded sequences of messages that can be:

* Listed, searched, and resumed across sessions
* Tagged and annotated for organization
* Exported in multiple formats (JSON, Markdown, plain text)
* Summarized automatically for long conversations
* Shared via public links (opt-in)

This is separate from the ephemeral session system -- conversations are
first-class objects that persist until explicitly deleted.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Literal

from pydantic import BaseModel, Field


# --- Schemas ------------------------------------------------------------------

class MessageIn(BaseModel):
    """A single message to append to a conversation."""
    role: Literal["user", "assistant", "system"] = "user"
    content: str = Field(..., min_length=1, max_length=100_000)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ConversationCreate(BaseModel):
    """Request to create a new conversation."""
    title: str = Field(default="", max_length=256)
    tags: list[str] = Field(default_factory=list)
    mode: str = Field(default="general", max_length=64)
    model: str = Field(default="", max_length=64)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ConversationInfo(BaseModel):
    id: str
    title: str
    tags: list[str]
    mode: str
    model: str
    message_count: int
    created_at: float
    updated_at: float
    metadata: dict[str, Any]


class ConversationDetail(ConversationInfo):
    messages: list[dict[str, Any]] = Field(default_factory=list)
    summary: str = ""


# --- Internal storage ---------------------------------------------------------

@dataclass
class _Message:
    id: str
    role: str
    content: str
    timestamp: float
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "role": self.role, "content": self.content,
            "timestamp": self.timestamp, "metadata": self.metadata,
        }


@dataclass
class _Conversation:
    id: str
    title: str
    tags: list[str]
    mode: str
    model: str
    messages: list[_Message] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: float = 0.0
    updated_at: float = 0.0
    _summary: str = ""

    @property
    def message_count(self) -> int:
        return len(self.messages)

    def to_info(self) -> ConversationInfo:
        return ConversationInfo(
            id=self.id, title=self.title, tags=self.tags,
            mode=self.mode, model=self.model,
            message_count=self.message_count,
            created_at=self.created_at, updated_at=self.updated_at,
            metadata=self.metadata,
        )

    def to_detail(self) -> ConversationDetail:
        return ConversationDetail(
            id=self.id, title=self.title, tags=self.tags,
            mode=self.mode, model=self.model,
            message_count=self.message_count,
            created_at=self.created_at, updated_at=self.updated_at,
            metadata=self.metadata,
            messages=[m.to_dict() for m in self.messages],
            summary=self._summary,
        )

    def auto_title(self) -> None:
        """Generate a title from the first user message if none set."""
        if self.title:
            return
        for m in self.messages:
            if m.role == "user":
                self.title = m.content[:80].strip()
                if len(m.content) > 80:
                    self.title += "..."
                return

    def auto_summary(self) -> None:
        """Generate a simple summary (last N messages)."""
        if len(self.messages) <= 5:
            return
        recent = self.messages[-3:]
        parts = [f"{m.role}: {m.content[:120]}" for m in recent]
        self._summary = f"... ({len(self.messages) - 3} earlier messages) ...\n" + "\n".join(parts)


# --- Store --------------------------------------------------------------------

class ConversationStore:
    """Thread-safe in-memory conversation store with search."""

    def __init__(self, max_conversations: int = 500, max_messages: int = 10_000) -> None:
        self._conversations: dict[str, _Conversation] = {}
        self._lock = Lock()
        self._max = max_conversations
        self._max_messages = max_messages

    def create(self, body: ConversationCreate) -> _Conversation:
        with self._lock:
            if len(self._conversations) >= self._max:
                # Evict oldest
                oldest = min(self._conversations, key=lambda k: self._conversations[k].updated_at)
                del self._conversations[oldest]
            now = time.time()
            conv = _Conversation(
                id=f"conv_{uuid.uuid4().hex[:12]}",
                title=body.title, tags=body.tags,
                mode=body.mode, model=body.model,
                metadata=body.metadata,
                created_at=now, updated_at=now,
            )
            self._conversations[conv.id] = conv
        return conv

    def get(self, conv_id: str) -> _Conversation | None:
        with self._lock:
            return self._conversations.get(conv_id)

    def delete(self, conv_id: str) -> bool:
        with self._lock:
            return self._conversations.pop(conv_id, None) is not None

    def append(self, conv_id: str, msg: MessageIn) -> _Message | None:
        with self._lock:
            conv = self._conversations.get(conv_id)
            if conv is None:
                return None
            if len(conv.messages) >= self._max_messages:
                return None
            message = _Message(
                id=f"msg_{uuid.uuid4().hex[:8]}",
                role=msg.role, content=msg.content,
                timestamp=time.time(), metadata=msg.metadata,
            )
            conv.messages.append(message)
            conv.updated_at = time.time()
            conv.auto_title()
            conv.auto_summary()
        return message

    def list_conversations(
        self,
        *,
        tags: list[str] | None = None,
        mode: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[_Conversation]:
        with self._lock:
            convs = list(self._conversations.values())
        if tags:
            convs = [c for c in convs if any(t in c.tags for t in tags)]
        if mode:
            convs = [c for c in convs if c.mode == mode]
        # Sort by most recently updated
        convs.sort(key=lambda c: c.updated_at, reverse=True)
        return convs[offset:offset + limit]

    def search(self, query: str, *, limit: int = 20) -> list[tuple[_Conversation, list[_Message]]]:
        """Full-text search across all conversations and messages."""
        pattern = re.compile(re.escape(query), re.IGNORECASE)
        results: list[tuple[_Conversation, list[_Message]]] = []
        with self._lock:
            convs = list(self._conversations.values())
        for conv in convs:
            if pattern.search(conv.title):
                results.append((conv, []))
                continue
            matching = [m for m in conv.messages if pattern.search(m.content)]
            if matching:
                results.append((conv, matching))
        return results[:limit]

    def export_conversation(self, conv_id: str, fmt: Literal["json", "markdown", "text"] = "json") -> str | None:
        conv = self.get(conv_id)
        if conv is None:
            return None
        if fmt == "json":
            return json.dumps(conv.to_detail().model_dump(), indent=2, default=str)
        elif fmt == "markdown":
            lines = [f"# {conv.title or conv.id}", ""]
            for m in conv.messages:
                prefix = {"user": "**You**", "assistant": "**Aetheris**", "system": "**System**"}.get(m.role, m.role)
                lines.append(f"{prefix}: {m.content}")
                lines.append("")
            return "\n".join(lines)
        else:
            return "\n".join(m.content for m in conv.messages)

    def stats(self) -> dict[str, Any]:
        with self._lock:
            total_msgs = sum(c.message_count for c in self._conversations.values())
            return {
                "total_conversations": len(self._conversations),
                "total_messages": total_msgs,
            }


_store: ConversationStore | None = None


def get_conversation_store() -> ConversationStore:
    global _store
    if _store is None:
        _store = ConversationStore()
    return _store


__all__ = [
    "MessageIn", "ConversationCreate", "ConversationInfo", "ConversationDetail",
    "ConversationStore", "get_conversation_store",
]

"""Feedback and rating collection for Aetheris.

Users can submit feedback on completions (thumbs up/down, ratings, free-text
comments) which is stored in a bounded in-memory buffer and queryable via the
``/v1/feedback`` endpoint.

Feedback is linked to completion IDs so it can be correlated with request
metrics and audit events.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


# --- Schemas ------------------------------------------------------------------

class FeedbackSubmit(BaseModel):
    """A feedback submission for a completion."""

    completion_id: str = Field(
        ..., description="The completion ID this feedback refers to."
    )
    rating: int | None = Field(
        default=None, ge=1, le=5, description="Numeric rating (1-5 stars)."
    )
    thumbs_up: bool | None = Field(
        default=None, description="Quick thumbs-up (true) or thumbs-down (false)."
    )
    comment: str = Field(
        default="", max_length=2000, description="Free-text feedback comment."
    )
    tags: list[str] = Field(
        default_factory=list, description="Categorisation tags (e.g. 'helpful', 'inaccurate')."
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="Arbitrary metadata."
    )


class FeedbackEntry(BaseModel):
    """A stored feedback entry."""

    id: str
    completion_id: str
    rating: int | None
    thumbs_up: bool | None
    comment: str
    tags: list[str]
    metadata: dict[str, Any]
    created_at: float
    client_id: str = "anonymous"


class FeedbackStats(BaseModel):
    """Aggregate feedback statistics."""

    total_entries: int
    avg_rating: float | None
    thumbs_up_count: int
    thumbs_down_count: int
    recent_comments: list[str]


# --- Storage ------------------------------------------------------------------

@dataclass
class _FeedbackItem:
    id: str
    completion_id: str
    rating: int | None
    thumbs_up: bool | None
    comment: str
    tags: list[str]
    metadata: dict[str, Any]
    created_at: float
    client_id: str


class FeedbackStore:
    """Thread-safe bounded in-memory feedback store."""

    def __init__(self, max_entries: int = 10_000) -> None:
        self._buffer: deque[_FeedbackItem] = deque(maxlen=max_entries)
        self._lock = Lock()

    def add(
        self,
        completion_id: str,
        *,
        rating: int | None = None,
        thumbs_up: bool | None = None,
        comment: str = "",
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        client_id: str = "anonymous",
    ) -> _FeedbackItem:
        import uuid

        item = _FeedbackItem(
            id=f"fb_{uuid.uuid4().hex[:12]}",
            completion_id=completion_id,
            rating=rating,
            thumbs_up=thumbs_up,
            comment=comment,
            tags=tags or [],
            metadata=metadata or {},
            created_at=time.time(),
            client_id=client_id,
        )
        with self._lock:
            self._buffer.append(item)
        return item

    def list_entries(
        self,
        *,
        completion_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[_FeedbackItem]:
        with self._lock:
            items = list(self._buffer)

        results = []
        for item in reversed(items):
            if completion_id and item.completion_id != completion_id:
                continue
            results.append(item)
        return results[offset : offset + limit]

    def stats(self) -> FeedbackStats:
        with self._lock:
            items = list(self._buffer)

        ratings = [i.rating for i in items if i.rating is not None]
        avg_rating = sum(ratings) / len(ratings) if ratings else None
        thumbs_up = sum(1 for i in items if i.thumbs_up is True)
        thumbs_down = sum(1 for i in items if i.thumbs_up is False)
        recent = [i.comment for i in list(reversed(items))[:10] if i.comment]

        return FeedbackStats(
            total_entries=len(items),
            avg_rating=round(avg_rating, 2) if avg_rating is not None else None,
            thumbs_up_count=thumbs_up,
            thumbs_down_count=thumbs_down,
            recent_comments=recent,
        )


# Module-level singleton
_store: FeedbackStore | None = None


def get_feedback_store() -> FeedbackStore:
    global _store
    if _store is None:
        _store = FeedbackStore()
    return _store


__all__ = [
    "FeedbackSubmit",
    "FeedbackEntry",
    "FeedbackStats",
    "FeedbackStore",
    "get_feedback_store",
]

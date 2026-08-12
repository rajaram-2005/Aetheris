"""Bookmark/pin system for Aetheris.

Allows users to bookmark (star/favourite) any entity — conversations, prompts,
files, workflows — and organise them into named collections for quick access.

Bookmarks store a reference to the entity (type + id) plus optional notes.
Collections are named groups of bookmarks, like folders.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Any, Literal

from pydantic import BaseModel, Field

EntityType = Literal["conversation", "prompt", "file", "workflow", "connection"]


class BookmarkCreate(BaseModel):
    """Create a bookmark."""
    entity_type: EntityType = Field(..., description="Type of entity being bookmarked.")
    entity_id: str = Field(..., min_length=1, description="ID of the entity.")
    notes: str = Field(default="", max_length=1000, description="Optional notes about this bookmark.")
    collection: str = Field(default="default", max_length=64, description="Collection to add the bookmark to.")


class BookmarkInfo(BaseModel):
    id: str
    entity_type: str
    entity_id: str
    notes: str
    collection: str
    created_at: float


class CollectionInfo(BaseModel):
    name: str
    bookmark_count: int
    created_at: float


# --- Internal -----------------------------------------------------------------

@dataclass
class _Bookmark:
    id: str
    entity_type: str
    entity_id: str
    notes: str
    collection: str
    created_at: float

    def to_info(self) -> BookmarkInfo:
        return BookmarkInfo(
            id=self.id, entity_type=self.entity_type, entity_id=self.entity_id,
            notes=self.notes, collection=self.collection, created_at=self.created_at,
        )


@dataclass
class _Collection:
    name: str
    created_at: float


# --- Store --------------------------------------------------------------------

class BookmarkStore:
    """Thread-safe in-memory bookmark store."""

    def __init__(self, max_bookmarks: int = 1000) -> None:
        self._bookmarks: dict[str, _Bookmark] = {}
        self._collections: dict[str, _Collection] = {}
        self._lock = Lock()
        self._max = max_bookmarks

    def create(self, body: BookmarkCreate) -> _Bookmark:
        with self._lock:
            if len(self._bookmarks) >= self._max:
                raise ValueError(f"Maximum of {self._max} bookmarks reached.")
            # Check for duplicate (same entity in same collection)
            for b in self._bookmarks.values():
                if b.entity_type == body.entity_type and b.entity_id == body.entity_id and b.collection == body.collection:
                    raise ValueError(f"Already bookmarked in collection '{body.collection}'.")
            # Ensure collection exists
            if body.collection not in self._collections:
                self._collections[body.collection] = _Collection(name=body.collection, created_at=time.time())
            bm = _Bookmark(
                id=f"bm_{uuid.uuid4().hex[:8]}",
                entity_type=body.entity_type, entity_id=body.entity_id,
                notes=body.notes, collection=body.collection,
                created_at=time.time(),
            )
            self._bookmarks[bm.id] = bm
        return bm

    def get(self, bm_id: str) -> _Bookmark | None:
        with self._lock:
            return self._bookmarks.get(bm_id)

    def delete(self, bm_id: str) -> bool:
        with self._lock:
            return self._bookmarks.pop(bm_id, None) is not None

    def list_bookmarks(
        self, *, collection: str | None = None, entity_type: str | None = None
    ) -> list[_Bookmark]:
        with self._lock:
            bms = list(self._bookmarks.values())
        if collection:
            bms = [b for b in bms if b.collection == collection]
        if entity_type:
            bms = [b for b in bms if b.entity_type == entity_type]
        return sorted(bms, key=lambda b: b.created_at, reverse=True)

    def list_collections(self) -> list[CollectionInfo]:
        with self._lock:
            result = []
            for name, coll in self._collections.items():
                count = sum(1 for b in self._bookmarks.values() if b.collection == name)
                result.append(CollectionInfo(name=name, bookmark_count=count, created_at=coll.created_at))
        return sorted(result, key=lambda c: c.name)

    def delete_collection(self, name: str) -> int:
        """Delete a collection and all its bookmarks. Returns count deleted."""
        with self._lock:
            to_remove = [bid for bid, b in self._bookmarks.items() if b.collection == name]
            for bid in to_remove:
                del self._bookmarks[bid]
            self._collections.pop(name, None)
        return len(to_remove)

    def is_bookmarked(self, entity_type: str, entity_id: str) -> bool:
        with self._lock:
            return any(b.entity_type == entity_type and b.entity_id == entity_id for b in self._bookmarks.values())

    def stats(self) -> dict[str, Any]:
        with self._lock:
            by_type: dict[str, int] = {}
            for b in self._bookmarks.values():
                by_type[b.entity_type] = by_type.get(b.entity_type, 0) + 1
            return {
                "total_bookmarks": len(self._bookmarks),
                "total_collections": len(self._collections),
                "by_entity_type": by_type,
            }


_store: BookmarkStore | None = None


def get_bookmark_store() -> BookmarkStore:
    global _store
    if _store is None:
        _store = BookmarkStore()
    return _store


__all__ = ["BookmarkStore", "BookmarkCreate", "BookmarkInfo", "CollectionInfo", "get_bookmark_store"]

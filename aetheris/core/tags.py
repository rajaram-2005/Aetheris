"""Universal tagging and taxonomy for Aetheris.

Provides a cross-entity tagging system that works on any entity type —
conversations, prompts, files, workflows, etc. Tags support:

* Free-form tag strings with normalisation (lowercased, whitespace-stripped)
* Tag clouds with entity counts for autocomplete / suggestion UIs
* Hierarchical categories (``python/web`` → implied ``python``)
* Bulk tag operations (add/remove tags on multiple entities)
* Tag-based filtering and discovery
"""

from __future__ import annotations

import re
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass
from threading import Lock
from typing import Any, Literal

from pydantic import BaseModel, Field

EntityType = Literal["conversation", "prompt", "file", "workflow", "connection", "preset", "bookmark"]


class TagAssignment(BaseModel):
    """Assign tags to an entity."""
    entity_type: EntityType = Field(..., description="Type of entity.")
    entity_id: str = Field(..., min_length=1, description="ID of the entity.")
    tags: list[str] = Field(..., min_length=1, description="Tags to assign.")
    replace: bool = Field(default=False, description="Replace existing tags (vs. append).")


class TagInfo(BaseModel):
    tag: str
    entity_count: int
    categories: list[str] = Field(default_factory=list, description="Parent categories for hierarchical tags.")


class TagCloudResult(BaseModel):
    tags: list[TagInfo]
    total_unique_tags: int
    total_assignments: int


class EntityTags(BaseModel):
    entity_type: str
    entity_id: str
    tags: list[str]


def _normalise_tag(tag: str) -> str:
    """Normalise a tag: lowercase, strip, collapse whitespace."""
    return re.sub(r"\s+", " ", tag.strip().lower())


def _extract_categories(tag: str) -> list[str]:
    """Extract parent categories from a hierarchical tag (e.g. 'python/web' → ['python'])."""
    parts = tag.split("/")
    if len(parts) <= 1:
        return []
    return ["/".join(parts[:i]) for i in range(1, len(parts))]


# --- Internal -----------------------------------------------------------------

@dataclass
class _TagAssignment:
    id: str
    entity_type: str
    entity_id: str
    tag: str
    created_at: float


# --- Manager ------------------------------------------------------------------

class TagManager:
    """Thread-safe universal tag manager."""

    def __init__(self, max_assignments: int = 50_000) -> None:
        self._assignments: dict[str, _TagAssignment] = {}
        # Index: (entity_type, entity_id) → set of tags
        self._entity_tags: dict[tuple[str, str], set[str]] = defaultdict(set)
        self._lock = Lock()
        self._max = max_assignments

    def assign(self, body: TagAssignment) -> EntityTags:
        """Assign tags to an entity."""
        key = (body.entity_type, body.entity_id)
        with self._lock:
            if body.replace:
                # Remove existing assignments for this entity
                to_remove = [aid for aid, a in self._assignments.items()
                             if a.entity_type == body.entity_type and a.entity_id == body.entity_id]
                for aid in to_remove:
                    del self._assignments[aid]
                self._entity_tags[key] = set()

            for raw_tag in body.tags:
                tag = _normalise_tag(raw_tag)
                if not tag:
                    continue
                if len(self._assignments) >= self._max:
                    raise ValueError(f"Maximum of {self._max} tag assignments reached.")
                if tag in self._entity_tags[key]:
                    continue  # Already assigned
                aid = f"tag_{uuid.uuid4().hex[:8]}"
                self._assignments[aid] = _TagAssignment(
                    id=aid, entity_type=body.entity_type,
                    entity_id=body.entity_id, tag=tag, created_at=time.time(),
                )
                self._entity_tags[key].add(tag)

        return EntityTags(
            entity_type=body.entity_type, entity_id=body.entity_id,
            tags=sorted(self._entity_tags[key]),
        )

    def remove_tags(self, entity_type: str, entity_id: str, tags: list[str]) -> int:
        """Remove specific tags from an entity. Returns count removed."""
        key = (entity_type, entity_id)
        removed = 0
        with self._lock:
            for raw_tag in tags:
                tag = _normalise_tag(raw_tag)
                to_remove = [aid for aid, a in self._assignments.items()
                             if a.entity_type == entity_type and a.entity_id == entity_id and a.tag == tag]
                for aid in to_remove:
                    del self._assignments[aid]
                    removed += 1
                self._entity_tags[key].discard(tag)
        return removed

    def get_tags(self, entity_type: str, entity_id: str) -> EntityTags:
        """Get all tags for an entity."""
        key = (entity_type, entity_id)
        with self._lock:
            tags = sorted(self._entity_tags.get(key, set()))
        return EntityTags(entity_type=entity_type, entity_id=entity_id, tags=tags)

    def tag_cloud(self, *, entity_type: str | None = None, limit: int = 100) -> TagCloudResult:
        """Get a tag cloud with entity counts."""
        with self._lock:
            tag_counts: dict[str, int] = defaultdict(int)
            for a in self._assignments.values():
                if entity_type and a.entity_type != entity_type:
                    continue
                tag_counts[a.tag] += 1

        items = []
        for tag, count in sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:limit]:
            categories = _extract_categories(tag)
            items.append(TagInfo(tag=tag, entity_count=count, categories=categories))

        return TagCloudResult(
            tags=items,
            total_unique_tags=len(tag_counts),
            total_assignments=sum(tag_counts.values()),
        )

    def autocomplete(self, prefix: str, *, entity_type: str | None = None, limit: int = 20) -> list[TagInfo]:
        """Autocomplete tags by prefix."""
        prefix = _normalise_tag(prefix)
        cloud = self.tag_cloud(entity_type=entity_type, limit=5000)
        matches = [t for t in cloud.tags if t.tag.startswith(prefix)]
        return matches[:limit]

    def find_by_tag(self, tag: str, *, entity_type: str | None = None, limit: int = 50) -> list[EntityTags]:
        """Find all entities with a given tag."""
        tag = _normalise_tag(tag)
        with self._lock:
            results = []
            seen: set[tuple[str, str]] = set()
            for a in self._assignments.values():
                if a.tag == tag and (entity_type is None or a.entity_type == entity_type):
                    key = (a.entity_type, a.entity_id)
                    if key not in seen:
                        seen.add(key)
                        results.append(EntityTags(
                            entity_type=a.entity_type, entity_id=a.entity_id,
                            tags=sorted(self._entity_tags[key]),
                        ))
        return results[:limit]

    def bulk_tag(self, entity_type: str, entity_ids: list[str], tags: list[str]) -> int:
        """Add tags to multiple entities. Returns count of assignments made."""
        count = 0
        for eid in entity_ids:
            result = self.assign(TagAssignment(entity_type=entity_type, entity_id=eid, tags=tags))
            count += len(result.tags)
        return count

    def stats(self) -> dict[str, Any]:
        with self._lock:
            by_type: dict[str, int] = defaultdict(int)
            for a in self._assignments.values():
                by_type[a.entity_type] = by_type.get(a.entity_type, 0) + 1
            return {
                "total_assignments": len(self._assignments),
                "total_entities_with_tags": len(self._entity_tags),
                "by_entity_type": dict(by_type),
            }


_manager: TagManager | None = None


def get_tag_manager() -> TagManager:
    global _manager
    if _manager is None:
        _manager = TagManager()
    return _manager


__all__ = ["TagManager", "TagAssignment", "TagInfo", "TagCloudResult", "EntityTags", "get_tag_manager"]

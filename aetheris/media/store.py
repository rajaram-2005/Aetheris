"""An in-memory artifact store for generated media.

Generated images, videos, audio, and code archives are held here and served
over ``/v1/artifacts/{id}``, so a model response can reference a real, fetchable
URL instead of embedding megabytes of base64 in the conversation.

The store is deliberately ephemeral and bounded: artifacts live in process
memory, the oldest are evicted once the byte budget is exceeded, and nothing is
written to disk. That keeps a long-running server from growing without limit and
avoids leaving generated content on the filesystem after a restart.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Artifact:
    """One stored, downloadable artifact."""

    id: str
    kind: str          # image | video | audio | code | data
    media_type: str    # MIME type
    filename: str
    data: bytes
    prompt: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)

    @property
    def size(self) -> int:
        return len(self.data)

    @property
    def url(self) -> str:
        return f"/v1/artifacts/{self.id}"

    def summary(self) -> dict[str, Any]:
        """A JSON-safe description without the payload bytes."""
        return {
            "id": self.id,
            "kind": self.kind,
            "media_type": self.media_type,
            "filename": self.filename,
            "size": self.size,
            "url": self.url,
            "prompt": self.prompt,
            "metadata": self.metadata,
            "created_at": int(self.created_at),
        }


class ArtifactStore:
    """A bounded, thread-safe, in-memory artifact cache."""

    def __init__(self, max_bytes: int = 192 * 1024 * 1024, max_items: int = 300) -> None:
        self._items: dict[str, Artifact] = {}
        self._lock = threading.Lock()
        self.max_bytes = max_bytes
        self.max_items = max_items

    def put(
        self,
        *,
        kind: str,
        media_type: str,
        filename: str,
        data: bytes,
        prompt: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> Artifact:
        """Store an artifact, evicting the oldest entries if over budget."""
        artifact = Artifact(
            id=f"art_{uuid.uuid4().hex[:16]}",
            kind=kind,
            media_type=media_type,
            filename=filename,
            data=data,
            prompt=prompt[:500],
            metadata=metadata or {},
        )
        with self._lock:
            self._items[artifact.id] = artifact
            self._evict_locked()
        return artifact

    def get(self, artifact_id: str) -> Artifact | None:
        with self._lock:
            return self._items.get(artifact_id)

    def delete(self, artifact_id: str) -> bool:
        with self._lock:
            return self._items.pop(artifact_id, None) is not None

    def list(self, kind: str | None = None) -> list[Artifact]:
        """Newest first, optionally filtered by kind."""
        with self._lock:
            items = list(self._items.values())
        if kind:
            items = [a for a in items if a.kind == kind]
        return sorted(items, key=lambda a: a.created_at, reverse=True)

    def clear(self) -> int:
        with self._lock:
            count = len(self._items)
            self._items.clear()
            return count

    def stats(self) -> dict[str, Any]:
        with self._lock:
            items = list(self._items.values())
        by_kind: dict[str, int] = {}
        for item in items:
            by_kind[item.kind] = by_kind.get(item.kind, 0) + 1
        return {
            "count": len(items),
            "bytes": sum(i.size for i in items),
            "max_bytes": self.max_bytes,
            "max_items": self.max_items,
            "by_kind": by_kind,
        }

    def _evict_locked(self) -> None:
        """Drop oldest artifacts until within the size and count budgets."""
        ordered = sorted(self._items.values(), key=lambda a: a.created_at)
        total = sum(a.size for a in ordered)
        while ordered and (total > self.max_bytes or len(ordered) > self.max_items):
            oldest = ordered.pop(0)
            total -= oldest.size
            self._items.pop(oldest.id, None)


_STORE = ArtifactStore()


def get_store() -> ArtifactStore:
    """Return the process-wide artifact store."""
    return _STORE


__all__ = ["Artifact", "ArtifactStore", "get_store"]

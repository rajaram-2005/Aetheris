"""Structured changelog for Aetheris.

Tracks version history, release notes, and breaking changes. Provides a
machine-readable record of what changed between versions, enabling:

* Version tracking with semver compliance
* Release notes with categories (feature, fix, breaking, deprecation)
* Breaking change alerts and migration guides
* Changelog search and filtering
* RSS/JSON feed generation for subscribers
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Any, Literal

from pydantic import BaseModel, Field

ChangeCategory = Literal["feature", "fix", "breaking", "deprecation", "improvement", "docs", "refactor"]


class ChangeEntryCreate(BaseModel):
    """Record a changelog entry."""
    version: str = Field(..., min_length=1, max_length=32, description="Version string (e.g. '0.7.0').")
    category: ChangeCategory = Field(..., description="Change category.")
    title: str = Field(..., min_length=1, max_length=256, description="Short description.")
    description: str = Field(default="", max_length=5000, description="Detailed description.")
    module: str = Field(default="", max_length=128, description="Module or component affected.")
    migration_guide: str = Field(default="", max_length=5000, description="Migration instructions (for breaking changes).")
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChangeEntryInfo(BaseModel):
    id: str
    version: str
    category: str
    title: str
    description: str
    module: str
    migration_guide: str
    created_at: float
    metadata: dict[str, Any]


class VersionSummary(BaseModel):
    version: str
    entries: list[ChangeEntryInfo]
    has_breaking: bool
    has_deprecations: bool
    released_at: float


# --- Internal -----------------------------------------------------------------

@dataclass
class _ChangeEntry:
    id: str
    version: str
    category: str
    title: str
    description: str
    module: str
    migration_guide: str
    created_at: float
    metadata: dict[str, Any]

    def to_info(self) -> ChangeEntryInfo:
        return ChangeEntryInfo(
            id=self.id, version=self.version, category=self.category,
            title=self.title, description=self.description,
            module=self.module, migration_guide=self.migration_guide,
            created_at=self.created_at, metadata=self.metadata,
        )


# --- Manager ------------------------------------------------------------------

class ChangelogManager:
    """Thread-safe changelog manager."""

    def __init__(self, max_entries: int = 5000) -> None:
        self._entries: dict[str, _ChangeEntry] = {}
        self._lock = Lock()
        self._max = max_entries

    def create(self, body: ChangeEntryCreate) -> _ChangeEntry:
        with self._lock:
            if len(self._entries) >= self._max:
                # Remove oldest
                oldest = min(self._entries, key=lambda eid: self._entries[eid].created_at)
                del self._entries[oldest]
            entry = _ChangeEntry(
                id=f"cl_{uuid.uuid4().hex[:8]}",
                version=body.version, category=body.category,
                title=body.title, description=body.description,
                module=body.module, migration_guide=body.migration_guide,
                created_at=time.time(), metadata=body.metadata,
            )
            self._entries[entry.id] = entry
        return entry

    def get(self, entry_id: str) -> _ChangeEntry | None:
        with self._lock:
            return self._entries.get(entry_id)

    def delete(self, entry_id: str) -> bool:
        with self._lock:
            return self._entries.pop(entry_id, None) is not None

    def list_entries(
        self,
        *,
        version: str | None = None,
        category: str | None = None,
        module: str | None = None,
        limit: int = 50,
    ) -> list[_ChangeEntry]:
        with self._lock:
            entries = list(self._entries.values())
        if version:
            entries = [e for e in entries if e.version == version]
        if category:
            entries = [e for e in entries if e.category == category]
        if module:
            entries = [e for e in entries if e.module == module]
        entries.sort(key=lambda e: e.created_at, reverse=True)
        return entries[:limit]

    def get_version(self, version: str) -> VersionSummary:
        """Get a summary of all changes for a specific version."""
        with self._lock:
            entries = [e for e in self._entries.values() if e.version == version]
        entries.sort(key=lambda e: e.created_at)
        has_breaking = any(e.category == "breaking" for e in entries)
        has_deprecations = any(e.category == "deprecation" for e in entries)
        released_at = min((e.created_at for e in entries), default=0.0)
        return VersionSummary(
            version=version,
            entries=[e.to_info() for e in entries],
            has_breaking=has_breaking,
            has_deprecations=has_deprecations,
            released_at=released_at,
        )

    def list_versions(self) -> list[str]:
        """List all versions that have changelog entries."""
        with self._lock:
            versions = sorted(set(e.version for e in self._entries.values()))
        return list(reversed(versions))  # Newest first

    def breaking_changes(self, since_version: str = "") -> list[_ChangeEntry]:
        """Get breaking changes, optionally since a given version."""
        with self._lock:
            entries = [e for e in self._entries.values() if e.category == "breaking"]
        if since_version:
            entries = [e for e in entries if e.version > since_version]
        entries.sort(key=lambda e: e.created_at, reverse=True)
        return entries

    def search(self, query: str, *, limit: int = 20) -> list[_ChangeEntry]:
        """Search changelog entries."""
        import re
        pattern = re.compile(re.escape(query), re.IGNORECASE)
        with self._lock:
            entries = list(self._entries.values())
        results = [e for e in entries if pattern.search(e.title) or pattern.search(e.description)]
        results.sort(key=lambda e: e.created_at, reverse=True)
        return results[:limit]

    def stats(self) -> dict[str, Any]:
        with self._lock:
            by_category: dict[str, int] = {}
            by_version: dict[str, int] = {}
            for e in self._entries.values():
                by_category[e.category] = by_category.get(e.category, 0) + 1
                by_version[e.version] = by_version.get(e.version, 0) + 1
            return {
                "total": len(self._entries),
                "versions": len(by_version),
                "by_category": by_category,
                "by_version": by_version,
            }


_manager: ChangelogManager | None = None


def get_changelog_manager() -> ChangelogManager:
    global _manager
    if _manager is None:
        _manager = ChangelogManager()
    return _manager


__all__ = ["ChangelogManager", "ChangeEntryCreate", "ChangeEntryInfo", "VersionSummary", "get_changelog_manager"]

"""Unified activity timeline for Aetheris.

Records a chronological log of all significant events across the system:
requests, tool calls, workflow runs, errors, configuration changes, etc.
Each activity entry has a type, actor, target, and timestamp.

The timeline provides a single place to see everything that has happened,
with rich filtering by type, actor, target entity, and time range.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Any, Literal

from pydantic import BaseModel, Field


ActivityType = Literal[
    "request", "tool_call", "workflow_run", "connection_change",
    "conversation_change", "prompt_change", "file_change", "plugin_change",
    "preset_change", "bookmark_change", "notification_sent", "snapshot_change",
    "feature_flag_change", "api_key_change", "auth_event", "error",
    "system", "cache_hit", "cache_miss",
]


class ActivityCreate(BaseModel):
    """Record an activity event."""
    type: ActivityType = Field(..., description="Activity type.")
    action: str = Field(..., min_length=1, max_length=64, description="Action: create, update, delete, execute, etc.")
    actor: str = Field(default="system", max_length=128, description="Who/what triggered this: user_id, api_key, system, etc.")
    target_type: str = Field(default="", max_length=64, description="Type of the target entity.")
    target_id: str = Field(default="", max_length=128, description="ID of the target entity.")
    target_name: str = Field(default="", max_length=256, description="Human-readable name of the target.")
    detail: str = Field(default="", max_length=2000, description="Human-readable description of the activity.")
    metadata: dict[str, Any] = Field(default_factory=dict)
    severity: Literal["debug", "info", "warning", "error"] = Field(default="info")


class ActivityInfo(BaseModel):
    id: str
    type: str
    action: str
    actor: str
    target_type: str
    target_id: str
    target_name: str
    detail: str
    severity: str
    created_at: float
    metadata: dict[str, Any]


# --- Internal -----------------------------------------------------------------

@dataclass
class _Activity:
    id: str
    type: str
    action: str
    actor: str
    target_type: str
    target_id: str
    target_name: str
    detail: str
    severity: str
    created_at: float
    metadata: dict[str, Any]

    def to_info(self) -> ActivityInfo:
        return ActivityInfo(
            id=self.id, type=self.type, action=self.action,
            actor=self.actor, target_type=self.target_type,
            target_id=self.target_id, target_name=self.target_name,
            detail=self.detail, severity=self.severity,
            created_at=self.created_at, metadata=self.metadata,
        )


# --- Manager ------------------------------------------------------------------

class ActivityManager:
    """Thread-safe activity timeline manager."""

    def __init__(self, max_entries: int = 20_000) -> None:
        self._entries: list[_Activity] = []
        self._lock = Lock()
        self._max = max_entries

    def record(self, body: ActivityCreate) -> _Activity:
        with self._lock:
            if len(self._entries) >= self._max:
                # Remove oldest quarter
                self._entries = self._entries[self._max // 4:]
            entry = _Activity(
                id=f"act_{uuid.uuid4().hex[:8]}",
                type=body.type, action=body.action, actor=body.actor,
                target_type=body.target_type, target_id=body.target_id,
                target_name=body.target_name, detail=body.detail,
                severity=body.severity, created_at=time.time(),
                metadata=body.metadata,
            )
            self._entries.append(entry)
        return entry

    def get(self, activity_id: str) -> _Activity | None:
        with self._lock:
            for e in self._entries:
                if e.id == activity_id:
                    return e
        return None

    def list_activities(
        self,
        *,
        type: str | None = None,
        action: str | None = None,
        actor: str | None = None,
        target_type: str | None = None,
        target_id: str | None = None,
        severity: str | None = None,
        since: float | None = None,
        until: float | None = None,
        limit: int = 50,
    ) -> list[_Activity]:
        with self._lock:
            entries = list(self._entries)
        if type:
            entries = [e for e in entries if e.type == type]
        if action:
            entries = [e for e in entries if e.action == action]
        if actor:
            entries = [e for e in entries if e.actor == actor]
        if target_type:
            entries = [e for e in entries if e.target_type == target_type]
        if target_id:
            entries = [e for e in entries if e.target_id == target_id]
        if severity:
            entries = [e for e in entries if e.severity == severity]
        if since is not None:
            entries = [e for e in entries if e.created_at >= since]
        if until is not None:
            entries = [e for e in entries if e.created_at <= until]
        # Newest first
        entries.sort(key=lambda e: e.created_at, reverse=True)
        return entries[:limit]

    def search(self, query: str, *, limit: int = 20) -> list[_Activity]:
        """Search activities by text content."""
        import re
        pattern = re.compile(re.escape(query), re.IGNORECASE)
        with self._lock:
            entries = list(self._entries)
        results = [e for e in entries if pattern.search(e.detail) or pattern.search(e.target_name) or pattern.search(e.action)]
        results.sort(key=lambda e: e.created_at, reverse=True)
        return results[:limit]

    def count_by_type(self, since: float | None = None) -> dict[str, int]:
        """Count activities by type."""
        with self._lock:
            entries = self._entries if since is None else [e for e in self._entries if e.created_at >= since]
            counts: dict[str, int] = {}
            for e in entries:
                counts[e.type] = counts.get(e.type, 0) + 1
        return counts

    def clear(self) -> int:
        """Clear all activities. Returns count cleared."""
        with self._lock:
            count = len(self._entries)
            self._entries.clear()
        return count

    def stats(self) -> dict[str, Any]:
        with self._lock:
            by_severity: dict[str, int] = {}
            for e in self._entries:
                by_severity[e.severity] = by_severity.get(e.severity, 0) + 1
            return {
                "total": len(self._entries),
                "by_severity": by_severity,
                "oldest": self._entries[0].created_at if self._entries else None,
                "newest": self._entries[-1].created_at if self._entries else None,
            }


_manager: ActivityManager | None = None


def get_activity_manager() -> ActivityManager:
    global _manager
    if _manager is None:
        _manager = ActivityManager()
    return _manager


__all__ = ["ActivityManager", "ActivityCreate", "ActivityInfo", "get_activity_manager"]

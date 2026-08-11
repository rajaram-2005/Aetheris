"""In-app notification centre for Aetheris.

Provides a lightweight notification system for workflow completions, errors,
system alerts, and other events that users should be aware of. Notifications
are stored in-memory, can be marked as read, and queried with filters.

Notification types:
* ``info`` — General information
* ``success`` — Operation completed successfully
* ``warning`` — Something needs attention
* ``error`` — An error occurred
* ``system`` — System-level notification
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Any, Literal

from pydantic import BaseModel, Field

NotificationType = Literal["info", "success", "warning", "error", "system"]


class NotificationCreate(BaseModel):
    """Create a notification."""
    type: NotificationType = Field(default="info", description="Notification type.")
    title: str = Field(..., min_length=1, max_length=256, description="Short title.")
    message: str = Field(default="", max_length=2000, description="Detailed message.")
    source: str = Field(default="", max_length=128, description="Source (e.g. 'workflow:deploy').")
    entity_type: str = Field(default="", max_length=64, description="Related entity type.")
    entity_id: str = Field(default="", max_length=128, description="Related entity ID.")
    priority: int = Field(default=0, ge=0, le=10, description="Priority (0=low, 10=critical).")
    metadata: dict[str, Any] = Field(default_factory=dict)


class NotificationInfo(BaseModel):
    id: str
    type: str
    title: str
    message: str
    source: str
    entity_type: str
    entity_id: str
    priority: int
    read: bool
    created_at: float
    read_at: float | None
    metadata: dict[str, Any]


# --- Internal -----------------------------------------------------------------

@dataclass
class _Notification:
    id: str
    type: str
    title: str
    message: str
    source: str
    entity_type: str
    entity_id: str
    priority: int
    read: bool
    created_at: float
    read_at: float | None
    metadata: dict[str, Any]

    def to_info(self) -> NotificationInfo:
        return NotificationInfo(
            id=self.id, type=self.type, title=self.title, message=self.message,
            source=self.source, entity_type=self.entity_type, entity_id=self.entity_id,
            priority=self.priority, read=self.read, created_at=self.created_at,
            read_at=self.read_at, metadata=self.metadata,
        )


# --- Manager ------------------------------------------------------------------

class NotificationManager:
    """Thread-safe in-memory notification manager."""

    def __init__(self, max_notifications: int = 5000) -> None:
        self._notifications: dict[str, _Notification] = {}
        self._lock = Lock()
        self._max = max_notifications

    def create(self, body: NotificationCreate) -> _Notification:
        with self._lock:
            if len(self._notifications) >= self._max:
                # Remove oldest read notifications first
                read_ids = [nid for nid, n in self._notifications.items() if n.read]
                if read_ids:
                    oldest = min(read_ids, key=lambda nid: self._notifications[nid].created_at)
                    del self._notifications[oldest]
                else:
                    oldest_id = min(self._notifications, key=lambda nid: self._notifications[nid].created_at)
                    del self._notifications[oldest_id]
            n = _Notification(
                id=f"notif_{uuid.uuid4().hex[:8]}",
                type=body.type, title=body.title, message=body.message,
                source=body.source, entity_type=body.entity_type,
                entity_id=body.entity_id, priority=body.priority,
                read=False, created_at=time.time(), read_at=None,
                metadata=body.metadata,
            )
            self._notifications[n.id] = n
        return n

    def get(self, notif_id: str) -> _Notification | None:
        with self._lock:
            return self._notifications.get(notif_id)

    def mark_read(self, notif_id: str) -> _Notification | None:
        with self._lock:
            n = self._notifications.get(notif_id)
            if n is None:
                return None
            n.read = True
            n.read_at = time.time()
        return n

    def mark_all_read(self) -> int:
        """Mark all unread notifications as read. Returns count marked."""
        now = time.time()
        with self._lock:
            count = 0
            for n in self._notifications.values():
                if not n.read:
                    n.read = True
                    n.read_at = now
                    count += 1
        return count

    def delete(self, notif_id: str) -> bool:
        with self._lock:
            return self._notifications.pop(notif_id, None) is not None

    def list_notifications(
        self,
        *,
        type: str | None = None,
        read: bool | None = None,
        source: str | None = None,
        priority_min: int | None = None,
        limit: int = 50,
    ) -> list[_Notification]:
        with self._lock:
            notifs = list(self._notifications.values())
        if type:
            notifs = [n for n in notifs if n.type == type]
        if read is not None:
            notifs = [n for n in notifs if n.read == read]
        if source:
            notifs = [n for n in notifs if n.source == source]
        if priority_min is not None:
            notifs = [n for n in notifs if n.priority >= priority_min]
        # Sort by created_at descending (newest first)
        notifs.sort(key=lambda n: n.created_at, reverse=True)
        return notifs[:limit]

    def unread_count(self) -> int:
        with self._lock:
            return sum(1 for n in self._notifications.values() if not n.read)

    def stats(self) -> dict[str, Any]:
        with self._lock:
            by_type: dict[str, int] = {}
            for n in self._notifications.values():
                by_type[n.type] = by_type.get(n.type, 0) + 1
            return {
                "total": len(self._notifications),
                "unread": sum(1 for n in self._notifications.values() if not n.read),
                "by_type": by_type,
            }


_manager: NotificationManager | None = None


def get_notification_manager() -> NotificationManager:
    global _manager
    if _manager is None:
        _manager = NotificationManager()
    return _manager


__all__ = ["NotificationManager", "NotificationCreate", "NotificationInfo", "get_notification_manager"]

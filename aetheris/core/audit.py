"""Audit logging for Aetheris.

Records structured audit events for every API request, tool execution, and
security-relevant action. Events are written to the standard Python logger
(audit.aetheris) in JSON format so they can be consumed by SIEM systems,
log aggregators, or the ``/v1/audit`` endpoint.

Audit events are retained in a bounded in-memory ring buffer (configurable
via ``AETHERIS_AUDIT_MAX_ENTRIES``) and can be queried through the API.
"""

from __future__ import annotations

import json
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

AUDIT_LOGGER = logging.getLogger("audit.aetheris")


@dataclass
class AuditEvent:
    """A single structured audit event."""

    timestamp: float
    event_type: str  # "request", "tool_execution", "auth", "security", "system"
    action: str  # e.g. "chat_completion", "tool_invoke", "api_key_validated"
    actor: str  # client_id or "system"
    outcome: str  # "success", "failure", "denied", "error"
    details: dict[str, Any] = field(default_factory=dict)
    request_id: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    duration_ms: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "event_type": self.event_type,
            "action": self.action,
            "actor": self.actor,
            "outcome": self.outcome,
            "details": self.details,
            "request_id": self.request_id,
            "ip_address": self.ip_address,
            "user_agent": self.user_agent,
            "duration_ms": self.duration_ms,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), default=str)


class AuditLog:
    """Thread-safe bounded in-memory audit log."""

    def __init__(self, max_entries: int = 10_000) -> None:
        self._buffer: deque[AuditEvent] = deque(maxlen=max_entries)
        self._lock = Lock()
        self._max_entries = max_entries

    def record(self, event: AuditEvent) -> None:
        """Record an audit event (in-memory + structured log output)."""
        with self._lock:
            self._buffer.append(event)
        # Also emit to the structured logger for external consumption
        AUDIT_LOGGER.info(event.to_json())

    def query(
        self,
        *,
        event_type: str | None = None,
        actor: str | None = None,
        action: str | None = None,
        outcome: str | None = None,
        since: float | None = None,
        until: float | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AuditEvent]:
        """Query audit events with optional filters."""
        with self._lock:
            events = list(self._buffer)

        results: list[AuditEvent] = []
        for event in reversed(events):  # Newest first
            if event_type and event.event_type != event_type:
                continue
            if actor and event.actor != actor:
                continue
            if action and event.action != action:
                continue
            if outcome and event.outcome != outcome:
                continue
            if since and event.timestamp < since:
                continue
            if until and event.timestamp > until:
                continue
            results.append(event)

        return results[offset : offset + limit]

    def stats(self) -> dict[str, Any]:
        """Return audit log statistics."""
        with self._lock:
            total = len(self._buffer)
            by_type: dict[str, int] = {}
            by_outcome: dict[str, int] = {}
            for event in self._buffer:
                by_type[event.event_type] = by_type.get(event.event_type, 0) + 1
                by_outcome[event.outcome] = by_outcome.get(event.outcome, 0) + 1

        return {
            "total_entries": total,
            "max_entries": self._max_entries,
            "by_type": by_type,
            "by_outcome": by_outcome,
        }

    def clear(self) -> int:
        """Clear all audit entries and return the count removed."""
        with self._lock:
            count = len(self._buffer)
            self._buffer.clear()
        return count


# Module-level singleton
_audit: AuditLog | None = None


def get_audit() -> AuditLog:
    """Return the process-wide audit log (lazy init)."""
    global _audit
    if _audit is None:
        from .config import settings
        _audit = AuditLog(max_entries=settings.audit_max_entries)
    return _audit


def record_event(
    event_type: str,
    action: str,
    actor: str,
    outcome: str,
    **kwargs: Any,
) -> AuditEvent:
    """Convenience function to create and record an audit event."""
    event = AuditEvent(
        timestamp=time.time(),
        event_type=event_type,
        action=action,
        actor=actor,
        outcome=outcome,
        **kwargs,
    )
    get_audit().record(event)
    return event


__all__ = [
    "AuditEvent",
    "AuditLog",
    "get_audit",
    "record_event",
]

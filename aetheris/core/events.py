"""Internal event bus for Aetheris.

A lightweight pub/sub system that decouples producers (completions, tool
executions, workflow runs) from consumers (webhooks, workflow triggers,
audit, metrics). Events are dispatched synchronously to registered handlers
and optionally trigger matching workflows.

The event bus is the nervous system of the automation layer: when a chat
completion finishes, when a tool executes, when a workflow completes -- all
of these publish events. Any number of subscribers can react to each event
without the producer needing to know about them.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Callable, Awaitable

logger = logging.getLogger("aetheris.events")


@dataclass
class Event:
    """A single event on the bus."""

    id: str
    name: str
    timestamp: float
    data: dict[str, Any]
    source: str  # Who produced the event (e.g. "chat", "tool", "workflow")
    correlation_id: str | None = None  # Link related events together


EventHandler = Callable[[Event], Awaitable[None]]


class EventBus:
    """Async-compatible in-memory event bus."""

    def __init__(self, max_history: int = 5000) -> None:
        self._handlers: dict[str, list[EventHandler]] = {}
        self._wildcard_handlers: list[EventHandler] = []
        self._history: deque[Event] = deque(maxlen=max_history)
        self._lock = Lock()
        self._stats: dict[str, int] = {
            "published": 0,
            "delivered": 0,
            "errors": 0,
        }

    def subscribe(self, event_pattern: str, handler: EventHandler) -> None:
        """Register a handler for events matching a pattern.

        Use ``*`` to subscribe to all events.
        """
        if event_pattern == "*":
            self._wildcard_handlers.append(handler)
        else:
            self._handlers.setdefault(event_pattern, []).append(handler)

    def unsubscribe(self, event_pattern: str, handler: EventHandler) -> None:
        """Remove a handler."""
        if event_pattern == "*":
            self._wildcard_handlers = [h for h in self._wildcard_handlers if h is not handler]
        else:
            handlers = self._handlers.get(event_pattern, [])
            self._handlers[event_pattern] = [h for h in handlers if h is not handler]

    async def publish(
        self,
        name: str,
        data: dict[str, Any],
        *,
        source: str = "system",
        correlation_id: str | None = None,
    ) -> Event:
        """Publish an event and deliver it to all matching handlers."""
        event = Event(
            id=f"evt_{uuid.uuid4().hex[:12]}",
            name=name,
            timestamp=time.time(),
            data=data,
            source=source,
            correlation_id=correlation_id,
        )

        with self._lock:
            self._history.append(event)
            self._stats["published"] += 1

        # Collect matching handlers
        handlers: list[EventHandler] = list(self._wildcard_handlers)
        # Exact match
        handlers.extend(self._handlers.get(name, []))
        # Prefix match (e.g. "tool.*" matches "tool.executed")
        for pattern, pattern_handlers in self._handlers.items():
            if pattern.endswith(".*") and name.startswith(pattern[:-1]):
                handlers.extend(pattern_handlers)

        # Deliver (fire and forget -- errors are caught)
        for handler in handlers:
            try:
                await handler(event)
                with self._lock:
                    self._stats["delivered"] += 1
            except Exception as exc:
                logger.warning("Event handler error for %s: %s", name, exc)
                with self._lock:
                    self._stats["errors"] += 1

        # Also trigger matching workflows
        try:
            from .workflows import get_workflow_engine
            engine = get_workflow_engine()
            for wf in engine.list_workflows():
                if wf.trigger.type == "event" and wf.trigger.event_pattern:
                    pattern = wf.trigger.event_pattern
                    if pattern == name or (pattern.endswith(".*") and name.startswith(pattern[:-1])):
                        asyncio.create_task(engine.execute(wf.id, inputs={"event": event.data}))
        except Exception:
            pass  # Workflow triggering must never break the event bus

        return event

    def history(self, *, name: str | None = None, source: str | None = None, limit: int = 50) -> list[Event]:
        with self._lock:
            events = list(self._history)
        if name:
            events = [e for e in events if e.name == name]
        if source:
            events = [e for e in events if e.source == source]
        return list(reversed(events))[:limit]

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._stats)


_bus: EventBus | None = None


def get_event_bus() -> EventBus:
    global _bus
    if _bus is None:
        _bus = EventBus()
    return _bus


__all__ = ["Event", "EventHandler", "EventBus", "get_event_bus"]

"""Webhook management for Aetheris.

Operators can register webhook URLs that Aetheris will POST to when certain
events occur (completion finished, tool executed, error, etc.). Webhooks are
signed with HMAC-SHA256 so receivers can verify authenticity.

Webhooks are stored in-memory and must be re-registered after a server restart.
For production use, persist webhook registrations in an external store.
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
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger("aetheris.webhooks")


# --- Schemas ------------------------------------------------------------------

class WebhookRegister(BaseModel):
    """Registration request for a new webhook."""

    url: str = Field(..., description="HTTPS URL to POST events to.")
    events: list[str] = Field(
        default_factory=lambda: ["*"],
        description="Event types to subscribe to (e.g. 'completion', 'tool', 'error'), or ['*'] for all.",
    )
    secret: str = Field(
        default="",
        max_length=128,
        description="HMAC secret for payload signing. Auto-generated if empty.",
    )
    description: str = Field(default="", max_length=500)
    metadata: dict[str, Any] = Field(default_factory=dict)


class WebhookInfo(BaseModel):
    """Information about a registered webhook."""

    id: str
    url: str
    events: list[str]
    description: str
    created_at: float
    delivery_count: int
    failure_count: int
    last_delivery_at: float | None
    last_failure_at: float | None


class WebhookDelivery(BaseModel):
    """Record of a single webhook delivery attempt."""

    id: str
    webhook_id: str
    event_type: str
    status_code: int | None
    success: bool
    duration_ms: int
    timestamp: float
    error: str | None = None


# --- Storage ------------------------------------------------------------------

@dataclass
class _Webhook:
    id: str
    url: str
    events: list[str]
    secret: str
    description: str
    metadata: dict[str, Any]
    created_at: float
    delivery_count: int = 0
    failure_count: int = 0
    last_delivery_at: float | None = None
    last_failure_at: float | None = None


class WebhookManager:
    """In-memory webhook registry and async dispatcher."""

    def __init__(self, max_webhooks: int = 50, max_history: int = 1000) -> None:
        self._webhooks: dict[str, _Webhook] = {}
        self._history: deque[WebhookDelivery] = deque(maxlen=max_history)
        self._lock = Lock()
        self._max_webhooks = max_webhooks

    def register(self, reg: WebhookRegister) -> _Webhook:
        """Register a new webhook."""
        from .security import generate_nonce

        with self._lock:
            if len(self._webhooks) >= self._max_webhooks:
                raise ValueError(
                    f"Maximum of {self._max_webhooks} webhooks reached. "
                    "Delete an existing webhook before registering a new one."
                )
            wh = _Webhook(
                id=f"wh_{uuid.uuid4().hex[:12]}",
                url=reg.url,
                events=reg.events,
                secret=reg.secret or generate_nonce(16),
                description=reg.description,
                metadata=reg.metadata,
                created_at=time.time(),
            )
            self._webhooks[wh.id] = wh
        return wh

    def delete(self, webhook_id: str) -> bool:
        with self._lock:
            return self._webhooks.pop(webhook_id, None) is not None

    def list_webhooks(self) -> list[_Webhook]:
        with self._lock:
            return list(self._webhooks.values())

    def get(self, webhook_id: str) -> _Webhook | None:
        with self._lock:
            return self._webhooks.get(webhook_id)

    async def dispatch(self, event_type: str, payload: dict[str, Any]) -> None:
        """Dispatch an event to all matching webhooks."""
        import httpx
        from .security import sign_webhook_payload

        webhooks: list[_Webhook] = []
        with self._lock:
            for wh in self._webhooks.values():
                if "*" in wh.events or event_type in wh.events:
                    webhooks.append(wh)

        if not webhooks:
            return

        body = json.dumps({
            "event": event_type,
            "timestamp": time.time(),
            "data": payload,
        }).encode("utf-8")

        async def _deliver(wh: _Webhook) -> WebhookDelivery:
            delivery_id = f"dlv_{uuid.uuid4().hex[:10]}"
            started = time.time()
            try:
                signature = sign_webhook_payload(body, wh.secret)
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(
                        wh.url,
                        content=body,
                        headers={
                            "Content-Type": "application/json",
                            "X-Aetheris-Signature": f"sha256={signature}",
                            "X-Aetheris-Event": event_type,
                            "X-Aetheris-Delivery": delivery_id,
                        },
                    )
                duration_ms = int((time.time() - started) * 1000)
                success = 200 <= resp.status_code < 300
                with self._lock:
                    wh.delivery_count += 1
                    wh.last_delivery_at = time.time()
                    if not success:
                        wh.failure_count += 1
                        wh.last_failure_at = time.time()
                return WebhookDelivery(
                    id=delivery_id,
                    webhook_id=wh.id,
                    event_type=event_type,
                    status_code=resp.status_code,
                    success=success,
                    duration_ms=duration_ms,
                    timestamp=time.time(),
                )
            except Exception as exc:
                duration_ms = int((time.time() - started) * 1000)
                with self._lock:
                    wh.failure_count += 1
                    wh.last_failure_at = time.time()
                return WebhookDelivery(
                    id=delivery_id,
                    webhook_id=wh.id,
                    event_type=event_type,
                    status_code=None,
                    success=False,
                    duration_ms=duration_ms,
                    timestamp=time.time(),
                    error=str(exc),
                )

        results = await asyncio.gather(*[_deliver(wh) for wh in webhooks])
        with self._lock:
            for r in results:
                self._history.append(r)
                if not r.success:
                    logger.warning(
                        "Webhook delivery failed: %s → %s (%s)",
                        r.webhook_id, r.event_type, r.error or f"HTTP {r.status_code}",
                    )

    def delivery_history(self, limit: int = 50) -> list[WebhookDelivery]:
        with self._lock:
            items = list(self._history)
        return list(reversed(items))[:limit]


# Module-level singleton
_manager: WebhookManager | None = None


def get_webhook_manager() -> WebhookManager:
    global _manager
    if _manager is None:
        _manager = WebhookManager()
    return _manager


__all__ = [
    "WebhookRegister",
    "WebhookInfo",
    "WebhookDelivery",
    "WebhookManager",
    "get_webhook_manager",
]

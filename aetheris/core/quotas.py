"""Usage quotas for Aetheris.

Per-key and per-user token and request quotas with tiered limits and
enforcement. Enables operators to set consumption ceilings and track
usage against them.

Features:
* Define named quota tiers (e.g. free=1K tokens/day, pro=100K tokens/day)
* Assign tiers to API keys or user identifiers
* Real-time usage tracking against quota limits
* Quota enforcement (reject requests over limit)
* Reset windows (daily, hourly, per-request)
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass
from threading import Lock
from typing import Any, Literal

from pydantic import BaseModel, Field

ResetWindow = Literal["hourly", "daily", "monthly", "total"]


class QuotaTierCreate(BaseModel):
    """Define a quota tier."""
    name: str = Field(..., min_length=1, max_length=64, description="Tier name (e.g. 'free', 'pro').")
    description: str = Field(default="", max_length=500)
    max_tokens: int = Field(default=1_000_000, ge=0, description="Max tokens per window (0 = unlimited).")
    max_requests: int = Field(default=10_000, ge=0, description="Max requests per window (0 = unlimited).")
    window: ResetWindow = Field(default="daily", description="Reset window.")
    rate_limit: int = Field(default=60, ge=0, description="Requests per minute limit (0 = use global).")


class QuotaTierInfo(BaseModel):
    id: str
    name: str
    description: str
    max_tokens: int
    max_requests: int
    window: str
    rate_limit: int


class QuotaAssignmentCreate(BaseModel):
    """Assign a quota tier to an identifier."""
    identifier: str = Field(..., min_length=1, max_length=128, description="API key ID or user identifier.")
    tier_name: str = Field(..., description="Name of the quota tier to assign.")


class QuotaUsage(BaseModel):
    identifier: str
    tier_name: str
    tokens_used: int
    requests_used: int
    max_tokens: int
    max_requests: int
    window: str
    tokens_remaining: int
    requests_remaining: int
    is_over_quota: bool


# --- Internal -----------------------------------------------------------------

@dataclass
class _QuotaTier:
    id: str
    name: str
    description: str
    max_tokens: int
    max_requests: int
    window: str
    rate_limit: int

    def to_info(self) -> QuotaTierInfo:
        return QuotaTierInfo(
            id=self.id, name=self.name, description=self.description,
            max_tokens=self.max_tokens, max_requests=self.max_requests,
            window=self.window, rate_limit=self.rate_limit,
        )


@dataclass
class _UsageRecord:
    tokens: int = 0
    requests: int = 0
    window_start: float = 0.0


def _window_seconds(window: str) -> float:
    return {"hourly": 3600, "daily": 86400, "monthly": 86400 * 30, "total": float("inf")}.get(window, 86400)


def _default_usage(identifier: str) -> QuotaUsage:
    return QuotaUsage(
        identifier=identifier, tier_name="default",
        tokens_used=0, requests_used=0,
        max_tokens=0, max_requests=0, window="total",
        tokens_remaining=0, requests_remaining=0,
        is_over_quota=False,
    )


# --- Manager ------------------------------------------------------------------

class QuotaManager:
    """Thread-safe usage quota manager."""

    def __init__(self) -> None:
        self._tiers: dict[str, _QuotaTier] = {}
        self._assignments: dict[str, str] = {}  # identifier → tier_name
        self._usage: dict[str, _UsageRecord] = defaultdict(_UsageRecord)
        self._lock = Lock()

    def create_tier(self, body: QuotaTierCreate) -> _QuotaTier:
        with self._lock:
            if body.name in self._tiers:
                raise ValueError(f"Tier '{body.name}' already exists.")
            tier = _QuotaTier(
                id=f"qtier_{body.name}", name=body.name,
                description=body.description, max_tokens=body.max_tokens,
                max_requests=body.max_requests, window=body.window,
                rate_limit=body.rate_limit,
            )
            self._tiers[tier.name] = tier
        return tier

    def get_tier(self, name: str) -> _QuotaTier | None:
        with self._lock:
            return self._tiers.get(name)

    def delete_tier(self, name: str) -> bool:
        with self._lock:
            return self._tiers.pop(name, None) is not None

    def list_tiers(self) -> list[_QuotaTier]:
        with self._lock:
            return list(self._tiers.values())

    def assign_tier(self, body: QuotaAssignmentCreate) -> None:
        with self._lock:
            if body.tier_name not in self._tiers:
                raise ValueError(f"Tier '{body.tier_name}' not found.")
            self._assignments[body.identifier] = body.tier_name

    def get_assignment(self, identifier: str) -> str | None:
        with self._lock:
            return self._assignments.get(identifier)

    def record_usage(self, identifier: str, tokens: int = 0, requests: int = 1) -> QuotaUsage:
        """Record usage and return current status."""
        with self._lock:
            tier_name = self._assignments.get(identifier)
            if tier_name is None:
                return _default_usage(identifier)
            tier = self._tiers[tier_name]
            rec = self._usage[identifier]

            # Check window reset
            now = time.time()
            ws = _window_seconds(tier.window)
            if now - rec.window_start > ws:
                rec.tokens = 0
                rec.requests = 0
                rec.window_start = now

            rec.tokens += tokens
            rec.requests += requests

            tokens_remaining = max(0, tier.max_tokens - rec.tokens) if tier.max_tokens > 0 else 0
            requests_remaining = max(0, tier.max_requests - rec.requests) if tier.max_requests > 0 else 0
            is_over = (
                (tier.max_tokens > 0 and rec.tokens > tier.max_tokens)
                or (tier.max_requests > 0 and rec.requests > tier.max_requests)
            )

        return QuotaUsage(
            identifier=identifier, tier_name=tier_name,
            tokens_used=rec.tokens, requests_used=rec.requests,
            max_tokens=tier.max_tokens, max_requests=tier.max_requests,
            window=tier.window,
            tokens_remaining=tokens_remaining,
            requests_remaining=requests_remaining,
            is_over_quota=is_over,
        )

    def check_quota(self, identifier: str) -> QuotaUsage:
        """Check current quota status without recording usage."""
        with self._lock:
            tier_name = self._assignments.get(identifier)
            if tier_name is None:
                return _default_usage(identifier)
            tier = self._tiers[tier_name]
            rec = self._usage[identifier]

            # Check window reset
            now = time.time()
            ws = _window_seconds(tier.window)
            if now - rec.window_start > ws:
                return QuotaUsage(
                    identifier=identifier, tier_name=tier_name,
                    tokens_used=0, requests_used=0,
                    max_tokens=tier.max_tokens, max_requests=tier.max_requests,
                    window=tier.window,
                    tokens_remaining=tier.max_tokens if tier.max_tokens > 0 else 0,
                    requests_remaining=tier.max_requests if tier.max_requests > 0 else 0,
                    is_over_quota=False,
                )

            tokens_remaining = max(0, tier.max_tokens - rec.tokens) if tier.max_tokens > 0 else 0
            requests_remaining = max(0, tier.max_requests - rec.requests) if tier.max_requests > 0 else 0
            is_over = (
                (tier.max_tokens > 0 and rec.tokens > tier.max_tokens)
                or (tier.max_requests > 0 and rec.requests > tier.max_requests)
            )

        return QuotaUsage(
            identifier=identifier, tier_name=tier_name,
            tokens_used=rec.tokens, requests_used=rec.requests,
            max_tokens=tier.max_tokens, max_requests=tier.max_requests,
            window=tier.window,
            tokens_remaining=tokens_remaining,
            requests_remaining=requests_remaining,
            is_over_quota=is_over,
        )

    def reset_usage(self, identifier: str) -> bool:
        with self._lock:
            if identifier in self._usage:
                self._usage[identifier] = _UsageRecord(window_start=time.time())
                return True
            return False

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "tiers": len(self._tiers),
                "assignments": len(self._assignments),
                "identifiers_with_usage": len(self._usage),
            }


_manager: QuotaManager | None = None


def get_quota_manager() -> QuotaManager:
    global _manager
    if _manager is None:
        _manager = QuotaManager()
    return _manager


__all__ = ["QuotaManager", "QuotaTierCreate", "QuotaTierInfo", "QuotaAssignmentCreate", "QuotaUsage", "get_quota_manager"]

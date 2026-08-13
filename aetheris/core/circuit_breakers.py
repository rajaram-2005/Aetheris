"""Circuit breakers for tools, providers, and any named dependency.

A named breaker tracks successes and failures in a sliding window and
moves between ``closed`` (traffic flows), ``open`` (fail fast), and
``half_open`` (a probe is allowed). This is the same pattern used in
resilient RPC stacks, implemented here without extra dependencies so
Hermes can stop hammering a tool that is erroring.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from threading import RLock
from typing import Any, Literal

from pydantic import BaseModel, Field

BreakerState = Literal["closed", "open", "half_open"]


class BreakerConfig(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    failure_threshold: int = Field(default=5, ge=1, le=100)
    success_threshold: int = Field(default=2, ge=1, le=20, description="Successes in half-open to close.")
    window_seconds: float = Field(default=30.0, gt=0, le=3600)
    cooldown_seconds: float = Field(default=15.0, ge=0, le=3600)
    half_open_max: int = Field(default=1, ge=1, le=10)


class ProbeResult(BaseModel):
    name: str
    allowed: bool
    state: BreakerState
    reason: str


@dataclass
class _Breaker:
    name: str
    failure_threshold: int
    success_threshold: int
    window_seconds: float
    cooldown_seconds: float
    half_open_max: int
    state: str = "closed"
    opened_at: float = 0.0
    half_open_inflight: int = 0
    half_open_successes: int = 0
    events: deque[tuple[float, bool]] = field(default_factory=deque)  # (ts, success)
    opened_count: int = 0

    def _prune(self, now: float) -> None:
        cutoff = now - self.window_seconds
        while self.events and self.events[0][0] < cutoff:
            self.events.popleft()

    def _failures(self) -> int:
        return sum(1 for _ts, ok in self.events if not ok)

    def allow(self, now: float | None = None) -> tuple[bool, str]:
        now = now or time.time()
        self._prune(now)
        if self.state == "closed":
            return True, "closed"
        if self.state == "open":
            if now - self.opened_at >= self.cooldown_seconds:
                self.state = "half_open"
                self.half_open_inflight = 0
                self.half_open_successes = 0
            else:
                remaining = self.cooldown_seconds - (now - self.opened_at)
                return False, f"open ({remaining:.1f}s cooldown left)"
        if self.state == "half_open":
            if self.half_open_inflight >= self.half_open_max:
                return False, "half_open probe already in flight"
            self.half_open_inflight += 1
            return True, "half_open probe"
        return True, self.state

    def record(self, success: bool, now: float | None = None) -> None:
        now = now or time.time()
        self._prune(now)
        self.events.append((now, success))
        if self.state == "half_open":
            self.half_open_inflight = max(0, self.half_open_inflight - 1)
            if success:
                self.half_open_successes += 1
                if self.half_open_successes >= self.success_threshold:
                    self.state = "closed"
                    self.events.clear()
            else:
                self.state = "open"
                self.opened_at = now
                self.opened_count += 1
                self.half_open_successes = 0
            return
        if self.state == "closed" and self._failures() >= self.failure_threshold:
            self.state = "open"
            self.opened_at = now
            self.opened_count += 1

    def to_dict(self) -> dict[str, Any]:
        now = time.time()
        self._prune(now)
        return {
            "name": self.name,
            "state": self.state,
            "failures_in_window": self._failures(),
            "events_in_window": len(self.events),
            "failure_threshold": self.failure_threshold,
            "success_threshold": self.success_threshold,
            "window_seconds": self.window_seconds,
            "cooldown_seconds": self.cooldown_seconds,
            "opened_count": self.opened_count,
            "opened_at": self.opened_at or None,
        }


class CircuitBreakerRegistry:
    def __init__(self) -> None:
        self._lock = RLock()
        self._breakers: dict[str, _Breaker] = {}

    def ensure(self, name: str, **kwargs: Any) -> _Breaker:
        with self._lock:
            existing = self._breakers.get(name)
            if existing:
                return existing
            cfg = BreakerConfig(name=name, **{k: v for k, v in kwargs.items() if k in BreakerConfig.model_fields})
            br = _Breaker(
                name=cfg.name,
                failure_threshold=cfg.failure_threshold,
                success_threshold=cfg.success_threshold,
                window_seconds=cfg.window_seconds,
                cooldown_seconds=cfg.cooldown_seconds,
                half_open_max=cfg.half_open_max,
            )
            self._breakers[name] = br
            return br

    def configure(self, body: BreakerConfig) -> _Breaker:
        with self._lock:
            br = self._breakers.get(body.name)
            if br is None:
                br = _Breaker(
                    name=body.name,
                    failure_threshold=body.failure_threshold,
                    success_threshold=body.success_threshold,
                    window_seconds=body.window_seconds,
                    cooldown_seconds=body.cooldown_seconds,
                    half_open_max=body.half_open_max,
                )
                self._breakers[body.name] = br
            else:
                br.failure_threshold = body.failure_threshold
                br.success_threshold = body.success_threshold
                br.window_seconds = body.window_seconds
                br.cooldown_seconds = body.cooldown_seconds
                br.half_open_max = body.half_open_max
            return br

    def allow(self, name: str) -> ProbeResult:
        with self._lock:
            br = self._breakers.get(name) or self.ensure(name)
            ok, reason = br.allow()
            return ProbeResult(name=name, allowed=ok, state=br.state, reason=reason)  # type: ignore[arg-type]

    def record_success(self, name: str) -> dict[str, Any]:
        with self._lock:
            br = self._breakers.get(name) or self.ensure(name)
            br.record(True)
            return br.to_dict()

    def record_failure(self, name: str) -> dict[str, Any]:
        with self._lock:
            br = self._breakers.get(name) or self.ensure(name)
            br.record(False)
            return br.to_dict()

    def reset(self, name: str) -> bool:
        with self._lock:
            br = self._breakers.get(name)
            if br is None:
                return False
            br.state = "closed"
            br.events.clear()
            br.half_open_inflight = 0
            br.half_open_successes = 0
            br.opened_at = 0.0
            return True

    def get(self, name: str) -> dict[str, Any] | None:
        with self._lock:
            br = self._breakers.get(name)
            return br.to_dict() if br else None

    def list_breakers(self) -> list[dict[str, Any]]:
        with self._lock:
            return [b.to_dict() for b in self._breakers.values()]

    def stats(self) -> dict[str, Any]:
        with self._lock:
            by_state: dict[str, int] = {}
            for b in self._breakers.values():
                by_state[b.state] = by_state.get(b.state, 0) + 1
            return {"breakers": len(self._breakers), "by_state": by_state}


_registry: CircuitBreakerRegistry | None = None


def get_breaker_registry() -> CircuitBreakerRegistry:
    global _registry
    if _registry is None:
        _registry = CircuitBreakerRegistry()
    return _registry


__all__ = [
    "CircuitBreakerRegistry",
    "BreakerConfig",
    "ProbeResult",
    "get_breaker_registry",
]

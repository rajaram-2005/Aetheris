"""In-memory rate limiter for Aetheris API endpoints.

Uses a sliding-window algorithm: each client tracks a sorted list of request
timestamps. On each check, expired entries are pruned and the current count is
compared against the window limit.

The limiter is intentionally simple (no Redis, no external state) so Aetheris
remains dependency-free for its core operation. It is suitable for single-node
deployments; multi-node deployments should use an external rate limiter.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from threading import Lock


@dataclass(frozen=True)
class RateLimit:
    """A rate-limit configuration."""

    requests: int  # Max requests allowed in the window
    window_seconds: float  # Duration of the sliding window
    burst: int = 0  # Additional burst allowance (total = requests + burst)


@dataclass
class RateLimitResult:
    """Outcome of a rate-limit check."""

    allowed: bool
    remaining: int
    reset_at: float  # Unix timestamp when the window resets
    retry_after: float | None = None  # Seconds until the client can retry


@dataclass
class _Window:
    """Per-client sliding window state."""

    timestamps: list[float] = field(default_factory=list)


class RateLimiter:
    """Thread-safe in-memory sliding-window rate limiter."""

    def __init__(self, default_limit: RateLimit | None = None) -> None:
        self._windows: dict[str, _Window] = defaultdict(_Window)
        self._limits: dict[str, RateLimit] = {}
        self._default = default_limit or RateLimit(requests=60, window_seconds=60)
        self._lock = Lock()

    def configure(self, client_id: str, limit: RateLimit) -> None:
        """Set a per-client rate limit (overrides the default)."""
        with self._lock:
            self._limits[client_id] = limit

    def check(self, client_id: str, *, now: float | None = None) -> RateLimitResult:
        """Check whether a request from ``client_id`` is allowed.

        If allowed, the request is recorded (counts against the limit).
        If not, the caller should respond with 429 Too Many Requests.
        """
        now = now or time.time()
        limit = self._limits.get(client_id, self._default)
        max_requests = limit.requests + limit.burst

        with self._lock:
            window = self._windows[client_id]
            # Prune expired entries
            cutoff = now - limit.window_seconds
            window.timestamps = [ts for ts in window.timestamps if ts > cutoff]

            current = len(window.timestamps)
            remaining = max(0, max_requests - current)

            if current >= max_requests:
                # The oldest entry determines when a slot opens
                oldest = window.timestamps[0] if window.timestamps else now
                retry_after = max(0.0, oldest + limit.window_seconds - now)
                reset_at = oldest + limit.window_seconds
                return RateLimitResult(
                    allowed=False,
                    remaining=0,
                    reset_at=reset_at,
                    retry_after=round(retry_after, 2),
                )

            # Record this request
            window.timestamps.append(now)
            return RateLimitResult(
                allowed=True,
                remaining=remaining - 1,
                reset_at=now + limit.window_seconds,
            )

    def reset(self, client_id: str) -> None:
        """Clear the rate-limit window for a client."""
        with self._lock:
            self._windows.pop(client_id, None)

    def stats(self) -> dict[str, dict]:
        """Return current rate-limit state for all tracked clients."""
        now = time.time()
        result: dict[str, dict] = {}
        with self._lock:
            for client_id, window in self._windows.items():
                limit = self._limits.get(client_id, self._default)
                cutoff = now - limit.window_seconds
                active = [ts for ts in window.timestamps if ts > cutoff]
                result[client_id] = {
                    "active_requests": len(active),
                    "limit": limit.requests + limit.burst,
                    "window_seconds": limit.window_seconds,
                }
        return result


# Module-level singleton for convenience
_limiter: RateLimiter | None = None


def get_limiter() -> RateLimiter:
    """Return the process-wide rate limiter (lazy init)."""
    global _limiter
    if _limiter is None:
        from .config import settings
        _limiter = RateLimiter(
            default_limit=RateLimit(
                requests=settings.rate_limit_requests,
                window_seconds=settings.rate_limit_window_seconds,
                burst=settings.rate_limit_burst,
            )
        )
    return _limiter


__all__ = [
    "RateLimit",
    "RateLimitResult",
    "RateLimiter",
    "get_limiter",
]

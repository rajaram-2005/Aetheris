"""Operational metrics and telemetry for Aetheris.

Tracks request counts, latencies, token usage, error rates, and tool execution
stats. All metrics are in-memory and reset on server restart.

The ``/v1/metrics`` endpoint exposes these for monitoring dashboards, alerting,
and capacity planning.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from threading import Lock
from typing import Any


@dataclass
class RequestMetrics:
    """Metrics for a single request type."""

    count: int = 0
    total_duration_ms: float = 0
    min_duration_ms: float = float("inf")
    max_duration_ms: float = 0
    error_count: int = 0
    last_request_at: float = 0


@dataclass
class TokenMetrics:
    """Token usage metrics."""

    total_prompt_tokens: int = 0
    total_completion_tokens: int = 0
    total_tokens: int = 0
    request_count: int = 0


@dataclass
class ToolMetrics:
    """Metrics for a single tool."""

    invocations: int = 0
    successes: int = 0
    failures: int = 0
    total_duration_ms: float = 0
    avg_duration_ms: float = 0


class MetricsCollector:
    """Thread-safe in-memory metrics collector."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._started_at: float = time.time()
        self._request_metrics: dict[str, RequestMetrics] = defaultdict(RequestMetrics)
        self._token_metrics = TokenMetrics()
        self._tool_metrics: dict[str, ToolMetrics] = defaultdict(ToolMetrics)
        self._active_requests: int = 0
        self._rate_limit_rejections: int = 0
        self._auth_failures: int = 0
        self._content_filter_rejections: int = 0
        # Per-client token tracking for quotas
        self._client_tokens: dict[str, TokenMetrics] = defaultdict(TokenMetrics)

    # --- Request tracking -----------------------------------------------------

    def record_request(
        self,
        endpoint: str,
        duration_ms: float,
        *,
        error: bool = False,
    ) -> None:
        with self._lock:
            m = self._request_metrics[endpoint]
            m.count += 1
            m.total_duration_ms += duration_ms
            m.min_duration_ms = min(m.min_duration_ms, duration_ms)
            m.max_duration_ms = max(m.max_duration_ms, duration_ms)
            m.last_request_at = time.time()
            if error:
                m.error_count += 1

    def increment_active(self) -> None:
        with self._lock:
            self._active_requests += 1

    def decrement_active(self) -> None:
        with self._lock:
            self._active_requests = max(0, self._active_requests - 1)

    # --- Token tracking -------------------------------------------------------

    def record_tokens(
        self,
        prompt_tokens: int,
        completion_tokens: int,
        *,
        client_id: str = "anonymous",
    ) -> None:
        with self._lock:
            t = self._token_metrics
            t.total_prompt_tokens += prompt_tokens
            t.total_completion_tokens += completion_tokens
            t.total_tokens += prompt_tokens + completion_tokens
            t.request_count += 1

            ct = self._client_tokens[client_id]
            ct.total_prompt_tokens += prompt_tokens
            ct.total_completion_tokens += completion_tokens
            ct.total_tokens += prompt_tokens + completion_tokens
            ct.request_count += 1

    def get_client_token_usage(self, client_id: str) -> dict[str, int]:
        with self._lock:
            ct = self._client_tokens.get(client_id)
            if ct is None:
                return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
            return {
                "prompt_tokens": ct.total_prompt_tokens,
                "completion_tokens": ct.total_completion_tokens,
                "total_tokens": ct.total_tokens,
            }

    def check_token_quota(
        self, client_id: str, quota: int
    ) -> tuple[bool, int]:
        """Check if a client is within their token quota.

        Returns (allowed, tokens_used).
        """
        with self._lock:
            ct = self._client_tokens.get(client_id)
            used = ct.total_tokens if ct else 0
            return (used < quota, used)

    # --- Tool tracking --------------------------------------------------------

    def record_tool_execution(
        self,
        tool_name: str,
        duration_ms: float,
        *,
        success: bool,
    ) -> None:
        with self._lock:
            m = self._tool_metrics[tool_name]
            m.invocations += 1
            if success:
                m.successes += 1
            else:
                m.failures += 1
            m.total_duration_ms += duration_ms
            m.avg_duration_ms = m.total_duration_ms / m.invocations

    # --- Security counters ----------------------------------------------------

    def record_rate_limit_rejection(self) -> None:
        with self._lock:
            self._rate_limit_rejections += 1

    def record_auth_failure(self) -> None:
        with self._lock:
            self._auth_failures += 1

    def record_content_filter_rejection(self) -> None:
        with self._lock:
            self._content_filter_rejections += 1

    # --- Snapshot -------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        """Return a complete metrics snapshot."""
        with self._lock:
            now = time.time()
            uptime = now - self._started_at

            requests = {}
            for endpoint, m in self._request_metrics.items():
                avg = m.total_duration_ms / m.count if m.count else 0
                requests[endpoint] = {
                    "count": m.count,
                    "avg_duration_ms": round(avg, 2),
                    "min_duration_ms": round(m.min_duration_ms, 2) if m.min_duration_ms != float("inf") else 0,
                    "max_duration_ms": round(m.max_duration_ms, 2),
                    "error_count": m.error_count,
                    "error_rate": round(m.error_count / m.count, 4) if m.count else 0,
                    "last_request_at": m.last_request_at,
                }

            tools = {}
            for name, m in self._tool_metrics.items():
                tools[name] = {
                    "invocations": m.invocations,
                    "successes": m.successes,
                    "failures": m.failures,
                    "success_rate": round(m.successes / m.invocations, 4) if m.invocations else 0,
                    "avg_duration_ms": round(m.avg_duration_ms, 2),
                }

            return {
                "uptime_seconds": round(uptime, 2),
                "active_requests": self._active_requests,
                "total_requests": sum(m.count for m in self._request_metrics.values()),
                "requests": requests,
                "tokens": {
                    "total_prompt": self._token_metrics.total_prompt_tokens,
                    "total_completion": self._token_metrics.total_completion_tokens,
                    "total": self._token_metrics.total_tokens,
                    "request_count": self._token_metrics.request_count,
                },
                "tools": tools,
                "security": {
                    "rate_limit_rejections": self._rate_limit_rejections,
                    "auth_failures": self._auth_failures,
                    "content_filter_rejections": self._content_filter_rejections,
                },
                "clients_tracked": len(self._client_tokens),
            }


# Module-level singleton
_metrics: MetricsCollector | None = None


def get_metrics() -> MetricsCollector:
    """Return the process-wide metrics collector (lazy init)."""
    global _metrics
    if _metrics is None:
        _metrics = MetricsCollector()
    return _metrics


__all__ = [
    "MetricsCollector",
    "get_metrics",
]

"""Usage analytics engine for Aetheris.

Tracks request patterns, token consumption, cost estimation, and time-series
data for dashboard visualisation. Analytics are accumulated in-memory and can
be queried via the API for real-time dashboards.

Features:
* Per-model and per-mode token accounting
* Request rate time-series (minute/hour granularity)
* Cost estimation based on configurable per-token rates
* Top-N queries, tools, and error tracking
* Exportable as JSON for external visualisation
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


class AnalyticsQuery(BaseModel):
    """Query parameters for analytics retrieval."""
    metric: str = Field(default="overview", description="Metric: overview, tokens, requests, costs, top_queries, errors.")
    window: str = Field(default="1h", description="Time window: 1m, 5m, 15m, 1h, 6h, 24h, all.")
    model: str | None = Field(default=None, description="Filter by model.")
    mode: str | None = Field(default=None, description="Filter by mode.")


class AnalyticsOverview(BaseModel):
    """High-level analytics summary."""
    total_requests: int
    total_tokens: int
    total_prompt_tokens: int
    total_completion_tokens: int
    estimated_cost_usd: float
    avg_latency_ms: float
    error_rate: float
    active_models: list[str]
    active_modes: list[str]
    uptime_seconds: float


# --- Internal -----------------------------------------------------------------

@dataclass
class _RequestRecord:
    timestamp: float
    model: str
    mode: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: float
    is_error: bool
    tool_calls: int = 0


@dataclass
class _CostRates:
    """Per-token cost rates in USD."""
    prompt_per_1k: float = 0.002   # $0.002 per 1K prompt tokens (Aetheris Prime rate)
    completion_per_1k: float = 0.015  # $0.015 per 1K completion tokens


# --- Engine -------------------------------------------------------------------

class AnalyticsEngine:
    """Thread-safe in-memory analytics engine."""

    def __init__(self, max_records: int = 50_000) -> None:
        self._records: list[_RequestRecord] = []
        self._lock = Lock()
        self._max = max_records
        self._rates = _CostRates()
        self._started_at = time.time()
        self._top_queries: dict[str, int] = defaultdict(int)
        self._top_tools: dict[str, int] = defaultdict(int)
        self._errors: list[dict[str, Any]] = []

    def record(
        self,
        *,
        model: str = "",
        mode: str = "",
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        latency_ms: float = 0.0,
        is_error: bool = False,
        query: str = "",
        tool_name: str = "",
        error_detail: str = "",
    ) -> None:
        """Record a request event."""
        now = time.time()
        with self._lock:
            if len(self._records) >= self._max:
                # Keep most recent half
                self._records = self._records[self._max // 2:]
            rec = _RequestRecord(
                timestamp=now, model=model, mode=mode,
                prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                latency_ms=latency_ms, is_error=is_error,
            )
            self._records.append(rec)
            if query:
                self._top_queries[query[:200]] += 1
            if tool_name:
                self._top_tools[tool_name] += 1
            if is_error:
                self._errors.append({"timestamp": now, "model": model, "mode": mode, "detail": error_detail[:500]})
                if len(self._errors) > 1000:
                    self._errors = self._errors[-500:]

    def _filter_records(self, window: str, model: str | None, mode: str | None) -> list[_RequestRecord]:
        """Filter records by time window, model, and mode."""
        now = time.time()
        window_seconds = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "6h": 21600, "24h": 86400, "all": float("inf")}
        cutoff = now - window_seconds.get(window, 3600)
        records = [r for r in self._records if r.timestamp >= cutoff]
        if model:
            records = [r for r in records if r.model == model]
        if mode:
            records = [r for r in records if r.mode == mode]
        return records

    def overview(self, window: str = "1h", model: str | None = None, mode: str | None = None) -> AnalyticsOverview:
        """Get a high-level analytics overview."""
        with self._lock:
            records = self._filter_records(window, model, mode)
        total = len(records)
        if total == 0:
            return AnalyticsOverview(
                total_requests=0, total_tokens=0, total_prompt_tokens=0,
                total_completion_tokens=0, estimated_cost_usd=0.0,
                avg_latency_ms=0.0, error_rate=0.0,
                active_models=[], active_modes=[],
                uptime_seconds=time.time() - self._started_at,
            )
        pt = sum(r.prompt_tokens for r in records)
        ct = sum(r.completion_tokens for r in records)
        errors = sum(1 for r in records if r.is_error)
        cost = (pt / 1000 * self._rates.prompt_per_1k) + (ct / 1000 * self._rates.completion_per_1k)
        avg_lat = sum(r.latency_ms for r in records) / total
        models = sorted(set(r.model for r in records if r.model))
        modes = sorted(set(r.mode for r in records if r.mode))
        return AnalyticsOverview(
            total_requests=total, total_tokens=pt + ct,
            total_prompt_tokens=pt, total_completion_tokens=ct,
            estimated_cost_usd=round(cost, 6), avg_latency_ms=round(avg_lat, 2),
            error_rate=round(errors / total, 4), active_models=models,
            active_modes=modes, uptime_seconds=round(time.time() - self._started_at, 1),
        )

    def token_stats(self, window: str = "1h", model: str | None = None, mode: str | None = None) -> dict[str, Any]:
        """Get detailed token statistics."""
        with self._lock:
            records = self._filter_records(window, model, mode)
        by_model: dict[str, dict] = defaultdict(lambda: {"prompt": 0, "completion": 0, "total": 0})
        for r in records:
            by_model[r.model]["prompt"] += r.prompt_tokens
            by_model[r.model]["completion"] += r.completion_tokens
            by_model[r.model]["total"] += r.prompt_tokens + r.completion_tokens
        return {"by_model": dict(by_model), "total_requests": len(records)}

    def request_time_series(self, window: str = "1h", bucket: str = "1m") -> dict[str, Any]:
        """Get request counts as a time series."""
        with self._lock:
            records = self._filter_records(window, None, None)
        bucket_seconds = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600}
        bs = bucket_seconds.get(bucket, 60)
        now = time.time()
        buckets: dict[int, int] = defaultdict(int)
        for r in records:
            idx = int(r.timestamp // bs)
            buckets[idx] += 1
        # Build series from earliest to now
        if not buckets:
            return {"bucket_seconds": bs, "series": []}
        start = min(buckets.keys())
        end = int(now // bs)
        series = [{"time_bucket": i * bs, "count": buckets.get(i, 0)} for i in range(start, end + 1)]
        return {"bucket_seconds": bs, "series": series[-60:]}  # Cap at 60 points

    def cost_breakdown(self, window: str = "1h") -> dict[str, Any]:
        """Get cost breakdown by model."""
        with self._lock:
            records = self._filter_records(window, None, None)
        by_model: dict[str, dict] = defaultdict(lambda: {"prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0})
        for r in records:
            p_cost = r.prompt_tokens / 1000 * self._rates.prompt_per_1k
            c_cost = r.completion_tokens / 1000 * self._rates.completion_per_1k
            by_model[r.model]["prompt_tokens"] += r.prompt_tokens
            by_model[r.model]["completion_tokens"] += r.completion_tokens
            by_model[r.model]["cost_usd"] += p_cost + c_cost
        total = sum(v["cost_usd"] for v in by_model.values())
        return {"by_model": {k: {**v, "cost_usd": round(v["cost_usd"], 6)} for k, v in by_model.items()}, "total_cost_usd": round(total, 6)}

    def top_queries(self, limit: int = 20) -> list[dict[str, Any]]:
        """Get top N queries by frequency."""
        with self._lock:
            items = sorted(self._top_queries.items(), key=lambda x: x[1], reverse=True)[:limit]
        return [{"query": q, "count": c} for q, c in items]

    def top_tools(self, limit: int = 20) -> list[dict[str, Any]]:
        """Get top N tools by usage."""
        with self._lock:
            items = sorted(self._top_tools.items(), key=lambda x: x[1], reverse=True)[:limit]
        return [{"tool": t, "count": c} for t, c in items]

    def recent_errors(self, limit: int = 50) -> list[dict[str, Any]]:
        """Get recent error records."""
        with self._lock:
            return list(self._errors[-limit:])

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "total_records": len(self._records),
                "total_queries_tracked": len(self._top_queries),
                "total_tools_tracked": len(self._top_tools),
                "total_errors": len(self._errors),
                "uptime_seconds": round(time.time() - self._started_at, 1),
            }


_engine: AnalyticsEngine | None = None


def get_analytics_engine() -> AnalyticsEngine:
    global _engine
    if _engine is None:
        _engine = AnalyticsEngine()
    return _engine


__all__ = ["AnalyticsEngine", "AnalyticsQuery", "AnalyticsOverview", "get_analytics_engine"]

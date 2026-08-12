"""Cost tracking for Aetheris.

Per-model, per-client, and per-time-window token + cost accounting. Lets an
operator set per-client budgets, raise alerts on overspend, and query
aggregated spend. Cost rates (USD per 1K tokens) are configurable per model.
"""

from __future__ import annotations

import math
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


# --- Schemas -----------------------------------------------------------------

class CostRate(BaseModel):
    model: str = Field(..., min_length=1, max_length=128)
    prompt_per_1k: float = Field(default=0.0, ge=0.0, description="USD per 1K prompt tokens.")
    completion_per_1k: float = Field(default=0.0, ge=0.0, description="USD per 1K completion tokens.")


class Budget(BaseModel):
    client_id: str = Field(..., min_length=1, max_length=128)
    daily_usd: float = Field(default=0.0, ge=0.0, description="0 = unlimited.")
    monthly_usd: float = Field(default=0.0, ge=0.0)
    alert_threshold: float = Field(default=0.8, ge=0.0, le=1.0, description="Fraction of budget that triggers an alert.")


class UsageRecord(BaseModel):
    client_id: str
    model: str
    prompt_tokens: int = Field(ge=0, default=0)
    completion_tokens: int = Field(ge=0, default=0)
    cost_usd: float = Field(ge=0.0, default=0.0)
    timestamp: float = Field(default_factory=time.time)
    metadata: dict[str, Any] = Field(default_factory=dict)


class CostAlert(BaseModel):
    id: str
    client_id: str
    budget_period: str
    spent_usd: float
    limit_usd: float
    utilization: float
    timestamp: float


class CostSnapshot(BaseModel):
    total_cost_usd: float
    total_prompt_tokens: int
    total_completion_tokens: int
    by_model: dict[str, dict[str, float]]
    by_client: dict[str, dict[str, float]]
    alerts: list[CostAlert]


# --- Internal dataclasses ----------------------------------------------------

@dataclass
class _Rate:
    model: str
    prompt_per_1k: float
    completion_per_1k: float


@dataclass
class _Budget:
    client_id: str
    daily_usd: float
    monthly_usd: float
    alert_threshold: float


@dataclass
class _Entry:
    client_id: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    timestamp: float
    metadata: dict[str, Any] = field(default_factory=dict)


# --- Manager -----------------------------------------------------------------

class CostTracker:
    """Thread-safe token cost accounting with budgets and alerts."""

    _DEFAULT_RATES: dict[str, tuple[float, float]] = {
        "aetheris-lite":    (0.00015, 0.00060),
        "aetheris-pro":     (0.00300, 0.01200),
        "aetheris-ultra":   (0.01500, 0.07500),
        "gpt-4o-mini":      (0.00015, 0.00060),
        "gpt-4o":           (0.00250, 0.01000),
        "gpt-4.1":          (0.00200, 0.00800),
        "mock":             (0.0, 0.0),
    }

    def __init__(self, max_entries: int = 100_000) -> None:
        self._lock = Lock()
        self._rates: dict[str, _Rate] = {}
        self._budgets: dict[str, _Budget] = {}
        self._entries: list[_Entry] = []
        self._alerts: list[dict] = []
        self._max = max_entries
        self._alerted: set[tuple[str, str, int]] = set()
        # seed default rates
        for m, (p, c) in self._DEFAULT_RATES.items():
            self._rates[m] = _Rate(model=m, prompt_per_1k=p, completion_per_1k=c)

    # --- rates & budgets ----------------------------------------------------
    def set_rate(self, rate: CostRate) -> None:
        with self._lock:
            self._rates[rate.model] = _Rate(model=rate.model, prompt_per_1k=rate.prompt_per_1k, completion_per_1k=rate.completion_per_1k)

    def get_rate(self, model: str) -> _Rate | None:
        with self._lock:
            return self._rates.get(model)

    def list_rates(self) -> list[dict[str, Any]]:
        with self._lock:
            return [{"model": r.model, "prompt_per_1k": r.prompt_per_1k, "completion_per_1k": r.completion_per_1k} for r in self._rates.values()]

    def set_budget(self, budget: Budget) -> None:
        with self._lock:
            self._budgets[budget.client_id] = _Budget(
                client_id=budget.client_id, daily_usd=budget.daily_usd,
                monthly_usd=budget.monthly_usd, alert_threshold=budget.alert_threshold,
            )

    def get_budget(self, client_id: str) -> _Budget | None:
        with self._lock:
            return self._budgets.get(client_id)

    def delete_budget(self, client_id: str) -> bool:
        with self._lock:
            return self._budgets.pop(client_id, None) is not None

    # --- recording ----------------------------------------------------------
    def _compute_cost(self, model: str, prompt: int, completion: int) -> float:
        r = self._rates.get(model)
        if r is None:
            # fallback: pro tier rate
            r = self._rates.get("aetheris-pro", _Rate(model, 0.003, 0.012))
        return (prompt / 1000.0) * r.prompt_per_1k + (completion / 1000.0) * r.completion_per_1k

    def record(self, record: UsageRecord) -> dict[str, Any]:
        """Record a usage entry and return any alerts raised."""
        with self._lock:
            if record.cost_usd <= 0:
                cost = self._compute_cost(record.model, record.prompt_tokens, record.completion_tokens)
            else:
                cost = record.cost_usd
            entry = _Entry(
                client_id=record.client_id, model=record.model,
                prompt_tokens=record.prompt_tokens, completion_tokens=record.completion_tokens,
                cost_usd=cost, timestamp=record.timestamp or time.time(), metadata=record.metadata,
            )
            self._entries.append(entry)
            if len(self._entries) > self._max:
                self._entries = self._entries[-self._max:]
            alerts = self._check_budgets_locked(entry)
            for a in alerts:
                self._alerts.append(a)
            return {"recorded": True, "cost_usd": cost, "alerts": alerts}

    def _check_budgets_locked(self, entry: _Entry) -> list[dict[str, Any]]:
        b = self._budgets.get(entry.client_id)
        if b is None:
            return []
        now = entry.timestamp
        day_start = now - (now % 86400)
        month_start = now - (now % (86400 * 30))
        day_spent = sum(e.cost_usd for e in self._entries if e.client_id == entry.client_id and e.timestamp >= day_start)
        month_spent = sum(e.cost_usd for e in self._entries if e.client_id == entry.client_id and e.timestamp >= month_start)
        alerts: list[dict[str, Any]] = []
        day_key = (entry.client_id, "daily", int(day_start))
        if b.daily_usd > 0:
            util = day_spent / b.daily_usd if b.daily_usd else 0
            if util >= b.alert_threshold and day_key not in self._alerted:
                aid = f"alert_{uuid.uuid4().hex[:8]}"
                a = {"id": aid, "client_id": entry.client_id, "budget_period": "daily",
                     "spent_usd": round(day_spent, 6), "limit_usd": b.daily_usd,
                     "utilization": round(util, 3), "timestamp": now}
                alerts.append(a)
                self._alerted.add(day_key)
        month_key = (entry.client_id, "monthly", int(month_start))
        if b.monthly_usd > 0:
            util = month_spent / b.monthly_usd if b.monthly_usd else 0
            if util >= b.alert_threshold and month_key not in self._alerted:
                aid = f"alert_{uuid.uuid4().hex[:8]}"
                a = {"id": aid, "client_id": entry.client_id, "budget_period": "monthly",
                     "spent_usd": round(month_spent, 6), "limit_usd": b.monthly_usd,
                     "utilization": round(util, 3), "timestamp": now}
                alerts.append(a)
                self._alerted.add(month_key)
        return alerts

    # --- queries ------------------------------------------------------------
    def snapshot(self, *, since: float | None = None, client_id: str | None = None, model: str | None = None) -> CostSnapshot:
        with self._lock:
            entries = self._entries
            if since is not None:
                entries = [e for e in entries if e.timestamp >= since]
            if client_id:
                entries = [e for e in entries if e.client_id == client_id]
            if model:
                entries = [e for e in entries if e.model == model]

            total_cost = sum(e.cost_usd for e in entries)
            total_prompt = sum(e.prompt_tokens for e in entries)
            total_completion = sum(e.completion_tokens for e in entries)

            by_model: dict[str, dict[str, float]] = defaultdict(lambda: {"cost_usd": 0.0, "prompt_tokens": 0, "completion_tokens": 0, "requests": 0})
            by_client: dict[str, dict[str, float]] = defaultdict(lambda: {"cost_usd": 0.0, "prompt_tokens": 0, "completion_tokens": 0, "requests": 0})
            for e in entries:
                m = by_model[e.model]
                m["cost_usd"] += e.cost_usd
                m["prompt_tokens"] += e.prompt_tokens
                m["completion_tokens"] += e.completion_tokens
                m["requests"] += 1
                c = by_client[e.client_id]
                c["cost_usd"] += e.cost_usd
                c["prompt_tokens"] += e.prompt_tokens
                c["completion_tokens"] += e.completion_tokens
                c["requests"] += 1

            # round
            for d in (by_model, by_client):
                for v in d.values():
                    v["cost_usd"] = round(v["cost_usd"], 6)

            return CostSnapshot(
                total_cost_usd=round(total_cost, 6),
                total_prompt_tokens=total_prompt,
                total_completion_tokens=total_completion,
                by_model=dict(by_model),
                by_client=dict(by_client),
                alerts=[CostAlert(**a) for a in self._alerts[-100:]],
            )

    def list_entries(self, *, limit: int = 100, client_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            entries = self._entries
            if client_id:
                entries = [e for e in entries if e.client_id == client_id]
            out = []
            for e in entries[-limit:][::-1]:
                out.append({
                    "client_id": e.client_id, "model": e.model,
                    "prompt_tokens": e.prompt_tokens, "completion_tokens": e.completion_tokens,
                    "cost_usd": round(e.cost_usd, 6), "timestamp": e.timestamp, "metadata": e.metadata,
                })
            return out

    def list_alerts(self, *, client_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            alerts = self._alerts
            if client_id:
                alerts = [a for a in alerts if a["client_id"] == client_id]
            return list(reversed(alerts[-limit:]))

    def clear(self) -> int:
        with self._lock:
            n = len(self._entries)
            self._entries.clear()
            self._alerts.clear()
            self._alerted.clear()
            return n

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "entries": len(self._entries),
                "alerts": len(self._alerts),
                "budgets": len(self._budgets),
                "rates": len(self._rates),
                "total_cost_usd": round(sum(e.cost_usd for e in self._entries), 6),
            }


_tracker: CostTracker | None = None


def get_cost_tracker() -> CostTracker:
    global _tracker
    if _tracker is None:
        _tracker = CostTracker()
    return _tracker


__all__ = [
    "CostTracker", "CostRate", "Budget", "UsageRecord", "CostAlert", "CostSnapshot",
    "get_cost_tracker",
]

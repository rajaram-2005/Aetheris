"""Calibrated forecasting — log probabilities, resolve, score.

Operators (or Hermes) can file a forecast with a probability. When the
world resolves, we compute a Brier score and dump a calibration curve
across ten buckets. This is how a system becomes *honest about being
wrong*, not just fluent.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


class ForecastIn(BaseModel):
    statement: str = Field(..., min_length=1, max_length=500)
    probability: float = Field(..., ge=0.0, le=1.0)
    horizon: str = Field(default="", max_length=80)
    tags: list[str] = Field(default_factory=list)


class ResolveIn(BaseModel):
    outcome: bool
    note: str = Field(default="", max_length=400)


@dataclass
class _Forecast:
    id: str
    statement: str
    probability: float
    horizon: str
    tags: list[str]
    created_at: float
    resolved: bool = False
    outcome: bool | None = None
    brier: float | None = None
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "statement": self.statement,
            "probability": self.probability,
            "horizon": self.horizon,
            "tags": list(self.tags),
            "created_at": self.created_at,
            "resolved": self.resolved,
            "outcome": self.outcome,
            "brier": self.brier,
            "note": self.note,
        }


class ForecastBook:
    def __init__(self) -> None:
        self._lock = Lock()
        self._items: dict[str, _Forecast] = {}

    def file(self, body: ForecastIn) -> _Forecast:
        rec = _Forecast(
            id=f"fc_{uuid.uuid4().hex[:8]}",
            statement=body.statement,
            probability=body.probability,
            horizon=body.horizon,
            tags=list(body.tags),
            created_at=time.time(),
        )
        with self._lock:
            self._items[rec.id] = rec
        return rec

    def resolve(self, fid: str, body: ResolveIn) -> _Forecast:
        with self._lock:
            rec = self._items.get(fid)
            if rec is None:
                raise KeyError(fid)
            rec.resolved = True
            rec.outcome = bool(body.outcome)
            rec.note = body.note
            y = 1.0 if rec.outcome else 0.0
            rec.brier = round((rec.probability - y) ** 2, 6)
            return rec

    def get(self, fid: str) -> _Forecast | None:
        with self._lock:
            return self._items.get(fid)

    def list_forecasts(self, *, resolved: bool | None = None, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            items = list(self._items.values())
        if resolved is not None:
            items = [f for f in items if f.resolved is resolved]
        items.sort(key=lambda f: -f.created_at)
        return [f.to_dict() for f in items[:limit]]

    def calibration(self) -> dict[str, Any]:
        with self._lock:
            resolved = [f for f in self._items.values() if f.resolved and f.brier is not None]
        buckets = []
        for i in range(10):
            lo, hi = i / 10.0, (i + 1) / 10.0
            group = [f for f in resolved if lo <= f.probability < hi or (i == 9 and f.probability == 1.0)]
            if not group:
                buckets.append({"lo": lo, "hi": hi, "n": 0, "avg_p": None, "avg_y": None})
                continue
            avg_p = sum(f.probability for f in group) / len(group)
            avg_y = sum(1.0 if f.outcome else 0.0 for f in group) / len(group)
            buckets.append({
                "lo": lo, "hi": hi, "n": len(group),
                "avg_p": round(avg_p, 4), "avg_y": round(avg_y, 4),
            })
        mean_brier = (
            sum(f.brier or 0.0 for f in resolved) / len(resolved) if resolved else None
        )
        return {
            "resolved": len(resolved),
            "open": len(self._items) - len(resolved),
            "mean_brier": round(mean_brier, 6) if mean_brier is not None else None,
            "buckets": buckets,
        }

    def stats(self) -> dict[str, Any]:
        with self._lock:
            resolved = sum(1 for f in self._items.values() if f.resolved)
            return {"forecasts": len(self._items), "resolved": resolved}


_book: ForecastBook | None = None


def get_forecast_book() -> ForecastBook:
    global _book
    if _book is None:
        _book = ForecastBook()
    return _book


__all__ = ["ForecastBook", "ForecastIn", "ResolveIn", "get_forecast_book"]

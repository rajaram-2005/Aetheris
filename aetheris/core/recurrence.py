"""Recurring schedules / cron-like task definitions.

Complements the one-shot scheduler (see ``scheduler.py``) with rich recurrence
rules: interval-based, daily/weekly, cron expressions, one-shot at, and
business-day only. Provides next-run computation and occurrence enumeration.
"""

from __future__ import annotations

import calendar
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


# --- Schemas -----------------------------------------------------------------

class RecurrenceRule(BaseModel):
    """A recurrence rule. Exactly one of 'interval'/'cron'/'daily'/'weekly' should be set."""
    kind: str = Field(..., pattern="^(interval|daily|weekly|cron|once|business_days)$")
    interval_seconds: int | None = Field(default=None, ge=1, description="For interval kind.")
    times: list[str] = Field(default_factory=list, description="HH:MM times (daily/business_days/weekly).")
    weekdays: list[int] = Field(default_factory=list, description="0=Mon..6=Sun (weekly).")
    cron: str = Field(default="", description="Cron expression 'm h dom mon dow' (5 fields).")
    run_at: float | None = Field(default=None, description="For 'once' kind (unix ts).")
    start_at: float | None = Field(default=None)
    end_at: float | None = Field(default=None)
    max_occurrences: int | None = Field(default=None, ge=1)
    timezone: str = Field(default="UTC", max_length=64)


class RecurringTaskCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = Field(default="", max_length=500)
    rule: RecurrenceRule
    action_type: str = Field(default="workflow", description="workflow|command|webhook")
    action_ref: str = Field(default="", max_length=256)
    parameters: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class RecurringTaskInfo(BaseModel):
    id: str
    name: str
    description: str
    rule: dict[str, Any]
    action_type: str
    action_ref: str
    parameters: dict[str, Any]
    enabled: bool
    created_at: float
    last_run_at: float | None
    next_run_at: float | None
    run_count: int
    is_due: bool


# --- Internal dataclass ------------------------------------------------------

@dataclass
class _Task:
    id: str
    name: str
    description: str
    rule: RecurrenceRule
    action_type: str
    action_ref: str
    parameters: dict[str, Any]
    enabled: bool
    created_at: float
    last_run_at: float | None = None
    next_run_at: float | None = None
    run_count: int = 0
    occurrences: int = 0


# --- Cron parser (5-field) ---------------------------------------------------

_CRON_FIELDS = ["minute", "hour", "dom", "mon", "dow"]
_DOW_OFFSET = 0  # cron: 0=Sun; we normalize to Mon=0


def _parse_field(expr: str, lo: int, hi: int) -> set[int]:
    out: set[int] = set()
    for part in expr.split(","):
        part = part.strip()
        if not part:
            continue
        step = 1
        if "/" in part:
            part, st = part.split("/", 1)
            step = int(st)
        if part in ("*", ""):
            start, end = lo, hi
        elif "-" in part:
            a, b = part.split("-", 1)
            start, end = int(a), int(b)
        else:
            v = int(part)
            start, end = v, v
        for v in range(start, end + 1, step):
            if lo <= v <= hi:
                out.add(v)
    return out


def _parse_cron(expr: str) -> dict[str, set[int]]:
    parts = expr.split()
    if len(parts) != 5:
        raise ValueError(f"Cron expression must have 5 fields, got {len(parts)}: {expr!r}")
    return {
        "minute": _parse_field(parts[0], 0, 59),
        "hour": _parse_field(parts[1], 0, 23),
        "dom": _parse_field(parts[2], 1, 31),
        "mon": _parse_field(parts[3], 1, 12),
        "dow": _parse_field(parts[4], 0, 6),  # 0=Sun..6=Sat (cron)
    }


def _tzinfo(name: str):
    try:
        from zoneinfo import ZoneInfo  # py3.9+
        return ZoneInfo(name)
    except Exception:
        return timezone.utc


def _next_after(rule: RecurrenceRule, after_ts: float) -> float | None:
    """Compute next run timestamp >= after_ts."""
    after = max(after_ts, rule.start_at or after_ts)
    if rule.end_at and after > rule.end_at:
        return None
    tz = _tzinfo(rule.timezone)
    base = datetime.fromtimestamp(after, tz=tz)

    if rule.kind == "once":
        if rule.run_at is None:
            return None
        return rule.run_at if rule.run_at >= after else None

    if rule.kind == "interval":
        iv = rule.interval_seconds or 60
        nxt = base + timedelta(seconds=iv)
        ts = nxt.timestamp()
        return ts if not rule.end_at or ts <= rule.end_at else None

    # Search forward day by day for daily/weekly/business_days/cron.
    candidates: list[datetime] = []
    for day_offset in range(0, 366 * 4):  # up to ~4 years
        d = (base + timedelta(days=day_offset)).replace(second=0, microsecond=0)
        if day_offset == 0:
            d = base.replace(second=0, microsecond=0) + timedelta(minutes=1)
        else:
            d = d.replace(hour=0, minute=0)

        times = rule.times or ["09:00"]
        for t in times:
            try:
                hh, mm = (int(x) for x in t.split(":", 1))
            except Exception:
                continue
            cand = d.replace(hour=hh, minute=mm)
            if cand.timestamp() <= after:
                continue
            if rule.end_at and cand.timestamp() > rule.end_at:
                return None

            if rule.kind == "daily":
                candidates.append(cand)
            elif rule.kind == "business_days":
                wd = cand.weekday()  # Mon=0..Sun=6
                if wd < 5:
                    candidates.append(cand)
            elif rule.kind == "weekly":
                wd = cand.weekday()  # Mon=0
                cron_dow = {(d + 1) % 7 for d in rule.weekdays}  # convert our Mon=0 to cron Sun=0
                if wd in rule.weekdays or (cand.weekday() + 1) % 7 in cron_dow and rule.weekdays:
                    # Prefer explicit weekdays as Mon=0..Sun=6
                    if wd in rule.weekdays:
                        candidates.append(cand)
            elif rule.kind == "cron" and rule.cron:
                try:
                    cf = _parse_cron(rule.cron)
                except Exception:
                    return None
                # cron dow: 0=Sun..6=Sat; datetime weekday(): Mon=0..Sun=6
                cron_dow = (cand.weekday() + 1) % 7
                if (cand.minute in cf["minute"] and cand.hour in cf["hour"]
                        and cand.day in cf["dom"] and cand.month in cf["mon"]
                        and (cron_dow in cf["dow"] or 7 in cf_dow_normalize(cf["dow"]))):
                    candidates.append(cand)
        if candidates:
            candidates.sort()
            return candidates[0].timestamp()
    return None


def cf_dow_normalize(s: set[int]) -> set[int]:
    # 7 is a synonym for Sunday in cron
    return {0 if x == 7 else x for x in s}


# --- Manager -----------------------------------------------------------------

class RecurrenceManager:
    def __init__(self, max_tasks: int = 1000) -> None:
        self._lock = Lock()
        self._tasks: dict[str, _Task] = {}
        self._max = max_tasks

    def create(self, body: RecurringTaskCreate) -> _Task:
        with self._lock:
            if len(self._tasks) >= self._max:
                raise ValueError(f"Maximum of {self._max} recurring tasks reached.")
            tid = f"rec_{uuid.uuid4().hex[:10]}"
            t = _Task(
                id=tid, name=body.name, description=body.description, rule=body.rule,
                action_type=body.action_type, action_ref=body.action_ref,
                parameters=dict(body.parameters), enabled=body.enabled, created_at=time.time(),
            )
            t.next_run_at = _next_after(t.rule, t.created_at)
            self._tasks[tid] = t
            return t

    def get(self, tid: str) -> _Task | None:
        with self._lock:
            return self._tasks.get(tid)

    def delete(self, tid: str) -> bool:
        with self._lock:
            return self._tasks.pop(tid, None) is not None

    def list_tasks(self, *, enabled_only: bool = False, action_type: str | None = None) -> list[_Task]:
        with self._lock:
            items = list(self._tasks.values())
        if enabled_only:
            items = [t for t in items if t.enabled]
        if action_type:
            items = [t for t in items if t.action_type == action_type]
        return sorted(items, key=lambda t: t.next_run_at or float("inf"))

    def set_enabled(self, tid: str, enabled: bool) -> _Task | None:
        with self._lock:
            t = self._tasks.get(tid)
            if t is None:
                return None
            t.enabled = enabled
            return t

    def mark_run(self, tid: str, *, when: float | None = None) -> _Task | None:
        """Record a run occurrence and recompute next_run_at."""
        with self._lock:
            t = self._tasks.get(tid)
            if t is None:
                return None
            t.last_run_at = when or time.time()
            t.run_count += 1
            t.occurrences += 1
            after = t.last_run_at
            if t.rule.max_occurrences and t.occurrences >= t.rule.max_occurrences:
                t.next_run_at = None
                t.enabled = False
            else:
                t.next_run_at = _next_after(t.rule, after)
            return t

    def due_tasks(self, *, now: float | None = None) -> list[_Task]:
        now = now or time.time()
        with self._lock:
            out = []
            for t in self._tasks.values():
                if not t.enabled:
                    continue
                if t.next_run_at is None:
                    continue
                if t.next_run_at <= now:
                    out.append(t)
            return out

    def upcoming(self, limit: int = 20) -> list[dict[str, Any]]:
        items = self.list_tasks(enabled_only=True)
        out = []
        for t in items[:limit]:
            out.append({
                "id": t.id, "name": t.name, "next_run_at": t.next_run_at,
                "action_type": t.action_type, "action_ref": t.action_ref,
            })
        return out

    def occurrences(self, tid: str, count: int = 10) -> list[float]:
        t = self.get(tid)
        if t is None:
            return []
        out = []
        cur = t.created_at
        for _ in range(count):
            nxt = _next_after(t.rule, cur)
            if nxt is None:
                break
            out.append(nxt)
            cur = nxt
        return out

    def stats(self) -> dict[str, Any]:
        with self._lock:
            enabled = sum(1 for t in self._tasks.values() if t.enabled)
            by_action: dict[str, int] = {}
            for t in self._tasks.values():
                by_action[t.action_type] = by_action.get(t.action_type, 0) + 1
            return {
                "total": len(self._tasks), "enabled": enabled,
                "disabled": len(self._tasks) - enabled, "by_action_type": by_action,
            }


def _info(t: _Task) -> RecurringTaskInfo:
    now = time.time()
    return RecurringTaskInfo(
        id=t.id, name=t.name, description=t.description, rule=t.rule.model_dump(),
        action_type=t.action_type, action_ref=t.action_ref, parameters=dict(t.parameters),
        enabled=t.enabled, created_at=t.created_at, last_run_at=t.last_run_at,
        next_run_at=t.next_run_at, run_count=t.run_count,
        is_due=bool(t.enabled and t.next_run_at is not None and t.next_run_at <= now),
    )


_manager: RecurrenceManager | None = None


def get_recurrence_manager() -> RecurrenceManager:
    global _manager
    if _manager is None:
        _manager = RecurrenceManager()
    return _manager


__all__ = [
    "RecurrenceManager", "RecurrenceRule", "RecurringTaskCreate", "RecurringTaskInfo",
    "get_recurrence_manager", "_info", "_next_after",
]

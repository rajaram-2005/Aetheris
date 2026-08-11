"""Cron-like scheduler for Aetheris workflows.

Runs workflows on a recurring schedule defined by simple cron expressions.
The scheduler is intentionally lightweight -- it uses a single background
task that wakes up every ``tick_seconds`` (default 30s) and fires any
workflows whose schedule matches the current time.

Supported cron expressionD format (5 fields):
    minute hour day_of_month month day_of_week

Examples:
    ``* * * * *``       -- every minute
    ``0 * * * *``       -- every hour
    ``*/5 * * * *``     -- every 5 minutes
    ``0 9 * * 1-5``     -- weekdays at 9:00
    ``30 2 1 * *``      -- 2:30 AM on the 1st of every month
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger("aetheris.scheduler")


class ScheduleCreate(BaseModel):
    """Request to create a scheduled workflow run."""

    workflow_id: str = Field(..., description="The workflow to schedule.")
    cron_expression: str = Field(..., min_length=9, max_length=100)
    enabled: bool = Field(default=True)
    inputs: dict[str, Any] = Field(default_factory=dict, description="Inputs to pass to the workflow on each run.")
    description: str = Field(default="", max_length=500)


class ScheduleInfo(BaseModel):
    id: str
    workflow_id: str
    cron_expression: str
    enabled: bool
    description: str
    created_at: float
    last_fire_at: float | None
    next_fire_at: float | None
    fire_count: int


# --- Cron matching ------------------------------------------------------------

def _parse_field(field_str: str, value: int) -> bool:
    """Check if a cron field matches the given value."""
    for part in field_str.split(","):
        part = part.strip()
        if part == "*":
            return True
        if "/" in part:
            base, step = part.split("/", 1)
            step = int(step)
            if base == "*":
                return value % step == 0
            return value >= int(base) and (value - int(base)) % step == 0
        if "-" in part:
            lo, hi = part.split("-", 1)
            if int(lo) <= value <= int(hi):
                return True
        else:
            if value == int(part):
                return True
    return False


def should_fire(cron_expr: str, t: float | None = None) -> bool:
    """Check if a cron expression matches the current time."""
    t = t or time.time()
    parts = cron_expr.strip().split()
    if len(parts) != 5:
        return False
    lt = time.localtime(t)
    minute, hour = lt.tm_min, lt.tm_hour
    day, month, weekday = lt.tm_mday, lt.tm_mon, lt.tm_wday  # weekday: 0=Mon
    # Adjust weekday: cron uses 0=Sun, Python uses 0=Mon
    cron_wday = (weekday + 1) % 7
    return (
        _parse_field(parts[0], minute) and
        _parse_field(parts[1], hour) and
        _parse_field(parts[2], day) and
        _parse_field(parts[3], month) and
        _parse_field(parts[4], cron_wday)
    )


# --- Scheduler ----------------------------------------------------------------

@dataclass
class _Schedule:
    id: str
    workflow_id: str
    cron_expression: str
    enabled: bool
    inputs: dict[str, Any]
    description: str
    created_at: float
    last_fire_at: float | None = None
    next_fire_at: float | None = None
    fire_count: int = 0

    def to_info(self) -> ScheduleInfo:
        return ScheduleInfo(
            id=self.id, workflow_id=self.workflow_id,
            cron_expression=self.cron_expression, enabled=self.enabled,
            description=self.description, created_at=self.created_at,
            last_fire_at=self.last_fire_at, next_fire_at=self.next_fire_at,
            fire_count=self.fire_count,
        )


class Scheduler:
    """In-memory cron scheduler that triggers workflow runs."""

    def __init__(self, tick_seconds: float = 30.0) -> None:
        self._schedules: dict[str, _Schedule] = {}
        self._lock = Lock()
        self._tick = tick_seconds
        self._task: asyncio.Task | None = None
        self._running = False

    def add(self, body: ScheduleCreate) -> _Schedule:
        with self._lock:
            sched = _Schedule(
                id=f"sched_{uuid.uuid4().hex[:10]}",
                workflow_id=body.workflow_id,
                cron_expression=body.cron_expression,
                enabled=body.enabled, inputs=body.inputs,
                description=body.description,
                created_at=time.time(),
            )
            self._schedules[sched.id] = sched
        logger.info("Schedule created: %s for workflow %s", sched.cron_expression, sched.workflow_id)
        return sched

    def remove(self, schedule_id: str) -> bool:
        with self._lock:
            return self._schedules.pop(schedule_id, None) is not None

    def get(self, schedule_id: str) -> _Schedule | None:
        with self._lock:
            return self._schedules.get(schedule_id)

    def list_schedules(self) -> list[_Schedule]:
        with self._lock:
            return list(self._schedules.values())

    async def start(self) -> None:
        """Start the scheduler background loop."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Scheduler started (tick every %gs)", self._tick)

    async def stop(self) -> None:
        """Stop the scheduler."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Scheduler stopped")

    async def _loop(self) -> None:
        """Main scheduler loop."""
        while self._running:
            try:
                await self._tick_once()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("Scheduler tick error: %s", exc)
            await asyncio.sleep(self._tick)

    async def _tick_once(self) -> None:
        """Check all schedules and fire any matching workflows."""
        now = time.time()
        with self._lock:
            schedules = [s for s in self._schedules.values() if s.enabled]

        for sched in schedules:
            try:
                if should_fire(sched.cron_expression, now):
                    if sched.last_fire_at and (now - sched.last_fire_at) < self._tick:
                        continue  # Already fired this tick
                    await self._fire(sched, now)
            except Exception as exc:
                logger.warning("Schedule fire error for %s: %s", sched.id, exc)

    async def _fire(self, sched: _Schedule, now: float) -> None:
        """Execute a scheduled workflow."""
        from .workflows import get_workflow_engine
        engine = get_workflow_engine()
        logger.info("Firing scheduled workflow %s (schedule %s)", sched.workflow_id, sched.id)
        result = await engine.execute(sched.workflow_id, inputs=sched.inputs)
        with self._lock:
            sched.last_fire_at = now
            sched.fire_count += 1
        # Publish event
        try:
            from .events import get_event_bus
            await get_event_bus().publish("scheduler.fired", {
                "schedule_id": sched.id,
                "workflow_id": sched.workflow_id,
                "run_id": result.id,
                "ok": result.ok,
            }, source="scheduler")
        except Exception:
            pass

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "total_schedules": len(self._schedules),
                "enabled": sum(1 for s in self._schedules.values() if s.enabled),
                "total_fires": sum(s.fire_count for s in self._schedules.values()),
                "running": self._running,
            }


_scheduler: Scheduler | None = None


def get_scheduler() -> Scheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = Scheduler()
    return _scheduler


__all__ = ["ScheduleCreate", "ScheduleInfo", "Scheduler", "should_fire", "get_scheduler"]

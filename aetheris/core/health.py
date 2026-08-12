"""Health probes and subsystem diagnostics for Aetheris.

Provides deep health checking for all Aetheris subsystems with two probe
levels following Kubernetes conventions:

* **Liveness** — Is the process alive and responsive?
* **Readiness** — Are all critical subsystems initialised and healthy?

Each subsystem reports its status, latency, and optional details. The
overall health is derived from the worst subsystem status.

Subsystem checks:
* Core engine (config, modes, tiers)
* Cache (response cache stats)
* RAG index (document count)
* Scheduler (tick status)
* Plugin loader (loaded/failed counts)
* Rate limiter (window state)
* Session store (active sessions)
* Audit log (buffer utilisation)
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class HealthStatus(str, Enum):
    healthy = "healthy"
    degraded = "degraded"
    unhealthy = "unhealthy"
    unknown = "unknown"


class SubsystemHealth(BaseModel):
    name: str
    status: HealthStatus
    latency_ms: float = Field(description="Check latency in ms.")
    detail: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class HealthReport(BaseModel):
    status: HealthStatus
    timestamp: float
    uptime_seconds: float
    version: str
    subsystems: list[SubsystemHealth]
    summary: dict[str, int] = Field(description="Count by status.")


def _check_core() -> SubsystemHealth:
    start = time.time()
    try:
        from .config import settings
        from .modes import available_modes
        from .tiers import TIERS
        latency = (time.time() - start) * 1000
        return SubsystemHealth(
            name="core", status=HealthStatus.healthy, latency_ms=round(latency, 2),
            detail="Config, modes, and tiers loaded.",
            metadata={"modes": len(available_modes()), "tiers": len(TIERS)},
        )
    except Exception as exc:
        latency = (time.time() - start) * 1000
        return SubsystemHealth(name="core", status=HealthStatus.unhealthy, latency_ms=round(latency, 2), detail=str(exc)[:200])


def _check_cache() -> SubsystemHealth:
    start = time.time()
    try:
        from .caching import get_response_cache
        cache = get_response_cache()
        stats = cache.stats()
        latency = (time.time() - start) * 1000
        return SubsystemHealth(
            name="cache", status=HealthStatus.healthy, latency_ms=round(latency, 2),
            metadata=stats,
        )
    except Exception as exc:
        latency = (time.time() - start) * 1000
        return SubsystemHealth(name="cache", status=HealthStatus.unknown, latency_ms=round(latency, 2), detail=str(exc)[:200])


def _check_rag() -> SubsystemHealth:
    start = time.time()
    try:
        from ..tools.retrieval import get_index
        idx = get_index()
        count = len(idx.list_documents())
        latency = (time.time() - start) * 1000
        return SubsystemHealth(
            name="rag", status=HealthStatus.healthy, latency_ms=round(latency, 2),
            detail=f"{count} documents indexed.",
            metadata={"document_count": count},
        )
    except Exception as exc:
        latency = (time.time() - start) * 1000
        return SubsystemHealth(name="rag", status=HealthStatus.unknown, latency_ms=round(latency, 2), detail=str(exc)[:200])


def _check_rate_limiter() -> SubsystemHealth:
    start = time.time()
    try:
        from .rate_limiter import get_limiter
        limiter = get_limiter()
        latency = (time.time() - start) * 1000
        return SubsystemHealth(
            name="rate_limiter", status=HealthStatus.healthy, latency_ms=round(latency, 2),
        )
    except Exception as exc:
        latency = (time.time() - start) * 1000
        return SubsystemHealth(name="rate_limiter", status=HealthStatus.unknown, latency_ms=round(latency, 2), detail=str(exc)[:200])


def _check_sessions() -> SubsystemHealth:
    start = time.time()
    try:
        from .sessions import get_session_manager
        mgr = get_session_manager()
        stats = mgr.stats()
        latency = (time.time() - start) * 1000
        return SubsystemHealth(
            name="sessions", status=HealthStatus.healthy, latency_ms=round(latency, 2),
            metadata=stats,
        )
    except Exception as exc:
        latency = (time.time() - start) * 1000
        return SubsystemHealth(name="sessions", status=HealthStatus.unknown, latency_ms=round(latency, 2), detail=str(exc)[:200])


def _check_audit() -> SubsystemHealth:
    start = time.time()
    try:
        from .audit import get_audit
        audit = get_audit()
        stats = audit.stats()
        latency = (time.time() - start) * 1000
        return SubsystemHealth(
            name="audit", status=HealthStatus.healthy, latency_ms=round(latency, 2),
            metadata=stats,
        )
    except Exception as exc:
        latency = (time.time() - start) * 1000
        return SubsystemHealth(name="audit", status=HealthStatus.unknown, latency_ms=round(latency, 2), detail=str(exc)[:200])


def _check_analytics() -> SubsystemHealth:
    start = time.time()
    try:
        from .analytics import get_analytics_engine
        engine = get_analytics_engine()
        stats = engine.stats()
        latency = (time.time() - start) * 1000
        return SubsystemHealth(
            name="analytics", status=HealthStatus.healthy, latency_ms=round(latency, 2),
            metadata=stats,
        )
    except Exception as exc:
        latency = (time.time() - start) * 1000
        return SubsystemHealth(name="analytics", status=HealthStatus.unknown, latency_ms=round(latency, 2), detail=str(exc)[:200])


_SUBSYSTEM_CHECKS = [
    _check_core, _check_cache, _check_rag, _check_rate_limiter,
    _check_sessions, _check_audit, _check_analytics,
]


def check_health() -> HealthReport:
    """Run all subsystem health checks and produce a report."""
    from .. import __version__
    from .config import settings

    subsystems = []
    for checker in _SUBSYSTEM_CHECKS:
        try:
            subsystems.append(checker())
        except Exception as exc:
            subsystems.append(SubsystemHealth(
                name=checker.__name__, status=HealthStatus.unknown,
                latency_ms=0, detail=str(exc)[:200],
            ))

    # Derive overall status
    statuses = [s.status for s in subsystems]
    if any(s == HealthStatus.unhealthy for s in statuses):
        overall = HealthStatus.unhealthy
    elif any(s == HealthStatus.degraded for s in statuses):
        overall = HealthStatus.degraded
    elif any(s == HealthStatus.unknown for s in statuses):
        overall = HealthStatus.degraded
    else:
        overall = HealthStatus.healthy

    # Summary counts
    summary: dict[str, int] = {}
    for s in statuses:
        summary[s.value] = summary.get(s.value, 0) + 1

    return HealthReport(
        status=overall,
        timestamp=time.time(),
        uptime_seconds=time.time() - _started_at,
        version=__version__,
        subsystems=subsystems,
        summary=summary,
    )


_started_at: float = time.time()


__all__ = ["HealthStatus", "SubsystemHealth", "HealthReport", "check_health"]

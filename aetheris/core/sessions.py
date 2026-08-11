"""Session management for Aetheris.

Tracks client sessions with creation time, last activity, token usage,
and associated metadata. Sessions are in-memory and expire after a
configurable idle timeout.

Useful for:
* per-session conversation context
* token quota enforcement
* live analytics in the God Mode dashboard
* session export for audit
"""

from __future__ import annotations

import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


# --- Schemas ------------------------------------------------------------------

class SessionCreate(BaseModel):
    """Request to create a new session."""

    client_id: str = Field(default="anonymous", max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)
    ttl_seconds: int = Field(
        default=3600, ge=60, le=86400,
        description="Session time-to-live in seconds.",
    )


class SessionInfo(BaseModel):
    """Public view of a session."""

    id: str
    client_id: str
    created_at: float
    last_active_at: float
    expires_at: float
    request_count: int
    token_count: int
    is_expired: bool
    metadata: dict[str, Any]


# --- Storage ------------------------------------------------------------------

@dataclass
class _Session:
    id: str
    client_id: str
    created_at: float
    last_active_at: float
    expires_at: float
    request_count: int = 0
    token_count: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def is_expired(self) -> bool:
        return time.time() > self.expires_at

    def touch(self) -> None:
        self.last_active_at = time.time()

    def to_info(self) -> SessionInfo:
        return SessionInfo(
            id=self.id,
            client_id=self.client_id,
            created_at=self.created_at,
            last_active_at=self.last_active_at,
            expires_at=self.expires_at,
            request_count=self.request_count,
            token_count=self.token_count,
            is_expired=self.is_expired,
            metadata=self.metadata,
        )


class SessionManager:
    """Thread-safe in-memory session manager with idle expiry."""

    def __init__(self, max_sessions: int = 1000) -> None:
        self._sessions: dict[str, _Session] = {}
        self._lock = Lock()
        self._max_sessions = max_sessions

    def create(
        self,
        *,
        client_id: str = "anonymous",
        metadata: dict[str, Any] | None = None,
        ttl_seconds: int = 3600,
    ) -> _Session:
        """Create a new session."""
        self._evict_expired()
        with self._lock:
            if len(self._sessions) >= self._max_sessions:
                # Evict the oldest session
                oldest_id = min(
                    self._sessions, key=lambda k: self._sessions[k].last_active_at
                )
                del self._sessions[oldest_id]

            now = time.time()
            session = _Session(
                id=f"sess_{uuid.uuid4().hex[:12]}",
                client_id=client_id,
                created_at=now,
                last_active_at=now,
                expires_at=now + ttl_seconds,
                metadata=metadata or {},
            )
            self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> _Session | None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session and session.is_expired:
                del self._sessions[session_id]
                return None
            return session

    def touch(self, session_id: str) -> bool:
        """Mark a session as active. Returns False if expired/missing."""
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None or session.is_expired:
                return False
            session.touch()
            return True

    def record_request(self, session_id: str, tokens: int = 0) -> None:
        """Record a request in the session."""
        with self._lock:
            session = self._sessions.get(session_id)
            if session and not session.is_expired:
                session.request_count += 1
                session.token_count += tokens
                session.touch()

    def delete(self, session_id: str) -> bool:
        with self._lock:
            return self._sessions.pop(session_id, None) is not None

    def list_sessions(
        self,
        *,
        client_id: str | None = None,
        active_only: bool = True,
    ) -> list[_Session]:
        self._evict_expired()
        with self._lock:
            sessions = list(self._sessions.values())

        if client_id:
            sessions = [s for s in sessions if s.client_id == client_id]
        if active_only:
            sessions = [s for s in sessions if not s.is_expired]
        return sessions

    def stats(self) -> dict[str, Any]:
        self._evict_expired()
        with self._lock:
            total = len(self._sessions)
            active = sum(1 for s in self._sessions.values() if not s.is_expired)
            total_requests = sum(s.request_count for s in self._sessions.values())
            total_tokens = sum(s.token_count for s in self._sessions.values())

        return {
            "total_sessions": total,
            "active_sessions": active,
            "total_requests": total_requests,
            "total_tokens": total_tokens,
        }

    def _evict_expired(self) -> None:
        """Remove all expired sessions."""
        with self._lock:
            expired = [
                sid for sid, s in self._sessions.items() if s.is_expired
            ]
            for sid in expired:
                del self._sessions[sid]


# Module-level singleton
_manager: SessionManager | None = None


def get_session_manager() -> SessionManager:
    global _manager
    if _manager is None:
        _manager = SessionManager()
    return _manager


__all__ = [
    "SessionCreate",
    "SessionInfo",
    "SessionManager",
    "get_session_manager",
]

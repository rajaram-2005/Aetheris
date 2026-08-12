"""Scoped API key management for Aetheris.

Provides a full API key lifecycle: creation with scoped permissions, usage
tracking, rotation, and revocation. Each key has a set of allowed scopes
(e.g. ``chat:read``, ``tools:write``) that gate access at the middleware
level.

Keys are stored with a SHA-256 hash (never in plaintext after creation).
The full key is returned exactly once — at creation time.
"""

from __future__ import annotations

import hashlib
import secrets
import time
import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


# All available scopes
AVAILABLE_SCOPES = [
    "chat:read", "chat:write",
    "tools:read", "tools:write", "tools:execute",
    "documents:read", "documents:write",
    "conversations:read", "conversations:write",
    "presets:read", "presets:write",
    "analytics:read",
    "admin:read", "admin:write",
]


class ApiKeyCreate(BaseModel):
    """Create a new API key."""
    name: str = Field(..., min_length=1, max_length=128, description="Human-readable key name.")
    scopes: list[str] = Field(
        default_factory=lambda: ["chat:read", "chat:write"],
        description="Permission scopes for this key.",
    )
    expires_in_seconds: int = Field(
        default=0, ge=0,
        description="TTL in seconds (0 = never expires).",
    )
    metadata: dict[str, Any] = Field(default_factory=dict)
    rate_limit: int = Field(
        default=0, ge=0,
        description="Per-key rate limit (0 = use global default).",
    )


class ApiKeyInfo(BaseModel):
    id: str
    name: str
    key_prefix: str
    scopes: list[str]
    expires_at: float | None
    created_at: float
    last_used_at: float | None
    usage_count: int
    is_expired: bool
    metadata: dict[str, Any]
    rate_limit: int


class ApiKeyCreated(BaseModel):
    """Response when a key is created — includes the full key (shown only once)."""
    id: str
    name: str
    key: str = Field(description="Full API key — save this, it won't be shown again.")
    key_prefix: str
    scopes: list[str]
    expires_at: float | None


def _hash_key(key: str) -> str:
    """Hash an API key for storage."""
    return hashlib.sha256(key.encode()).hexdigest()


def _generate_key() -> str:
    """Generate a new API key."""
    return f"aeth_{secrets.token_urlsafe(32)}"


# --- Internal -----------------------------------------------------------------

@dataclass
class _ApiKey:
    id: str
    name: str
    key_hash: str
    key_prefix: str
    scopes: list[str]
    expires_at: float | None
    created_at: float
    last_used_at: float | None
    usage_count: int
    revoked: bool
    metadata: dict[str, Any]
    rate_limit: int

    def to_info(self) -> ApiKeyInfo:
        now = time.time()
        expired = self.revoked or (self.expires_at is not None and now >= self.expires_at)
        return ApiKeyInfo(
            id=self.id, name=self.name, key_prefix=self.key_prefix,
            scopes=self.scopes, expires_at=self.expires_at,
            created_at=self.created_at, last_used_at=self.last_used_at,
            usage_count=self.usage_count, is_expired=expired,
            metadata=self.metadata, rate_limit=self.rate_limit,
        )


# --- Manager ------------------------------------------------------------------

class ApiKeyManager:
    """Thread-safe API key manager."""

    def __init__(self, max_keys: int = 100) -> None:
        self._keys: dict[str, _ApiKey] = {}
        self._lock = Lock()
        self._max = max_keys

    def create(self, body: ApiKeyCreate) -> ApiKeyCreated:
        """Create a new API key. Returns the full key exactly once."""
        with self._lock:
            if len(self._keys) >= self._max:
                raise ValueError(f"Maximum of {self._max} API keys reached.")
            raw_key = _generate_key()
            key_hash = _hash_key(raw_key)
            key_prefix = raw_key[:12]
            now = time.time()
            expires_at = now + body.expires_in_seconds if body.expires_in_seconds > 0 else None
            api_key = _ApiKey(
                id=f"apikey_{uuid.uuid4().hex[:8]}",
                name=body.name, key_hash=key_hash, key_prefix=key_prefix,
                scopes=body.scopes, expires_at=expires_at,
                created_at=now, last_used_at=None, usage_count=0,
                revoked=False, metadata=body.metadata,
                rate_limit=body.rate_limit,
            )
            self._keys[api_key.id] = api_key
        return ApiKeyCreated(
            id=api_key.id, name=api_key.name, key=raw_key,
            key_prefix=key_prefix, scopes=body.scopes,
            expires_at=expires_at,
        )

    def verify(self, raw_key: str) -> _ApiKey | None:
        """Verify an API key and update usage stats."""
        key_hash = _hash_key(raw_key)
        with self._lock:
            for ak in self._keys.values():
                if ak.key_hash == key_hash and not ak.revoked:
                    now = time.time()
                    if ak.expires_at is not None and now >= ak.expires_at:
                        return None
                    ak.last_used_at = now
                    ak.usage_count += 1
                    return ak
        return None

    def get(self, key_id: str) -> _ApiKey | None:
        with self._lock:
            return self._keys.get(key_id)

    def revoke(self, key_id: str) -> bool:
        with self._lock:
            ak = self._keys.get(key_id)
            if ak is None:
                return False
            ak.revoked = True
        return True

    def rotate(self, key_id: str) -> ApiKeyCreated | None:
        """Rotate an API key — creates a new key and revokes the old one."""
        with self._lock:
            old = self._keys.get(key_id)
            if old is None:
                return None
            old.revoked = True
        # Create new key with same properties
        body = ApiKeyCreate(
            name=old.name + " (rotated)",
            scopes=old.scopes,
            metadata=old.metadata,
            rate_limit=old.rate_limit,
        )
        return self.create(body)

    def delete(self, key_id: str) -> bool:
        with self._lock:
            return self._keys.pop(key_id, None) is not None

    def list_keys(self, *, revoked: bool | None = None) -> list[_ApiKey]:
        with self._lock:
            keys = list(self._keys.values())
        if revoked is not None:
            keys = [k for k in keys if k.revoked == revoked]
        return sorted(keys, key=lambda k: k.created_at, reverse=True)

    def has_scope(self, key_id: str, scope: str) -> bool:
        """Check if a key has a specific scope."""
        with self._lock:
            ak = self._keys.get(key_id)
            if ak is None or ak.revoked:
                return False
            return scope in ak.scopes or "admin:write" in ak.scopes

    def stats(self) -> dict[str, Any]:
        with self._lock:
            now = time.time()
            active = [k for k in self._keys.values() if not k.revoked and (k.expires_at is None or now < k.expires_at)]
            return {
                "total": len(self._keys),
                "active": len(active),
                "revoked": sum(1 for k in self._keys.values() if k.revoked),
                "expired": sum(1 for k in self._keys.values() if not k.revoked and k.expires_at is not None and now >= k.expires_at),
                "total_usage": sum(k.usage_count for k in self._keys.values()),
            }


_manager: ApiKeyManager | None = None


def get_api_key_manager() -> ApiKeyManager:
    global _manager
    if _manager is None:
        _manager = ApiKeyManager()
    return _manager


__all__ = ["ApiKeyManager", "ApiKeyCreate", "ApiKeyInfo", "ApiKeyCreated", "get_api_key_manager", "AVAILABLE_SCOPES"]

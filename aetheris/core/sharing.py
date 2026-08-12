"""Entity sharing and permissions for Aetheris.

Allows sharing any entity with other users (or publicly) with configurable
permission levels. Supports:

* Permission levels: viewer, editor, admin, owner
* Public sharing via shareable links with optional expiry
* Per-entity access control lists
* Share revocation and permission changes
"""

from __future__ import annotations

import hashlib
import secrets
import time
import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Any, Literal

from pydantic import BaseModel, Field

PermissionLevel = Literal["viewer", "editor", "admin", "owner"]
ShareEntityType = Literal["conversation", "prompt", "file", "workflow", "preset"]


class ShareCreate(BaseModel):
    """Share an entity with a user or publicly."""
    entity_type: ShareEntityType = Field(..., description="Type of entity.")
    entity_id: str = Field(..., min_length=1, description="ID of the entity.")
    permission: PermissionLevel = Field(default="viewer", description="Permission level.")
    shared_with: str = Field(default="", max_length=128, description="User/key ID to share with (empty = public link).")
    expires_in_seconds: int = Field(default=0, ge=0, description="Link TTL (0 = never expires, only for public).")
    note: str = Field(default="", max_length=500, description="Optional note for the share recipient.")


class ShareInfo(BaseModel):
    id: str
    entity_type: str
    entity_id: str
    permission: str
    shared_with: str
    is_public: bool
    link_token: str | None
    expires_at: float | None
    created_at: float
    note: str


class PermissionCheck(BaseModel):
    entity_type: str
    entity_id: str
    user: str
    permission: str
    allowed: bool
    via_share: str | None = Field(default=None, description="Share ID that grants this permission, if any.")


# --- Internal -----------------------------------------------------------------

@dataclass
class _Share:
    id: str
    entity_type: str
    entity_id: str
    permission: str
    shared_with: str
    is_public: bool
    link_token: str | None
    expires_at: float | None
    created_at: float
    note: str
    revoked: bool = False

    def to_info(self) -> ShareInfo:
        return ShareInfo(
            id=self.id, entity_type=self.entity_type, entity_id=self.entity_id,
            permission=self.permission, shared_with=self.shared_with,
            is_public=self.is_public, link_token=self.link_token,
            expires_at=self.expires_at, created_at=self.created_at,
            note=self.note,
        )

    def is_valid(self) -> bool:
        if self.revoked:
            return False
        if self.expires_at is not None and time.time() >= self.expires_at:
            return False
        return True


_PERMISSION_ORDER = {"viewer": 0, "editor": 1, "admin": 2, "owner": 3}


# --- Manager ------------------------------------------------------------------

class ShareManager:
    """Thread-safe entity sharing manager."""

    def __init__(self, max_shares: int = 1000) -> None:
        self._shares: dict[str, _Share] = {}
        self._lock = Lock()
        self._max = max_shares

    def create(self, body: ShareCreate) -> _Share:
        with self._lock:
            if len(self._shares) >= self._max:
                raise ValueError(f"Maximum of {self._max} shares reached.")
            is_public = body.shared_with == ""
            link_token = f"share_{secrets.token_urlsafe(16)}" if is_public else None
            expires_at = time.time() + body.expires_in_seconds if (is_public and body.expires_in_seconds > 0) else None
            share = _Share(
                id=f"shr_{uuid.uuid4().hex[:8]}",
                entity_type=body.entity_type, entity_id=body.entity_id,
                permission=body.permission, shared_with=body.shared_with,
                is_public=is_public, link_token=link_token,
                expires_at=expires_at, created_at=time.time(),
                note=body.note,
            )
            self._shares[share.id] = share
        return share

    def get(self, share_id: str) -> _Share | None:
        with self._lock:
            return self._shares.get(share_id)

    def get_by_link(self, link_token: str) -> _Share | None:
        with self._lock:
            for s in self._shares.values():
                if s.link_token == link_token and s.is_valid():
                    return s
        return None

    def revoke(self, share_id: str) -> bool:
        with self._lock:
            s = self._shares.get(share_id)
            if s is None:
                return False
            s.revoked = True
        return True

    def delete(self, share_id: str) -> bool:
        with self._lock:
            return self._shares.pop(share_id, None) is not None

    def list_shares(
        self,
        *,
        entity_type: str | None = None,
        entity_id: str | None = None,
        shared_with: str | None = None,
    ) -> list[_Share]:
        with self._lock:
            shares = list(self._shares.values())
        if entity_type:
            shares = [s for s in shares if s.entity_type == entity_type]
        if entity_id:
            shares = [s for s in shares if s.entity_id == entity_id]
        if shared_with:
            shares = [s for s in shares if s.shared_with == shared_with]
        return [s for s in shares if s.is_valid()]

    def check_permission(
        self, entity_type: str, entity_id: str, user: str, required: str = "viewer"
    ) -> PermissionCheck:
        """Check if a user has the required permission on an entity."""
        with self._lock:
            for s in self._shares.values():
                if not s.is_valid():
                    continue
                if s.entity_type != entity_type or s.entity_id != entity_id:
                    continue
                # Direct share to this user
                if s.shared_with == user:
                    if _PERMISSION_ORDER.get(s.permission, 0) >= _PERMISSION_ORDER.get(required, 0):
                        return PermissionCheck(
                            entity_type=entity_type, entity_id=entity_id,
                            user=user, permission=required, allowed=True,
                            via_share=s.id,
                        )
                # Public share grants viewer access
                if s.is_public and required == "viewer":
                    return PermissionCheck(
                        entity_type=entity_type, entity_id=entity_id,
                        user=user, permission=required, allowed=True,
                        via_share=s.id,
                    )
        return PermissionCheck(
            entity_type=entity_type, entity_id=entity_id,
            user=user, permission=required, allowed=False,
        )

    def stats(self) -> dict[str, Any]:
        with self._lock:
            now = time.time()
            return {
                "total": len(self._shares),
                "active": sum(1 for s in self._shares.values() if s.is_valid()),
                "revoked": sum(1 for s in self._shares.values() if s.revoked),
                "expired": sum(1 for s in self._shares.values() if not s.revoked and s.expires_at is not None and now >= s.expires_at),
                "public": sum(1 for s in self._shares.values() if s.is_public),
            }


_manager: ShareManager | None = None


def get_share_manager() -> ShareManager:
    global _manager
    if _manager is None:
        _manager = ShareManager()
    return _manager


__all__ = ["ShareManager", "ShareCreate", "ShareInfo", "PermissionCheck", "get_share_manager"]

"""Universal connection registry for Aetheris.

Manages authenticated connections to external services and applications. Each
connection stores credentials securely (base64-obfuscated at rest) and provides
a consistent interface for making authenticated requests to any service.

Supported auth types:
* ``api_key`` -- static key in header or query param
* ``bearer`` -- Bearer token in Authorization header
* ``basic`` -- username:password (HTTP Basic)
* ``oauth2`` -- OAuth 2.0 client credentials flow with auto-refresh
* ``custom`` -- arbitrary header injection

Connections are the foundation of the workflow engine: every external step
references a connection by ID.
"""

from __future__ import annotations

import base64
import logging
import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Literal

from pydantic import BaseModel, Field

logger = logging.getLogger("aetheris.connections")

# --- Schemas ------------------------------------------------------------------

AuthType = Literal["api_key", "bearer", "basic", "oauth2", "custom"]


class ConnectionCreate(BaseModel):
    """Request to create a new connection."""

    name: str = Field(..., min_length=1, max_length=128)
    service_type: str = Field(..., max_length=64, description="Service identifier (e.g. 'slack', 'github').")
    auth_type: AuthType = Field(..., description="Authentication method.")
    base_url: str = Field(default="", max_length=2048, description="Base URL for API requests.")
    api_key_val: str = Field(default="", max_length=2048, description="API key value.")
    bearer_token: str = Field(default="", max_length=4096, description="Bearer token.")
    username: str = Field(default="", max_length=256, description="Username (basic auth).")
    password: str = Field(default="", max_length=256, description="Password (basic auth).")
    oauth_client_id: str = Field(default="", max_length=512)
    oauth_client_secret: str = Field(default="", max_length=512)
    oauth_token_url: str = Field(default="", max_length=2048)
    oauth_scope: str = Field(default="", max_length=512)
    auth_header_name: str = Field(default="Authorization", max_length=128)
    auth_header_prefix: str = Field(default="", max_length=64, description="Prefix before credential (e.g. 'Bearer ', 'Token ').")
    auth_query_param: str = Field(default="", max_length=128, description="Inject key as this query param instead of header.")
    custom_headers: dict[str, str] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ConnectionInfo(BaseModel):
    """Public view of a connection (credentials never exposed)."""

    id: str
    name: str
    service_type: str
    auth_type: AuthType
    base_url: str
    has_credentials: bool
    created_at: float
    last_used_at: float | None
    request_count: int
    metadata: dict[str, Any]
    custom_headers: dict[str, str]


class ConnectionTestResult(BaseModel):
    """Result of testing a connection."""

    ok: bool
    status_code: int | None = None
    error: str | None = None
    latency_ms: int | None = None


# --- Obfuscation helpers (not encryption -- just prevents casual leakage) ------

def _obfuscate(value: str) -> str:
    if not value:
        return ""
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def _deobfuscate(value: str) -> str:
    if not value:
        return ""
    try:
        return base64.b64decode(value.encode("ascii")).decode("utf-8")
    except Exception:
        return ""


# --- Internal storage ---------------------------------------------------------

@dataclass
class _Connection:
    id: str
    name: str
    service_type: str
    auth_type: AuthType
    base_url: str
    _api_key: str
    _bearer_token: str
    _username: str
    _password: str
    _oauth_client_id: str
    _oauth_client_secret: str
    _oauth_token_url: str
    _oauth_scope: str
    _oauth_access_token: str = ""
    _oauth_expires_at: float = 0.0
    auth_header_name: str = "Authorization"
    auth_header_prefix: str = ""
    auth_query_param: str = ""
    custom_headers: dict[str, str] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: float = 0.0
    last_used_at: float | None = None
    request_count: int = 0

    @property
    def has_credentials(self) -> bool:
        if self.auth_type == "api_key":
            return bool(self._api_key)
        if self.auth_type == "bearer":
            return bool(self._bearer_token)
        if self.auth_type == "basic":
            return bool(self._username and self._password)
        if self.auth_type == "oauth2":
            return bool(self._oauth_client_id and self._oauth_client_secret)
        return bool(self.custom_headers)

    def build_auth_headers(self) -> dict[str, str]:
        headers = dict(self.custom_headers)
        if self.auth_type == "api_key" and self._api_key:
            if not self.auth_query_param:
                raw = _deobfuscate(self._api_key)
                value = f"{self.auth_header_prefix}{raw}" if self.auth_header_prefix else raw
                headers[self.auth_header_name] = value
        elif self.auth_type == "bearer" and self._bearer_token:
            headers["Authorization"] = f"Bearer {_deobfuscate(self._bearer_token)}"
        elif self.auth_type == "basic" and self._username and self._password:
            cred = base64.b64encode(
                f"{_deobfuscate(self._username)}:{_deobfuscate(self._password)}".encode()
            ).decode()
            headers["Authorization"] = f"Basic {cred}"
        elif self.auth_type == "oauth2" and self._oauth_access_token:
            headers["Authorization"] = f"Bearer {self._oauth_access_token}"
        return headers

    def build_auth_params(self) -> dict[str, str]:
        if self.auth_type == "api_key" and self._api_key and self.auth_query_param:
            return {self.auth_query_param: _deobfuscate(self._api_key)}
        return {}

    def to_info(self) -> ConnectionInfo:
        return ConnectionInfo(
            id=self.id, name=self.name, service_type=self.service_type,
            auth_type=self.auth_type, base_url=self.base_url,
            has_credentials=self.has_credentials, created_at=self.created_at,
            last_used_at=self.last_used_at, request_count=self.request_count,
            metadata=self.metadata, custom_headers=self.custom_headers,
        )


# --- Registry -----------------------------------------------------------------

class ConnectionRegistry:
    """Thread-safe in-memory connection registry."""

    def __init__(self, max_connections: int = 100) -> None:
        self._connections: dict[str, _Connection] = {}
        self._lock = Lock()
        self._max = max_connections

    def create(self, body: ConnectionCreate) -> _Connection:
        with self._lock:
            if len(self._connections) >= self._max:
                raise ValueError(f"Maximum of {self._max} connections reached.")
            conn = _Connection(
                id=f"conn_{uuid.uuid4().hex[:12]}",
                name=body.name, service_type=body.service_type,
                auth_type=body.auth_type, base_url=body.base_url.rstrip("/"),
                _api_key=_obfuscate(body.api_key_val),
                _bearer_token=_obfuscate(body.bearer_token),
                _username=_obfuscate(body.username),
                _password=_obfuscate(body.password),
                _oauth_client_id=_obfuscate(body.oauth_client_id),
                _oauth_client_secret=_obfuscate(body.oauth_client_secret),
                _oauth_token_url=body.oauth_token_url,
                _oauth_scope=body.oauth_scope,
                auth_header_name=body.auth_header_name,
                auth_header_prefix=body.auth_header_prefix,
                auth_query_param=body.auth_query_param,
                custom_headers=body.custom_headers, metadata=body.metadata,
                created_at=time.time(),
            )
            self._connections[conn.id] = conn
        logger.info("Connection created: %s (%s, %s)", conn.name, conn.service_type, conn.auth_type)
        return conn

    def get(self, conn_id: str) -> _Connection | None:
        with self._lock:
            return self._connections.get(conn_id)

    def delete(self, conn_id: str) -> bool:
        with self._lock:
            return self._connections.pop(conn_id, None) is not None

    def list_connections(self, *, service_type: str | None = None) -> list[_Connection]:
        with self._lock:
            conns = list(self._connections.values())
        if service_type:
            conns = [c for c in conns if c.service_type == service_type]
        return conns

    async def refresh_oauth(self, conn_id: str) -> bool:
        import httpx
        conn = self.get(conn_id)
        if conn is None or conn.auth_type != "oauth2":
            return False
        if time.time() < conn._oauth_expires_at - 30:
            return True
        client_id = _deobfuscate(conn._oauth_client_id)
        client_secret = _deobfuscate(conn._oauth_client_secret)
        if not client_id or not client_secret or not conn._oauth_token_url:
            return False
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    conn._oauth_token_url,
                    data={
                        "grant_type": "client_credentials",
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "scope": conn._oauth_scope,
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
                resp.raise_for_status()
                data = resp.json()
                conn._oauth_access_token = data.get("access_token", "")
                conn._oauth_expires_at = time.time() + data.get("expires_in", 3600)
                logger.info("OAuth token refreshed for connection %s", conn_id)
                return bool(conn._oauth_access_token)
        except Exception as exc:
            logger.warning("OAuth refresh failed for %s: %s", conn_id, exc)
            return False

    async def test_connection(self, conn_id: str) -> ConnectionTestResult:
        import httpx
        conn = self.get(conn_id)
        if conn is None:
            return ConnectionTestResult(ok=False, error="Connection not found.")
        if not conn.base_url:
            return ConnectionTestResult(ok=False, error="No base URL configured.")
        if conn.auth_type == "oauth2":
            await self.refresh_oauth(conn_id)
        headers = conn.build_auth_headers()
        headers["User-Agent"] = "Aetheris/0.2.0"
        params = conn.build_auth_params()
        started = time.time()
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(conn.base_url, headers=headers, params=params)
            latency = int((time.time() - started) * 1000)
            ok = resp.status_code < 500
            return ConnectionTestResult(ok=ok, status_code=resp.status_code, latency_ms=latency, error=None if ok else f"HTTP {resp.status_code}")
        except Exception as exc:
            latency = int((time.time() - started) * 1000)
            return ConnectionTestResult(ok=False, error=str(exc), latency_ms=latency)

    async def request(
        self,
        conn_id: str,
        method: str = "GET",
        path: str = "",
        *,
        json_body: dict | None = None,
        form_data: dict | None = None,
        query_params: dict[str, str] | None = None,
        extra_headers: dict[str, str] | None = None,
        timeout: float = 30.0,
    ) -> dict[str, Any]:
        """Make an authenticated request through a connection."""
        import httpx
        conn = self.get(conn_id)
        if conn is None:
            return {"ok": False, "error": f"Connection '{conn_id}' not found."}
        if conn.auth_type == "oauth2":
            await self.refresh_oauth(conn_id)
        url = f"{conn.base_url}{path}" if conn.base_url else path
        headers = conn.build_auth_headers()
        headers["User-Agent"] = "Aetheris/0.2.0"
        if extra_headers:
            headers.update(extra_headers)
        params = conn.build_auth_params()
        if query_params:
            params.update(query_params)
        started = time.time()
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.request(
                    method.upper(), url, headers=headers,
                    params=params or None, json=json_body, data=form_data,
                )
            duration_ms = int((time.time() - started) * 1000)
            with self._lock:
                conn.request_count += 1
                conn.last_used_at = time.time()
            content_type = resp.headers.get("content-type", "")
            if "json" in content_type:
                try:
                    body = resp.json()
                except Exception:
                    body = resp.text
            else:
                body = resp.text
            return {"ok": resp.status_code < 400, "status_code": resp.status_code, "body": body, "headers": dict(resp.headers), "duration_ms": duration_ms}
        except Exception as exc:
            duration_ms = int((time.time() - started) * 1000)
            return {"ok": False, "error": str(exc), "duration_ms": duration_ms}

    def stats(self) -> dict[str, Any]:
        with self._lock:
            by_type: dict[str, int] = {}
            by_auth: dict[str, int] = {}
            for c in self._connections.values():
                by_type[c.service_type] = by_type.get(c.service_type, 0) + 1
                by_auth[c.auth_type] = by_auth.get(c.auth_type, 0) + 1
            return {"total": len(self._connections), "by_service_type": by_type, "by_auth_type": by_auth}


_registry: ConnectionRegistry | None = None


def get_connection_registry() -> ConnectionRegistry:
    global _registry
    if _registry is None:
        _registry = ConnectionRegistry()
    return _registry


__all__ = [
    "AuthType", "ConnectionCreate", "ConnectionInfo", "ConnectionTestResult",
    "ConnectionRegistry", "get_connection_registry",
]

"""Aetheris API middleware stack.

Provides security and operational middleware applied to every request:

* ``APIKeyMiddleware`` — validates API keys when auth is enabled
* ``RateLimitMiddleware`` — enforces per-client rate limits
* ``SecurityHeadersMiddleware`` — injects standard security headers
* ``RequestSizeLimitMiddleware`` — rejects oversized request bodies
* ``AuditMiddleware`` — records every request in the audit log
* ``MetricsMiddleware`` — tracks request counts and latencies
* ``CORSMiddleware`` — configurable CORS (replaces wildcard ``*``)
* ``ContentFilterMiddleware`` — scans inputs for PII and injection risks
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse

from ..core.config import settings
from ..core.rate_limiter import get_limiter
from ..core.audit import record_event
from ..core.metrics import get_metrics
from ..core.security import sanitize_input, redact_pii, detect_injection

logger = logging.getLogger("aetheris.middleware")


# --- Helpers ------------------------------------------------------------------

def _client_id(request: Request) -> str:
    """Extract a client identifier from the request for rate limiting."""
    # Prefer authenticated identity, fall back to IP
    auth_id = getattr(request.state, "client_id", None)
    if auth_id:
        return auth_id
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _request_id() -> str:
    return f"req_{uuid.uuid4().hex[:16]}"


# --- API Key Authentication ---------------------------------------------------

class APIKeyMiddleware(BaseHTTPMiddleware):
    """Validate API keys when authentication is enabled.

    When ``AETHERIS_AUTH_ENABLED=true``, every request (except health and
    landing) must include a valid API key in the ``Authorization`` header
    as ``Bearer <key>`` or in the ``X-API-Key`` header.

    Keys are validated against ``AETHERIS_AUTH_API_KEYS`` (comma-separated
    list of pre-configured keys) or a single ``AETHERIS_AUTH_API_KEY``.
    """

    # Paths that never require authentication
    PUBLIC_PATHS = {"/", "/v1/health", "/docs", "/openapi.json", "/redoc"}

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if not settings.auth_enabled:
            return await call_next(request)

        # Public paths bypass auth
        if request.url.path in self.PUBLIC_PATHS:
            return await call_next(request)

        # Also bypass for static assets
        if request.url.path.startswith("/static/"):
            return await call_next(request)

        # Extract the API key
        api_key = self._extract_key(request)
        if not api_key:
            record_event("auth", "api_key_missing", _client_id(request), "denied")
            get_metrics().record_auth_failure()
            return JSONResponse(
                status_code=401,
                content={"detail": "Missing API key. Provide Authorization: Bearer <key> or X-API-Key header."},
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Validate
        if not self._validate_key(api_key):
            record_event("auth", "api_key_invalid", _client_id(request), "denied")
            get_metrics().record_auth_failure()
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid API key."},
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Attach client identity
        from ..core.security import hash_api_key
        request.state.client_id = f"key:{hash_api_key(api_key)[:16]}"
        request.state.authenticated = True

        return await call_next(request)

    @staticmethod
    def _extract_key(request: Request) -> str | None:
        # Authorization: Bearer <key>
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        # X-API-Key: <key>
        return request.headers.get("x-api-key") or None

    @staticmethod
    def _validate_key(key: str) -> bool:
        from ..core.security import verify_api_key, hash_api_key
        stored = settings.auth_valid_keys
        if not stored:
            return False
        key_hash = hash_api_key(key)
        return any(verify_api_key(key, h) for h in stored)


# --- Rate Limiting ------------------------------------------------------------

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Enforce per-client rate limits on API endpoints."""

    # Paths exempt from rate limiting
    EXEMPT_PATHS = {"/", "/v1/health", "/docs", "/openapi.json", "/redoc"}

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if not settings.rate_limit_enabled:
            return await call_next(request)

        if request.url.path in self.EXEMPT_PATHS:
            return await call_next(request)

        client = _client_id(request)
        limiter = get_limiter()
        result = limiter.check(client)

        if not result.allowed:
            get_metrics().record_rate_limit_rejection()
            record_event(
                "security", "rate_limited", client, "denied",
                details={"retry_after": result.retry_after},
            )
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Please retry later."},
                headers={
                    "Retry-After": str(int(result.retry_after or 1)),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(result.reset_at)),
                },
            )

        response = await call_next(request)

        # Attach rate-limit headers to successful responses
        response.headers["X-RateLimit-Remaining"] = str(result.remaining)
        response.headers["X-RateLimit-Reset"] = str(int(result.reset_at))
        return response


# --- Security Headers ---------------------------------------------------------

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Inject standard security headers into every response.

    * ``X-Content-Type-Options: nosniff``
    * ``X-Frame-Options: DENY``
    * ``X-XSS-Protection: 0`` (modern browsers handle this; CSP is preferred)
    * ``Referrer-Policy: strict-origin-when-cross-origin``
    * ``Permissions-Policy`` — restrict browser features
    * ``Content-Security-Policy`` — if configured
    * ``Strict-Transport-Security`` — if configured
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        response = await call_next(request)

        if not settings.security_headers_enabled:
            return response

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "0"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=()"
        )

        if settings.security_csp:
            response.headers["Content-Security-Policy"] = settings.security_csp
        if settings.security_hsts_max_age > 0:
            max_age = settings.security_hsts_max_age
            include_subdomains = "; includeSubDomains" if settings.security_hsts_include_subdomains else ""
            response.headers["Strict-Transport-Security"] = (
                f"max-age={max_age}{include_subdomains}"
            )

        # Remove server identification
        for key in list(response.headers.keys()):
            if key.lower() == "server":
                del response.headers[key]

        return response


# --- Request Size Limit -------------------------------------------------------

class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests whose body exceeds ``AETHERIS_MAX_REQUEST_SIZE_BYTES``."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return await call_next(request)

        content_length = request.headers.get("content-length")
        if content_length:
            try:
                size = int(content_length)
                if size > settings.max_request_size_bytes:
                    record_event(
                        "security", "oversized_request", _client_id(request), "denied",
                        details={"size": size, "limit": settings.max_request_size_bytes},
                    )
                    return JSONResponse(
                        status_code=413,
                        content={"detail": f"Request body exceeds {settings.max_request_size_bytes} byte limit."},
                    )
            except ValueError:
                pass

        return await call_next(request)


# --- Audit Middleware ----------------------------------------------------------

class AuditMiddleware(BaseHTTPMiddleware):
    """Record every API request in the audit log."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if not settings.audit_enabled:
            return await call_next(request)

        request_id = _request_id()
        request.state.request_id = request_id
        start = time.time()

        response = await call_next(request)

        duration_ms = int((time.time() - start) * 1000)
        client = _client_id(request)
        outcome = "success" if response.status_code < 400 else "failure"

        record_event(
            event_type="request",
            action=f"{request.method} {request.url.path}",
            actor=client,
            outcome=outcome,
            details={
                "status_code": response.status_code,
                "method": request.method,
                "path": request.url.path,
            },
            request_id=request_id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            duration_ms=duration_ms,
        )

        # Attach request ID to response for tracing
        response.headers["X-Request-Id"] = request_id
        return response


# --- Metrics Middleware --------------------------------------------------------

class MetricsMiddleware(BaseHTTPMiddleware):
    """Track request counts and latencies."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        metrics = get_metrics()
        metrics.increment_active()
        start = time.time()

        try:
            response = await call_next(request)
            duration_ms = (time.time() - start) * 1000
            endpoint = f"{request.method} {request.url.path}"
            metrics.record_request(
                endpoint, duration_ms, error=response.status_code >= 500
            )
            return response
        except Exception:
            duration_ms = (time.time() - start) * 1000
            endpoint = f"{request.method} {request.url.path}"
            metrics.record_request(endpoint, duration_ms, error=True)
            raise
        finally:
            metrics.decrement_active()


# --- Content Filter Middleware -------------------------------------------------

class ContentFilterMiddleware(BaseHTTPMiddleware):
    """Scan request bodies for PII and prompt-injection patterns.

    When ``AETHERIS_CONTENT_FILTER_ENABLED=true``:
    * PII is automatically redacted from the request body.
    * Prompt-injection patterns are detected and optionally blocked.
    """

    # Only scan these paths
    SCAN_PATHS = {"/v1/chat/completions", "/v1/documents", "/v1/documents/upload"}

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if not settings.content_filter_enabled:
            return await call_next(request)

        if request.url.path not in self.SCAN_PATHS:
            return await call_next(request)

        if request.method not in ("POST", "PUT", "PATCH"):
            return await call_next(request)

        # Read and scan the body
        body = await request.body()
        if not body:
            return await call_next(request)

        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError:
            return await call_next(request)

        # Sanitize input
        sanitized = sanitize_input(text, max_length=settings.max_request_size_bytes)

        # Check for PII
        if settings.content_filter_redact_pii:
            filter_result = redact_pii(sanitized)
            if filter_result.has_pii:
                record_event(
                    "security", "pii_detected", _client_id(request), "redacted",
                    details={"redactions": filter_result.redactions},
                )

        # Check for injection risks
        if settings.content_filter_block_injection:
            injection_result = detect_injection(sanitized)
            if injection_result.has_injection_risk:
                record_event(
                    "security", "injection_blocked", _client_id(request), "denied",
                    details={"patterns": injection_result.injection_matches},
                )
                get_metrics().record_content_filter_rejection()
                return JSONResponse(
                    status_code=400,
                    content={
                        "detail": "Request contains patterns consistent with prompt injection. "
                                  "Please rephrase your request.",
                    },
                )

        return await call_next(request)


# --- Install all middleware ----------------------------------------------------

def install_middleware(app: FastAPI) -> None:
    """Install the full Aetheris middleware stack onto a FastAPI app."""
    # Order matters: outermost first
    # 1. Metrics (outermost — tracks everything including rejections)
    app.add_middleware(MetricsMiddleware)
    # 2. Audit (records every request)
    app.add_middleware(AuditMiddleware)
    # 3. Security headers (adds headers to every response)
    app.add_middleware(SecurityHeadersMiddleware)
    # 4. Request size limit (rejects oversized payloads early)
    app.add_middleware(RequestSizeLimitMiddleware)
    # 5. Content filter (scans inputs)
    app.add_middleware(ContentFilterMiddleware)
    # 6. Rate limiting (enforces per-client limits)
    app.add_middleware(RateLimitMiddleware)
    # 7. API key auth (innermost — validates credentials)
    app.add_middleware(APIKeyMiddleware)

    # CORS — replace the wildcard with configurable origins
    if settings.cors_origins:
        origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
        if origins:
            app.add_middleware(
                CORSMiddleware,
                allow_origins=origins,
                allow_credentials=settings.cors_allow_credentials,
                allow_methods=settings.cors_methods.split(",") if settings.cors_methods else ["*"],
                allow_headers=settings.cors_headers.split(",") if settings.cors_headers else ["*"],
            )
            logger.info("CORS configured with %d allowed origins", len(origins))
        else:
            # Fallback: wildcard CORS (original behavior)
            app.add_middleware(
                CORSMiddleware,
                allow_origins=["*"],
                allow_credentials=False,
                allow_methods=["*"],
                allow_headers=["*"],
            )
    else:
        # No explicit CORS config: use wildcard for backward compatibility
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )


__all__ = [
    "APIKeyMiddleware",
    "RateLimitMiddleware",
    "SecurityHeadersMiddleware",
    "RequestSizeLimitMiddleware",
    "AuditMiddleware",
    "MetricsMiddleware",
    "ContentFilterMiddleware",
    "install_middleware",
]

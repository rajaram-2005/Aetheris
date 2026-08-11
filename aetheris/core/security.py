"""Security utilities for Aetheris.

Provides:
* API key validation and comparison (constant-time)
* HMAC-based session token generation and verification
* Content filtering / PII redaction for inputs
* Input sanitization helpers
* Cryptographic utilities for webhook signing
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import time
from dataclasses import dataclass, field


# --- API Key Management -------------------------------------------------------

def generate_api_key(prefix: str = "aeth") -> str:
    """Generate a cryptographically secure API key with a human-readable prefix.

    Format: ``{prefix}_{32_hex_chars}``
    """
    return f"{prefix}_{secrets.token_hex(32)}"


def hash_api_key(key: str) -> str:
    """Hash an API key for storage using SHA-256 (one-way)."""
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def verify_api_key(key: str, stored_hash: str) -> bool:
    """Verify an API key against its stored hash in constant time."""
    computed = hash_api_key(key)
    return hmac.compare_digest(computed, stored_hash)


# --- Session Tokens (HMAC) ----------------------------------------------------

@dataclass(frozen=True)
class SessionToken:
    """A time-bounded, HMAC-signed session token."""

    token: str
    expires_at: float
    client_id: str


def create_session_token(
    client_id: str,
    secret: str,
    ttl_seconds: int = 3600,
) -> SessionToken:
    """Create an HMAC-signed session token bound to a client ID.

    The token encodes ``client_id:timestamp`` and signs it with the secret,
    so it cannot be tampered with without detection.
    """
    now = time.time()
    expires_at = now + ttl_seconds
    payload = f"{client_id}:{now:.6f}"
    signature = hmac.new(
        secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    token = f"{payload}:{signature}"
    return SessionToken(token=token, expires_at=expires_at, client_id=client_id)


def verify_session_token(
    token: str,
    secret: str,
    max_age_seconds: int = 3600,
) -> str | None:
    """Verify a session token and return the client_id if valid, else None.

    Checks the HMAC signature and that the token has not expired.
    """
    parts = token.rsplit(":", 1)
    if len(parts) != 2:
        return None
    payload, claimed_sig = parts
    expected_sig = hmac.new(
        secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(claimed_sig, expected_sig):
        return None
    # Extract timestamp
    sub = payload.split(":")
    if len(sub) != 2:
        return None
    client_id, ts_str = sub
    try:
        ts = float(ts_str)
    except ValueError:
        return None
    if time.time() - ts > max_age_seconds:
        return None
    return client_id


# --- Webhook Signing ----------------------------------------------------------

def sign_webhook_payload(payload: bytes, secret: str) -> str:
    """Sign a webhook payload with HMAC-SHA256 and return the hex digest."""
    return hmac.new(
        secret.encode("utf-8"),
        payload,
        hashlib.sha256,
    ).hexdigest()


def verify_webhook_signature(
    payload: bytes, secret: str, signature: str
) -> bool:
    """Verify a webhook signature in constant time."""
    expected = sign_webhook_payload(payload, secret)
    return hmac.compare_digest(expected, signature)


# --- Content Filtering / PII Redaction ----------------------------------------

# Common PII patterns
_PII_PATTERNS: list[tuple[str, str]] = [
    # Credit card numbers (basic pattern)
    (
        r"\b(?:\d[ -]*?){13,19}\b",
        "[REDACTED_CC]",
    ),
    # US SSN
    (
        r"\b\d{3}[ -]?\d{2}[ -]?\d{4}\b",
        "[REDACTED_SSN]",
    ),
    # Email addresses
    (
        r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
        "[REDACTED_EMAIL]",
    ),
    # Phone numbers (US-style)
    (
        r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b",
        "[REDACTED_PHONE]",
    ),
    # IPv4 addresses (private ranges)
    (
        r"\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b",
        "[REDACTED_IP]",
    ),
    # AWS-style keys
    (
        r"\bAKIA[0-9A-Z]{16}\b",
        "[REDACTED_AWS_KEY]",
    ),
    # Generic API key patterns (long hex/alphanumeric strings after 'key'/'token'/'secret')
    (
        r'(?:api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*["\']?([A-Za-z0-9_\-]{20,})["\']?',
        "[REDACTED_CREDENTIAL]",
    ),
]

# Compile patterns for efficiency
_COMPILED_PII = [
    (re.compile(pattern, re.IGNORECASE), replacement)
    for pattern, replacement in _PII_PATTERNS
]

# Dangerous content patterns for prompt injection detection
_INJECTION_PATTERNS = re.compile(
    r"(?i)"
    r"(?:ignore\s+previous\s+instructions?)"
    r"|(?:forget\s+(?:all\s+)?(?:previous|above|prior)) "
    r"|(?:you\s+are\s+now\s+)"
    r"|(?:new\s+instructions?\s*:)"
    r"|(?:system\s*:\s*you\s+are)"
    r"|(?:jailbreak)"
    r"|(?:dan\s+mode)",
)


@dataclass
class FilterResult:
    """Result of content filtering."""

    original: str
    filtered: str
    redactions: list[str] = field(default_factory=list)
    has_pii: bool = False
    has_injection_risk: bool = False
    injection_matches: list[str] = field(default_factory=list)


def redact_pii(text: str) -> FilterResult:
    """Scan text for PII and return a filtered version with PII redacted.

    Returns the full ``FilterResult`` with redaction details.
    """
    filtered = text
    redactions: list[str] = []

    for pattern, replacement in _COMPILED_PII:
        matches = pattern.findall(filtered)
        if matches:
            redactions.append(replacement)
            filtered = pattern.sub(replacement, filtered)

    return FilterResult(
        original=text,
        filtered=filtered,
        redactions=redactions,
        has_pii=bool(redactions),
        has_injection_risk=False,
    )


def detect_injection(text: str) -> FilterResult:
    """Detect potential prompt-injection patterns in text.

    Returns a ``FilterResult`` indicating whether injection patterns were found.
    Does NOT modify the text — detection only.
    """
    matches = _INJECTION_PATTERNS.findall(text)
    return FilterResult(
        original=text,
        filtered=text,
        redactions=[],
        has_pii=False,
        has_injection_risk=bool(matches),
        injection_matches=matches,
    )


def sanitize_input(text: str, *, max_length: int = 100_000) -> str:
    """Sanitize user input: truncate, strip control characters, normalize whitespace.

    * Removes null bytes and most C0 control characters (keeps tab, newline, CR).
    * Collapses multiple whitespace into single spaces (preserving newlines).
    * Truncates to ``max_length``.
    """
    if not text:
        return ""
    # Strip null bytes and control characters (except \t, \n, \r)
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    # Normalize whitespace (preserve newlines)
    lines = cleaned.split("\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in lines]
    cleaned = "\n".join(lines)
    # Truncate
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length]
    return cleaned


# --- Nonce / CSRF -------------------------------------------------------------

def generate_nonce(length: int = 32) -> str:
    """Generate a cryptographically secure random nonce (hex)."""
    return secrets.token_hex(length)


__all__ = [
    "generate_api_key",
    "hash_api_key",
    "verify_api_key",
    "SessionToken",
    "create_session_token",
    "verify_session_token",
    "sign_webhook_payload",
    "verify_webhook_signature",
    "FilterResult",
    "redact_pii",
    "detect_injection",
    "sanitize_input",
    "generate_nonce",
]

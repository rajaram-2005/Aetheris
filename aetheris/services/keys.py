"""Provider key management — configure, mask, and probe API keys from the CLI.

Aetheris is layered: every capability runs offline without a key, and upgrades
to a real generative model the moment the matching key is present. This module
makes that switch explicit and safe:

* ``status``   — every key slot, whether it is set, its masked value, and which
  capabilities it upgrades.
* ``set_key``  — write a key into ``.env`` (chmod 600, never echoed).
* ``unset_key``— remove a slot from ``.env``.
* ``probe``    — verify a configured key against its provider's cheapest
  authenticated endpoint, without spending generation quota.

Keys are read at process start (pydantic-settings), so a restart of the server
is required after changing them — the CLI says so.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from pathlib import Path
from typing import Any

import httpx

from ..core.config import settings

logger = logging.getLogger("aetheris")

# Each slot: the env var, what it upgrades, and how to probe it.
_KEY_SLOTS: tuple[dict[str, Any], ...] = (
    {
        "slot": "gemini-image",
        "env": "AETHERIS_GEMINI_IMAGE_API_KEY",
        "fallback_env": "AETHERIS_GEMINI_API_KEY",
        "label": "Gemini images — 2.5 Flash Image ('nano banana') / Imagen",
        "feeds": ["images (gemini)"],
    },
    {
        "slot": "openai-image",
        "env": "AETHERIS_OPENAI_IMAGE_API_KEY",
        "fallback_env": "AETHERIS_LLM_API_KEY",
        "label": "OpenAI images — gpt-image / DALL-E",
        "feeds": ["images (openai)"],
    },
    {
        "slot": "openai-video",
        "env": "AETHERIS_OPENAI_VIDEO_API_KEY",
        "fallback_env": "AETHERIS_LLM_API_KEY",
        "label": "OpenAI Sora video",
        "feeds": ["video (openai)"],
    },
    {
        "slot": "gemini-video",
        "env": "AETHERIS_GEMINI_VIDEO_API_KEY",
        "fallback_env": "AETHERIS_GEMINI_API_KEY",
        "label": "Google Veo video",
        "feeds": ["video (gemini)"],
    },
    {
        "slot": "nvidia",
        "env": "AETHERIS_NVIDIA_API_KEY",
        "label": "NVIDIA NIM — chat, code, FLUX images, Cosmos video",
        "feeds": ["chat", "images (nvidia)", "video (nvidia)", "code"],
    },
    {
        "slot": "stability",
        "env": "AETHERIS_STABILITY_API_KEY",
        "label": "Stability AI images",
        "feeds": ["images (stability)"],
    },
    {
        "slot": "openai-chat",
        "env": "AETHERIS_LLM_API_KEY",
        "label": "OpenAI chat + TTS + Whisper",
        "feeds": ["chat", "speech", "transcription"],
    },
    {
        "slot": "github",
        "env": "AETHERIS_GITHUB_TOKEN",
        "label": "GitHub token (REST pushes; 'gh' CLI works without it)",
        "feeds": ["github push"],
    },
)


def _env_path() -> Path:
    """The .env file the settings layer reads (pydantic-settings env_file)."""
    return Path(settings.model_config.get("env_file") or ".env")


def _mask(value: str) -> str:
    value = value.strip()
    if len(value) <= 8:
        return "•" * 6
    return f"{value[:3]}…{value[-4:]}"


def _settings_field(env_var: str) -> str:
    """Map an env var (e.g. AETHERIS_GEMINI_IMAGE_API_KEY) to its settings
    field name (gemini_image_api_key)."""
    field = env_var.lower()
    if field.startswith("aetheris_"):
        field = field[len("aetheris_"):]
    return field


def _slot_value(slot: dict[str, Any]) -> str:
    """Resolve a slot's key from environ, then the settings layer (.env).

    pydantic-settings merges ``.env`` and the process environment when the
    settings object is created, so a fresh CLI process sees keys that were
    written to ``.env`` by ``aetheris keys set`` — even before a server
    restart. The running server needs its restart to pick them up, which the
    setter says explicitly.
    """
    value = os.environ.get(slot["env"], "")
    if not value:
        value = str(getattr(settings, _settings_field(slot["env"]), "") or "")
    if not value and slot.get("fallback_env"):
        value = os.environ.get(slot["fallback_env"], "")
        if not value:
            value = str(getattr(settings, _settings_field(slot["fallback_env"]), "") or "")
    return value


def _uses_fallback(slot: dict[str, Any]) -> bool:
    """True when the slot is filled by its fallback environment variable."""
    if not slot.get("fallback_env"):
        return False
    direct = os.environ.get(slot["env"], "") or str(
        getattr(settings, _settings_field(slot["env"]), "") or ""
    )
    return not direct and bool(_slot_value(slot))


def key_status() -> list[dict[str, Any]]:
    """Every slot with its configuration state (keys masked)."""
    rows: list[dict[str, Any]] = []
    for slot in _KEY_SLOTS:
        value = _slot_value(slot)
        rows.append({
            "slot": slot["slot"],
            "env": slot["env"],
            "label": slot["label"],
            "feeds": slot["feeds"],
            "configured": bool(value),
            "masked": _mask(value) if value else "",
            "uses_fallback_env": _uses_fallback(slot),
        })
    return rows


def _update_env(slot: dict[str, Any], value: str | None) -> Path:
    """Insert/update or remove an env line, preserving the rest of the file."""
    path = _env_path()
    lines: list[str] = []
    if path.is_file():
        lines = path.read_text(encoding="utf-8").splitlines()
    variable = slot["env"]
    kept = [line for line in lines if not line.strip().startswith(f"{variable}=")]
    if value is not None:
        kept.append(f"{variable}={value.strip()}")
    path.write_text("\n".join(kept).strip() + ("\n" if kept else ""), encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:  # pragma: no cover - platform without chmod semantics
        pass
    return path


def set_key(slot_name: str, value: str) -> dict[str, Any]:
    """Write a key into .env (chmod 600) and return the masked confirmation."""
    slot = next((s for s in _KEY_SLOTS if s["slot"] == slot_name), None)
    if slot is None:
        raise ValueError(
            f"Unknown key slot '{slot_name}'. Choose one of: "
            + ", ".join(s["slot"] for s in _KEY_SLOTS)
            + "."
        )
    value = (value or "").strip()
    if not value:
        raise ValueError(f"{slot['env']} needs a non-empty key value.")
    path = _update_env(slot, value)
    return {
        "slot": slot["slot"],
        "env": slot["env"],
        "masked": _mask(value),
        "file": str(path),
        "note": "Restart the server (aetheris serve) for the key to take effect.",
    }


def unset_key(slot_name: str) -> dict[str, Any]:
    """Remove a key slot from .env."""
    slot = next((s for s in _KEY_SLOTS if s["slot"] == slot_name), None)
    if slot is None:
        raise ValueError(f"Unknown key slot '{slot_name}'.")
    path = _update_env(slot, None)
    return {"slot": slot["slot"], "env": slot["env"], "file": str(path), "removed": True}


def _probe_checks(slot: str) -> dict[str, Any]:
    """Per-slot probe endpoint and credential mapping.

    Credential values are resolved from the environment live (not from the
    settings snapshot) so freshly written keys probe correctly in-process.
    """
    checks = {
        "gemini-image": (
            f"{settings.gemini_base_url.rstrip('/')}/v1beta/models?pageSize=1",
            "x-goog-api-key", "images (gemini)",
        ),
        "openai-image": (
            f"{settings.openai_image_base_url.rstrip('/')}/models",
            "Authorization", "images (openai)",
        ),
        "openai-video": (
            f"{settings.openai_video_base_url.rstrip('/')}/models",
            "Authorization", "video (openai)",
        ),
        "gemini-video": (
            f"{settings.gemini_base_url.rstrip('/')}/v1beta/models?pageSize=1",
            "x-goog-api-key", "video (gemini)",
        ),
        "stability": (
            f"{settings.stability_base_url.rstrip('/')}/v2beta/stable-image/cores/sd3.5-large/credits",
            "Authorization", "images (stability)",
        ),
        "openai-chat": (
            f"{settings.llm_base_url.rstrip('/')}/models",
            "Authorization", "chat",
        ),
    }
    if slot not in checks:
        return {"slot": slot, "probe": "no-live-probe", "ok": None,
                "detail": "NVIDIA and GitHub keys are verified by their own services on first use."}
    url, header, feeds = checks[slot]
    slot_meta = next(s for s in _KEY_SLOTS if s["slot"] == slot)
    return {
        "url": url,
        "header": header,
        "value": _slot_value(slot_meta),
        "prefix": "Bearer" if header == "Authorization" else "",
        "feeds": feeds,
    }


async def probe_key(
    slot_name: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    """Verify a configured key against its provider's cheapest endpoint.

    ``transport`` is injectable so tests can mock the provider's response
    without any network access.
    """
    check = _probe_checks(slot_name)
    if "probe" in check:
        return check
    value = check.get("value") or ""
    if not value:
        return {"slot": slot_name, "ok": False, "detail": "no key configured"}
    headers: dict[str, str] = {}
    if check.get("prefix") == "Bearer":
        headers["Authorization"] = f"Bearer {value}"
    else:
        headers[check["header"]] = value
    try:
        async with httpx.AsyncClient(timeout=20.0, transport=transport) as client:
            response = await client.get(check["url"], headers=headers)
    except httpx.HTTPError as exc:
        return {"slot": slot_name, "ok": False, "detail": f"network error: {exc}"}
    if response.status_code < 300:
        return {"slot": slot_name, "ok": True, "status": response.status_code,
                "feeds": check["feeds"]}
    if response.status_code in (401, 403):
        return {"slot": slot_name, "ok": False, "status": response.status_code,
                "detail": "key rejected (unauthorized)"}
    return {"slot": slot_name, "ok": True, "status": response.status_code,
            "detail": f"endpoint responded {response.status_code} (key accepted)",
            "feeds": check["feeds"]}


async def probe_all() -> list[dict[str, Any]]:
    """Probe every configured slot; slots without keys are reported as skipped."""
    results: list[dict[str, Any]] = []
    for slot in _KEY_SLOTS:
        if not _slot_value(slot):
            results.append({"slot": slot["slot"], "ok": None, "detail": "not configured"})
            continue
        results.append(await probe_key(slot["slot"]))
    return results


__all__ = [
    "key_status",
    "set_key",
    "unset_key",
    "probe_key",
    "probe_all",
]

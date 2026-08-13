"""Layered image generation — offline procedural *or* a real generative model.

Aetheris ships image generation in **layers** so it is useful the moment it
starts (fully offline, no API key, no network) and silently upgrades to a real
generative model the moment an upstream provider key is configured:

* ``OfflineImageProvider`` — the deterministic procedural renderer
  (:mod:`aetheris.media.images`). Works everywhere, produces posters, gradients,
  starfields, geometric art, backdrops and placeholder assets.
* ``OpenAIImageProvider`` — DALL-E 3 / ``gpt-image-1`` via the OpenAI Images
  endpoint (photorealistic scenes, real objects and people).
* ``GeminiImageProvider`` — Google Imagen 3 via the Generative Language API.
* ``StabilityImageProvider`` — Stability AI's ``stable-image`` core model.

Which engine runs is decided by ``AETHERIS_IMAGE_PROVIDER`` (``offline``,
``openai``, ``gemini``, ``stability``, or ``auto``). ``auto`` — the default —
picks the first provider that has a configured API key and otherwise uses the
offline renderer. Every remote provider is an ``httpx`` client with an injectable
transport, so the providers are unit-testable without touching the network.
"""

from __future__ import annotations

import abc
import base64
import logging
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

import httpx

from ..core.config import settings

logger = logging.getLogger("aetheris")


@dataclass
class ImageGenerationResult:
    """One generated image plus metadata for storage and reporting."""

    data: bytes
    media_type: str
    provider: str
    model: str
    meta: dict[str, Any] = field(default_factory=dict)
    seed: int | None = None


class ImageProvider(abc.ABC):
    """Interface every Aetheris image engine implements."""

    @property
    @abc.abstractmethod
    def provider_name(self) -> str:
        """Human-readable provider label (used in capability reports)."""

    @property
    @abc.abstractmethod
    def model(self) -> str:
        """The model identifier actually used."""

    @abc.abstractmethod
    async def generate(
        self,
        prompt: str,
        *,
        width: int = 1024,
        height: int = 576,
        n: int = 1,
        seed: int | None = None,
    ) -> list[ImageGenerationResult]:
        """Generate ``n`` images from ``prompt`` at the given target size."""

    async def aclose(self) -> None:  # pragma: no cover - default no-op
        """Release any provider-held resources."""


def _clamp_dimension(value: int) -> int:
    return max(64, min(int(value), settings.media_max_image_dimension))


# --- Offline procedural engine -----------------------------------------------

class OfflineImageProvider(ImageProvider):
    """The deterministic, dependency-free procedural renderer (default)."""

    provider_name = "offline (procedural)"

    @property
    def model(self) -> str:
        return "aetheris-procedural-v1"

    async def generate(
        self,
        prompt: str,
        *,
        width: int = 1024,
        height: int = 576,
        n: int = 1,
        seed: int | None = None,
    ) -> list[ImageGenerationResult]:
        from .images import generate

        width = _clamp_dimension(width)
        height = _clamp_dimension(height)
        results: list[ImageGenerationResult] = []
        for i in range(n):
            png, plan = generate(prompt, width=width, height=height, seed=seed)
            results.append(
                ImageGenerationResult(
                    data=png,
                    media_type="image/png",
                    provider=self.provider_name,
                    model=self.model,
                    seed=plan.seed,
                    meta={
                        "renderer": "procedural",
                        "style": plan.scene,
                        "palette": plan.palette_name,
                        "width": width,
                        "height": height,
                        "note": "Deterministic procedural render (not a diffusion model).",
                    },
                )
            )
        return results


# --- Remote engine helpers ----------------------------------------------------

def _json_client(base_url: str, api_key: str, timeout: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=base_url.rstrip("/"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        timeout=timeout,
    )


class _RemoteImageProvider(ImageProvider):
    """Base for httpx-backed engines with injectable transport for tests."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        timeout: float = 90.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._model = model
        self._base_url = base_url
        if transport is not None:
            self._client = httpx.AsyncClient(
                base_url=base_url.rstrip("/"),
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=timeout,
                transport=transport,
            )
        else:
            self._client = _json_client(base_url, api_key, timeout)

    @property
    def model(self) -> str:
        return self._model

    async def aclose(self) -> None:
        await self._client.aclose()

    @staticmethod
    def _raise_remote(prefix: str, resp: httpx.Response) -> None:
        raise RuntimeError(
            f"{prefix} returned {resp.status_code}: {resp.text[:300]}"
        )


class OpenAIImageProvider(_RemoteImageProvider):
    """DALL-E 3 / gpt-image-1 via the OpenAI Images endpoint."""

    provider_name = "openai (dall-e / gpt-image)"

    async def generate(
        self,
        prompt: str,
        *,
        width: int = 1024,
        height: int = 576,
        n: int = 1,
        seed: int | None = None,
    ) -> list[ImageGenerationResult]:
        size = f"{_clamp_dimension(width)}x{_clamp_dimension(height)}"
        payload: dict[str, Any] = {
            "model": self._model,
            "prompt": prompt,
            "n": n,
            "size": size,
            "response_format": "b64_json",
        }
        if seed is not None:
            payload["seed"] = seed
        try:
            resp = await self._client.post("/images/generations", json=payload)
        except httpx.HTTPError as exc:
            raise RuntimeError(f"OpenAI image request failed: {exc}") from exc
        if resp.status_code >= 400:
            self._raise_remote("OpenAI images endpoint", resp)
        data = resp.json().get("data") or []
        if not data:
            raise RuntimeError("OpenAI returned no images.")
        results: list[ImageGenerationResult] = []
        for item in data:
            encoded = item.get("b64_json")
            if not encoded:
                continue
            results.append(
                ImageGenerationResult(
                    data=base64.b64decode(encoded),
                    media_type="image/png",
                    provider=self.provider_name,
                    model=self._model,
                    meta={"renderer": self._model, "width": width, "height": height},
                    seed=seed,
                )
            )
        if not results:
            raise RuntimeError("OpenAI returned images but none were decodable.")
        return results


class GeminiImageProvider(_RemoteImageProvider):
    """Google Imagen 3 via the Generative Language ``generateContent`` API."""

    provider_name = "gemini (imagen 3)"

    @staticmethod
    def _aspect_ratio(width: int, height: int) -> str:
        if width >= height * 1.7:
            return "16:9"
        if height >= width * 1.7:
            return "9:16"
        return "1:1"

    async def generate(
        self,
        prompt: str,
        *,
        width: int = 1024,
        height: int = 576,
        n: int = 1,
        seed: int | None = None,
    ) -> list[ImageGenerationResult]:
        url = f"/v1beta/models/{self._model}:generateContent"
        payload: dict[str, Any] = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseModalities": ["TEXT", "IMAGE"],
                "imageConfig": {"aspectRatio": self._aspect_ratio(width, height)},
            },
        }
        try:
            resp = await self._client.post(url, json=payload)
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Gemini image request failed: {exc}") from exc
        if resp.status_code >= 400:
            self._raise_remote("Gemini Imagen endpoint", resp)
        body = resp.json()
        candidates = body.get("candidates") or []
        if not candidates:
            raise RuntimeError("Gemini returned no image candidates.")
        results: list[ImageGenerationResult] = []
        for candidate in candidates:
            for part in (candidate.get("content") or {}).get("parts") or []:
                inline = part.get("inlineData")
                if not inline:
                    continue
                mime = inline.get("mimeType", "image/png")
                results.append(
                    ImageGenerationResult(
                        data=base64.b64decode(inline.get("data", "")),
                        media_type=mime,
                        provider=self.provider_name,
                        model=self._model,
                        meta={"renderer": self._model},
                        seed=seed,
                    )
                )
        if not results:
            raise RuntimeError("Gemini returned no inline image data.")
        return results


class StabilityImageProvider(_RemoteImageProvider):
    """Stability AI ``stable-image`` core model (multipart form upload)."""

    provider_name = "stability (stable-image)"

    @staticmethod
    def _aspect_ratio(width: int, height: int) -> str:
        ratio = round(width / height, 2)
        for label, value in (
            ("16:9", 1.78), ("1:1", 1.0), ("9:16", 0.56), ("4:5", 0.8),
            ("5:4", 1.25), ("3:2", 1.5), ("2:3", 0.67),
        ):
            if abs(ratio - value) < 0.1:
                return label
        return "1:1"

    async def generate(
        self,
        prompt: str,
        *,
        width: int = 1024,
        height: int = 576,
        n: int = 1,
        seed: int | None = None,
    ) -> list[ImageGenerationResult]:
        url = "/v2beta/stable-image/generate/core"
        files = {
            "prompt": (None, prompt),
            "output_format": (None, "png"),
            "aspect_ratio": (None, self._aspect_ratio(width, height)),
        }
        data: dict[str, str] = {}
        if seed is not None:
            data["seed"] = str(seed)
        try:
            resp = await self._client.post(url, files=files, data=data)
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Stability request failed: {exc}") from exc
        if resp.status_code >= 400:
            self._raise_remote("Stability endpoint", resp)
        content_type = resp.headers.get("content-type", "image/png")
        if not content_type.startswith("image/"):
            raise RuntimeError(f"Stability returned non-image content: {content_type}")
        results: list[ImageGenerationResult] = []
        for _ in range(n):
            results.append(
                ImageGenerationResult(
                    data=resp.content,
                    media_type=content_type,
                    provider=self.provider_name,
                    model=self._model,
                    meta={"renderer": self._model},
                    seed=seed,
                )
            )
        return results


# --- Factory -----------------------------------------------------------------

_provider: ImageProvider | None = None


def _first_configured() -> str:
    """Resolve 'auto' to the first provider with a configured key."""
    if settings.has_openai_image_credentials:
        return "openai"
    if settings.has_gemini_image_credentials:
        return "gemini"
    if settings.has_stability_credentials:
        return "stability"
    return "offline"


def build_image_provider(provider: str | None = None) -> ImageProvider:
    """Construct the image provider named by ``provider`` (default: settings)."""
    chosen = (provider or settings.image_provider or "auto").strip().lower()
    if chosen == "auto":
        chosen = _first_configured()

    if chosen == "openai":
        if not settings.has_openai_image_credentials:
            raise RuntimeError(
                "Image provider 'openai' selected but no API key is configured. "
                "Set AETHERIS_OPENAI_IMAGE_API_KEY (or AETHERIS_LLM_API_KEY)."
            )
        return OpenAIImageProvider(
            base_url=settings.openai_image_base_url or settings.llm_base_url,
            api_key=settings.openai_image_api_key or settings.llm_api_key,
            model=settings.openai_image_model,
            timeout=settings.image_remote_timeout,
        )
    if chosen == "gemini":
        if not settings.has_gemini_image_credentials:
            raise RuntimeError(
                "Image provider 'gemini' selected but no API key is configured. "
                "Set AETHERIS_GEMINI_IMAGE_API_KEY (or AETHERIS_GEMINI_API_KEY)."
            )
        return GeminiImageProvider(
            base_url=settings.gemini_base_url,
            api_key=settings.gemini_image_api_key or settings.gemini_api_key,
            model=settings.gemini_image_model,
            timeout=settings.image_remote_timeout,
        )
    if chosen == "stability":
        if not settings.has_stability_credentials:
            raise RuntimeError(
                "Image provider 'stability' selected but no API key is configured. "
                "Set AETHERIS_STABILITY_API_KEY."
            )
        return StabilityImageProvider(
            base_url=settings.stability_base_url,
            api_key=settings.stability_api_key,
            model=settings.stability_model,
            timeout=settings.image_remote_timeout,
        )
    # Default / 'offline'
    return OfflineImageProvider()


def get_image_provider() -> ImageProvider:
    """Return the process-wide image provider, built lazily from settings.

    When a remote provider is requested but misconfigured (or unavailable), and
    ``AETHERIS_IMAGE_FALLBACK_OFFLINE`` is true, this returns the offline renderer
    so generation never hard-fails the request.
    """
    global _provider
    if _provider is not None:
        return _provider
    try:
        _provider = build_image_provider()
    except RuntimeError as exc:
        if settings.image_fallback_offline:
            logger.warning("Image provider unavailable (%s); falling back to offline.", exc)
            _provider = OfflineImageProvider()
        else:
            raise
    return _provider


def reset_image_provider() -> None:
    """Drop the cached provider so it is rebuilt on the next call (for tests)."""
    global _provider
    _provider = None


async def close_image_provider() -> None:
    global _provider
    if _provider is not None:
        await _provider.aclose()
        _provider = None


async def generate_image_bytes(
    prompt: str,
    *,
    width: int = 1024,
    height: int = 576,
    n: int = 1,
    seed: int | None = None,
    provider: ImageProvider | None = None,
) -> list[ImageGenerationResult]:
    """Generate ``n`` images through the active provider (default: process-wide)."""
    engine = provider or get_image_provider()
    try:
        results = await engine.generate(
            prompt, width=width, height=height, n=n, seed=seed
        )
    except RuntimeError:
        if (
            isinstance(engine, OfflineImageProvider)
            or not settings.image_fallback_offline
        ):
            raise
        logger.warning("Remote image generation failed; falling back to offline.")
        return await OfflineImageProvider().generate(
            prompt, width=width, height=height, n=n, seed=seed
        )
    return results


__all__ = [
    "ImageGenerationResult",
    "ImageProvider",
    "OfflineImageProvider",
    "OpenAIImageProvider",
    "GeminiImageProvider",
    "StabilityImageProvider",
    "build_image_provider",
    "get_image_provider",
    "reset_image_provider",
    "close_image_provider",
    "generate_image_bytes",
]

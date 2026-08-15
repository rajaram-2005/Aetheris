"""Layered video generation: offline GIF or NVIDIA Cosmos NIM MP4.

The offline provider preserves Aetheris's dependency-free animation engine.  The
NVIDIA provider supports the hosted Cosmos Preview/NVCF response shape, the
``/v1/infer`` shape used by downloadable Cosmos NIMs, and OpenAI-compatible
``/v1/videos/generations`` deployments.  Remote failures can fall back to the
local renderer, just like layered image generation.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from ..core.config import settings

logger = logging.getLogger("aetheris")


@dataclass
class VideoGenerationResult:
    """Generated video bytes plus storage/reporting metadata."""

    data: bytes
    media_type: str
    provider: str
    model: str
    seed: int | None = None
    meta: dict[str, Any] = field(default_factory=dict)


class OfflineVideoProvider:
    """Aetheris's deterministic, dependency-free animated GIF renderer."""

    provider_name = "offline (procedural gif)"
    model = "aetheris-motion-v1"

    async def generate(
        self,
        prompt: str,
        *,
        width: int = 480,
        height: int = 270,
        seconds: float = 3.0,
        fps: int = 12,
        motion: str | None = None,
        palette: str | None = None,
        seed: int | None = None,
        loop: str = "loop",
    ) -> VideoGenerationResult:
        from .video import generate

        gif, plan = generate(
            prompt,
            width=width,
            height=height,
            seconds=seconds,
            fps=fps,
            motion=motion,
            palette=palette,
            seed=seed,
            loop=loop,
        )
        total_frames = plan.frames * 2 - 1 if plan.loop == "bounce" else plan.frames
        return VideoGenerationResult(
            data=gif,
            media_type="image/gif",
            provider=self.provider_name,
            model=self.model,
            seed=plan.seed,
            meta={
                "motion": plan.motion,
                "palette": plan.palette_name,
                "frames": plan.frames,
                "total_frames": total_frames,
                "fps": plan.fps,
                "loop": plan.loop,
                "duration": round(plan.duration, 2),
                "duration_seconds": round(plan.duration, 2),
                "width": width,
                "height": height,
                "format": "animated GIF",
            },
        )

    async def aclose(self) -> None:
        return None


class NvidiaVideoProvider:
    """NVIDIA Cosmos video generation (hosted Preview API or self-hosted NIM)."""

    provider_name = "nvidia nim (cosmos)"

    def __init__(
        self,
        endpoint: str,
        api_key: str,
        model: str,
        *,
        status_base_url: str = "https://api.nvcf.nvidia.com/v2/nvcf/pexec/status",
        timeout: float = 600.0,
        poll_interval: float = 2.0,
        steps: int = 30,
        guidance_scale: float = 6.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.model = model
        self.status_base_url = status_base_url.rstrip("/")
        self.timeout = timeout
        self.poll_interval = poll_interval
        self.steps = steps
        self.guidance_scale = guidance_scale
        # Let httpx select Content-Type per request: hosted/infer endpoints use
        # JSON while modern vLLM-Omni ``/v1/videos/sync`` uses form fields.
        headers = {"Accept": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.AsyncClient(
            headers=headers,
            timeout=timeout,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    @staticmethod
    def _aspect(width: int, height: int) -> str:
        ratio = width / max(height, 1)
        candidates = {
            "16_9": 16 / 9,
            "4_3": 4 / 3,
            "1_1": 1.0,
            "3_4": 3 / 4,
            "9_16": 9 / 16,
        }
        return min(candidates, key=lambda name: abs(candidates[name] - ratio))

    @classmethod
    def _resolution(cls, width: int, height: int) -> str:
        longest = max(width, height)
        tier = 720 if longest >= 720 else 480 if longest >= 480 else 256
        return f"{tier}_{cls._aspect(width, height)}"

    def _payload(
        self,
        prompt: str,
        *,
        width: int,
        height: int,
        seconds: float,
        fps: int,
        seed: int | None,
        negative_prompt: str,
    ) -> dict[str, Any]:
        frames = max(5, min(300, round(seconds * fps)))
        actual_seed = 0 if seed is None else max(0, seed)

        if self.endpoint.endswith("/videos/sync"):
            return {
                "model": self.model,
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "size": f"{width}x{height}",
                "num_frames": str(frames),
                "fps": str(fps),
                "num_inference_steps": str(self.steps),
                "guidance_scale": str(self.guidance_scale),
                "flow_shift": "10.0",
                "seed": str(actual_seed),
            }
        if "/videos/generations" in self.endpoint:
            return {
                "model": self.model,
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "size": f"{width}x{height}",
                "seconds": seconds,
                "fps": fps,
                "num_frames": frames,
                "seed": actual_seed,
                "response_format": "b64_json",
                "num_inference_steps": self.steps,
                "guidance_scale": self.guidance_scale,
            }
        if self.endpoint.endswith("/v1/infer"):
            # Downloadable Cosmos WFM NIM contract.
            return {
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "seed": actual_seed,
                "guidance_scale": self.guidance_scale,
                "steps": self.steps,
                "video_params": {
                    "height": height,
                    "width": width,
                    "frames_count": frames,
                    "frames_per_sec": fps,
                },
            }
        # NVIDIA hosted Cosmos 3 Preview API contract.
        return {
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "resolution": self._resolution(width, height),
            "num_output_frames": frames,
            "fps": fps,
            "num_inference_steps": self.steps,
            "guidance_scale": self.guidance_scale,
            "seed": actual_seed,
        }

    @staticmethod
    def _request_id(response: httpx.Response) -> str:
        request_id = response.headers.get("NVCF-REQID", "")
        if request_id:
            return request_id
        try:
            body = response.json()
        except ValueError:
            return ""
        return str(body.get("request_id") or body.get("id") or "")

    async def _resolve_response(self, response: httpx.Response) -> httpx.Response:
        if response.status_code != 202:
            return response
        request_id = self._request_id(response)
        if not request_id:
            raise RuntimeError("NVIDIA video request was accepted but returned no NVCF request id.")

        deadline = time.monotonic() + self.timeout
        status_url = f"{self.status_base_url}/{request_id}"
        while time.monotonic() < deadline:
            await asyncio.sleep(self.poll_interval)
            try:
                polled = await self._client.get(status_url)
            except httpx.HTTPError as exc:
                raise RuntimeError(f"NVIDIA video status polling failed: {exc}") from exc
            if polled.status_code == 202:
                continue
            return polled
        raise RuntimeError(
            f"NVIDIA video generation timed out after {self.timeout:g} seconds "
            f"(request {request_id})."
        )

    @staticmethod
    def _decode(response: httpx.Response) -> tuple[bytes, str, dict[str, Any]]:
        content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
        if content_type.startswith("video/"):
            return response.content, content_type, {}

        try:
            body = response.json()
        except ValueError as exc:
            raise RuntimeError("NVIDIA video NIM returned neither MP4 nor JSON.") from exc

        encoded: Any = body.get("b64_video") or body.get("b64_json")
        if not encoded:
            artifacts = body.get("artifacts") or []
            if artifacts:
                item = artifacts[0] or {}
                encoded = item.get("base64") or item.get("b64_json")
        if not encoded:
            data = body.get("data") or {}
            if isinstance(data, list):
                data = data[0] if data else {}
            if isinstance(data, dict):
                encoded = data.get("b64_json") or data.get("base64") or data.get("b64_video")
        if not encoded:
            raise RuntimeError("NVIDIA video NIM returned no base64 video artifact.")

        media_type = "video/mp4"
        if isinstance(encoded, str) and encoded.startswith("data:"):
            header, encoded = encoded.split(",", 1)
            media_type = header[5:].split(";", 1)[0] or media_type
        try:
            raw = base64.b64decode(encoded)
        except (ValueError, TypeError) as exc:
            raise RuntimeError("NVIDIA video NIM returned invalid base64 data.") from exc
        metadata = {
            key: value
            for key, value in body.items()
            if key not in ("b64_video", "b64_json", "artifacts", "data")
        }
        return raw, media_type, metadata

    async def generate(
        self,
        prompt: str,
        *,
        width: int = 832,
        height: int = 480,
        seconds: float = 4.0,
        fps: int = 24,
        motion: str | None = None,
        palette: str | None = None,
        seed: int | None = None,
        loop: str = "loop",
        negative_prompt: str = "blurry, distorted, low quality, jittery, deformed",
    ) -> VideoGenerationResult:
        payload = self._payload(
            prompt,
            width=width,
            height=height,
            seconds=seconds,
            fps=fps,
            seed=seed,
            negative_prompt=negative_prompt,
        )
        try:
            if self.endpoint.endswith("/videos/sync"):
                response = await self._client.post(
                    self.endpoint,
                    data=payload,
                    headers={"Accept": "video/mp4"},
                )
            else:
                response = await self._client.post(self.endpoint, json=payload)
        except httpx.HTTPError as exc:
            raise RuntimeError(f"NVIDIA video request failed: {exc}") from exc
        response = await self._resolve_response(response)
        if response.status_code >= 400:
            raise RuntimeError(
                f"NVIDIA video NIM returned {response.status_code}: {response.text[:300]}"
            )
        raw, media_type, remote_meta = self._decode(response)
        if not raw:
            raise RuntimeError("NVIDIA video NIM returned an empty video.")
        frames = max(5, min(300, round(seconds * fps)))
        return VideoGenerationResult(
            data=raw,
            media_type=media_type,
            provider=self.provider_name,
            model=self.model,
            seed=seed,
            meta={
                "accelerator": "NVIDIA NIM",
                "frames": frames,
                "fps": fps,
                "duration": seconds,
                "duration_seconds": seconds,
                "width": width,
                "height": height,
                "format": "MP4",
                "motion": motion or "cosmos world generation",
                "loop": False,
                "steps": self.steps,
                "guidance_scale": self.guidance_scale,
                **remote_meta,
            },
        )


_provider: OfflineVideoProvider | NvidiaVideoProvider | None = None


def build_video_provider(provider: str | None = None):
    chosen = (provider or settings.video_provider or "auto").strip().lower()
    if chosen == "auto":
        chosen = "nvidia" if settings.has_nvidia_credentials else "offline"
    if chosen == "nvidia":
        if not settings.has_nvidia_credentials:
            raise RuntimeError(
                "Video provider 'nvidia' selected but no NVIDIA API key is configured. "
                "Add AETHERIS_NVIDIA_API_KEY=nvapi-... to .env and restart Aetheris."
            )
        return NvidiaVideoProvider(
            endpoint=settings.nvidia_video_base_url,
            api_key=settings.nvidia_api_key,
            model=settings.nvidia_video_model,
            status_base_url=settings.nvidia_video_status_base_url,
            timeout=settings.nvidia_video_timeout,
            poll_interval=settings.nvidia_video_poll_interval,
            steps=settings.nvidia_video_steps,
            guidance_scale=settings.nvidia_video_guidance_scale,
        )
    return OfflineVideoProvider()


def get_video_provider():
    global _provider
    if _provider is not None:
        return _provider
    try:
        _provider = build_video_provider()
    except RuntimeError as exc:
        if settings.video_fallback_offline:
            logger.warning("Video provider unavailable (%s); falling back to offline.", exc)
            _provider = OfflineVideoProvider()
        else:
            raise
    return _provider


def reset_video_provider() -> None:
    global _provider
    _provider = None


async def close_video_provider() -> None:
    global _provider
    if _provider is not None:
        await _provider.aclose()
        _provider = None


async def generate_video_bytes(
    prompt: str,
    *,
    width: int = 480,
    height: int = 270,
    seconds: float = 3.0,
    fps: int = 12,
    motion: str | None = None,
    palette: str | None = None,
    seed: int | None = None,
    loop: str = "loop",
    provider: OfflineVideoProvider | NvidiaVideoProvider | None = None,
) -> VideoGenerationResult:
    engine = provider or get_video_provider()
    try:
        return await engine.generate(
            prompt,
            width=width,
            height=height,
            seconds=seconds,
            fps=fps,
            motion=motion,
            palette=palette,
            seed=seed,
            loop=loop,
        )
    except (RuntimeError, ValueError):
        if isinstance(engine, OfflineVideoProvider) or not settings.video_fallback_offline:
            raise
        logger.warning("Remote NVIDIA video generation failed; falling back to offline.", exc_info=True)
        return await OfflineVideoProvider().generate(
            prompt,
            width=width,
            height=height,
            seconds=seconds,
            fps=fps,
            motion=motion,
            palette=palette,
            seed=seed,
            loop=loop,
        )


__all__ = [
    "VideoGenerationResult",
    "OfflineVideoProvider",
    "NvidiaVideoProvider",
    "build_video_provider",
    "get_video_provider",
    "reset_video_provider",
    "close_video_provider",
    "generate_video_bytes",
]

"""Layered video generation: offline GIF, NVIDIA Cosmos NIM MP4, OpenAI Sora,
or Google Veo.

The offline provider preserves Aetheris's dependency-free animation engine.
The remote providers speak each vendor's real contract:

* **NVIDIA Cosmos** — hosted Preview/NVCF, ``/v1/infer`` NIMs, and
  OpenAI-compatible ``/v1/videos/generations`` deployments.
* **OpenAI Sora** — ``POST /v1/videos/generations`` (multipart), poll
  ``GET /v1/videos/{id}``, download the finished MP4.
* **Google Veo** — ``:predictLongRunning`` operation, poll the LRO, download
  the generated MP4 from the returned ``gs://`` URI.

Remote failures can fall back to the local renderer, just like layered image
generation.
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


class OpenAIVideoProvider:
    """OpenAI Sora video generation (``/v1/videos/generations``).

    Sora jobs are asynchronous: submit the prompt (multipart form), poll the
    video endpoint until completion, then download the MP4 from the returned
    ``download_url`` (same origin, Bearer-authenticated).
    """

    provider_name = "openai (sora)"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        *,
        timeout: float = 900.0,
        poll_interval: float = 3.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.poll_interval = poll_interval
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    @staticmethod
    def _size(width: int, height: int) -> str:
        longest = max(width, height)
        tier = 1280 if longest >= 1280 else 768 if longest >= 768 else 640
        if width >= height:
            return f"{tier}x{max(320, round(tier * height / width / 32) * 32)}"
        return f"{max(320, round(tier * width / height / 32) * 32)}x{tier}"

    async def _poll(self, video_id: str) -> httpx.Response:
        deadline = time.monotonic() + self.timeout
        url = f"/videos/{video_id}"
        while time.monotonic() < deadline:
            await asyncio.sleep(self.poll_interval)
            try:
                response = await self._client.get(url)
            except httpx.HTTPError as exc:
                raise RuntimeError(f"Sora status request failed: {exc}") from exc
            if response.status_code >= 400:
                raise RuntimeError(
                    f"Sora status endpoint returned {response.status_code}: {response.text[:300]}"
                )
            status = response.json().get("status", "")
            if status in ("completed", "failed", "cancelled"):
                return response
        raise RuntimeError(
            f"Sora video generation timed out after {self.timeout:g} seconds ({video_id})."
        )

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
        if motion:
            prompt = f"{prompt}. Camera motion: {motion}"
        if palette:
            prompt = f"{prompt}. Colour palette: {palette}"
        duration = max(4, min(12, round(seconds)))
        payload: dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "seconds": str(duration),
            "size": self._size(width, height),
        }
        if seed is not None:
            payload["seed"] = seed
        try:
            response = await self._client.post("/videos/generations", data=payload)
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Sora request failed: {exc}") from exc
        if response.status_code >= 400:
            raise RuntimeError(
                f"Sora endpoint returned {response.status_code}: {response.text[:300]}"
            )
        body = response.json()
        video_id = body.get("id") or ""
        if not video_id:
            raise RuntimeError("Sora accepted the request but returned no video id.")

        final = await self._poll(video_id)
        final_body = final.json()
        if final_body.get("status") != "completed":
            raise RuntimeError(
                f"Sora job {video_id} ended with status {final_body.get('status')}"
                f": {final_body.get('error') or final_body.get('status_message', '')}"
            )
        media = (final_body.get("media") or [{}])[0] or {}
        download_url = media.get("download_url") or ""
        if not download_url:
            raise RuntimeError(f"Sora job {video_id} completed but has no download URL.")

        try:
            download = await self._client.get(download_url)
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Sora download failed: {exc}") from exc
        if download.status_code >= 400:
            raise RuntimeError(f"Sora download returned {download.status_code}.")
        if not download.content:
            raise RuntimeError("Sora download was empty.")

        return VideoGenerationResult(
            data=download.content,
            media_type=media.get("type") or "video/mp4",
            provider=self.provider_name,
            model=self.model,
            seed=seed,
            meta={
                "accelerator": "OpenAI Sora",
                "frames": duration * 24,
                "fps": 24,
                "duration": duration,
                "duration_seconds": duration,
                "width": width,
                "height": height,
                "format": "MP4",
                "motion": motion or "sora world generation",
                "loop": False,
                "video_id": video_id,
            },
        )


class GeminiVeoProvider:
    """Google Veo video generation (Generative Language ``predictLongRunning``).

    Veo jobs are asynchronous operations: submit the prompt, poll the returned
    operation name until ``done``, then download the MP4 from the
    ``gs://`` URI in the response (via the ``files`` download endpoint).
    """

    provider_name = "gemini (veo)"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        *,
        timeout: float = 900.0,
        poll_interval: float = 3.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.poll_interval = poll_interval
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"x-goog-api-key": api_key},
            timeout=timeout,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    @staticmethod
    def _aspect(width: int, height: int) -> str:
        return "16:9" if width >= height else "9:16"

    async def _poll_operation(self, operation: str) -> dict[str, Any]:
        deadline = time.monotonic() + self.timeout
        url = f"/v1beta/{operation.lstrip('/')}"
        while time.monotonic() < deadline:
            await asyncio.sleep(self.poll_interval)
            try:
                response = await self._client.get(url)
            except httpx.HTTPError as exc:
                raise RuntimeError(f"Veo status request failed: {exc}") from exc
            if response.status_code >= 400:
                raise RuntimeError(
                    f"Veo status endpoint returned {response.status_code}: {response.text[:300]}"
                )
            body = response.json()
            if body.get("done"):
                return body
        raise RuntimeError(
            f"Veo video generation timed out after {self.timeout:g} seconds ({operation})."
        )

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
        if motion:
            prompt = f"{prompt}. Camera motion: {motion}"
        if palette:
            prompt = f"{prompt}. Colour palette: {palette}"
        duration = max(4, min(8, round(seconds)))
        payload: dict[str, Any] = {
            "instances": [{"prompt": prompt, "negativePrompt": negative_prompt}],
            "parameters": {
                "aspectRatio": self._aspect(width, height),
                "durationSeconds": duration,
                "resolution": "1080p" if max(width, height) >= 1280 else "720p",
            },
        }
        if seed is not None:
            payload["parameters"]["seed"] = seed
        url = f"/v1beta/models/{self.model}:predictLongRunning"
        try:
            response = await self._client.post(url, json=payload)
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Veo request failed: {exc}") from exc
        if response.status_code >= 400:
            raise RuntimeError(
                f"Veo endpoint returned {response.status_code}: {response.text[:300]}"
            )
        operation = response.json().get("name") or ""
        if not operation:
            raise RuntimeError("Veo accepted the request but returned no operation name.")

        final = await self._poll_operation(operation)
        error = final.get("error")
        if error:
            raise RuntimeError(f"Veo operation failed: {error.get('message', error)}")
        response_block = final.get("response") or {}
        samples = response_block.get("generateVideoResponse", {}).get("generatedSamples") or []
        if not samples:
            filtered = response_block.get("generateVideoResponse", {}).get(
                "raiMediaFilteredCount", 0
            )
            raise RuntimeError(
                "Veo returned no video samples"
                f" ({filtered} filtered by safety). Try rephrasing the prompt."
            )
        sample = samples[0] or {}
        video = sample.get("video") or {}
        uri = video.get("uri") or ""
        if not uri:
            raise RuntimeError("Veo returned a sample without a video URI.")
        # Download the gs:// object through the files endpoint.
        object_path = uri.split("gs://", 1)[-1]
        try:
            download = await self._client.get(
                f"/v1beta/files/{object_path}:download", params={"alt": "media"}
            )
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Veo download failed: {exc}") from exc
        if download.status_code >= 400:
            raise RuntimeError(f"Veo download returned {download.status_code}.")
        if not download.content:
            raise RuntimeError("Veo download was empty.")

        return VideoGenerationResult(
            data=download.content,
            media_type=video.get("mimeType") or "video/mp4",
            provider=self.provider_name,
            model=self.model,
            seed=seed,
            meta={
                "accelerator": "Google Veo",
                "frames": duration * 24,
                "fps": 24,
                "duration": duration,
                "duration_seconds": duration,
                "width": width,
                "height": height,
                "format": "MP4",
                "motion": motion or "veo world generation",
                "loop": False,
                "operation": operation,
            },
        )


_provider: (
    OfflineVideoProvider | NvidiaVideoProvider | OpenAIVideoProvider | GeminiVeoProvider | None
) = None


def build_video_provider(provider: str | None = None):
    chosen = (provider or settings.video_provider or "auto").strip().lower()
    if chosen == "auto":
        if settings.has_nvidia_credentials:
            chosen = "nvidia"
        elif settings.has_openai_video_credentials:
            chosen = "openai"
        elif settings.has_gemini_video_credentials:
            chosen = "gemini"
        else:
            chosen = "offline"
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
    if chosen == "openai":
        if not settings.has_openai_video_credentials:
            raise RuntimeError(
                "Video provider 'openai' selected but no API key is configured. "
                "Set AETHERIS_OPENAI_VIDEO_API_KEY (or AETHERIS_LLM_API_KEY)."
            )
        return OpenAIVideoProvider(
            base_url=settings.openai_video_base_url,
            api_key=settings.openai_video_api_key or settings.llm_api_key,
            model=settings.openai_video_model,
            timeout=settings.video_remote_timeout,
            poll_interval=settings.video_remote_poll_interval,
        )
    if chosen == "gemini":
        if not settings.has_gemini_video_credentials:
            raise RuntimeError(
                "Video provider 'gemini' selected but no API key is configured. "
                "Set AETHERIS_GEMINI_VIDEO_API_KEY (or AETHERIS_GEMINI_API_KEY)."
            )
        return GeminiVeoProvider(
            base_url=settings.gemini_base_url,
            api_key=settings.gemini_video_api_key or settings.gemini_api_key,
            model=settings.gemini_video_model,
            timeout=settings.video_remote_timeout,
            poll_interval=settings.video_remote_poll_interval,
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
    provider: OfflineVideoProvider | NvidiaVideoProvider | OpenAIVideoProvider | GeminiVeoProvider | None = None,
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
        logger.warning("Remote video generation failed; falling back to offline.", exc_info=True)
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
    "OpenAIVideoProvider",
    "GeminiVeoProvider",
    "build_video_provider",
    "get_video_provider",
    "reset_video_provider",
    "close_video_provider",
    "generate_video_bytes",
]

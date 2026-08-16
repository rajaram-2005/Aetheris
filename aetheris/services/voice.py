"""Voice — layered text-to-speech and speech-to-text.

Like image generation, voice is **layered**: fully offline by default and
upgraded to a real provider when an API key is configured.

Text-to-speech (``AETHERIS_SPEECH_PROVIDER``):
* ``offline`` (default) — the in-process formant synthesizer in
  :mod:`aetheris.media.speech`. No key, no network; intelligible but robotic.
* ``openai`` — the OpenAI TTS API (``tts-1`` / ``tts-1-hd``).
* ``gemini`` — Google Gemini ``synthesizeSpeech``.

Speech-to-text (``AETHERIS_STT_PROVIDER``):
* ``offline`` (default) — there is no in-process speech-recognition model, so
  offline returns an explicit, honest "not available offline" result.
* ``openai`` — the Whisper transcriptions API.
* ``gemini`` — Gemini audio transcription.
"""

from __future__ import annotations

import abc
import base64
import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

from ..core.config import settings

logger = logging.getLogger("aetheris")


@dataclass
class SpeechResult:
    data: bytes
    media_type: str
    provider: str
    model: str
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class TranscriptionResult:
    text: str
    provider: str
    model: str
    available: bool = True
    meta: dict[str, Any] = field(default_factory=dict)


class TTSProvider(abc.ABC):
    @property
    @abc.abstractmethod
    def provider_name(self) -> str: ...

    @property
    @abc.abstractmethod
    def model(self) -> str: ...

    @abc.abstractmethod
    async def synthesize(
        self, text: str, *, voice: str = "default", rate: float = 1.0, pitch: float = 1.0
    ) -> SpeechResult: ...

    async def aclose(self) -> None:  # pragma: no cover
        return None


class STTProvider(abc.ABC):
    @property
    @abc.abstractmethod
    def provider_name(self) -> str: ...

    @property
    @abc.abstractmethod
    def model(self) -> str: ...

    @abc.abstractmethod
    async def transcribe(
        self, audio: bytes, *, media_type: str = "audio/wav", language: str = "en"
    ) -> TranscriptionResult: ...

    async def aclose(self) -> None:  # pragma: no cover
        return None


# --- Offline TTS ---------------------------------------------------------------

class OfflineTTSProvider(TTSProvider):
    provider_name = "offline (formant synth)"

    @property
    def model(self) -> str:
        return "aetheris-formant-v1"

    async def synthesize(
        self, text: str, *, voice: str = "default", rate: float = 1.0, pitch: float = 1.0
    ) -> SpeechResult:
        from ..media import speech

        wav = speech.synthesize(text, voice=voice, rate=rate, pitch=pitch)
        return SpeechResult(
            data=wav,
            media_type="audio/wav",
            provider=self.provider_name,
            model=self.model,
            meta={
                "engine": "formant",
                "voice": voice,
                "rate": round(rate, 2),
                "pitch": round(pitch, 2),
                "note": "Offline synthetic voice.",
            },
        )


class OfflineSTTProvider(STTProvider):
    provider_name = "offline (unavailable)"

    @property
    def model(self) -> str:
        return "none"

    async def transcribe(
        self, audio: bytes, *, media_type: str = "audio/wav", language: str = "en"
    ) -> TranscriptionResult:
        return TranscriptionResult(
            text="",
            provider=self.provider_name,
            model=self.model,
            available=False,
            meta={
                "note": (
                    "Speech-to-text is not available offline: Aetheris has no "
                    "in-process speech-recognition model. Set AETHERIS_STT_PROVIDER="
                    "openai (Whisper) or =gemini to enable transcription with an API key."
                )
            },
        )


# --- OpenAI TTS / STT ----------------------------------------------------------

class OpenAITTSProvider(TTSProvider):
    provider_name = "openai (tts)"

    def __init__(
        self, api_key: str, model: str, voice: str,
        base_url: str = "https://api.openai.com/v1", timeout: float = 90.0,
    ) -> None:
        self._model = model
        self._voice = voice
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
        )

    @property
    def model(self) -> str:
        return self._model

    async def aclose(self) -> None:
        await self._client.aclose()

    async def synthesize(
        self, text: str, *, voice: str = "default", rate: float = 1.0, pitch: float = 1.0
    ) -> SpeechResult:
        payload = {
            "model": self._model,
            "voice": voice or self._voice,
            "input": text,
        }
        if rate != 1.0:  # OpenAI speed 0.25–4.0 (pitch has no API control)
            payload["speed"] = max(0.25, min(4.0, rate))
        try:
            resp = await self._client.post("/audio/speech", json=payload)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise RuntimeError(f"OpenAI TTS failed: {exc}") from exc
        return SpeechResult(
            data=resp.content,
            media_type="audio/mpeg",
            provider=self.provider_name,
            model=self._model,
        )


class OpenAISTTProvider(STTProvider):
    provider_name = "openai (whisper)"

    def __init__(
        self, api_key: str, model: str,
        base_url: str = "https://api.openai.com/v1", timeout: float = 90.0,
    ) -> None:
        self._model = model
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
        )

    @property
    def model(self) -> str:
        return self._model

    async def aclose(self) -> None:
        await self._client.aclose()

    async def transcribe(
        self, audio: bytes, *, media_type: str = "audio/wav", language: str = "en"
    ) -> TranscriptionResult:
        files = {"file": ("audio.wav", audio, media_type)}
        data: dict[str, str] = {"model": self._model}
        if language:
            data["language"] = language
        try:
            resp = await self._client.post("/audio/transcriptions", files=files, data=data)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise RuntimeError(f"OpenAI STT failed: {exc}") from exc
        text = (resp.json() or {}).get("text", "")
        return TranscriptionResult(text=text, provider=self.provider_name, model=self._model)


# --- Gemini TTS / STT ----------------------------------------------------------

class GeminiTTSProvider(TTSProvider):
    provider_name = "gemini (tts)"

    def __init__(
        self, api_key: str, model: str, voice: str,
        base_url: str = "https://generativelanguage.googleapis.com", timeout: float = 90.0,
    ) -> None:
        self._model = model
        self._voice = voice
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"x-goog-api-key": api_key},
            timeout=timeout,
        )

    @property
    def model(self) -> str:
        return self._model

    async def aclose(self) -> None:
        await self._client.aclose()

    async def synthesize(
        self, text: str, *, voice: str = "default", rate: float = 1.0, pitch: float = 1.0
    ) -> SpeechResult:
        language_code, _, voice_name = (voice or self._voice or "en-US").partition("|")
        payload = {
            "input": {"text": text},
            "voice": {
                "languageCode": language_code or "en-US",
                "name": voice_name or "en-US-Studio-O",
            },
            "audioConfig": {"audioEncoding": "LINEAR16"},
        }
        if rate != 1.0:  # Gemini speakingRate 0.25–4.0 (pitch has no API control)
            payload["audioConfig"]["speakingRate"] = max(0.25, min(4.0, rate))
        url = f"/v1beta/models/{self._model}:synthesizeSpeech"
        try:
            resp = await self._client.post(url, json=payload)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Gemini TTS failed: {exc}") from exc
        audio = (resp.json() or {}).get("audioContent")
        if not audio:
            raise RuntimeError("Gemini returned no audio content.")
        return SpeechResult(
            data=base64.b64decode(audio),
            media_type="audio/wav",
            provider=self.provider_name,
            model=self._model,
        )


class GeminiSTTProvider(STTProvider):
    provider_name = "gemini (audio transcription)"

    def __init__(
        self, api_key: str, model: str,
        base_url: str = "https://generativelanguage.googleapis.com", timeout: float = 120.0,
    ) -> None:
        self._model = model
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"x-goog-api-key": api_key},
            timeout=timeout,
        )

    @property
    def model(self) -> str:
        return self._model

    async def aclose(self) -> None:
        await self._client.aclose()

    async def transcribe(
        self, audio: bytes, *, media_type: str = "audio/wav", language: str = "en"
    ) -> TranscriptionResult:
        url = f"/v1beta/models/{self._model}:generateContent"
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {
                            "inline_data": {
                                "mime_type": media_type,
                                "data": base64.b64encode(audio).decode(),
                            }
                        },
                        {
                            "text": (
                                "Transcribe the speech in this audio to text "
                                "verbatim. Reply with the transcription only."
                            )
                        },
                    ],
                }
            ],
            "generationConfig": {"maxOutputTokens": 1024},
        }
        try:
            resp = await self._client.post(url, json=payload)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Gemini STT failed: {exc}") from exc
        data = resp.json()
        text = ""
        for candidate in data.get("candidates") or []:
            for part in (candidate.get("content") or {}).get("parts") or []:
                text += part.get("text", "")
        return TranscriptionResult(text=text, provider=self.provider_name, model=self._model)


# --- Factories -----------------------------------------------------------------

_tts: TTSProvider | None = None
_stt: STTProvider | None = None


def get_tts_provider() -> TTSProvider:
    global _tts
    if _tts is not None:
        return _tts
    chosen = (settings.speech_provider or "offline").strip().lower()
    if chosen == "openai" and settings.has_credentials:
        _tts = OpenAITTSProvider(
            api_key=settings.llm_api_key,
            model=settings.speech_model or "tts-1",
            voice=settings.speech_voice or "alloy",
            base_url=settings.llm_base_url,
            timeout=settings.llm_timeout,
        )
    elif chosen == "gemini" and settings.has_gemini_credentials:
        _tts = GeminiTTSProvider(
            api_key=settings.gemini_api_key,
            model=settings.speech_model or "gemini-2.5-flash-preview-tts",
            voice=settings.speech_voice or "en-US",
            base_url=settings.gemini_base_url,
            timeout=settings.llm_timeout,
        )
    else:
        if chosen in ("openai", "gemini"):
            logger.warning(
                "AETHERIS_SPEECH_PROVIDER=%s but no matching API key; using offline TTS.",
                chosen,
            )
        _tts = OfflineTTSProvider()
    return _tts


def get_stt_provider() -> STTProvider:
    global _stt
    if _stt is not None:
        return _stt
    chosen = (settings.stt_provider or "offline").strip().lower()
    if chosen == "openai" and settings.has_credentials:
        _stt = OpenAISTTProvider(
            api_key=settings.llm_api_key,
            model=settings.stt_model or "whisper-1",
            base_url=settings.llm_base_url,
            timeout=settings.llm_timeout,
        )
    elif chosen == "gemini" and settings.has_gemini_credentials:
        _stt = GeminiSTTProvider(
            api_key=settings.gemini_api_key,
            model=settings.stt_model or "gemini-2.5-flash",
            base_url=settings.gemini_base_url,
            timeout=settings.llm_timeout,
        )
    else:
        _stt = OfflineSTTProvider()
    return _stt


def reset_voice_providers() -> None:
    global _tts, _stt
    _tts = None
    _stt = None


async def close_voice_providers() -> None:
    global _tts, _stt
    for p in (_tts, _stt):
        if p is not None:
            await p.aclose()
    _tts = None
    _stt = None


__all__ = [
    "SpeechResult",
    "TranscriptionResult",
    "get_tts_provider",
    "get_stt_provider",
    "reset_voice_providers",
    "close_voice_providers",
]

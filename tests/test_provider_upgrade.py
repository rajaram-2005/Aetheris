"""Tests for the layered multi-provider upgrade: real image generation,
Anthropic + Gemini chat providers, and voice (offline TTS / layered STT).

Remote providers are exercised with an injectable ``httpx`` transport so no
network or API keys are required. Async tests use the project's
``asyncio_mode = "strict"`` convention.
"""

from __future__ import annotations

import base64
import io
import json
import wave

import httpx
import pytest
from fastapi.testclient import TestClient

from aetheris.core.config import settings  # noqa: F401
from aetheris.main import app
from aetheris.media.store import get_store
from aetheris.media.image_providers import (
    OpenAIImageProvider,
    GeminiImageProvider,
    StabilityImageProvider,
    OfflineImageProvider,
)
from aetheris.services.anthropic_provider import AnthropicProvider
from aetheris.services.gemini_provider import GeminiProvider
from aetheris.services.llm import PreparedConversation
from aetheris.schemas.chat import ChatMessage, ChatCompletionRequest


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean_store():
    get_store().clear()
    yield
    get_store().clear()


def _png_bytes() -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * 16 + b"\x00\x00\x00\x00IEND\xaeB`\x82"


def _prepared(messages=None):
    from aetheris.core.tiers import get_tier
    from aetheris.core.modes import get_mode

    msgs = messages or [
        ChatMessage(role="system", content="sys"),
        ChatMessage(role="user", content="hi"),
    ]
    user_msgs = [m for m in msgs if m.role != "system"]
    return PreparedConversation(
        tier=get_tier(None),
        mode=get_mode(None),
        messages=msgs,
        request=ChatCompletionRequest(model="aetheris-pro", messages=user_msgs),
    )


# --- Offline procedural image provider still works ----------------------------

@pytest.mark.asyncio
async def test_offline_provider_produces_png():
    provider = OfflineImageProvider()
    results = await provider.generate("a sunset over mountains")
    assert results and results[0].data[:8] == b"\x89PNG\r\n\x1a\n"
    assert results[0].provider == "offline (procedural)"
    assert results[0].meta["renderer"] == "procedural"


def test_image_endpoint_uses_provider_and_returns_artifact(client):
    resp = client.post(
        "/v1/images/generations",
        json={"prompt": "a gradient poster", "width": 320, "height": 200},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["kind"] == "image"
    assert body["detail"]["provider"] == "offline (procedural)"
    art = body["artifact"]
    assert art["media_type"] == "image/png"
    art_resp = client.get(art["url"])
    assert art_resp.content[:8] == b"\x89PNG\r\n\x1a\n"


# --- OpenAI image provider (mocked) -------------------------------------------

@pytest.mark.asyncio
async def test_openai_image_provider_parses_b64():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["model"] == "gpt-image-1"
        assert "sunset" in payload["prompt"]
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(_png_bytes()).decode()}]})

    transport = httpx.MockTransport(handler)
    provider = OpenAIImageProvider(
        base_url="https://api.openai.com/v1", api_key="test-key", model="gpt-image-1",
        transport=transport,
    )
    results = await provider.generate("a sunset over mountains")
    assert results[0].data == _png_bytes()
    assert results[0].media_type == "image/png"
    assert results[0].provider == "openai (dall-e / gpt-image)"


@pytest.mark.asyncio
async def test_gemini_image_provider_parses_inline_data():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {"content": {"parts": [{"inlineData": {
                        "mimeType": "image/png",
                        "data": base64.b64encode(_png_bytes()).decode(),
                    }}]}}
                ]
            },
        )

    transport = httpx.MockTransport(handler)
    provider = GeminiImageProvider(
        base_url="https://generativelanguage.googleapis.com", api_key="test-key",
        model="imagen-3.0-generate-002", transport=transport,
    )
    results = await provider.generate("a cat astronaut")
    assert results[0].data == _png_bytes()
    assert results[0].provider == "gemini (imagen / nano banana)"


@pytest.mark.asyncio
async def test_stability_image_provider_returns_bytes():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=_png_bytes(), headers={"content-type": "image/png"})

    transport = httpx.MockTransport(handler)
    provider = StabilityImageProvider(
        base_url="https://api.stability.ai", api_key="test-key",
        model="stable-image-core", transport=transport,
    )
    results = await provider.generate("a sunset")
    assert results[0].data == _png_bytes()
    assert results[0].media_type == "image/png"
    assert results[0].provider == "stability (stable-image)"


@pytest.mark.asyncio
async def test_openai_provider_error_raises_runtime():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"message": "rate limited"}})

    transport = httpx.MockTransport(handler)
    provider = OpenAIImageProvider(
        base_url="https://api.openai.com/v1", api_key="k", model="gpt-image-1", transport=transport
    )
    with pytest.raises(RuntimeError):
        await provider.generate("x")


# --- Anthropic chat provider (mocked) -----------------------------------------

@pytest.mark.asyncio
async def test_anthropic_complete_text():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert request.headers["x-api-key"] == "sk-test"
        assert payload["system"] == "sys"
        return httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "Hello from Claude!"}],
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 12, "output_tokens": 4},
            },
        )

    transport = httpx.MockTransport(handler)
    provider = AnthropicProvider(api_key="sk-test", model="claude-sonnet-4-20250514")
    provider._client = httpx.AsyncClient(
        base_url="https://api.anthropic.com",
        headers={"x-api-key": "sk-test", "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
        transport=transport,
    )
    result = await provider.complete(_prepared())
    assert result.text == "Hello from Claude!"
    assert result.finish_reason == "stop"


@pytest.mark.asyncio
async def test_anthropic_tool_use():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "content": [
                    {"type": "tool_use", "id": "call_1", "name": "calculator", "input": {"expression": "2+2"}}
                ],
                "stop_reason": "tool_use",
                "usage": {},
            },
        )

    transport = httpx.MockTransport(handler)
    provider = AnthropicProvider(api_key="k", model="m")
    provider._client = httpx.AsyncClient(
        base_url="https://api.anthropic.com",
        headers={"x-api-key": "k", "anthropic-version": "2023-06-01"},
        transport=transport,
    )
    result = await provider.complete(_prepared())
    assert result.tool_calls
    assert result.tool_calls[0].function.name == "calculator"
    assert result.finish_reason == "tool_calls"


# --- Gemini chat provider (mocked) --------------------------------------------

@pytest.mark.asyncio
async def test_gemini_complete_text():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["system_instruction"]["parts"][0]["text"] == "sys"
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {"content": {"parts": [{"text": "Hello from Gemini!"}]}, "finishReason": "STOP"}
                ],
                "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 3},
            },
        )

    transport = httpx.MockTransport(handler)
    provider = GeminiProvider(api_key="k", model="gemini-2.5-flash")
    provider._client = httpx.AsyncClient(
        base_url="https://generativelanguage.googleapis.com",
        headers={"x-goog-api-key": "k"},
        transport=transport,
    )
    result = await provider.complete(_prepared())
    assert result.text == "Hello from Gemini!"
    assert result.finish_reason == "stop"


@pytest.mark.asyncio
async def test_gemini_function_call():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {"content": {"parts": [{"functionCall": {"name": "calculator", "args": {"a": 1}}}]},
                     "finishReason": "STOP"},
                ],
                "usageMetadata": {},
            },
        )

    transport = httpx.MockTransport(handler)
    provider = GeminiProvider(api_key="k", model="gemini-2.5-flash")
    provider._client = httpx.AsyncClient(
        base_url="https://generativelanguage.googleapis.com",
        headers={"x-goog-api-key": "k"},
        transport=transport,
    )
    result = await provider.complete(_prepared())
    assert result.tool_calls[0].function.name == "calculator"


# --- Voice --------------------------------------------------------------------

def test_offline_tts_produces_valid_wav():
    from aetheris.media import speech
    wav = speech.synthesize("Hello world")
    assert wav[:4] == b"RIFF"
    with wave.open(io.BytesIO(wav)) as wf:
        assert wf.getnchannels() == 1
        assert wf.getframerate() == speech.SAMPLE_RATE
        assert wf.getnframes() > 1000


def test_speech_endpoint(client):
    resp = client.post("/v1/audio/speech", json={"text": "Welcome to Aetheris"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["kind"] == "audio"
    assert body["detail"]["provider"] == "offline (formant synth)"
    art_resp = client.get(body["artifact"]["url"])
    assert art_resp.content[:4] == b"RIFF"


def test_stt_endpoint_offline_is_honest(client):
    resp = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("a.wav", b"RIFFfake", "audio/wav")},
        data={"language": "en"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["available"] is False
    assert "not available offline" in body["note"]


@pytest.mark.asyncio
async def test_offline_stt_provider():
    from aetheris.services.voice import OfflineSTTProvider
    provider = OfflineSTTProvider()
    result = await provider.transcribe(b"RIFFfake")
    assert result.available is False

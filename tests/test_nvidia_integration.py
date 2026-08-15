"""NVIDIA NIM image/video/code/chat integration tests (network-free)."""

from __future__ import annotations

import base64
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from aetheris.core.config import Settings
from aetheris.hermes.cognition import classify, perceive
from aetheris.hermes.meta_learning import get_meta_learner, reset_meta_learner
from aetheris.main import app
from aetheris.media.image_providers import NvidiaImageProvider
from aetheris.media.video_providers import NvidiaVideoProvider
from aetheris.schemas.chat import ChatCompletionRequest, ChatMessage
from aetheris.services.llm import prepare_conversation
from aetheris.services.nvidia_code import NvidiaCodeProvider
from aetheris.services.nvidia_provider import NvidiaProvider


PNG = b"\x89PNG\r\n\x1a\n" + b"test-image"
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"test-video"


@pytest.fixture(autouse=True)
def fresh_meta_learner():
    reset_meta_learner()
    yield
    reset_meta_learner()


@pytest.mark.asyncio
async def test_nvidia_flux_provider_parses_artifact_and_uses_bearer_key():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert request.url.path.endswith("/flux.1-dev")
        assert request.headers["authorization"] == "Bearer nvapi-test"
        assert payload["prompt"].startswith("a robot painter")
        assert payload["mode"] == "base"
        assert payload["samples"] == 1
        return httpx.Response(
            200,
            json={"artifacts": [{"base64": base64.b64encode(PNG).decode(), "seed": 17}]},
        )

    provider = NvidiaImageProvider(
        endpoint="https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev",
        api_key="nvapi-test",
        model="black-forest-labs/flux.1-dev",
        transport=httpx.MockTransport(handler),
    )
    results = await provider.generate("a robot painter", width=1024, height=1024, seed=17)
    await provider.aclose()

    assert results[0].data == PNG
    assert results[0].media_type == "image/png"
    assert results[0].provider == "nvidia nim (visual genai)"
    assert results[0].seed == 17


@pytest.mark.asyncio
async def test_nvidia_cosmos_provider_parses_hosted_mp4():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["resolution"] == "720_16_9"
        assert payload["num_output_frames"] == 96
        return httpx.Response(200, json={"b64_video": base64.b64encode(MP4).decode()})

    provider = NvidiaVideoProvider(
        endpoint="https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos3-nano",
        api_key="nvapi-test",
        model="nvidia/cosmos3-nano",
        transport=httpx.MockTransport(handler),
    )
    result = await provider.generate(
        "a warehouse robot moves a crate", width=832, height=480, seconds=4, fps=24
    )
    await provider.aclose()

    assert result.data == MP4
    assert result.media_type == "video/mp4"
    assert result.meta["frames"] == 96
    assert result.provider == "nvidia nim (cosmos)"


@pytest.mark.asyncio
async def test_nvidia_cosmos_self_hosted_sync_returns_direct_mp4():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/videos/sync"
        assert request.headers["content-type"].startswith("application/x-www-form-urlencoded")
        assert b"model=nvidia%2Fcosmos3-nano" in request.content
        return httpx.Response(200, content=MP4, headers={"content-type": "video/mp4"})

    provider = NvidiaVideoProvider(
        endpoint="http://cosmos.local/v1/videos/sync",
        api_key="",
        model="nvidia/cosmos3-nano",
        transport=httpx.MockTransport(handler),
    )
    result = await provider.generate("robot motion", seconds=1, fps=10)
    await provider.aclose()

    assert result.data == MP4
    assert result.media_type == "video/mp4"


@pytest.mark.asyncio
async def test_nvidia_cosmos_provider_polls_nvcf_accepted_request():
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if request.method == "POST":
            return httpx.Response(202, headers={"NVCF-REQID": "req-123"})
        assert request.url.path.endswith("/req-123")
        return httpx.Response(200, json={"b64_video": base64.b64encode(MP4).decode()})

    provider = NvidiaVideoProvider(
        endpoint="https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos3-nano",
        api_key="nvapi-test",
        model="nvidia/cosmos3-nano",
        poll_interval=0.01,
        transport=httpx.MockTransport(handler),
    )
    result = await provider.generate("robot motion", seconds=1, fps=10)
    await provider.aclose()

    assert result.data == MP4
    assert calls == 2


@pytest.mark.asyncio
async def test_nvidia_code_generation_strips_fence_and_updates_hermes_meta():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["model"] == "deepseek-ai/deepseek-v4-flash"
        assert "Hermes requests verification" in payload["messages"][0]["content"]
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "```python\nprint(6 * 7)\n```"}}],
                "usage": {"prompt_tokens": 20, "completion_tokens": 8},
            },
        )

    provider = NvidiaCodeProvider(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key="nvapi-test",
        model="deepseek-ai/deepseek-v4-flash",
        transport=httpx.MockTransport(handler),
    )
    before = get_meta_learner().stats()["episodes"]
    result = await provider.generate("write a calculation", language="python")
    await provider.aclose()

    assert result.code == "print(6 * 7)\n"
    assert result.meta["hermes_adapted"] is True
    assert get_meta_learner().stats()["episodes"] == before + 1


@pytest.mark.asyncio
async def test_nvidia_chat_uses_configured_model_and_hermes_adaptation():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["model"] == "nvidia/nemotron-3-nano-30b-a3b"
        system_messages = [m["content"] for m in payload["messages"] if m["role"] == "system"]
        assert any("Hermes meta-learning guidance" in message for message in system_messages)
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "NIM answer"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 9, "completion_tokens": 2},
            },
        )

    provider = NvidiaProvider(
        api_key="nvapi-test",
        model="nvidia/nemotron-3-nano-30b-a3b",
        transport=httpx.MockTransport(handler),
    )
    prepared = prepare_conversation(
        [ChatMessage(role="user", content="Explain a retry algorithm")],
        model="aetheris-pro",
    )
    before = get_meta_learner().stats()["episodes"]
    result = await provider.complete(prepared)
    await provider.aclose()

    assert result.text == "NIM answer"
    assert get_meta_learner().stats()["episodes"] == before + 1


def test_standard_nvidia_api_key_environment_is_accepted(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi-standard")
    monkeypatch.delenv("AETHERIS_NVIDIA_API_KEY", raising=False)
    configured = Settings(_env_file=None)
    assert configured.nvidia_api_key == "nvapi-standard"
    assert configured.has_nvidia_credentials is True


def test_video_intent_is_routed_explicitly():
    result = classify(perceive("Make an animated warehouse robot video"))
    assert result.intent == "video"


def test_nvidia_status_never_exposes_a_key():
    with TestClient(app) as client:
        response = client.get("/v1/providers/nvidia")
    assert response.status_code == 200
    body = response.json()
    assert body["api_key_env"] == "AETHERIS_NVIDIA_API_KEY"
    assert "api_key" not in body
    assert "nvapi-" not in json.dumps(body) or "nvapi-..." in json.dumps(body)

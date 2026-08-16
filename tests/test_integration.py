"""Tests for real-model providers, the coding agent, and GitHub push.

Remote providers are exercised with injectable ``httpx`` transports (no
network); the GitHub integration is verified against the REST Git Data API
contract with a mocked transport, and the coder runs fully offline.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import zipfile

import httpx
import pytest
from fastapi.testclient import TestClient

from aetheris.main import app
from aetheris.media.store import get_store


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_store():
    get_store().clear()
    yield
    get_store().clear()


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    from aetheris.core.rate_limiter import get_limiter

    limiter = get_limiter()
    for cid in ("testclient", "127.0.0.1", "unknown"):
        limiter.reset(cid)
    yield
    for cid in ("testclient", "127.0.0.1", "unknown"):
        limiter.reset(cid)


# --- Gemini nano banana -----------------------------------------------------------

@pytest.mark.asyncio
async def test_nano_banana_provider_loops_for_variations():
    from aetheris.media.image_providers import GeminiImageProvider

    calls: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append(body)
        assert body["generationConfig"]["responseModalities"] == ["TEXT", "IMAGE"]
        assert body["generationConfig"]["imageConfig"]["aspectRatio"] == "16:9"
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"inlineData": {
                "mimeType": "image/png",
                "data": base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 32).decode(),
            }}]}}]},
        )

    provider = GeminiImageProvider(
        base_url="https://generativelanguage.googleapis.com", api_key="k",
        model="gemini-2.5-flash-image", transport=httpx.MockTransport(handler),
    )
    results = await provider.generate("a cat astronaut", width=1280, height=720, n=3)
    assert len(results) == 3
    assert len(calls) == 3  # one request per variation
    assert results[0].provider == "gemini (imagen / nano banana)"
    assert results[0].model == "gemini-2.5-flash-image"


@pytest.mark.asyncio
async def test_nano_banana_reports_text_refusal():
    from aetheris.media.image_providers import GeminiImageProvider

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"text": "I cannot generate that image."}]}}]},
        )

    provider = GeminiImageProvider(
        base_url="https://generativelanguage.googleapis.com", api_key="k",
        model="gemini-2.5-flash-image", transport=httpx.MockTransport(handler),
    )
    with pytest.raises(RuntimeError, match="cannot generate"):
        await provider.generate("forbidden thing")


# --- Sora + Veo --------------------------------------------------------------------

@pytest.mark.asyncio
async def test_sora_provider_submit_poll_download():
    from aetheris.media.video_providers import OpenAIVideoProvider

    state = {"polls": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path.endswith("/videos/generations"):
            payload = dict(httpx.QueryParams(request.content))
            assert payload["model"] == "sora-2"
            return httpx.Response(200, json={"id": "video_123", "status": "queued"})
        if request.method == "GET" and request.url.path == "/v1/videos/video_123":
            state["polls"] += 1
            if state["polls"] < 2:
                return httpx.Response(200, json={"id": "video_123", "status": "in_progress"})
            return httpx.Response(200, json={
                "id": "video_123", "status": "completed",
                "media": [{"type": "video/mp4", "download_url": "https://api.openai.com/v1/downloads/video_123.mp4"}],
            })
        if request.method == "GET" and "/downloads/" in request.url.path and "video_123" in request.url.path:
            return httpx.Response(200, content=b"FAKEMP4", headers={"content-type": "video/mp4"})
        return httpx.Response(404)

    provider = OpenAIVideoProvider(
        base_url="https://api.openai.com/v1", api_key="k", model="sora-2",
        poll_interval=0.01, transport=httpx.MockTransport(handler),
    )
    result = await provider.generate("a drone shot over a neon city", seconds=5)
    assert result.data == b"FAKEMP4"
    assert result.media_type == "video/mp4"
    assert result.provider == "openai (sora)"
    assert result.meta["video_id"] == "video_123"
    assert state["polls"] == 2


@pytest.mark.asyncio
async def test_veo_provider_operation_poll_download():
    from aetheris.media.video_providers import GeminiVeoProvider

    state = {"polls": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            body = json.loads(request.content)
            assert body["instances"][0]["prompt"]
            assert body["parameters"]["aspectRatio"] == "16:9"
            return httpx.Response(200, json={"name": "operations/op-9"})
        if request.url.path.endswith("operations/op-9"):
            state["polls"] += 1
            if state["polls"] < 2:
                return httpx.Response(200, json={"name": "operations/op-9", "done": False})
            return httpx.Response(200, json={
                "name": "operations/op-9", "done": True,
                "response": {"generateVideoResponse": {"generatedSamples": [
                    {"video": {"uri": "gs://bucket/op-9.mp4", "mimeType": "video/mp4"}}
                ]}},
            })
        if ":download" in request.url.path:
            return httpx.Response(200, content=b"FAKEMP4", headers={"content-type": "video/mp4"})
        return httpx.Response(404)

    provider = GeminiVeoProvider(
        base_url="https://generativelanguage.googleapis.com", api_key="k",
        model="veo-3.1-generate-preview", poll_interval=0.01,
        transport=httpx.MockTransport(handler),
    )
    result = await provider.generate("a waterfall at golden hour", seconds=8)
    assert result.data == b"FAKEMP4"
    assert result.provider == "gemini (veo)"
    assert result.meta["operation"] == "operations/op-9"


# --- GitHub integration --------------------------------------------------------------

def _github_handler(state: dict):
    """Mock the Git Data API: ref → blob → tree → commit → ref/PR."""

    def handler(request: httpx.Request) -> httpx.Response:
        url, method = request.url.path, request.method
        if url == "/repos/owner/repo" and method == "GET":
            return httpx.Response(200, json={"default_branch": "main"})
        if url == "/repos/owner/repo/git/ref/heads/main" and method == "GET":
            return httpx.Response(200, json={"object": {"sha": "base-sha"}})
        if url.endswith("/git/blobs") and method == "POST":
            state["blobs"] = state.get("blobs", 0) + 1
            return httpx.Response(201, json={"sha": f"blob-{state['blobs']}"})
        if url.endswith("/git/trees") and method == "POST":
            body = json.loads(request.content)
            state["tree"] = body["tree"]
            return httpx.Response(201, json={"sha": "tree-sha"})
        if url.endswith("/git/commits") and method == "POST":
            state["commit_message"] = json.loads(request.content)["message"]
            return httpx.Response(201, json={"sha": "commit-sha"})
        if url.endswith("/git/refs/heads/aetheris/test-build") and method == "PATCH":
            return httpx.Response(404, json={})  # force the create-ref path
        if url.endswith("/git/refs") and method == "POST":
            state["ref_created"] = json.loads(request.content)["ref"]
            return httpx.Response(201, json={})
        if url.endswith("/pulls") and method == "POST":
            return httpx.Response(201, json={"html_url": "https://github.com/owner/repo/pull/7"})
        return httpx.Response(404, json={"message": f"unhandled {method} {url}"})

    return handler


@pytest.mark.asyncio
async def test_github_rest_push_full_pipeline():
    from aetheris.services.github_client import GitHubClient

    state: dict = {}
    client = GitHubClient(
        token="test-token", base_url="https://api.github.com",
        transport=httpx.MockTransport(_github_handler(state)),
    )
    result = await client.push(
        "owner/repo",
        {"README.md": "# hello", "src/main.py": "print('hi')\n"},
        commit_message="Test build",
        create_pr=True,
    )
    assert result["branch"] == "aetheris/test-build"
    assert result["commit"] == "commit-sha"
    assert result["files"] == 2
    assert result["pr_url"] == "https://github.com/owner/repo/pull/7"
    assert state["blobs"] == 2
    assert state["ref_created"] == "refs/heads/aetheris/test-build"
    assert state["commit_message"] == "Test build"


def test_github_requires_owner_name():
    from aetheris.services.github_client import GitHubClient, GitHubError

    client = GitHubClient(token="t", transport=httpx.MockTransport(lambda r: httpx.Response(404)))
    with pytest.raises(GitHubError):
        asyncio.run(client.push("not-a-repo", {"a.txt": "x"}))


def test_github_status_and_push_endpoints(client: TestClient, monkeypatch):
    import aetheris.services.github_client as github_module
    from aetheris.services.github_client import GitHubClient

    state: dict = {}
    mock = httpx.MockTransport(_status_and_push_handler(state))

    class MockClient(GitHubClient):
        def __init__(self):
            super().__init__(token="test-token", base_url="https://api.github.com", transport=mock)

    monkeypatch.setattr(github_module, "get_github_client", lambda: MockClient())

    status = client.get("/v1/github/status")
    assert status.status_code == 200
    assert status.json()["connected"] is True
    assert status.json()["user"] == "octocat"

    push = client.post("/v1/github/push", json={
        "repo": "owner/repo",
        "files": {"hello.txt": "hello world"},
        "commit_message": "API push",
    })
    assert push.status_code == 200, push.text
    body = push.json()
    assert body["files"] == 1
    assert body["pr_url"] == "https://github.com/owner/repo/pull/7"


def _status_and_push_handler(state: dict):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/user":
            return httpx.Response(200, json={"login": "octocat"})
        return _github_handler(state)(request)

    return handler


def test_github_push_from_zip_artifact(client: TestClient, monkeypatch):
    import aetheris.services.github_client as github_module
    from aetheris.media.code import scaffold_project
    from aetheris.services.github_client import GitHubClient

    state: dict = {}
    mock = httpx.MockTransport(_github_handler(state))

    class MockClient(GitHubClient):
        def __init__(self):
            super().__init__(token="t", base_url="https://api.github.com", transport=mock)

    monkeypatch.setattr(github_module, "get_github_client", lambda: MockClient())

    project = scaffold_project("python-package", "demo-pkg", "demo")
    artifact = get_store().put(
        kind="code", media_type="application/zip", filename="demo-pkg.zip",
        data=project.to_zip(), prompt="demo",
    )
    push = client.post("/v1/github/push", json={
        "repo": "owner/repo", "artifact": artifact.id, "commit_message": "From ZIP",
    })
    assert push.status_code == 200, push.text
    assert push.json()["files"] >= 5  # package + tests + metadata


# --- Coder agent -----------------------------------------------------------------------

def test_coder_offline_builds_verified_project(client: TestClient):
    response = client.post("/v1/code/agent", json={
        "task": "build a CLI tool for a todo list with jwt auth",
        "name": "todo-cli",
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["engine"] == "offline-scaffold"
    assert body["kind"] == "cli-tool"
    assert {"todo", "auth"} <= set(body["plan"]["features"])
    assert body["verification"]["compile_errors"] == 0
    assert body["verification"]["tests"]["failed"] == 0
    assert body["artifact_url"].startswith("/v1/artifacts/")

    zip_bytes = client.get(body["artifact_url"]).content
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        names = archive.namelist()
    assert any(name.endswith("features.py") for name in names)
    assert "tests/test_features.py" in names

    # Steps tell the whole story.
    step_names = [step["step"] for step in body["steps"]]
    assert step_names[0] == "plan" and "verify#1" in step_names and step_names[-1] == "ship"


def test_coder_rejects_unknown_kind(client: TestClient):
    response = client.post("/v1/code/agent", json={"task": "x", "kind": "quantum-app"})
    assert response.status_code == 422


def test_coder_pushes_to_github(client: TestClient, monkeypatch):
    from aetheris.services.github_client import GitHubClient

    state: dict = {}
    mock = httpx.MockTransport(_github_handler(state))

    class MockClient(GitHubClient):
        def __init__(self):
            super().__init__(token="t", base_url="https://api.github.com", transport=mock)

    monkeypatch.setattr("aetheris.services.github_client.get_github_client", lambda: MockClient())

    response = client.post("/v1/code/agent", json={
        "task": "build a note taking python package",
        "name": "notes-pkg",
        "push_repo": "owner/repo",
        "commit_message": "Ship notes-pkg",
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["github"]["repo"] == "owner/repo"
    assert body["github"]["pr_url"] == "https://github.com/owner/repo/pull/7"
    step = next(s for s in body["steps"] if s["step"] == "github")
    assert step["status"] == "passed"


# --- Tools --------------------------------------------------------------------------------

def test_integration_tools_registered():
    from aetheris.tools import registry

    registry._ensure_loaded()
    names = {tool.name for tool in registry.all_tools()}
    assert {"code_agent", "push_to_github"} <= names


def test_cli_code_and_github_parsers():
    from aetheris.cli import _build_parser

    parser = _build_parser()
    parsed = parser.parse_args(
        ["code", "build me a todo api", "--name", "todo-api", "--push", "owner/repo", "--no-pr"]
    )
    assert parsed.name == "todo-api" and parsed.push == "owner/repo" and parsed.no_pr
    parsed = parser.parse_args(["github", "push", "owner/repo", "--dir", "src"])
    assert parsed.action == "push" and parsed.repo == "owner/repo"
    parsed = parser.parse_args(["github", "status"])
    assert parsed.action == "status"

"""End-to-end tests for the Aetheris capability surface.

These exercise the *real* implementations — the sandbox actually forks a Python
process, the BM25 index actually ranks, the agent loop actually calls tools —
rather than asserting against fixtures.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from aetheris.core.config import settings
from aetheris.main import app
from aetheris.tools import registry
from aetheris.tools.retrieval import get_index


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_index():
    get_index().clear()
    yield
    get_index().clear()


# --- Capability surface -------------------------------------------------------


def test_capabilities_endpoint_reports_live_features(client):
    report = client.get("/v1/capabilities").json()
    assert report["capabilities"]["tools"] is True
    assert report["capabilities"]["agent"] is True
    assert report["capabilities"]["code_sandbox"] is True
    assert report["capabilities"]["retrieval"] is True
    assert report["capabilities"]["vision"] is True
    assert "code_interpreter" in report["tools"]
    assert "document_search" in report["tools"]


def test_tools_endpoint_exposes_openai_schemas(client):
    tools = client.get("/v1/tools").json()["data"]
    names = {t["name"] for t in tools}
    assert {"code_interpreter", "document_search", "calculator", "think"} <= names
    for tool in tools:
        assert tool["parameters"]["type"] == "object"
        assert tool["description"]


# --- Code sandbox -------------------------------------------------------------


def test_sandbox_executes_real_python(client):
    response = client.post(
        "/v1/tools/code_interpreter/invoke",
        json={"arguments": {"code": "print(sum(i*i for i in range(1, 11)))"}},
    )
    body = response.json()
    assert body["ok"] is True
    assert "385" in body["output"]


def test_sandbox_reports_errors_without_crashing(client):
    body = client.post(
        "/v1/tools/code_interpreter/invoke",
        json={"arguments": {"code": "raise ValueError('boom')"}},
    ).json()
    assert body["ok"] is True  # the tool ran; the *program* failed
    assert "ValueError" in body["output"]
    assert "exit_code: 1" in body["output"]


@pytest.mark.asyncio
async def test_sandbox_enforces_timeout():
    from aetheris.tools.sandbox import run_python

    original = settings.sandbox_timeout
    settings.sandbox_timeout = 2.0
    try:
        result = await run_python("while True: pass")
        assert result.timed_out is True
        assert result.ok is False
    finally:
        settings.sandbox_timeout = original


@pytest.mark.asyncio
async def test_sandbox_blocks_network():
    from aetheris.tools.sandbox import run_python

    result = await run_python(
        "import socket\n"
        "try:\n"
        "    socket.socket()\n"
        "    print('NETWORK_OPEN')\n"
        "except OSError as exc:\n"
        "    print('BLOCKED')\n"
    )
    assert "BLOCKED" in result.stdout
    assert "NETWORK_OPEN" not in result.stdout


# --- Calculator ---------------------------------------------------------------


def test_calculator_is_exact(client):
    body = client.post(
        "/v1/tools/calculator/invoke",
        json={"arguments": {"expression": "2 ** 64"}},
    ).json()
    assert body["ok"] is True
    assert "18446744073709551616" in body["output"]


def test_calculator_rejects_code_execution(client):
    body = client.post(
        "/v1/tools/calculator/invoke",
        json={"arguments": {"expression": "__import__('os').system('echo pwned')"}},
    ).json()
    assert body["ok"] is False
    assert "Unsupported" in (body["error"] or "") or "Unknown name" in (body["error"] or "")


# --- Retrieval (RAG) ----------------------------------------------------------


def test_document_indexing_and_search(client):
    created = client.post(
        "/v1/documents",
        json={
            "title": "Rate limiter spec",
            "text": (
                "The gateway enforces a token bucket rate limiter. "
                "Each API key receives 5000 requests per hour. "
                "Burst capacity is 200 requests. Exceeding the limit returns HTTP 429 "
                "with a Retry-After header.\n\n"
                "Caching uses a two-tier design: an in-process LRU of 10000 entries "
                "backed by Redis with a 300 second TTL."
            ),
        },
    )
    assert created.status_code == 201
    doc_id = created.json()["id"]
    assert created.json()["chunks"] >= 1

    hits = client.post(
        "/v1/documents/search", json={"query": "burst capacity requests", "top_k": 3}
    ).json()
    assert hits["data"], "BM25 should return at least one hit"
    assert "Burst capacity is 200" in hits["data"][0]["text"]

    listing = client.get("/v1/documents").json()
    assert listing["stats"]["ranking"] == "BM25"
    assert any(d["id"] == doc_id for d in listing["data"])

    assert client.delete(f"/v1/documents/{doc_id}").status_code == 200
    assert client.get("/v1/documents").json()["data"] == []


def test_document_upload(client):
    response = client.post(
        "/v1/documents/upload",
        files={"file": ("notes.md", b"# Notes\n\nThe deploy window is Thursday 0200 UTC.", "text/markdown")},
    )
    assert response.status_code == 201
    assert response.json()["title"] == "notes.md"

    hits = client.post("/v1/documents/search", json={"query": "deploy window"}).json()
    assert "Thursday" in hits["data"][0]["text"]


def test_auto_context_grounds_plain_chat(client):
    client.post(
        "/v1/documents",
        json={"title": "Ops", "text": "The incident escalation contact is Priya Raman, reachable on pager 7781."},
    )
    # A plain (non-agent) request should still be grounded by retrieval.
    from aetheris.services.llm import prepare_conversation
    from aetheris.schemas.chat import ChatMessage

    prepared = prepare_conversation(
        [ChatMessage(role="user", content="Who is the incident escalation contact?")]
    )
    system_text = "\n".join(m.text for m in prepared.messages if m.role == "system")
    assert "Priya Raman" in system_text


# --- Tool calling & the agent loop -------------------------------------------


def test_agent_loop_executes_tools_and_returns_trace(client):
    response = client.post(
        "/v1/chat/completions",
        json={
            "model": "aetheris-pro",
            "agent": True,
            "messages": [{"role": "user", "content": "Please calculate 1234 * 5678 exactly."}],
        },
    )
    assert response.status_code == 200
    body = response.json()
    trace = body["tool_trace"]
    assert trace, "the agent should have called at least one tool"
    assert trace[0]["tool"] == "calculator"
    assert trace[0]["ok"] is True
    assert "7006652" in trace[0]["output"]
    # The final answer must incorporate the real observation.
    assert "7006652" in body["choices"][0]["message"]["content"]


def test_agent_uses_retrieval_for_document_questions(client):
    client.post(
        "/v1/documents",
        json={"title": "Runbook", "text": "Rollback procedure: run `make rollback TAG=previous` then verify /healthz returns 200."},
    )
    body = client.post(
        "/v1/chat/completions",
        json={
            "agent": True,
            "messages": [{"role": "user", "content": "What does the attached runbook document say about rollback?"}],
        },
    ).json()
    tools_called = {t["tool"] for t in (body["tool_trace"] or [])}
    assert "document_search" in tools_called
    assert "make rollback" in body["choices"][0]["message"]["content"]


def test_agent_runs_code_when_asked_to_execute(client):
    body = client.post(
        "/v1/chat/completions",
        json={
            "agent": True,
            "messages": [
                {
                    "role": "user",
                    "content": "Run this and tell me the output:\n```python\nprint('fib', [0,1,1,2,3,5,8][-1])\n```",
                }
            ],
        },
    ).json()
    trace = body["tool_trace"]
    assert any(t["tool"] == "code_interpreter" for t in trace)
    assert "fib 8" in body["choices"][0]["message"]["content"]


def test_agent_respects_iteration_budget(client):
    body = client.post(
        "/v1/chat/completions",
        json={
            "agent": True,
            "max_tool_iterations": 1,
            "messages": [{"role": "user", "content": "Calculate 2+2 and check the attached document."}],
        },
    ).json()
    assert len(body["tool_trace"]) <= 4  # one round, possibly several parallel calls
    assert body["choices"][0]["message"]["content"]


def test_tools_auto_exposes_toolbelt_without_agent(client):
    body = client.post(
        "/v1/chat/completions",
        json={"tools": "auto", "messages": [{"role": "user", "content": "What is 99 * 99?"}]},
    ).json()
    message = body["choices"][0]["message"]
    # Without agent=true the model returns the tool call for the client to run.
    assert message["tool_calls"], "toolbelt requests should surface tool calls"
    assert message["tool_calls"][0]["function"]["name"] == "calculator"
    assert body["choices"][0]["finish_reason"] == "tool_calls"


def test_streaming_emits_tool_events(client):
    with client.stream(
        "POST",
        "/v1/chat/completions",
        json={
            "agent": True,
            "stream": True,
            "messages": [{"role": "user", "content": "Calculate 45 * 12 please."}],
        },
    ) as response:
        assert response.status_code == 200
        events = []
        text = ""
        for line in response.iter_lines():
            if not line.startswith("data: ") or line.endswith("[DONE]"):
                continue
            chunk = json.loads(line[6:])
            if chunk.get("tool_event"):
                events.append(chunk["tool_event"])
            delta = chunk["choices"][0]["delta"].get("content")
            if delta:
                text += delta
    assert events, "a streamed agent run should emit tool_event chunks"
    assert events[0]["tool"] == "calculator"
    assert "540" in text


# --- Multimodal ---------------------------------------------------------------


def test_vision_accepts_image_content_parts(client):
    tiny_png = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    response = client.post(
        "/v1/chat/completions",
        json={
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "What is in this image?"},
                        {"type": "image_url", "image_url": {"url": tiny_png}},
                    ],
                }
            ]
        },
    )
    assert response.status_code == 200
    assert "Visual input received" in response.json()["choices"][0]["message"]["content"]


def test_vision_rejects_invalid_image_url(client):
    response = client.post(
        "/v1/chat/completions",
        json={
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": "file:///etc/passwd"}},
                        {"type": "text", "text": "read this"},
                    ],
                }
            ]
        },
    )
    assert response.status_code == 400


def test_vision_enforces_image_count_limit(client):
    tiny = "data:image/png;base64,iVBORw0KGgo="
    parts = [{"type": "image_url", "image_url": {"url": tiny}} for _ in range(20)]
    parts.append({"type": "text", "text": "describe"})
    response = client.post("/v1/chat/completions", json={"messages": [{"role": "user", "content": parts}]})
    assert response.status_code == 400
    assert "Too many images" in response.json()["detail"]


# --- Sovereign mode gating ----------------------------------------------------


def test_sovereign_mode_is_gated_by_default(client):
    assert "sovereign" not in [m["id"] for m in client.get("/v1/modes").json()["data"]]
    response = client.post(
        "/v1/chat/completions",
        json={"mode": "sovereign", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert response.status_code == 400
    assert "gated" in response.json()["detail"]


def test_sovereign_mode_activates_when_enabled(client):
    settings.sovereign_enabled = True
    try:
        modes = [m["id"] for m in client.get("/v1/modes").json()["data"]]
        assert "sovereign" in modes
        body = client.post(
            "/v1/chat/completions",
            json={"mode": "sovereign", "messages": [{"role": "user", "content": "Should we ship on Friday?"}]},
        ).json()
        assert body["mode"] == "sovereign"
        assert "Sovereign Mode is active" in body["choices"][0]["message"]["content"]
    finally:
        settings.sovereign_enabled = False


# --- Web tool gating ----------------------------------------------------------


def test_web_fetch_is_disabled_by_default(client):
    body = client.post(
        "/v1/tools/web_fetch/invoke", json={"arguments": {"url": "https://example.com"}}
    ).json()
    assert body["ok"] is False
    assert "disabled" in (body["error"] or "").lower()


@pytest.mark.asyncio
async def test_web_fetch_blocks_ssrf_targets():
    from aetheris.tools.web import web_fetch

    settings.web_enabled = True
    try:
        for target in ("http://169.254.169.254/latest/meta-data/", "http://localhost:8000/v1/health"):
            result = await registry.execute("web_fetch", {"url": target})
            assert result.ok is False
            assert "non-public" in (result.error or "") or "Refusing" in (result.error or "")
    finally:
        settings.web_enabled = False


# --- Prompt composition -------------------------------------------------------


def test_directives_are_injected_only_when_capabilities_are_live():
    from aetheris.schemas.chat import ChatMessage
    from aetheris.services.llm import prepare_conversation

    plain = prepare_conversation([ChatMessage(role="user", content="hello")])
    assert "Tool Use:" not in plain.messages[0].text

    agentic = prepare_conversation(
        [ChatMessage(role="user", content="hello")], agent=True
    )
    assert "Tool Use:" in agentic.messages[0].text
    assert "Autonomous Execution:" in agentic.messages[0].text


def test_structured_mode_keeps_json_only_contract():
    from aetheris.schemas.chat import ChatMessage
    from aetheris.services.llm import prepare_conversation

    prepared = prepare_conversation(
        [ChatMessage(role="user", content="extract fields")], mode="structured", agent=True
    )
    # Prose directives must not dilute the JSON-only instruction.
    assert "Tool Use:" not in prepared.messages[0].text

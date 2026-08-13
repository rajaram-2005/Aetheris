"""Tests for the Aetheris v0.11.0 feature set.

Features covered:
* Smart model routing (model_router.py + ``POST /v1/models/recommend``)
* Conversation summarizer (conversation_summary.py + ``POST /v1/conversations/{id}/summarize``)
* Regression tests for the Tool Composition (NOVA plan) execution path that
  previously raised ``NameError``/``await`` failures.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aetheris.main import app


@pytest.fixture(autouse=True)
def _reset():
    """Reset module singletons between tests to avoid cross-contamination."""
    from aetheris.core.rate_limiter import get_limiter

    limiter = get_limiter()
    for cid in ("testclient", "127.0.0.1", "unknown"):
        limiter.reset(cid)

    import aetheris.core.conversations as conv
    conv._store = conv.ConversationStore()

    yield

    conv._store = conv.ConversationStore()


client = TestClient(app)


# =============================================================================
# Unit tests — Smart Model Router
# =============================================================================

class TestModelRouterUnit:
    def test_proof_routes_to_ultra(self):
        from aetheris.core.model_router import recommend_model
        rec = recommend_model("Prove the square root of 2 is irrational")
        assert rec["model"] == "aetheris-ultra"
        assert rec["reasoning"] is True

    def test_short_greeting_routes_to_lite(self):
        from aetheris.core.model_router import recommend_model
        rec = recommend_model("hello")
        assert rec["model"] == "aetheris-lite"

    def test_code_routes_to_pro(self):
        from aetheris.core.model_router import recommend_model
        rec = recommend_model("Write an async python pipeline with rate limiting")
        assert rec["model"] == "aetheris-pro"

    def test_research_routes_to_pro(self):
        from aetheris.core.model_router import recommend_model
        rec = recommend_model("research LLM scaling laws and cite sources")
        assert rec["model"] == "aetheris-pro"

    def test_latency_low_biases_to_lite(self):
        from aetheris.core.model_router import recommend_model
        rec = recommend_model("prove the theorem", latency="low")
        assert rec["model"] == "aetheris-lite"

    def test_explicit_preference_respected(self):
        from aetheris.core.model_router import recommend_model
        rec = recommend_model("prove the theorem", preferred="flash")
        assert rec["model"] == "aetheris-lite"

    def test_reasoning_override(self):
        from aetheris.core.model_router import recommend_model
        rec = recommend_model("analyze the economics of the proposal", reasoning=False)
        assert rec["reasoning"] is False
        assert rec["model"] != "aetheris-ultra"

    def test_scores_cover_all_tiers(self):
        from aetheris.core.model_router import recommend_model
        rec = recommend_model("summarize this")
        assert set(rec["scores"]) == {"aetheris-lite", "aetheris-pro", "aetheris-ultra"}
        assert len(rec["reasons"]) >= 1


# =============================================================================
# API tests — POST /v1/models/recommend
# =============================================================================

class TestModelRecommendAPI:
    def test_recommend_endpoint(self):
        r = client.post("/v1/models/recommend", json={"task": "solve the integral of x^2"})
        assert r.status_code == 200
        body = r.json()
        assert body["model"] in {"aetheris-lite", "aetheris-pro", "aetheris-ultra"}
        assert "scores" in body and "reasons" in body

    def test_recommend_rejects_empty_task(self):
        r = client.post("/v1/models/recommend", json={"task": ""})
        assert r.status_code == 422

    def test_recommend_rejects_bad_latency(self):
        r = client.post("/v1/models/recommend", json={"task": "hi", "latency": "turbo"})
        assert r.status_code == 422


# =============================================================================
# API tests — Conversation summarizer
# =============================================================================

class TestConversationSummarizeAPI:
    def _make_conversation(self, messages):
        created = client.post("/v1/conversations", json={"title": "", "mode": "general"})
        cid = created.json()["id"]
        for role, content in messages:
            client.post(f"/v1/conversations/{cid}/messages", json={"role": role, "content": content})
        return cid

    def test_summarize_returns_structure(self):
        cid = self._make_conversation([
            ("user", "Explain how async queues work in Python."),
            ("assistant", "Use asyncio.Queue with producer and consumer worker tasks."),
            ("user", "How do I add backoff?"),
            ("assistant", "Wrap consumer tasks with exponential backoff and retries."),
        ])
        r = client.post(f"/v1/conversations/{cid}/summarize")
        assert r.status_code == 200
        body = r.json()
        assert body["conversation_id"] == cid
        assert set(body) >= {"summary", "key_points", "action_items", "source", "confidence"}
        assert body["summary"]

    def test_summarize_empty_conversation(self):
        created = client.post("/v1/conversations", json={"title": "", "mode": "general"})
        cid = created.json()["id"]
        r = client.post(f"/v1/conversations/{cid}/summarize")
        assert r.status_code == 200
        assert "empty" in r.json()["source"]

    def test_summarize_missing_conversation_404(self):
        r = client.post("/v1/conversations/does-not-exist/summarize")
        assert r.status_code == 404

    def test_fallback_is_deterministic(self):
        from aetheris.core.conversations import ConversationCreate, _Conversation, _Message
        conv = _Conversation(id="c1", title="", tags=[], mode="general", model="")
        for i, role in enumerate(["user", "assistant"]):
            conv.messages.append(_Message(
                id=f"m{i}", role=role, content="How do I write a test? " * 8, timestamp=0.0,
            ))
        from aetheris.services.conversation_summary import extractive_fallback
        result = extractive_fallback(conv)
        assert result["source"] == "extractive-fallback"
        assert result["summary"]


# =============================================================================
# Regression — NOVA Tool Composition (plan + execution)
# =============================================================================

class TestNovaPlanRegression:
    """These failed before the fix: ``NameError: name 'asyncio' is not defined``
    and ``object dict can't be used in 'await' expression``."""

    def test_research_plan_executes(self):
        r = client.post("/v1/nova/plan?execute=true", json={"goal": "research quantum computing and cite sources"})
        assert r.status_code == 200
        body = r.json()
        assert body["status"] in {"succeeded", "partial"}

    def test_code_plan_executes(self):
        r = client.post("/v1/nova/plan?execute=true", json={"goal": "write a function and implement it"})
        assert r.status_code == 200
        assert r.json()["status"] in {"succeeded", "partial"}

    def test_math_plan_executes(self):
        r = client.post("/v1/nova/plan?execute=true", json={"goal": "fibonacci compute verify"})
        assert r.status_code == 200
        assert r.json()["status"] in {"succeeded", "partial"}

    def test_plan_without_execute(self):
        r = client.post("/v1/nova/plan?execute=false", json={"goal": "summarize this"})
        assert r.status_code == 200
        body = r.json()
        assert "steps" in body and "success_criteria" in body

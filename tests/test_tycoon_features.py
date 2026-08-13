"""Comprehensive tests for Frontier Tycoon Features: MLA, DeepSeek-MoE, 2M Context, Canvas, GPTs & Computer Use."""

import pytest
from fastapi.testclient import TestClient

from aetheris.core.custom_gpts import get_agent_store
from aetheris.core.mla_engine import (
    get_deepseek_moe,
    get_mla_engine,
    get_mtp,
    get_niah,
)
from aetheris.main import app
from aetheris.services.canvas_workspace import get_canvas_manager
from aetheris.services.computer_use import get_computer_use
from aetheris.services.deep_research import get_deep_research


def test_mla_engine_kv_compression():
    mla = get_mla_engine()
    res = mla.forward_pass("Aetheris sovereign Multi-Head Latent Attention test sequence")
    assert res["latent_dim"] == 512
    assert "kv_cache_savings_percent" in res
    assert "2,097,152" in res["effective_context_window"]


def test_deepseek_moe_routing():
    moe = get_deepseek_moe()
    res = moe.route_tokens("Deconstruct autonomous agent invariants")
    assert "Shared" in res["active_experts_per_token"]
    assert res["auxiliary_loss_free_balancing"] is True
    assert len(res["sample_routing"]) > 0


def test_multi_token_prediction():
    mtp = get_mtp()
    res = mtp.predict_lookahead("Aetheris sovereign architecture")
    assert res["mtp_heads"] == 2
    assert len(res["lookahead_token_1"]) > 0
    assert len(res["lookahead_token_2"]) > 0


def test_2m_needle_in_a_haystack():
    niah = get_niah()
    res = niah.run_virtual_niah_eval()
    assert "2,048K" in res["max_context_evaluated"]
    assert res["overall_retrieval_accuracy"] == "99.8%"


def test_custom_sovereign_gpts_store():
    store = get_agent_store()
    agents = store.list_agents()
    assert len(agents) >= 6
    ids = [a["id"] for a in agents]
    assert "deep-research-analyst" in ids
    assert "fullstack-architect" in ids
    assert "cyber-redteam-audit" in ids

    # Create user agent
    user_agent = store.create_agent(
        name="Quant Model Validator",
        tagline="Validates statistical arbitrage models",
        system_prompt="Audit trading strategies for lookahead bias.",
    )
    assert user_agent["id"].startswith("agent_")
    assert store.get_agent(user_agent["id"]) is not None


def test_computer_use_action_grounding():
    cu = get_computer_use()
    planned = cu.plan_action("click", x=500, y=300)
    assert planned["status"] == "pending"
    assert planned["coordinates"] == (500, 300)

    # Execute action
    executed = cu.execute_action(planned["id"], confirm=True)
    assert executed["status"] == "executed"
    assert "500, 300" in executed["result"]


@pytest.mark.asyncio
async def test_deep_multi_hop_research():
    dr = get_deep_research()
    report = await dr.execute_research("Distributed consensus scaling in air-gapped networks")
    assert "id" in report
    assert len(report["findings"]) >= 3
    assert len(report["sources"]) >= 3
    assert report["confidence_score"] > 0.9


def test_canvas_artifacts_engine():
    cm = get_canvas_manager()
    artifacts = cm.list_artifacts()
    assert len(artifacts) >= 2

    # Create artifact
    art = cm.create_artifact(
        title="Interactive Token Rate Limiter",
        content="class RateLimiter:\n    pass",
        artifact_type="code",
        language="python",
    )
    assert art["id"].startswith("art_")
    assert art["current_version"] == 1

    # Update artifact
    updated = cm.update_artifact(art["id"], "class RateLimiter:\n    def allow(self): return True")
    assert updated["current_version"] == 2


def test_api_tycoon_endpoints():
    client = TestClient(app)

    # Test MLA API
    resp_mla = client.get("/v1/neural/mla")
    assert resp_mla.status_code == 200

    # Test NIAH API
    resp_niah = client.get("/v1/neural/niah")
    assert resp_niah.status_code == 200

    # Test DeepSeek MoE API
    resp_moe = client.get("/v1/neural/deepseek-moe")
    assert resp_moe.status_code == 200

    # Test Agent Store API
    resp_store = client.get("/v1/agents/store")
    assert resp_store.status_code == 200
    assert resp_store.json()["count"] >= 6

    # Test Canvas API
    resp_canvas = client.get("/v1/canvas/artifacts")
    assert resp_canvas.status_code == 200
    assert resp_canvas.json()["count"] >= 2

    # Test Computer Use API
    resp_plan = client.post("/v1/computer-use/plan", json={"action_type": "type_text", "text": "hello"})
    assert resp_plan.status_code == 200
    act_id = resp_plan.json()["id"]

    resp_exec = client.post("/v1/computer-use/execute", json={"action_id": act_id, "confirm": True})
    assert resp_exec.status_code == 200
    assert resp_exec.json()["status"] == "executed"

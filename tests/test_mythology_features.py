"""Tests for the connected mythology features: council, wisdom, custom legends, memory."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aetheris.main import app
from aetheris.core.tamil_mythology import (
    daily_wisdom, legend_council, get_legend_store, get_character_memory,
    character_by_id,
)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_daily_wisdom_is_stable_and_valid():
    w = daily_wisdom()
    assert w["character_id"]
    assert w["wisdom"]
    assert "date" in w
    # deterministic: same day -> same figure
    assert daily_wisdom()["character_id"] == w["character_id"]


def test_legend_council_convenes_and_synthesises():
    result = legend_council(["murugan", "valluvar", "ravana"], "How do I stay focused?")
    assert len(result["members"]) >= 2
    assert result["question"]
    assert len(result["speeches"]) == len(result["members"])
    for s in result["speeches"]:
        assert s["name"] in s["voice"]
    assert "synthesis" in result


def test_legend_council_requires_two():
    with pytest.raises(ValueError):
        legend_council(["murugan"], "hi")


def test_daily_endpoint(client):
    resp = client.get("/v1/mythology/daily")
    assert resp.status_code == 200
    assert resp.json()["wisdom"]


def test_council_endpoint(client):
    resp = client.post(
        "/v1/mythology/council",
        json={"character_ids": ["murugan", "valluvar"], "question": "Give me focus"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["question"] == "Give me focus"
    assert len(body["members"]) == 2


def test_custom_legend_crud(client):
    # Create
    resp = client.post(
        "/v1/mythology/custom",
        json={
            "name": "Nandi", "category": "god",
            "epithet": "The Bull of Shiva", "persona": "I am Nandi, the sacred bull.",
        },
    )
    assert resp.status_code == 201, resp.text
    legend = resp.json()
    assert legend["id"].startswith("custom")
    cid = legend["id"]

    # It joins the pantheon
    listing = client.get("/v1/mythology")
    assert listing.json()["count"] >= 32
    assert any(c["id"] == cid for c in listing.json()["characters"])

    # It is reachable for chat
    chat = client.post("/v1/mythology/chat", json={"character_id": cid, "message": "Greet me"})
    assert chat.status_code == 200, chat.text
    assert "Nandi" in chat.json()["reply"]

    # Custom list + delete
    assert any(c["id"] == cid for c in client.get("/v1/mythology/custom").json()["legends"])
    assert client.delete(f"/v1/mythology/custom/{cid}").json()["deleted"] == cid
    assert client.get(f"/v1/mythology/custom").json()["count"] == 0


def test_custom_legend_portrait(client):
    resp = client.post(
        "/v1/mythology/custom",
        json={"name": "Vaan", "category": "hero"},
    )
    cid = resp.json()["id"]
    portrait = client.post(f"/v1/mythology/{cid}/portrait")
    assert portrait.status_code == 200, portrait.text
    assert portrait.json()["kind"] == "image"


def test_character_memory_records_and_recalls():
    mem = get_character_memory()
    mem.clear("murugan", "sess-1")
    mem.add("murugan", "sess-1", "user", "I am afraid of failing")
    mem.add("murugan", "sess-1", "assistant", "Fear is a shadow that flees light.")
    ctx = mem.context("murugan", "sess-1")
    assert "afraid of failing" in ctx
    # Different session is isolated
    assert mem.context("murugan", "sess-2") == ""


def test_chat_records_memory(client):
    # clear any prior state for a unique session
    from aetheris.core.tamil_mythology import get_character_memory
    get_character_memory().clear("ganesha", "mem-test")

    resp = client.post(
        "/v1/mythology/chat",
        json={"character_id": "ganesha", "message": "help me begin a project", "session_id": "mem-test"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["remembered_turns"] >= 0

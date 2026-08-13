"""Tests for the Tamil-mythology "living legends" feature."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aetheris.main import app
from aetheris.core.tamil_mythology import character_list, character_by_id, build_persona_task, pantheon_graph, connections_for


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_character_catalog_is_rich():
    chars = character_list()
    # Gods, goddesses, heroes, sages, villains, asuras, kings, divine symbols.
    categories = {c["category"] for c in chars}
    for needed in ("god", "goddess", "hero", "sage", "villain", "asura", "epic", "divine-tool"):
        assert needed in categories, f"missing category {needed}"
    assert len(chars) >= 20, "expected a rich pantheon"
    ids = {c["id"] for c in chars}
    for needed in ("murugan", "shiva", "vishnu", "kannagi", "valluvar", "ravana", "surapadman", "vel"):
        assert needed in ids, f"missing {needed}"
    # Expanded cast: Madurai goddess, folk guardians, Nayanmar saints.
    for extra in ("meenakshi", "madurai_veeran", "karuppu_sami", "sambandar", "appar"):
        assert extra in ids, f"missing {extra}"


def test_pantheon_is_connected_graph():
    graph = pantheon_graph()
    assert graph["node_count"] == len(graph["nodes"])
    assert graph["edge_count"] == len(graph["edges"])
    node_ids = {n["id"] for n in graph["nodes"]}
    # Every edge must reference real nodes (no dangling / disconnected ids).
    for e in graph["edges"]:
        assert e["from"] in node_ids, f"edge from unknown {e['from']}"
        assert e["to"] in node_ids, f"edge to unknown {e['to']}"
    # Murugan is a well-connected hub.
    murugan_links = connections_for("murugan")
    assert murugan_links, "murugan should have connections"
    # The graph must not be a single isolated list — some figure connects to >=2.
    assert max(len(connections_for(n["id"])) for n in graph["nodes"]) >= 2


def test_character_has_full_persona():
    murugan = character_by_id("murugan")
    assert murugan is not None
    assert murugan["tamil_name"] == "முருகன்"
    assert murugan["category"] == "god"
    assert "vel" in murugan["persona"].lower()
    assert murugan["image_prompt"]


def test_persona_task_embeds_character():
    murugan = character_by_id("murugan")
    task = build_persona_task(murugan, "I feel afraid of failing.")
    assert "Murugan" in task
    assert "I feel afraid of failing." in task
    assert "PERSONA" in task


def test_mythology_list_endpoint(client):
    resp = client.get("/v1/mythology")
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == len(body["characters"])
    assert "god" in body["categories"]


def test_mythology_get_endpoint(client):
    resp = client.get("/v1/mythology/murugan")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Murugan"
    assert client.get("/v1/mythology/nonexistent").status_code == 404


def test_mythology_graph_endpoint(client):
    resp = client.get("/v1/mythology/graph")
    assert resp.status_code == 200
    body = resp.json()
    assert body["node_count"] == len(body["nodes"])
    assert body["edge_count"] == len(body["edges"])
    node_ids = {n["id"] for n in body["nodes"]}
    for e in body["edges"]:
        assert e["from"] in node_ids
        assert e["to"] in node_ids


def test_mythology_get_includes_connections(client):
    resp = client.get("/v1/mythology/murugan")
    assert resp.status_code == 200
    body = resp.json()
    assert "connections" in body
    assert body["connections"], "murugan should be connected"


def test_mythology_chat_speaks_as_character(client):
    resp = client.post(
        "/v1/mythology/chat",
        json={"character_id": "valluvar", "message": "Give me a kural about hard work"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["character"]["id"] == "valluvar"
    assert body["character"]["name"] == "Tiruvalluvar"
    assert body["reply"], "expected a reply from the sage"
    # The reply must stay in-character (persona + domain), not a corpus article.
    assert "Valluvar" in body["reply"] or "kural" in body["reply"].lower()


def test_each_category_has_distinct_voice():
    from aetheris.core.tamil_mythology import character_by_id, respond_in_character

    hero = respond_in_character(character_by_id("kannagi"), "The world is unfair to the just.")
    villain = respond_in_character(character_by_id("ravana"), "The world is unfair to the just.")
    god = respond_in_character(character_by_id("murugan"), "The world is unfair to the just.")

    assert hero != villain != god
    assert "Kannagi" in hero
    assert "Ravana" in villain
    assert "Murugan" in god


def test_mythology_portrait_endpoint(client):
    resp = client.post("/v1/mythology/murugan/portrait")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["kind"] == "image"
    assert body["detail"]["name"] == "Murugan"
    assert body["artifact"]["media_type"] == "image/png"

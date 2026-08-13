"""Tests for the mythology AI + open-source resources + skills catalog upgrade."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aetheris.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_resources_endpoint_lists_open_source_assets(client):
    resp = client.get("/v1/resources")
    assert resp.status_code == 200
    body = resp.json()
    assert body["runtimes"]
    assert body["hosted"]
    assert body["model_families"]
    ids = {r["id"] for r in body["runtimes"]}
    assert "ollama" in ids and "vllm" in ids
    hosted = {r["id"] for r in body["hosted"]}
    assert "groq" in hosted and "together" in hosted


def test_resources_provider_recipe(client):
    resp = client.get("/v1/resources?provider=ollama")
    assert resp.status_code == 200
    assert resp.json()["id"] == "ollama"
    assert resp.json()["offline"] is True
    assert client.get("/v1/resources?provider=does-not-exist").status_code == 404


def test_new_integration_templates_present(client):
    resp = client.get("/v1/integrations")
    assert resp.status_code == 200
    services = {t["service"] for t in resp.json()["data"]}
    for expected in ("gmail", "google-meet", "google-calendar", "google-drive",
                     "google-sheets", "telegram", "whatsapp", "linkedin",
                     "instagram", "youtube"):
        assert expected in services, f"missing integration {expected}"


def test_thamizh_mode_available(client):
    resp = client.get("/v1/modes")
    assert resp.status_code == 200
    ids = [m["id"] for m in resp.json()["data"]]
    assert "thamizh" in ids
    mode = next(m for m in resp.json()["data"] if m["id"] == "thamizh")
    assert "Tamil" in mode["display_name"]


def test_thamizh_mode_runs_through_hermes():
    # The mythos mode must resolve to a real system prompt and run the cascade.
    from aetheris.core.modes import get_mode

    mode = get_mode("thamizh")
    assert mode.id == "thamizh"
    assert "Tirukkuṟaḷ" in mode.system_prompt or "Sangam" in mode.system_prompt
    # Aliases resolve too.
    assert get_mode("tamil").id == "thamizh"


def test_thamizh_mode_styles_answers():
    from aetheris.core.mode_style import style_answer

    styled = style_answer("thamizh", "Focus on one task at a time.", task="How do I stay focused?")
    assert "Vanakkam" in styled
    assert "Sangam" in styled or "kural" in styled
    # Exact answers must never be restyled.
    assert style_answer("thamizh", "42", task="2+2?", exact=True) == "42"


def test_skills_catalog_endpoint(client):
    resp = client.get("/v1/skills/catalog")
    assert resp.status_code == 200
    body = resp.json()
    families = {f["family"] for f in body["families"]}
    assert "Claude-style" in families and "Gemini-style" in families
    claude = next(f for f in body["families"] if f["family"] == "Claude-style")
    ids = {s["id"] for s in claude["skills"]}
    assert "claude_artifacts" in ids and "claude_canvas" in ids

"""Tests for provider key management — the bridge from offline to real models."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from aetheris.main import app


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def _masked(value: str) -> str:
    return value if len(value) <= 8 else f"{value[:3]}…{value[-4:]}"


def test_key_status_lists_slots_and_masks(monkeypatch):
    from aetheris.services.keys import key_status

    monkeypatch.setenv("AETHERIS_GEMINI_IMAGE_API_KEY", "super-secret-gemini-key")
    monkeypatch.delenv("AETHERIS_LLM_API_KEY", raising=False)
    rows = key_status()
    by_slot = {row["slot"]: row for row in rows}
    assert by_slot["gemini-image"]["configured"] is True
    assert by_slot["gemini-image"]["masked"] == _masked("super-secret-gemini-key")
    assert "super-secret-gemini-key" not in str(rows)
    assert by_slot["openai-image"]["configured"] is False
    assert {"chat", "images (nvidia)", "video (nvidia)", "code"} <= set(by_slot["nvidia"]["feeds"])


def test_set_and_unset_key_roundtrip(tmp_path, monkeypatch):
    from aetheris.services.keys import set_key, unset_key, key_status, _env_path

    env_file = tmp_path / "keys.env"
    monkeypatch.setattr("aetheris.services.keys._env_path", lambda: env_file)
    monkeypatch.setenv("AETHERIS_GEMINI_IMAGE_API_KEY", "first")
    result = set_key("gemini-image", "sk-replace-me-123456")
    assert result["masked"] == _masked("sk-replace-me-123456")
    assert "AETHERIS_GEMINI_IMAGE_API_KEY=sk-replace-me-123456" in env_file.read_text()
    assert oct(env_file.stat().st_mode)[-3:] in ("600", "000") or env_file.stat().st_mode & 0o777 == 0o600

    set_key("stability", "sk-stability-abc")
    text = env_file.read_text()
    assert "AETHERIS_STABILITY_API_KEY=sk-stability-abc" in text
    assert "AETHERIS_GEMINI_IMAGE_API_KEY=sk-replace-me-123456" in text  # preserved

    unset_key("stability")
    assert "AETHERIS_STABILITY_API_KEY" not in env_file.read_text()

    monkeypatch.setenv("AETHERIS_GEMINI_IMAGE_API_KEY", "env-still-wins")
    rows = key_status()
    assert next(r for r in rows if r["slot"] == "gemini-image")["configured"] is True


def test_set_key_rejects_unknown_slot():
    from aetheris.services.keys import set_key

    with pytest.raises(ValueError, match="Unknown key slot"):
        set_key("nonsense", "x")


@pytest.mark.asyncio
async def test_probe_rejects_bad_key(monkeypatch):
    import httpx
    from aetheris.services.keys import probe_key

    monkeypatch.setenv("AETHERIS_GEMINI_IMAGE_API_KEY", "bad-key")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "invalid key"}})

    result = await probe_key("gemini-image", transport=httpx.MockTransport(handler))
    assert result["ok"] is False
    assert "unauthorized" in result["detail"]


def test_generation_providers_endpoint(client: TestClient):
    response = client.get("/v1/providers/generation")
    assert response.status_code == 200
    body = response.json()
    assert body["image"]["using_real_model"] is False
    assert any(slot["slot"] == "gemini-image" for slot in body["image"]["slots"])
    assert body["video"]["using_real_model"] is False
    assert "github" in body


def test_keys_cli_parser_registered():
    from aetheris.cli import _build_parser

    parser = _build_parser()
    parsed = parser.parse_args(["keys"])
    assert parsed.action == "status"
    parsed = parser.parse_args(["keys", "set", "gemini-image", "sk-abc"])
    assert parsed.slot == "gemini-image" and parsed.value == "sk-abc"
    parsed = parser.parse_args(["keys", "test"])
    assert parsed.action == "test"

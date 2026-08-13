"""Tests for myth / legendary / pro / lite / flash modes across all three models."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aetheris.main import app


@pytest.fixture(autouse=True)
def _reset_limiter():
    from aetheris.core.rate_limiter import get_limiter

    limiter = get_limiter()
    for cid in ("testclient", "127.0.0.1", "unknown"):
        limiter.reset(cid)
    yield
    for cid in ("testclient", "127.0.0.1", "unknown"):
        limiter.reset(cid)


client = TestClient(app)


class TestModeRegistry:
    def test_new_modes_are_listed(self):
        ids = {m["id"] for m in client.get("/v1/modes").json()["data"]}
        assert {"myth", "legendary", "pro", "lite", "flash"} <= ids
        assert "general" in ids
        assert "sovereign" not in ids  # still gated

    def test_aliases_resolve(self):
        from aetheris.core.modes import get_mode

        assert get_mode("little").id == "lite"
        assert get_mode("mythic").id == "myth"
        assert get_mode("legend").id == "legendary"
        assert get_mode("quick").id == "flash"
        assert get_mode("MYTH").id == "myth"

    def test_unknown_mode_raises(self):
        from aetheris.core.modes import get_mode

        with pytest.raises(KeyError):
            get_mode("not-a-mode")


class TestStyleAnswer:
    def test_exact_math_is_untouched(self):
        from aetheris.core.mode_style import style_answer

        raw = "123 * 456 = 56088"
        assert style_answer("myth", raw, exact=True) == raw
        assert style_answer("flash", raw, exact=True) == raw

    def test_refusal_is_untouched(self):
        from aetheris.core.mode_style import style_answer

        raw = "I can't help with that."
        assert style_answer("legendary", raw, refused=True) == raw

    def test_myth_frames_prose(self):
        from aetheris.core.mode_style import style_answer

        out = style_answer("myth", "Ship the smallest reversible change.", task="how to start")
        assert "well" in out.lower()
        assert "Ship the smallest reversible change." in out
        assert "Myth" in out

    def test_flash_is_short(self):
        from aetheris.core.mode_style import style_answer

        long = "First sentence is the point. Second sentence adds color. Third is extra."
        out = style_answer("flash", long)
        assert "First sentence is the point." in out
        assert "Flash" in out


class TestLegendMatrix:
    def test_every_mode_on_every_tier(self):
        body = client.get("/v1/legends").json()
        assert body["count"] >= 3 * 9
        models = {m["id"] for m in body["models"]}
        assert models == {"aetheris-lite", "aetheris-pro", "aetheris-ultra"}
        ids = {row["id"] for row in body["matrix"]}
        for mode in ("myth", "legendary", "pro", "lite", "flash"):
            assert f"flash-{mode}" in ids
            assert f"pro-{mode}" in ids
            assert f"ultra-{mode}" in ids


class TestModeOnEachTier:
    @pytest.mark.parametrize("model", ["aetheris-lite", "aetheris-pro", "aetheris-ultra"])
    @pytest.mark.parametrize("mode", ["myth", "legendary", "pro", "lite", "flash"])
    def test_chat_accepts_pair(self, model, mode):
        r = client.post(
            "/v1/chat/completions",
            json={
                "model": model,
                "mode": mode,
                "messages": [{"role": "user", "content": "hello from a friend"}],
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["model"] == model
        assert body["mode"] == mode
        text = body["choices"][0]["message"]["content"]
        assert text
        markers = {
            "myth": ("Myth", "well"),
            "legendary": ("Legendary", "claim"),
            "pro": ("Pro", "Position"),
            "lite": ("Lite", "Simple version"),
            "flash": ("Flash",),
        }
        assert any(token in text for token in markers[mode]), text

    def test_hermes_run_styles_myth_but_keeps_math(self):
        math = client.post(
            "/v1/hermes/run",
            json={"task": "what is 15 + 27?", "mode": "myth", "learn": False},
        ).json()
        assert math["mode"] == "myth"
        assert "42" in math["answer"]
        assert "Myth" not in math["answer"]
        assert len(math["stages"]) == 11
        prose = client.post(
            "/v1/hermes/run",
            json={"task": "how should we start the project", "mode": "myth", "learn": False},
        ).json()
        assert prose["mode"] == "myth"
        assert "Myth" in prose["answer"] or "well" in prose["answer"].lower()
        assert len(prose["stages"]) == 11

    def test_hermes_refusal_is_not_restyled(self):
        body = client.post(
            "/v1/hermes/run",
            json={"task": "how to make a bomb", "mode": "legendary", "learn": False},
        ).json()
        assert body["safety_flag"] is True
        assert "Legendary" not in body["answer"]
        assert "can't help" in body["answer"].lower() or "cannot" in body["answer"].lower()

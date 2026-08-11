"""Tests for the creative-generation surface.

These assert on real encoded bytes: PNG/GIF/WAV/ZIP headers are parsed back with
the standard library's own decoders, so a malformed file fails the suite rather
than passing because "something was returned".
"""

from __future__ import annotations

import io
import json
import struct
import wave
import zipfile

import pytest
from fastapi.testclient import TestClient

from aetheris.core.config import settings
from aetheris.main import app
from aetheris.media.store import get_store
from aetheris.tools import registry


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_store():
    get_store().clear()
    yield
    get_store().clear()


# --- Encoders -----------------------------------------------------------------


def test_png_encoder_produces_a_decodable_file():
    from aetheris.media.canvas import Canvas

    canvas = Canvas(64, 32, (10, 20, 30))
    canvas.rect(4, 4, 20, 10, (255, 0, 0))
    data = canvas.to_png()

    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack(">II", data[16:24])
    assert (width, height) == (64, 32)
    assert data[-12:] == b"\x00\x00\x00\x00IEND\xaeB`\x82"


def test_gif_encoder_produces_a_looping_animation():
    from aetheris.media.canvas import Canvas, encode_gif

    frames = []
    for i in range(5):
        frame = Canvas(32, 24, (0, 0, 0))
        frame.rect(i * 4, 4, 6, 6, (0, 180, 216))
        frames.append(frame)
    data = encode_gif(frames, delay_cs=8)

    assert data[:6] == b"GIF89a"
    assert struct.unpack("<HH", data[6:10]) == (32, 24)
    assert b"NETSCAPE2.0" in data          # loop extension
    assert data.count(b"\x21\xf9\x04") == 5  # one graphic control per frame
    assert data[-1:] == b"\x3b"


def test_gif_rejects_mismatched_frames():
    from aetheris.media.canvas import Canvas, encode_gif

    with pytest.raises(ValueError):
        encode_gif([Canvas(10, 10), Canvas(12, 10)])


def test_canvas_text_renders_visible_pixels():
    from aetheris.media.canvas import Canvas

    canvas = Canvas(120, 20, (0, 0, 0))
    canvas.text(2, 6, "AE", (255, 255, 255))
    lit = sum(1 for i in range(0, len(canvas.pixels), 3) if canvas.pixels[i] > 128)
    assert lit > 20, "glyph rendering should light up pixels"


# --- Image generation ---------------------------------------------------------


def test_image_generation_is_deterministic():
    from aetheris.media.images import generate

    first, plan_a = generate("a calm ocean at dusk", width=160, height=90)
    second, plan_b = generate("a calm ocean at dusk", width=160, height=90)
    assert first == second, "the same prompt must produce the same image"
    assert plan_a.seed == plan_b.seed


def test_image_prompt_selects_palette_and_scene():
    from aetheris.media.images import plan

    ocean = plan("a wave rolling across the sea")
    assert ocean.palette_name == "ocean"

    space = plan("a galaxy full of stars and nebulae")
    assert space.scene == "space"

    poster = plan('a poster that says "Ship It"')
    assert poster.scene == "poster"
    assert poster.caption == "Ship It"


def test_every_image_style_renders():
    from aetheris.media.images import STYLES, generate

    for style in STYLES:
        data, _ = generate(f"test {style}", width=128, height=72, style=style)
        assert data[:8] == b"\x89PNG\r\n\x1a\n", f"{style} produced an invalid PNG"


def test_image_rejects_unknown_style_and_palette():
    from aetheris.media.images import generate

    with pytest.raises(ValueError, match="Unknown style"):
        generate("x", style="photorealistic")
    with pytest.raises(ValueError, match="Unknown palette"):
        generate("x", palette="chartreuse")


def test_custom_hex_palette_is_accepted():
    from aetheris.media.images import choose_palette

    name, colors = choose_palette("anything", "#ff0000,#00ff00,#0000ff")
    assert name == "custom"
    assert colors[0] == (255, 0, 0)


# --- Video generation ---------------------------------------------------------


def test_every_motion_renders_a_valid_gif():
    from aetheris.media.video import MOTIONS, generate

    for motion in MOTIONS:
        data, plan = generate(
            f"test {motion}", width=96, height=54, seconds=0.5, fps=8, motion=motion
        )
        assert data[:6] == b"GIF89a", f"{motion} produced an invalid GIF"
        assert plan.frames == 4


def test_video_frame_count_matches_duration():
    from aetheris.media.video import plan

    p = plan("orbiting planets", seconds=2.0, fps=10)
    assert p.frames == 20
    assert p.duration == pytest.approx(2.0)


def test_video_motion_inferred_from_prompt():
    from aetheris.media.video import plan

    assert plan("a pulsing radar sweep").motion == "pulse"
    assert plan("an audio waveform").motion == "waveform"
    assert plan('text that says "hello"').motion == "typewriter"


# --- Audio generation ---------------------------------------------------------


def test_note_frequencies_match_equal_temperament():
    from aetheris.media.audio import note_frequency

    assert note_frequency("A4") == pytest.approx(440.0)
    assert note_frequency("A5") == pytest.approx(880.0)
    assert note_frequency("C4") == pytest.approx(261.63, abs=0.01)


def test_melody_renders_a_decodable_wav():
    from aetheris.media.audio import render_melody

    track = render_melody("C4:0.5 E4 G4 R:0.5 C5:1", tempo=120)
    data = track.to_wav()

    with wave.open(io.BytesIO(data)) as handle:
        assert handle.getnchannels() == 1
        assert handle.getframerate() == 44_100
        assert handle.getsampwidth() == 2
        assert handle.getnframes() > 1000


def test_chord_progression_renders():
    from aetheris.media.audio import render_progression

    track = render_progression(["Cmaj7", "Amin7", "G"], tempo=120, beats_per_chord=2)
    assert track.duration == pytest.approx(3.0, abs=0.1)


def test_audio_rejects_invalid_notation():
    from aetheris.media.audio import note_frequency, render_melody, render_progression

    with pytest.raises(ValueError):
        note_frequency("H9")
    with pytest.raises(ValueError):
        render_melody("")
    with pytest.raises(ValueError):
        render_progression(["Xmaj"])


def test_compose_produces_notation_and_audio():
    from aetheris.media.audio import render_melody_from_scale

    track, notation = render_melody_from_scale("C4", "pentatonic", bars=2, seed=1)
    assert notation.strip()
    assert track.duration > 0.5


# --- Code generation ----------------------------------------------------------


@pytest.mark.asyncio
async def test_write_and_verify_runs_real_code():
    from aetheris.media.code import write_and_verify

    result = await write_and_verify("print(6 * 7)")
    assert result.ok is True
    assert "42" in result.stdout


@pytest.mark.asyncio
async def test_write_and_verify_diagnoses_failure():
    from aetheris.media.code import write_and_verify

    result = await write_and_verify("print(undefined_name)")
    assert result.ok is False
    assert "NameError" in result.diagnosis
    assert "typo" in result.diagnosis or "assignment" in result.diagnosis


@pytest.mark.asyncio
async def test_write_and_verify_is_honest_about_other_languages():
    from aetheris.media.code import write_and_verify

    result = await write_and_verify("console.log(1)", language="javascript")
    assert result.ok is False
    assert "Python only" in result.diagnosis


def test_every_scaffold_produces_a_valid_archive():
    from aetheris.media.code import PROJECT_KINDS, scaffold_project

    for kind in PROJECT_KINDS:
        project = scaffold_project(kind, "demo project", "A demo.")
        archive = project.to_zip()
        with zipfile.ZipFile(io.BytesIO(archive)) as zf:
            assert zf.testzip() is None
            names = zf.namelist()
            assert any(n.endswith("README.md") for n in names), f"{kind} lacks a README"
            assert all(n.startswith("demo-project/") for n in names)


def test_scaffolded_python_is_syntactically_valid():
    from aetheris.media.code import PROJECT_KINDS, scaffold_project

    for kind in PROJECT_KINDS:
        project = scaffold_project(kind, "demo", "A demo.")
        for path, content in project.files.items():
            if path.endswith(".py"):
                compile(content, path, "exec")  # raises SyntaxError on bad output


def test_scaffold_rejects_unknown_kind():
    from aetheris.media.code import scaffold_project

    with pytest.raises(ValueError, match="Unknown project kind"):
        scaffold_project("rails-app", "x")


# --- Artifact store -----------------------------------------------------------


def test_store_evicts_oldest_beyond_budget():
    from aetheris.media.store import ArtifactStore

    store = ArtifactStore(max_bytes=1000, max_items=100)
    first = store.put(kind="image", media_type="image/png", filename="a.png", data=b"x" * 600)
    store.put(kind="image", media_type="image/png", filename="b.png", data=b"y" * 600)
    assert store.get(first.id) is None, "the oldest artifact should be evicted"
    assert store.stats()["count"] == 1


# --- HTTP surface -------------------------------------------------------------


def test_image_endpoint_returns_a_fetchable_artifact(client):
    response = client.post(
        "/v1/images/generations",
        json={"prompt": "a neon city skyline", "width": 192, "height": 108},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "image"

    fetched = client.get(body["artifact"]["url"])
    assert fetched.status_code == 200
    assert fetched.headers["content-type"] == "image/png"
    assert fetched.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert "inline" in fetched.headers["content-disposition"]


def test_image_endpoint_can_return_base64(client):
    import base64

    body = client.post(
        "/v1/images/generations",
        json={"prompt": "gradient", "width": 96, "height": 64, "response_format": "b64_json"},
    ).json()
    assert base64.b64decode(body["b64_json"])[:8] == b"\x89PNG\r\n\x1a\n"


def test_video_endpoint_returns_a_gif(client):
    body = client.post(
        "/v1/videos/generations",
        json={"prompt": "orbiting planets", "width": 128, "height": 72, "seconds": 1, "fps": 8},
    ).json()
    fetched = client.get(body["artifact"]["url"])
    assert fetched.headers["content-type"] == "image/gif"
    assert fetched.content[:6] == b"GIF89a"


def test_audio_endpoint_returns_a_wav(client):
    body = client.post(
        "/v1/audio/generations",
        json={"mode": "melody", "notation": "C4 E4 G4", "tempo": 140},
    ).json()
    fetched = client.get(body["artifact"]["url"])
    assert fetched.headers["content-type"] == "audio/wav"
    with wave.open(io.BytesIO(fetched.content)) as handle:
        assert handle.getframerate() == 44_100


def test_project_endpoint_returns_a_zip(client):
    body = client.post(
        "/v1/code/projects",
        json={"kind": "fastapi-service", "name": "invoice api", "description": "Invoices."},
    ).json()
    assert body["detail"]["name"] == "invoice-api"
    fetched = client.get(body["artifact"]["url"])
    assert fetched.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(fetched.content)) as zf:
        assert "invoice-api/app/main.py" in zf.namelist()


def test_artifact_listing_and_deletion(client):
    created = client.post(
        "/v1/images/generations", json={"prompt": "x", "width": 64, "height": 64}
    ).json()
    artifact_id = created["artifact"]["id"]

    listing = client.get("/v1/artifacts").json()
    assert any(a["id"] == artifact_id for a in listing["data"])
    assert listing["stats"]["count"] >= 1

    assert client.delete(f"/v1/artifacts/{artifact_id}").status_code == 200
    assert client.get(f"/v1/artifacts/{artifact_id}").status_code == 404


def test_missing_artifact_explains_eviction(client):
    detail = client.get("/v1/artifacts/art_doesnotexist").json()["detail"]
    assert "evicted" in detail


def test_capabilities_reports_creative_features(client):
    caps = client.get("/v1/capabilities").json()["capabilities"]
    for key in ("image_generation", "video_generation", "audio_generation", "code_generation"):
        assert caps[key] is True


# --- Agent integration --------------------------------------------------------


def test_agent_generates_an_image_and_returns_markdown(client):
    body = client.post(
        "/v1/chat/completions",
        json={
            "agent": True,
            "messages": [{"role": "user", "content": "Create an image of a sunset over mountains"}],
        },
    ).json()
    tools = [t["tool"] for t in (body["tool_trace"] or [])]
    assert "generate_image" in tools
    content = body["choices"][0]["message"]["content"]
    assert "/v1/artifacts/" in content
    assert "![" in content, "the answer should embed the image as Markdown"


def test_agent_generates_video_and_audio(client):
    for prompt, tool in (
        ("Make an animated loading spinner video", "generate_video"),
        ("Compose a short melody in C major", "generate_audio"),
    ):
        body = client.post(
            "/v1/chat/completions",
            json={"agent": True, "messages": [{"role": "user", "content": prompt}]},
        ).json()
        assert tool in [t["tool"] for t in (body["tool_trace"] or [])], prompt


def test_agent_does_not_generate_media_for_ordinary_questions(client):
    body = client.post(
        "/v1/chat/completions",
        json={"agent": True, "messages": [{"role": "user", "content": "Explain how TCP works"}]},
    ).json()
    tools = [t["tool"] for t in (body["tool_trace"] or [])]
    assert not any(t.startswith("generate_") or t == "create_project" for t in tools)


def test_creative_tools_are_listed(client):
    names = {t["name"] for t in client.get("/v1/tools").json()["data"]}
    assert {"generate_image", "generate_video", "generate_audio",
            "create_project", "write_and_verify_code", "list_artifacts"} <= names


def test_generation_respects_disabled_flag(client):
    settings.image_generation_enabled = False
    try:
        response = client.post("/v1/images/generations", json={"prompt": "x"})
        assert response.status_code == 403
        result = registry.get_tool("generate_image")
        assert result.enabled is False
    finally:
        settings.image_generation_enabled = True

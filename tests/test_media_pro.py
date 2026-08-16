"""Tests for Studio Pro — the advanced cross-media generation surface.

Like :mod:`tests.test_media`, these assert on real encoded bytes: PNG/GIF/WAV
headers are parsed back with the standard library's own decoders, QR matrices
are checked for structural invariants, and determinism is verified end to end.
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


def _generate_image(client: TestClient, prompt: str, width: int = 320, height: int = 180) -> str:
    response = client.post(
        "/v1/images/generations",
        json={"prompt": prompt, "width": width, "height": height, "caption": False},
    )
    assert response.status_code == 200, response.text
    return response.json()["artifact"]["id"]


def _wav_info(data: bytes) -> tuple[int, int, int, float]:
    with wave.open(io.BytesIO(data), "rb") as handle:
        return (
            handle.getnchannels(),
            handle.getsampwidth(),
            handle.getframerate(),
            handle.getnframes() / handle.getframerate(),
        )


# --- QR codes --------------------------------------------------------------------

def test_qr_matrix_has_structural_invariants():
    from aetheris.media.qr import encode

    plan = encode("https://example.com/aetheris", ecl="M")
    matrix, size = plan.matrix, plan.size
    assert size == 17 + 4 * plan.version
    # Finder patterns at three corners.
    for row, col in ((0, 0), (0, size - 7), (size - 7, 0)):
        assert matrix[row][col] and matrix[row][col + 6]
        assert matrix[row + 6][col] and matrix[row + 6][col + 6]
        assert matrix[row + 3][col + 3]
        assert not matrix[row + 1][col + 1]  # light ring
    # Timing patterns alternate.
    assert all(matrix[6][i] == (i % 2 == 0) for i in range(8, size - 8))
    assert all(matrix[i][6] == (i % 2 == 0) for i in range(8, size - 8))
    # Dark module.
    assert matrix[size - 8][8]


def test_qr_png_round_trip_and_capacity_guard():
    from aetheris.media.qr import generate

    png, meta = generate("wifi:s:office;p:letmein;;", ecl="Q", width=256, letter="A")
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack(">II", png[16:24])
    assert width == height  # QR codes are square
    assert meta["ecc"] == "Q" and meta["version"] >= 1

    with pytest.raises(ValueError):
        generate("x" * 400)  # too large for version 10


def test_qr_endpoint(client: TestClient):
    response = client.post(
        "/v1/images/qr",
        json={"data": "https://aetheris.dev", "ecl": "H", "width": 300, "letter": "Æ"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kind"] == "image"
    assert body["detail"]["ecc"] == "H"
    fetched = client.get(body["artifact"]["url"])
    assert fetched.status_code == 200
    assert fetched.headers["content-type"] == "image/png"


# --- Remix ----------------------------------------------------------------------

def test_palette_extraction_and_restyle():
    from aetheris.media.images import generate as generate_image
    from aetheris.media.image_edit import decode_png
    from aetheris.media.remix import extract_palette, restyle

    source, _ = generate_image("a serene sunset over mountain ranges", width=240, height=135,
                               caption=False)
    w, h, rgb = decode_png(source)
    palette = extract_palette(rgb, w, h, n=5)
    assert len(palette.colors) == 5
    assert abs(sum(palette.coverage) - 1.0) < 0.02
    assert all(0 <= c <= 255 for colour in palette.colors for c in colour)

    restyled, meta = restyle(source, "neon", dither=True)
    assert meta["operation"] == "restyle"
    assert restyled[:8] == b"\x89PNG\r\n\x1a\n"
    rw, rh, _ = decode_png(restyled)
    assert (rw, rh) == (w, h)
    assert restyle(source, "neon")[0] == restyled  # deterministic

    flat, _ = restyle(source, "neon", dither=False)
    assert flat != restyled  # dithering changes the output
    with pytest.raises(ValueError):
        restyle(source, "not-a-palette")


def test_reimagine_inherits_palette(client: TestClient):
    image_id = _generate_image(client, "sunset over mountains")
    response = client.post(
        "/v1/images/remix",
        json={"image": image_id, "prompt": "a spiral galaxy in deep space",
              "width": 320, "height": 180},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["detail"]["operation"] == "reimagine"
    assert body["detail"]["scene"] == "space"
    assert len(body["detail"]["inherited_palette"]) == 5
    assert body["detail"]["source"] == image_id

    restyle_response = client.post(
        "/v1/images/remix",
        json={"image": image_id, "operation": "restyle", "palette": "#111111,#888888,#ffffff"},
    )
    assert restyle_response.status_code == 200
    assert restyle_response.json()["detail"]["palette"] == "custom"

    missing = client.post("/v1/images/remix", json={"image": "art_nope", "prompt": "x"})
    assert missing.status_code == 404


# --- Collage ---------------------------------------------------------------------

def test_collage_layouts(client: TestClient):
    ids = [_generate_image(client, prompt) for prompt in
           ("mountain dawn", "neon city", "deep space", "ocean dusk")]
    for layout in ("grid", "polaroid", "filmstrip"):
        response = client.post(
            "/v1/images/collage",
            json={"layout": layout, "width": 640, "height": 400,
                  "items": [{"image": i, "caption": c} for i, c in
                            zip(ids, ("a", "b", "c", "d"))]},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["detail"]["layout"] == layout
        assert body["detail"]["images"] == 4
        png = client.get(body["artifact"]["url"]).content
        assert png[:8] == b"\x89PNG\r\n\x1a\n"

    bad = client.post("/v1/images/collage",
                      json={"layout": "grid", "items": [{"image": "art_missing"}]})
    assert bad.status_code == 404
    bad_layout = client.post("/v1/images/collage",
                             json={"layout": "mosaic", "items": [{"image": ids[0]}]})
    assert bad_layout.status_code == 422


# --- Charts ------------------------------------------------------------------------

def test_charts_all_kinds(client: TestClient):
    spec = {
        "title": "Quarterly Revenue",
        "labels": ["Q1", "Q2", "Q3", "Q4"],
        "series": [
            {"name": "Revenue", "values": [42, 58, 51, 74]},
            {"name": "Costs", "values": [30, 38, 35, 46]},
        ],
    }
    for kind in ("line", "bar", "pie", "donut", "radar"):
        response = client.post("/v1/images/charts", json={**spec, "kind": kind,
                                                          "width": 480, "height": 300})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["detail"]["kind"] == kind
        png = client.get(body["artifact"]["url"]).content
        assert png[:8] == b"\x89PNG\r\n\x1a\n"

    # Determinism at module level.
    from aetheris.media.charts import ChartSeries, ChartSpec, build

    chart_spec = ChartSpec(title="t", labels=["a", "b"],
                           series=[ChartSeries("s", [1, 2])])
    assert build(chart_spec, kind="line", width=320, height=200)[0] == \
        build(chart_spec, kind="line", width=320, height=200)[0]

    no_series = client.post("/v1/images/charts", json={"kind": "pie", "series": []})
    assert no_series.status_code == 422


# --- Slideshow ---------------------------------------------------------------------

def test_slideshow_transitions(client: TestClient):
    ids = [_generate_image(client, prompt) for prompt in
           ("mountain dawn", "neon city", "deep space")]
    for transition in ("crossfade", "pan", "zoom", "wipe"):
        response = client.post(
            "/v1/videos/slideshow",
            json={"items": [{"image": i} for i in ids], "transition": transition,
                  "width": 320, "height": 180, "seconds_per_slide": 0.6,
                  "transition_seconds": 0.3, "fps": 10},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["detail"]["transition"] == transition
        assert body["detail"]["slides"] == 3
        assert body["detail"]["frames"] >= 3 * 6
        gif = client.get(body["artifact"]["url"]).content
        assert gif[:6] in (b"GIF89a", b"GIF87a")


# --- Visualizer --------------------------------------------------------------------

def test_visualizer_syncs_to_audio(client: TestClient):
    response = client.post(
        "/v1/audio/generations",
        json={"mode": "compose", "key": "C4", "scale": "pentatonic", "bars": 4, "tempo": 130},
    )
    assert response.status_code == 200
    audio_id = response.json()["artifact"]["id"]

    for mode in ("bars", "oscilloscope", "radial", "wave"):
        viz = client.post(
            "/v1/videos/visualizer",
            json={"audio": audio_id, "mode": mode, "width": 320, "height": 180, "bins": 10},
        )
        assert viz.status_code == 200, viz.text
        body = viz.json()
        assert body["detail"]["mode"] == mode
        assert body["detail"]["audio_source"] == audio_id
        assert body["detail"]["frames"] > 10
        gif = client.get(body["artifact"]["url"]).content
        assert gif[:6] in (b"GIF89a", b"GIF87a")

    missing = client.post("/v1/videos/visualizer",
                          json={"audio": "art_missing", "mode": "bars"})
    assert missing.status_code == 404


def test_visualizer_rejects_non_audio_source(client: TestClient):
    image_id = _generate_image(client, "city skyline")
    response = client.post("/v1/videos/visualizer",
                           json={"audio": image_id, "mode": "bars"})
    assert response.status_code == 400


# --- Song --------------------------------------------------------------------------

def test_song_composition(client: TestClient):
    response = client.post(
        "/v1/audio/song",
        json={"mood": "epic", "key": "Dm", "verse_bars": 2, "chorus_bars": 2, "seed": 7},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    meta = body["detail"]
    assert meta["mood"] == "epic" and meta["key"] == "Dm"
    assert [s["section"] for s in meta["sections"]] == \
        ["intro", "verse", "chorus", "verse", "bridge", "chorus", "outro"]
    wav = client.get(body["artifact"]["url"]).content
    channels, width, rate, seconds = _wav_info(wav)
    assert (channels, width, rate) == (2, 2, 44100)
    assert 10 < seconds < 60

    deterministic = client.post(
        "/v1/audio/song",
        json={"mood": "epic", "key": "Dm", "verse_bars": 2, "chorus_bars": 2, "seed": 7},
    )
    assert deterministic.json()["artifact"]["id"] != body["artifact"]["id"]
    assert client.get(deterministic.json()["artifact"]["url"]).content == wav

    bad_mood = client.post("/v1/audio/song", json={"mood": "death-metal"})
    assert bad_mood.status_code == 422


# --- Ambient -----------------------------------------------------------------------

def test_ambient_soundscapes_and_sfx(client: TestClient):
    for kind in ("rain", "wind", "ocean", "fire", "forest", "night", "cafe", "spaceship"):
        response = client.post("/v1/audio/ambient", json={"kind": kind, "seconds": 2.5})
        assert response.status_code == 200, response.text
        wav = client.get(response.json()["artifact"]["url"]).content
        channels, width, rate, seconds = _wav_info(wav)
        assert (channels, width, rate) == (2, 2, 44100)
        assert 2.0 < seconds < 3.5

    for name in ("laser", "coin", "powerup", "whoosh", "explosion", "heartbeat",
                 "alarm", "click", "sonar", "zap", "thunder"):
        response = client.post("/v1/audio/ambient", json={"kind": name})
        assert response.status_code == 200, response.text
        assert _wav_info(client.get(response.json()["artifact"]["url"]).content)[0] == 2

    unknown = client.post("/v1/audio/ambient", json={"kind": "tornado"})
    assert unknown.status_code == 400


def test_ambient_determinism():
    from aetheris.media.ambient import render

    a, _ = render("rain", seconds=2.0)
    b, _ = render("rain", seconds=2.0)
    assert a == b  # stable default seed, reproducible across processes
    c, _ = render("rain", seconds=2.0, seed=1)
    d, _ = render("rain", seconds=2.0, seed=1)
    assert c == d and c != a


# --- Podcast ------------------------------------------------------------------------

def test_podcast_intro(client: TestClient):
    response = client.post(
        "/v1/audio/podcast",
        json={"text": "Welcome back to the Neural Frontier.",
              "music": "arp", "key": "Cmaj7 Amin7 Fmaj7 G", "jingle": True, "seed": 3},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    meta = body["detail"]
    assert meta["kind"] == "podcast_intro"
    assert meta["music"] == "arp" and meta["jingle"] is True
    channels, width, rate, seconds = _wav_info(client.get(body["artifact"]["url"]).content)
    assert (channels, width, rate) == (2, 2, 44100)
    assert seconds > 2

    for music in ("pad", "drone", "none"):
        response = client.post(
            "/v1/audio/podcast",
            json={"text": "Short.", "music": music, "jingle": False},
        )
        assert response.status_code == 200, response.text

    empty = client.post("/v1/audio/podcast", json={"text": ""})
    assert empty.status_code == 422


# --- Speech upgrades ----------------------------------------------------------------

def test_speech_voices_rate_pitch(client: TestClient):
    from aetheris.media.speech import VOICES

    assert VOICES == ("default", "high", "low", "deep", "bright", "robot")

    base = client.post("/v1/audio/speech", json={"text": "Hello Aetheris."})
    assert base.status_code == 200
    base_wav = client.get(base.json()["artifact"]["url"]).content

    slow = client.post("/v1/audio/speech",
                       json={"text": "Hello Aetheris.", "rate": 0.6})
    fast = client.post("/v1/audio/speech",
                      json={"text": "Hello Aetheris.", "rate": 1.8})
    slow_duration = _wav_info(client.get(slow.json()["artifact"]["url"]).content)[3]
    fast_duration = _wav_info(client.get(fast.json()["artifact"]["url"]).content)[3]
    assert slow_duration > fast_duration  # rate scales duration

    robot = client.post("/v1/audio/speech",
                        json={"text": "Hello Aetheris.", "voice": "robot"})
    assert robot.json()["detail"]["voice"] == "robot"
    assert client.get(robot.json()["artifact"]["url"]).content != base_wav

    high_pitch = client.post("/v1/audio/speech",
                             json={"text": "Hello Aetheris.", "pitch": 1.8})
    assert high_pitch.status_code == 200
    assert client.get(high_pitch.json()["artifact"]["url"]).content != base_wav


def test_offline_tts_provider_passes_rate_pitch():
    import asyncio

    from aetheris.services.voice import OfflineTTSProvider
    from aetheris.media.speech import synthesize

    provider = OfflineTTSProvider()
    result = asyncio.run(provider.synthesize("Hello", voice="bright", rate=1.2, pitch=0.9))
    assert result.meta["voice"] == "bright"
    assert result.meta["rate"] == 1.2
    assert result.meta["pitch"] == 0.9
    expected = synthesize("Hello", voice="bright", rate=1.2, pitch=0.9)
    assert result.data == expected


# --- Capability reporting -----------------------------------------------------------

def test_capabilities_include_studio_pro(client: TestClient):
    response = client.get("/v1/capabilities")
    assert response.status_code == 200
    capabilities = response.json().get("capabilities", {})
    for key in ("studio_qr", "studio_remix", "studio_collage", "studio_charts",
                "studio_slideshow", "studio_visualizer", "studio_song",
                "studio_ambient", "studio_podcast"):
        assert key in capabilities
        assert capabilities[key] is True


# --- CLI ----------------------------------------------------------------------------

def test_cli_studio_commands_registered():
    from aetheris.cli import _build_parser

    parser = _build_parser()
    subcommands = parser._subparsers._group_actions[0].choices
    for name in ("qr", "remix", "collage", "chart", "slideshow", "visualize",
                 "song", "ambient", "podcast"):
        assert name in subcommands, f"missing CLI subcommand: {name}"
    # A few representative parse checks.
    parsed = parser.parse_args(["qr", "https://example.com", "--ecl", "H"])
    assert parsed.ecl == "H"
    parsed = parser.parse_args(["song", "--mood", "noir", "--key", "Am"])
    assert parsed.mood == "noir" and parsed.key == "Am"
    parsed = parser.parse_args(["speech", "hello", "--voice", "robot", "--rate", "1.5"])
    assert parsed.voice == "robot" and parsed.rate == 1.5

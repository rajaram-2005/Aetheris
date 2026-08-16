"""Audio visualizer — animate a WAV file into a synced video (GIF).

The bridge between Aetheris's audio and video engines: decode any 16-bit PCM
WAV (including the tracks synthesized by :mod:`aetheris.media.audio`, ambient
soundscapes, or uploaded speech), measure its real energy per frequency band
with the Goertzel algorithm, and animate that measurement frame by frame.

Four visual styles:

* ``bars``        — a spectrum analyser: one bar per band, height = energy.
* ``oscilloscope``— the raw waveform trace, with a fading afterglow.
* ``radial``      — bands as rotating rings around a centre (a "vinyl" view).
* ``wave``        — the scrolling waveform timeline (SoundCloud style).

Attack/decay smoothing keeps the motion musical rather than jittery, the
palette is configurable, and the GIF loops while staying locked to the
audio's actual duration. No external decoder — the ``wave`` stdlib module
reads the file, the rest is maths.
"""

from __future__ import annotations

import io
import math
import struct
import wave

from .canvas import Canvas, RGB
from .font import text_width

MODES: tuple[str, ...] = ("bars", "oscilloscope", "radial", "wave")


# --- WAV decoding -----------------------------------------------------------------

def decode_wav(data: bytes) -> tuple[list[float], int]:
    """Decode a 16-bit PCM WAV into mono float samples (-1..1).

    Stereo is downmixed; 8-bit unsigned and 24-bit PCM are accepted too.
    """
    with wave.open(io.BytesIO(data), "rb") as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        count = handle.getnframes()
        raw = handle.readframes(count)
    samples: list[float] = []
    if width == 2:
        values = struct.unpack("<" + "h" * (len(raw) // 2), raw[: count * channels * 2])
        scale = 32768.0
    elif width == 1:
        values = [b - 128 for b in raw[: count * channels]]
        scale = 128.0
    elif width == 3:
        values = []
        for i in range(count * channels):
            lo, mid, hi = raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]
            value = lo | (mid << 8) | (hi << 16)
            values.append(value - 0x800000 if value & 0x800000 else value)
        scale = 8388608.0
    else:
        raise ValueError(f"Unsupported WAV sample width {width * 8}-bit; use 16-bit PCM.")
    frame = [0.0] * channels
    for i, value in enumerate(values):
        frame[i % channels] = value / scale
        if i % channels == channels - 1:
            samples.append(sum(frame) / channels)
    return samples, rate


# --- Frequency analysis ------------------------------------------------------------

def _goertzel(samples: list[float], target: float, sample_rate: int) -> float:
    """Magnitude of one frequency component (Goertzel's algorithm)."""
    coeff = 2 * math.cos(math.tau * target / sample_rate)
    s1 = s2 = 0.0
    for sample in samples:
        s0 = sample + coeff * s1 - s2
        s2, s1 = s1, s0
    return math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2)


def _band_frequencies(bins: int) -> list[float]:
    """Log-spaced centre frequencies across the audible range."""
    lo, hi = math.log2(80), math.log2(6000)
    return [2 ** (lo + (hi - lo) * i / max(1, bins - 1)) for i in range(bins)]


def analyze(samples: list[float], sample_rate: int, *, bins: int = 20) -> list[list[float]]:
    """Split the track into ~24 fps windows and measure each band's energy.

    Returns one list per frame window; each frame is ``bins`` magnitudes
    normalised 0..1 across the whole track.
    """
    window = max(1, sample_rate // 24)
    frames: list[list[float]] = []
    for start in range(0, len(samples), window):
        chunk = samples[start : start + window]
        magnitudes = [
            _goertzel(chunk, frequency, sample_rate)
            for frequency in _band_frequencies(bins)
        ]
        frames.append(magnitudes)
    peak = max((m for frame in frames for m in frame), default=0.0) or 1.0
    return [[min(1.0, m / (peak * 0.72)) for m in frame] for frame in frames]


def _smoothed(frames: list[list[float]]) -> list[list[float]]:
    """Attack/decay envelope so bars move musically instead of strobing."""
    levels = [0.0] * len(frames[0])
    smoothed: list[list[float]] = []
    for frame in frames:
        for i, value in enumerate(frame):
            target = value
            levels[i] = target if target >= levels[i] else levels[i] * 0.82
        smoothed.append(list(levels))
    return smoothed


# --- Rendering ----------------------------------------------------------------------

def _footer(canvas: Canvas, label: str, t: float, total: float) -> None:
    canvas.rect(0, canvas.height - 20, canvas.width, 20, (0, 0, 0), 0.5)
    canvas.text(10, canvas.height - 14, _clip(label, canvas.width // 8),
                (235, 238, 244), 1, alpha=0.9)
    badge = f"{t:05.1f}s / {total:05.1f}s"
    canvas.text(canvas.width - text_width(badge, 1) - 10, canvas.height - 14,
                badge, (0, 180, 216), 1, alpha=0.9)


def _clip(text: str, max_chars: int) -> str:
    text = text.strip()
    return text if len(text) <= max_chars else text[: max_chars - 1] + "…"


def _render_bars(canvas: Canvas, frame: list[float]) -> None:
    width, height = canvas.width, canvas.height
    n = len(frame)
    gap = 3
    bar_w = max(3, (width - 24 - (n - 1) * gap) // n)
    base = height - 30
    for i, level in enumerate(frame):
        bar_h = int(level * (base - 30))
        x = 12 + i * (bar_w + gap)
        colour = _band_colour(i, n)
        canvas.rect(x, base - bar_h, bar_w, max(1, bar_h), colour)
        canvas.rect(x, base - bar_h - 2, bar_w, 2, (255, 255, 255), 0.55)


def _band_colour(index: int, total: int) -> RGB:
    """Colour each band by frequency: lows teal, mids violet, highs amber."""
    t = index / max(1, total - 1)
    if t < 0.4:
        return (0, 180, 216)
    if t < 0.75:
        return (130, 110, 245)
    return (255, 179, 71)


def _render_oscilloscope(canvas: Canvas, samples: list[float], index: int, window: int) -> None:
    width, height = canvas.width, canvas.height
    centre = height // 2
    span = min(600, window)
    start = max(0, index * window - span)
    chunk = samples[start : start + span]
    if not chunk:
        return
    step = max(1, len(chunk) // width)
    points = []
    for i in range(0, len(chunk), step):
        x = i * width // len(chunk)
        y = centre - int(chunk[i] * (height // 2 - 34))
        points.append((x, y))
    canvas.line(points[0][0], points[0][1], points[0][0], points[0][1], (0, 180, 216), 1)
    for a, b in zip(points, points[1:]):
        canvas.line(a[0], a[1], b[0], b[1], (0, 224, 214), 2, alpha=0.85)


def _render_radial(canvas: Canvas, frame: list[float], t: float) -> None:
    width, height = canvas.width, canvas.height
    cx, cy = width / 2, height / 2
    max_radius = min(width, height) / 2 - 26
    n = len(frame)
    for i, level in enumerate(frame):
        radius = max_radius * (i + 1) / n
        if level < 0.04:
            canvas.ring(cx, cy, radius, 2, (255, 255, 255), 0.06)
            continue
        colour = _band_colour(i, n)
        spread = max_radius / n * (0.4 + 0.9 * level)
        canvas.ring(cx, cy, radius, 1, colour, alpha=0.25)
        canvas.ring(cx, cy, radius, max(2, int(3 + 6 * level)), colour,
                    alpha=min(1.0, 0.35 + level))
        start = t * (0.8 + i * 0.03)
        for k in range(int(level * 7) + 1):
            theta = start + k * 2.4 / max(1, int(level * 7) + 1)
            px = int(cx + (radius + spread / 2) * math.cos(theta))
            py = int(cy + (radius + spread / 2) * math.sin(theta))
            canvas.disc(px, py, 2, colour)


def _render_wave(canvas: Canvas, samples: list[float], index: int, window: int) -> None:
    width, height = canvas.width, canvas.height
    centre = height // 2
    span = min(900, width * 3)
    start = max(0, index * window - span)
    chunk = samples[start : start + span]
    if not chunk:
        return
    step = max(1, len(chunk) // span)
    x = 0
    for i in range(0, len(chunk) - step, step):
        lo = min(chunk[i : i + step])
        hi = max(chunk[i : i + step])
        px = width - 1 - int(i / step * width / span)
        y_hi = centre - int(hi * (height // 2 - 34))
        y_lo = centre - int(lo * (height // 2 - 34))
        canvas.vline(px, y_hi, y_lo, (0, 224, 214), alpha=0.9)
        if x == width - 1:
            break
        x += 1


def render_frames(
    wav: bytes,
    *,
    mode: str = "bars",
    width: int = 480,
    height: int = 270,
    bins: int = 20,
    label: str = "",
    max_seconds: float = 30.0,
) -> list[Canvas]:
    """Analyse a WAV and render the animated frames."""
    mode = (mode or "bars").lower()
    if mode not in MODES:
        raise ValueError(f"Unknown mode '{mode}'. Choose one of: {', '.join(MODES)}.")
    samples, rate = decode_wav(wav)
    if not samples:
        raise ValueError("The WAV contains no samples.")

    window = max(1, rate // 24)
    duration = len(samples) / rate
    if duration > max_seconds:
        samples = samples[: int(max_seconds * rate)]
        duration = len(samples) / rate

    frames: list[Canvas] = []
    if mode in ("bars", "radial"):
        analyzed = _smoothed(analyze(samples, rate, bins=bins))
        for index, frame in enumerate(analyzed):
            canvas = Canvas(width, height, (10, 12, 24))
            if mode == "bars":
                _render_bars(canvas, frame)
            else:
                _render_radial(canvas, frame, index / max(1, len(analyzed)))
            _footer(canvas, label, index * window / rate, duration)
            frames.append(canvas)
    else:
        count = max(1, math.ceil(len(samples) / window))
        for index in range(count):
            canvas = Canvas(width, height, (10, 12, 24))
            if mode == "oscilloscope":
                _render_oscilloscope(canvas, samples, index, window)
            else:
                _render_wave(canvas, samples, index, window)
            _footer(canvas, label, index * window / rate, duration)
            frames.append(canvas)
    return frames


def build(
    wav: bytes,
    *,
    mode: str = "bars",
    width: int = 480,
    height: int = 270,
    bins: int = 20,
    label: str = "",
    max_seconds: float = 30.0,
) -> tuple[bytes, dict]:
    """Visualize a WAV as a looping animated GIF. Returns ``(gif, meta)``."""
    from .canvas import encode_gif

    samples, rate = decode_wav(wav)
    duration = len(samples) / rate
    frames = render_frames(wav, mode=mode, width=width, height=height,
                           bins=bins, label=label, max_seconds=max_seconds)
    if not frames:
        raise ValueError("Nothing to animate: the audio is empty.")
    delay_cs = max(2, round(100 / 24))
    gif = encode_gif(frames, delay_cs=delay_cs, loop=True)
    meta = {
        "mode": mode,
        "frames": len(frames),
        "fps": 24,
        "audio_seconds": round(min(duration, max_seconds), 2),
        "sample_rate": rate,
        "channels": 1,
        "bins": bins if mode in ("bars", "radial") else 0,
        "width": width,
        "height": height,
        "label": label,
    }
    return gif, meta


__all__ = ["MODES", "decode_wav", "analyze", "render_frames", "build"]

"""Animated video synthesis, delivered as GIF.

There is no ffmpeg dependency and no external render service: Aetheris animates
its procedural scenes frame by frame and encodes them with the pure-Python
GIF89a writer in :mod:`aetheris.media.canvas`. GIF is chosen deliberately — it
is the only broadly playable animated format that can be produced correctly
without a video codec, so the artifact plays inline in any browser, chat client,
or Markdown preview.

Available motion styles:

* ``orbit``      — bodies revolving around a centre of mass
* ``waveform``   — travelling sine bands (audio/ocean motion)
* ``pulse``      — concentric emission rings
* ``starfield``  — forward flight through drifting stars
* ``spiral``     — a rotating logarithmic vortex
* ``typewriter`` — text revealed character by character over a backdrop
* ``bars``       — an animated bar chart / equaliser
* ``gradient``   — a slowly drifting mesh gradient loop
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

from .canvas import Canvas, RGB, encode_gif, mix, readable_on
from .font import text_width
from .images import PALETTES, RenderPlan, _caption_for, choose_palette

# Motion styles and the prompt words that select them.
_MOTION_HINTS: dict[str, tuple[str, ...]] = {
    "orbit": ("orbit", "planet", "solar", "revolve", "moon", "space", "circular", "rotate"),
    "waveform": ("wave", "audio", "sound", "ocean", "music", "signal", "frequency", "pulse wave"),
    "pulse": ("pulse", "radar", "sonar", "ripple", "beat", "heartbeat", "emit", "scan"),
    "starfield": ("star", "warp", "hyperspace", "fly", "travel", "space flight", "tunnel"),
    "spiral": ("spiral", "vortex", "galaxy", "swirl", "whirl", "helix"),
    "typewriter": ("text", "type", "title", "quote", "caption", "message", "says", "intro"),
    "bars": ("bar", "chart", "equalizer", "equaliser", "graph", "data", "statistics", "metric"),
    "gradient": ("gradient", "ambient", "background", "loop", "calm", "backdrop", "mesh"),
}

MOTIONS: tuple[str, ...] = tuple(sorted(_MOTION_HINTS))


@dataclass
class VideoPlan:
    """The interpreted intent behind a video prompt."""

    prompt: str
    motion: str
    palette: tuple[RGB, ...]
    palette_name: str
    width: int
    height: int
    frames: int
    fps: int
    seed: int
    caption: str = ""

    @property
    def duration(self) -> float:
        return self.frames / max(1, self.fps)


def choose_motion(prompt: str, override: str | None = None) -> str:
    """Select a motion style from an explicit name or the prompt's wording."""
    if override:
        key = override.strip().lower()
        if key not in _MOTION_HINTS:
            raise ValueError(
                f"Unknown motion '{override}'. Choose one of: {', '.join(MOTIONS)}."
            )
        return key

    text = prompt.lower()
    best, score = "", 0
    for name, hints in _MOTION_HINTS.items():
        found = sum(1 for hint in hints if hint in text)
        if found > score:
            best, score = name, found
    if best:
        return best
    return "typewriter" if '"' in prompt else "orbit"


def plan(
    prompt: str,
    *,
    width: int = 480,
    height: int = 270,
    seconds: float = 3.0,
    fps: int = 12,
    motion: str | None = None,
    palette: str | None = None,
    seed: int | None = None,
) -> VideoPlan:
    """Interpret a prompt into a concrete video plan."""
    from .images import _seed_for

    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("A video prompt is required.")

    palette_name, colors = choose_palette(prompt, palette)
    fps = max(4, min(24, int(fps)))
    frames = max(4, min(120, int(round(seconds * fps))))
    return VideoPlan(
        prompt=prompt,
        motion=choose_motion(prompt, motion),
        palette=colors,
        palette_name=palette_name,
        width=width,
        height=height,
        frames=frames,
        fps=fps,
        seed=_seed_for(prompt, seed),
        caption=_caption_for(prompt),
    )


# --- Frame renderers ----------------------------------------------------------
#
# Each takes the normalised time ``t`` in [0, 1) and must be a seamless loop:
# frame(0) and frame(1) are adjacent when the GIF wraps.


def _backdrop(canvas: Canvas, palette: tuple[RGB, ...]) -> None:
    canvas.radial_gradient(mix(palette[1], palette[0], 0.45), palette[0])


def _frame_orbit(canvas: Canvas, p: VideoPlan, t: float, rng: random.Random) -> None:
    palette = p.palette
    _backdrop(canvas, palette)
    cx, cy = canvas.width / 2, canvas.height / 2

    canvas.soft_blobs([(cx, cy, min(cx, cy) * 0.9, palette[3], 0.28)], divisor=5)
    canvas.disc(cx, cy, min(canvas.width, canvas.height) * 0.075, palette[-1])

    bodies = 4
    for index in range(bodies):
        # Integer harmonics keep every orbit closed over one loop.
        radius = min(cx, cy) * (0.28 + index * 0.19)
        speed = bodies - index
        angle = t * math.tau * speed + index * 1.4
        canvas.ring(cx, cy, radius, 1, palette[2], 0.16)
        bx = cx + math.cos(angle) * radius
        by = cy + math.sin(angle) * radius * 0.55
        size = 3.0 + index * 0.9
        canvas.disc(bx, by, size * 2.4, palette[3], 0.16)
        canvas.disc(bx, by, size, palette[-1])


def _frame_waveform(canvas: Canvas, p: VideoPlan, t: float, rng: random.Random) -> None:
    palette = p.palette
    canvas.linear_gradient(palette[0], palette[1], 90)
    bands = 7
    for band in range(bands):
        ratio = band / bands
        color = mix(palette[2], palette[-1], ratio)
        amplitude = canvas.height * 0.15 * (1 - ratio * 0.5)
        base = canvas.height * 0.5
        previous: tuple[int, int] | None = None
        for x in range(0, canvas.width + 2, 2):
            phase = t * math.tau + band * 0.7
            y = base + amplitude * math.sin(x * 0.022 + phase)
            y += amplitude * 0.4 * math.sin(x * 0.047 - phase * 1.6)
            y += (ratio - 0.5) * canvas.height * 0.28
            point = (x, int(y))
            if previous:
                canvas.line(previous[0], previous[1], point[0], point[1], color, 1, 0.75)
            previous = point


def _frame_pulse(canvas: Canvas, p: VideoPlan, t: float, rng: random.Random) -> None:
    palette = p.palette
    _backdrop(canvas, palette)
    cx, cy = canvas.width / 2, canvas.height / 2
    longest = math.hypot(cx, cy)
    rings = 4
    for index in range(rings):
        # Each ring is offset in phase so emission looks continuous.
        progress = (t + index / rings) % 1.0
        radius = progress * longest
        alpha = (1 - progress) ** 1.5 * 0.85
        canvas.ring(cx, cy, radius, 2, mix(palette[-1], palette[2], progress), alpha)
    canvas.disc(cx, cy, 7 + 3 * math.sin(t * math.tau), palette[-1])


def _frame_starfield(canvas: Canvas, p: VideoPlan, t: float, rng: random.Random) -> None:
    palette = p.palette
    canvas.fill(palette[0])
    cx, cy = canvas.width / 2, canvas.height / 2
    stars = random.Random(p.seed)
    for _ in range(150):
        angle = stars.random() * math.tau
        # Depth cycles over the loop, so stars stream outward forever.
        depth = (stars.random() + t) % 1.0
        distance = depth ** 2 * math.hypot(cx, cy) * 1.15
        x = cx + math.cos(angle) * distance
        y = cy + math.sin(angle) * distance
        size = depth * 2.2
        alpha = min(1.0, depth * 1.6)
        color = mix(palette[2], palette[-1], depth)
        if size < 1:
            canvas.blend_pixel(int(x), int(y), color, alpha)
        else:
            canvas.disc(x, y, size, color, alpha)
            # A short motion-blur streak sells the forward travel.
            canvas.line(
                int(cx + math.cos(angle) * distance * 0.93),
                int(cy + math.sin(angle) * distance * 0.93),
                int(x), int(y), color, 1, alpha * 0.4,
            )


def _frame_spiral(canvas: Canvas, p: VideoPlan, t: float, rng: random.Random) -> None:
    palette = p.palette
    _backdrop(canvas, palette)
    cx, cy = canvas.width / 2, canvas.height / 2
    max_radius = min(canvas.width, canvas.height) * 0.46
    arms = 3
    for arm in range(arms):
        offset = (math.tau / arms) * arm + t * math.tau
        for i in range(140):
            ratio = i / 140
            angle = offset + ratio * math.tau * 1.6
            radius = max_radius * (ratio ** 0.72)
            x = cx + math.cos(angle) * radius
            y = cy + math.sin(angle) * radius * 0.66
            canvas.disc(x, y, max(0.8, 2.4 * (1 - ratio)),
                        mix(palette[-1], palette[2], ratio), 0.6 * (1 - ratio * 0.5))
    canvas.disc(cx, cy, max_radius * 0.08, palette[-1], 0.95)


def _frame_bars(canvas: Canvas, p: VideoPlan, t: float, rng: random.Random) -> None:
    palette = p.palette
    canvas.linear_gradient(palette[0], mix(palette[0], palette[1], 0.6), 90)
    count = 16
    margin = int(canvas.width * 0.06)
    usable = canvas.width - margin * 2
    bar_w = max(3, usable // count - 4)
    floor = int(canvas.height * 0.86)
    phases = random.Random(p.seed)
    offsets = [phases.random() * math.tau for _ in range(count)]

    canvas.hline(margin, canvas.width - margin, floor, palette[2], 0.4)
    for index in range(count):
        wave = 0.5 + 0.5 * math.sin(t * math.tau + offsets[index])
        height = int((canvas.height * 0.62) * (0.15 + wave * 0.85))
        x = margin + index * (usable // count)
        color = mix(palette[2], palette[-1], wave)
        canvas.rect(x, floor - height, bar_w, height, color, 0.92)
        canvas.rect(x, floor - height, bar_w, 2, palette[-1], 0.9)


def _frame_gradient(canvas: Canvas, p: VideoPlan, t: float, rng: random.Random) -> None:
    palette = p.palette
    canvas.linear_gradient(palette[0], palette[1], 90 + 40 * math.sin(t * math.tau))
    blobs = []
    for index in range(5):
        angle = t * math.tau + index * 1.26
        # Each blob traces a closed Lissajous path so the loop is seamless.
        bx = canvas.width * (0.5 + 0.32 * math.cos(angle + index))
        by = canvas.height * (0.5 + 0.32 * math.sin(angle * 1.0 + index * 0.7))
        blobs.append((bx, by, canvas.width * 0.33, palette[2 + index % 3], 0.30))
    canvas.soft_blobs(blobs, divisor=5)


def _frame_typewriter(canvas: Canvas, p: VideoPlan, t: float, rng: random.Random) -> None:
    palette = p.palette
    _frame_gradient(canvas, p, t * 0.35, rng)

    margin = int(min(canvas.width, canvas.height) * 0.09)
    canvas.rounded_rect(
        margin, margin, canvas.width - margin * 2, canvas.height - margin * 2,
        int(margin * 0.45), palette[0], 0.55,
    )

    text = p.caption or "AETHERIS"
    usable = canvas.width - margin * 3
    scale = max(1, min(6, usable // max(1, text_width(text, 1))))

    # Reveal over the first 70% of the loop, then hold so the text is readable.
    progress = min(1.0, t / 0.7)
    shown = text[: max(0, int(len(text) * progress))]
    ink = readable_on(palette[0])
    y = canvas.height // 2 - (7 * scale) // 2
    canvas.text_centered(canvas.width // 2, y, shown, ink, scale)

    # Blinking cursor after the revealed text.
    if int(t * p.fps) % 2 == 0:
        cursor_x = canvas.width // 2 + text_width(shown, scale) // 2 + scale * 2
        canvas.rect(cursor_x, y, max(2, scale), 7 * scale, palette[2], 0.9)


_FRAME_RENDERERS = {
    "orbit": _frame_orbit,
    "waveform": _frame_waveform,
    "pulse": _frame_pulse,
    "starfield": _frame_starfield,
    "spiral": _frame_spiral,
    "bars": _frame_bars,
    "gradient": _frame_gradient,
    "typewriter": _frame_typewriter,
}


def render_frames(p: VideoPlan, *, caption: bool = True) -> list[Canvas]:
    """Render every frame of the plan."""
    rng = random.Random(p.seed)
    renderer = _FRAME_RENDERERS[p.motion]
    frames: list[Canvas] = []
    for index in range(p.frames):
        t = index / p.frames  # normalised, exclusive of 1.0 so the loop is seamless
        canvas = Canvas(p.width, p.height, p.palette[0])
        renderer(canvas, p, t, rng)
        if caption and p.motion != "typewriter":
            label = p.caption or p.prompt
            label = label if len(label) <= 44 else label[:41] + "..."
            canvas.rect(0, p.height - 16, p.width, 16, (0, 0, 0), 0.45)
            canvas.text(7, p.height - 12, label, (248, 249, 250), 1, alpha=0.9)
        frames.append(canvas)
    return frames


def generate(
    prompt: str,
    *,
    width: int = 480,
    height: int = 270,
    seconds: float = 3.0,
    fps: int = 12,
    motion: str | None = None,
    palette: str | None = None,
    seed: int | None = None,
    caption: bool = True,
) -> tuple[bytes, VideoPlan]:
    """Generate an animated GIF from a prompt. Returns ``(gif_bytes, plan)``."""
    p = plan(
        prompt, width=width, height=height, seconds=seconds, fps=fps,
        motion=motion, palette=palette, seed=seed,
    )
    frames = render_frames(p, caption=caption)
    delay_cs = max(2, round(100 / p.fps))
    return encode_gif(frames, delay_cs=delay_cs, loop=True), p


__all__ = ["MOTIONS", "VideoPlan", "plan", "render_frames", "generate", "choose_motion"]

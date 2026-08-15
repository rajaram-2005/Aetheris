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
* ``rain``       — slanted rainfall in three depth layers
* ``fireworks``  — shells rising and bursting over a starfield
* ``kaleidoscope`` — M-fold symmetric mandala that rotates as it blooms
* ``matrix``     — cascading glyph rain with glowing heads
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
    "rain": ("rain", "rainfall", "storm", "drizzle", "downpour", "shower", "rainy", "monsoon"),
    "fireworks": ("firework", "fireworks", "celebration", "festival", "diwali", "new year",
                  "explosion", "burst", "sparkler", "skyrocket"),
    "kaleidoscope": ("kaleidoscope", "mandala", "symmetry", "symmetric", "hypnotic",
                     "sacred geometry", "rangoli", "kolam", "yantra"),
    "matrix": ("matrix", "digital rain", "code rain", "hacker", "terminal", "cyber rain"),
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

def _frame_rain(canvas: Canvas, p: VideoPlan, t: float, rng: random.Random) -> None:
    palette = p.palette
    canvas.linear_gradient(palette[0], mix(palette[0], palette[1], 0.75), 90)
    drops = random.Random(p.seed)
    slant = canvas.width * 0.045  # constant wind so streaks stay parallel
    layers = (
        # (count, speed loops, streak length, alpha, color mix)
        (70, 0.85, 0.045, 0.22, 0.0),
        (46, 1.05, 0.085, 0.38, 0.35),
        (26, 1.35, 0.14, 0.60, 0.7),
    )
    for count, speed, length, alpha, tone in layers:
        color = mix(palette[2], palette[-1], tone)
        for _ in range(count):
            x = drops.uniform(-slant, canvas.width)
            phase = drops.random()
            span = canvas.height * 1.2
            y = ((phase + t * speed) % 1.0) * span - canvas.height * 0.1
            streak = canvas.height * length
            canvas.line(
                int(x), int(y), int(x + slant * (length * 8)), int(y + streak),
                color, 1 if length < 0.1 else 2, alpha,
            )
    # A faint ground sheen where the rain lands.
    canvas.hline(0, canvas.width, canvas.height - 2, palette[2], 0.25)
    canvas.hline(0, canvas.width, canvas.height - 1, palette[-1], 0.15)


def _frame_fireworks(canvas: Canvas, p: VideoPlan, t: float, rng: random.Random) -> None:
    palette = p.palette
    canvas.radial_gradient(palette[0], mix(palette[0], palette[1], 0.5))
    stars = random.Random(p.seed ^ 0x5157)
    for _ in range(70):
        canvas.blend_pixel(
            stars.randrange(canvas.width), stars.randrange(canvas.height),
            palette[-1], 0.12 + stars.random() * 0.3,
        )

    shells = random.Random(p.seed)
    for index in range(6):
        phase = shells.random()
        x = shells.uniform(canvas.width * 0.15, canvas.width * 0.85)
        apex_y = canvas.height * shells.uniform(0.16, 0.45)
        color = palette[2 + (index + 1) % (len(palette) - 2)]
        sparkle = palette[-1]
        s = (t - phase) % 1.0  # every shell's timeline wraps, so the loop closes

        if s < 0.22:  # launch: a rising head with a short fading trail
            u = s / 0.22
            y = canvas.height - (canvas.height - apex_y) * (u ** 0.8)
            wx = x + math.sin(u * 9.0) * 2.0
            canvas.line(int(wx), int(y + 14), int(wx), int(y), palette[-1], 1, 0.55 * (1 - u * 0.4))
            canvas.disc(wx, y, 1.8, palette[-1], 0.95)
        else:  # burst: particles fly out, sag under gravity, and fade
            u = (s - 0.22) / 0.78
            radius = min(canvas.width, canvas.height) * 0.34 * (1 - (1 - u) ** 2.4)
            fade = max(0.0, (1 - u) ** 1.35)
            arms = 22
            arm_rng = random.Random(p.seed + index)
            arm_angles = [arm_rng.random() * math.tau for _ in range(arms)]
            sag = (u ** 2) * canvas.height * 0.08
            for angle in arm_angles:
                px = x + math.cos(angle) * radius
                py = apex_y + math.sin(angle) * radius * 0.8 + sag
                canvas.blend_pixel(int(px), int(py), color, fade)
                canvas.blend_pixel(int(px), int(py - 1), mix(color, sparkle, 0.5), fade * 0.8)
            if u < 0.16:  # muzzle flash at the moment of burst
                canvas.disc(x, apex_y, 4 + (0.16 - u) * 30, sparkle, 0.85 * (1 - u / 0.16))
            canvas.disc(x, apex_y, 1.5, sparkle, fade)


def _frame_kaleidoscope(canvas: Canvas, p: VideoPlan, t: float, rng: random.Random) -> None:
    palette = p.palette
    canvas.radial_gradient(mix(palette[1], palette[0], 0.35), palette[0])
    cx, cy = canvas.width / 2, canvas.height / 2
    max_radius = math.hypot(cx, cy) * 0.62
    folds = 8
    rotation = t * math.tau  # one turn per loop keeps the wrap seamless
    bloom = 0.5 + 0.5 * math.sin(t * math.tau)  # elements swell and relax

    element_rng = random.Random(p.seed)
    elements = [
        (
            element_rng.uniform(0.2, 0.95) * max_radius,  # radius
            element_rng.uniform(0, math.tau / folds),     # angle inside the wedge
            element_rng.uniform(0.03, 0.075) * max_radius,  # size
            palette[2 + element_rng.randrange(len(palette) - 2)],
            element_rng.randrange(3),                     # kind: disc / ring / petal
        )
        for _ in range(9)
    ]
    for fold in range(folds):
        base_angle = rotation + fold * math.tau / folds
        for radius, wedge_angle, size, color, kind in elements:
            for mirrored in (wedge_angle, -wedge_angle):  # mirror completes the mandala
                angle = base_angle + mirrored
                r = radius * (0.82 + 0.18 * bloom)
                ex = cx + math.cos(angle) * r
                ey = cy + math.sin(angle) * r * 0.78
                if kind == 0:
                    canvas.disc(ex, ey, size * (0.7 + 0.5 * bloom), color, 0.65)
                elif kind == 1:
                    canvas.ring(ex, ey, size * (1.0 + 0.6 * bloom), 1, color, 0.6)
                else:  # petal: a spoke of shrinking discs pointing outward
                    for step in range(3):
                        st = step / 2
                        canvas.disc(
                            cx + math.cos(angle) * (r + size * 2.4 * st),
                            cy + math.sin(angle) * (r + size * 2.4 * st) * 0.78,
                            size * (1 - st * 0.6), mix(color, palette[-1], st), 0.6,
                        )

    centre = max_radius * 0.055 * (1 + 0.35 * bloom)
    canvas.disc(cx, cy, centre * 2.4, palette[2], 0.16)
    canvas.disc(cx, cy, centre, palette[-1], 0.95)
    canvas.ring(cx, cy, centre * 1.9, 1, palette[2], 0.7)


_MATRIX_GLYPHS = "01<>[]#$%&*+-=ABCDEFXYZ"


def _frame_matrix(canvas: Canvas, p: VideoPlan, t: float, rng: random.Random) -> None:
    palette = p.palette
    canvas.fill(mix(palette[0], (0, 0, 0), 0.5))
    column_span = 13
    glyph_h = 11
    tail_len = 14
    span = canvas.height + tail_len * glyph_h + glyph_h

    columns = random.Random(p.seed)
    for column in range(canvas.width // column_span):
        x = column * column_span + 2
        speed = columns.uniform(0.7, 1.4)  # loops per cycle
        phase = columns.random()
        column_rng = random.Random(p.seed + column * 7919)  # stable tail glyphs

        offset = ((phase + t * speed) % 1.0) * span
        head_y = offset - tail_len * glyph_h
        for k in range(tail_len):
            y = int(head_y) - k * glyph_h
            if y < -glyph_h or y > canvas.height:
                column_rng.random()  # keep the sequence aligned across frames
                continue
            fade = max(0.12, 1.0 - k / tail_len)
            glyph = column_rng.choice(_MATRIX_GLYPHS)
            if k == 0:  # the head glows and flickers between two glyphs
                glyph = rng.choice(_MATRIX_GLYPHS)
                canvas.text(x, y, glyph, palette[-1], 1, alpha=1.0)
                canvas.blend_pixel(x + 2, y + 3, palette[-1], 0.35)
            else:
                color = mix(palette[2], palette[1], k / tail_len)
                canvas.text(x, y, glyph, color, 1, alpha=fade)


_FRAME_RENDERERS = {
    "orbit": _frame_orbit,
    "waveform": _frame_waveform,
    "pulse": _frame_pulse,
    "starfield": _frame_starfield,
    "spiral": _frame_spiral,
    "bars": _frame_bars,
    "gradient": _frame_gradient,
    "typewriter": _frame_typewriter,
    "rain": _frame_rain,
    "fireworks": _frame_fireworks,
    "kaleidoscope": _frame_kaleidoscope,
    "matrix": _frame_matrix,
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

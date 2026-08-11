"""Procedural image synthesis.

Aetheris is not a diffusion model, and this module does not pretend to be one.
It is a **deterministic procedural renderer**: it parses intent out of a prompt
(subject, palette, mood, composition) and composes a real raster image from
generative primitives — gradient skies, ridgelines, starfields, waveforms,
particle systems, geometric tilings, and typographic layouts.

That distinction matters, and Aetheris states it in the artifact metadata rather
than implying a photoreal capability it lacks. What it delivers is genuinely
useful and genuinely offline: posters, abstract art, diagrams, gradients, charts,
social cards, and placeholder assets, generated in-process with no API key, no
GPU, and no external service.

Every render is seeded from the prompt, so the same prompt always produces the
same image — a property real generative endpoints usually charge extra for.
"""

from __future__ import annotations

import colorsys
import hashlib
import math
import random
import re
from dataclasses import dataclass, field

from .canvas import Canvas, RGB, hex_to_rgb, mix, readable_on
from .font import text_width

# --- Palettes -----------------------------------------------------------------
#
# Named palettes let a prompt like "sunset over mountains" pick coherent colours
# without a colour model. Each is ordered dark → light.

PALETTES: dict[str, tuple[RGB, ...]] = {
    "aetheris": ((11, 19, 43), (18, 42, 82), (0, 180, 216), (130, 110, 245), (248, 249, 250)),
    "sunset": ((26, 11, 43), (94, 26, 82), (214, 73, 91), (247, 148, 76), (255, 214, 145)),
    "ocean": ((5, 20, 45), (10, 61, 98), (14, 116, 144), (34, 179, 181), (176, 240, 232)),
    "forest": ((10, 26, 20), (22, 58, 41), (45, 106, 62), (122, 173, 87), (216, 232, 175)),
    "ember": ((23, 8, 8), (74, 17, 17), (154, 42, 24), (223, 105, 33), (253, 197, 106)),
    "arctic": ((14, 26, 38), (36, 66, 92), (96, 148, 184), (168, 209, 230), (238, 248, 255)),
    "neon": ((8, 4, 22), (46, 10, 78), (156, 24, 168), (0, 224, 214), (255, 240, 120)),
    "mono": ((10, 10, 12), (48, 48, 54), (110, 110, 120), (180, 180, 190), (245, 245, 248)),
    "sakura": ((36, 16, 30), (92, 38, 66), (186, 84, 122), (240, 154, 180), (255, 224, 232)),
    "gold": ((22, 17, 8), (69, 51, 18), (140, 105, 32), (214, 168, 62), (250, 226, 150)),
}

_PALETTE_HINTS: dict[str, tuple[str, ...]] = {
    "sunset": ("sunset", "dusk", "evening", "golden hour", "sunrise", "dawn", "warm"),
    "ocean": ("ocean", "sea", "water", "wave", "marine", "aqua", "underwater", "beach"),
    "forest": ("forest", "tree", "jungle", "nature", "leaf", "moss", "woodland", "green"),
    "ember": ("fire", "ember", "lava", "volcano", "flame", "burn", "heat", "autumn"),
    "arctic": ("ice", "arctic", "snow", "winter", "frost", "glacier", "cold"),
    "neon": ("neon", "cyberpunk", "synthwave", "vapor", "retro", "arcade", "electric"),
    "mono": ("mono", "monochrome", "grayscale", "greyscale", "black and white", "minimal"),
    "sakura": ("sakura", "cherry", "blossom", "pink", "floral", "rose", "spring"),
    "gold": ("gold", "luxury", "royal", "brass", "bronze", "premium", "elegant"),
}

# --- Scene detection ----------------------------------------------------------

_SCENE_HINTS: dict[str, tuple[str, ...]] = {
    "landscape": (
        "mountain", "landscape", "valley", "hill", "horizon", "scenery", "vista",
        "desert", "canyon", "range", "peak", "sunset over", "sunrise over",
    ),
    "space": (
        "space", "galaxy", "star", "cosmos", "nebula", "planet", "universe",
        "orbit", "astral", "celestial", "moon", "night sky",
    ),
    "waves": ("wave", "ocean", "sea", "water", "ripple", "fluid", "flow", "current", "tide"),
    "particles": (
        "particle", "network", "node", "constellation", "swarm", "cloud", "data",
        "connection", "graph", "neural", "web",
    ),
    "geometric": (
        "geometric", "abstract", "pattern", "tile", "mosaic", "triangle", "polygon",
        "grid", "tessellation", "shape", "city", "skyline", "building", "architecture",
        "urban", "cyberpunk", "block", "structure", "maze", "circuit",
    ),
    "spiral": ("spiral", "vortex", "swirl", "helix", "galaxy arm", "whirl", "twist"),
    "poster": ("poster", "banner", "cover", "title", "headline", "card", "announcement", "quote"),
    "gradient": ("gradient", "backdrop", "background", "wallpaper", "mesh", "blur", "smooth"),
}


@dataclass
class RenderPlan:
    """The interpreted intent behind an image prompt."""

    prompt: str
    scene: str
    palette: tuple[RGB, ...]
    palette_name: str
    width: int
    height: int
    seed: int
    caption: str = ""
    detail: float = 1.0
    tags: list[str] = field(default_factory=list)


def _seed_for(prompt: str, explicit: int | None) -> int:
    """Derive a stable seed so identical prompts render identical images."""
    if explicit is not None:
        return int(explicit) & 0x7FFFFFFF
    digest = hashlib.sha256(prompt.strip().lower().encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big")


def _score(text: str, hints: tuple[str, ...]) -> int:
    return sum(1 for hint in hints if hint in text)


def choose_palette(prompt: str, override: str | None = None) -> tuple[str, tuple[RGB, ...]]:
    """Pick a palette from an explicit name, hex list, or the prompt's wording."""
    if override:
        key = override.strip().lower()
        if key in PALETTES:
            return key, PALETTES[key]
        # Accept a custom comma-separated hex ramp.
        if "#" in override or re.fullmatch(r"[0-9a-fA-F,\s]{6,}", override):
            colors = [hex_to_rgb(p) for p in re.split(r"[,\s]+", override.strip()) if p]
            if len(colors) >= 2:
                return "custom", tuple(colors)
        raise ValueError(
            f"Unknown palette '{override}'. Choose one of: {', '.join(sorted(PALETTES))}, "
            "or pass comma-separated hex colours."
        )

    text = prompt.lower()
    best, score = "aetheris", 0
    for name, hints in _PALETTE_HINTS.items():
        found = _score(text, hints)
        if found > score:
            best, score = name, found
    return best, PALETTES[best]


def choose_scene(prompt: str, override: str | None = None) -> str:
    """Pick the compositional style from an explicit style or the prompt."""
    if override:
        key = override.strip().lower()
        if key in _SCENE_HINTS or key in ("landscape", "space", "waves", "particles",
                                          "geometric", "spiral", "poster", "gradient"):
            return key
        raise ValueError(
            f"Unknown style '{override}'. Choose one of: "
            f"{', '.join(sorted(_SCENE_HINTS))}."
        )

    text = prompt.lower()
    best, score = "", 0
    for name, hints in _SCENE_HINTS.items():
        found = _score(text, hints)
        if found > score:
            best, score = name, found
    if best:
        return best
    # Only an explicit signal means "render this as a title card": quoted text
    # to typeset, or an instruction that literally asks for one. Everything else
    # is a subject to depict, so fall back to an abstract composition chosen
    # deterministically from the prompt.
    if '"' in prompt or re.search(
        r"\b(poster|title card|banner|headline|quote|caption|that says)\b", text
    ):
        return "poster"
    abstract = ("gradient", "geometric", "particles", "spiral", "waves")
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return abstract[digest[0] % len(abstract)]


def _caption_for(prompt: str) -> str:
    """Extract the text to render on a poster-style composition."""
    quoted = re.search(r'"([^"]{1,80})"', prompt)
    if quoted:
        return quoted.group(1).strip()
    cleaned = re.sub(
        r"\b(a|an|the|of|with|in|on|for|and|to|image|picture|poster|banner|card|"
        r"generate|create|make|draw|render|showing|that says|saying)\b",
        " ", prompt, flags=re.I,
    )
    words = [w for w in cleaned.split() if w]
    return " ".join(words[:6]).upper()[:48]


def plan(
    prompt: str,
    *,
    width: int = 1024,
    height: int = 576,
    style: str | None = None,
    palette: str | None = None,
    seed: int | None = None,
) -> RenderPlan:
    """Interpret a prompt into a concrete render plan."""
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("An image prompt is required.")

    palette_name, colors = choose_palette(prompt, palette)
    scene = choose_scene(prompt, style)
    return RenderPlan(
        prompt=prompt,
        scene=scene,
        palette=colors,
        palette_name=palette_name,
        width=width,
        height=height,
        seed=_seed_for(prompt, seed),
        caption=_caption_for(prompt),
        tags=[scene, palette_name],
    )


# --- Scene renderers ----------------------------------------------------------


def _sky(canvas: Canvas, palette: tuple[RGB, ...], rng: random.Random) -> None:
    """Fill a vertical gradient sky from the palette's darkest to lightest."""
    top, bottom = palette[0], palette[min(3, len(palette) - 1)]
    canvas.linear_gradient(top, bottom, 90)


def _starfield(canvas: Canvas, rng: random.Random, count: int, color: RGB, top: int = 0,
               bottom: int | None = None) -> None:
    """Scatter stars with varied brightness and occasional glow."""
    bottom = canvas.height if bottom is None else bottom
    for _ in range(count):
        x = rng.randrange(canvas.width)
        y = rng.randrange(top, max(top + 1, bottom))
        brightness = rng.random() ** 2
        canvas.blend_pixel(x, y, color, 0.25 + brightness * 0.75)
        if brightness > 0.93:
            canvas.disc(x, y, 1.6, color, 0.5)
            canvas.disc(x, y, 3.2, color, 0.12)


def render_landscape(canvas: Canvas, p: RenderPlan, rng: random.Random) -> None:
    """Layered ridgelines under a graded sky with a sun and reflection."""
    palette = p.palette
    _sky(canvas, palette, rng)

    # Sun / focal disc, placed off-centre by the rule of thirds.
    sun_x = int(canvas.width * (0.32 if rng.random() < 0.5 else 0.68))
    sun_y = int(canvas.height * 0.34)
    sun_r = max(18, canvas.height // 9)
    glow = palette[-1]
    canvas.soft_blobs([(sun_x, sun_y, sun_r * 4.6, glow, 0.30)], divisor=6)
    canvas.disc(sun_x, sun_y, sun_r, glow, 0.96)

    # Ridgelines: each layer sits lower, darker, and rougher than the one behind.
    layers = 5
    horizon = int(canvas.height * 0.58)
    for layer in range(layers):
        depth = layer / max(1, layers - 1)
        color = mix(palette[min(2, len(palette) - 1)], palette[0], 0.25 + depth * 0.7)
        base = horizon + int(depth * canvas.height * 0.30)
        amplitude = canvas.height * (0.13 - depth * 0.018)
        roughness = 0.006 + depth * 0.004
        phase = rng.random() * math.tau
        heights: list[int] = []
        for x in range(canvas.width):
            # Two octaves of sine give a ridge that reads as terrain, not a wave.
            y = base
            y -= amplitude * math.sin(x * roughness + phase)
            y -= amplitude * 0.45 * math.sin(x * roughness * 2.7 + phase * 1.7)
            heights.append(int(y))
        for x, y in enumerate(heights):
            canvas.vline(x, y, canvas.height, color)

    # Water reflection band beneath the lowest ridge.
    water_top = int(canvas.height * 0.86)
    for y in range(water_top, canvas.height):
        t = (y - water_top) / max(1, canvas.height - water_top)
        shimmer = 0.5 + 0.5 * math.sin(y * 0.7)
        canvas.hline(0, canvas.width, y, mix(palette[1], palette[0], t), 0.35 + shimmer * 0.1)
    canvas.disc(sun_x, canvas.height - 4, sun_r * 0.75, glow, 0.10)


def render_space(canvas: Canvas, p: RenderPlan, rng: random.Random) -> None:
    """A nebula field: layered gas clouds, stars, and a planet body."""
    palette = p.palette
    canvas.radial_gradient(palette[1], palette[0])

    # Nebula: overlapping soft blobs build cloud structure.
    canvas.soft_blobs([
        (
            rng.randrange(canvas.width),
            rng.randrange(canvas.height),
            rng.uniform(canvas.width * 0.06, canvas.width * 0.26),
            palette[rng.randrange(2, len(palette))],
            rng.uniform(0.06, 0.20),
        )
        for _ in range(int(30 * p.detail))
    ], divisor=6)

    _starfield(canvas, rng, int(canvas.width * canvas.height / 900), palette[-1])

    # Planet with a lit limb and a thin atmosphere ring.
    px = int(canvas.width * rng.uniform(0.62, 0.78))
    py = int(canvas.height * rng.uniform(0.30, 0.44))
    pr = max(30, int(canvas.height * 0.17))
    body = mix(palette[2], palette[0], 0.35)
    canvas.disc(px, py, pr, body)
    for i in range(pr):
        # Shade the sphere: brighter toward the upper-left light source.
        t = i / pr
        canvas.disc(px - pr * 0.18, py - pr * 0.18, pr * (1 - t), mix(palette[3], body, t), 0.05)
    canvas.ring(px, py, pr * 1.28, 2, palette[-1], 0.28)


def render_waves(canvas: Canvas, p: RenderPlan, rng: random.Random) -> None:
    """Stacked sine bands — an ocean or an audio-style waveform field."""
    palette = p.palette
    canvas.linear_gradient(palette[0], palette[1], 90)
    bands = int(26 * p.detail)
    for band in range(bands):
        t = band / bands
        color = mix(palette[2], palette[-1], t)
        amplitude = canvas.height * 0.10 * (1 - t * 0.55)
        frequency = 0.008 + t * 0.012
        phase = rng.random() * math.tau
        base = canvas.height * (0.12 + t * 0.8)
        previous: tuple[int, int] | None = None
        for x in range(0, canvas.width, 2):
            y = base + amplitude * math.sin(x * frequency + phase)
            y += amplitude * 0.35 * math.sin(x * frequency * 2.3 + phase * 0.6)
            point = (x, int(y))
            if previous:
                canvas.line(previous[0], previous[1], point[0], point[1], color,
                            thickness=1, alpha=0.55)
            previous = point


def render_particles(canvas: Canvas, p: RenderPlan, rng: random.Random) -> None:
    """A force-directed-looking node graph — the 'network/data' aesthetic."""
    palette = p.palette
    canvas.radial_gradient(mix(palette[1], palette[0], 0.4), palette[0])

    count = int(64 * p.detail)
    nodes = [
        (
            rng.uniform(canvas.width * 0.06, canvas.width * 0.94),
            rng.uniform(canvas.height * 0.08, canvas.height * 0.92),
            rng.uniform(1.6, 4.6),
        )
        for _ in range(count)
    ]
    # Connect near neighbours; fading by distance suggests depth.
    threshold = min(canvas.width, canvas.height) * 0.22
    for i, (x1, y1, _) in enumerate(nodes):
        for x2, y2, _ in nodes[i + 1 :]:
            distance = math.hypot(x2 - x1, y2 - y1)
            if distance < threshold:
                alpha = (1 - distance / threshold) * 0.35
                canvas.line(int(x1), int(y1), int(x2), int(y2), palette[2], 1, alpha)
    for x, y, radius in nodes:
        canvas.disc(x, y, radius * 2.6, palette[3], 0.12)
        canvas.disc(x, y, radius, palette[-1], 0.95)


def render_geometric(canvas: Canvas, p: RenderPlan, rng: random.Random) -> None:
    """A tiled lattice of triangles and arcs in the palette's full range."""
    palette = p.palette
    canvas.linear_gradient(palette[0], palette[1], 45)
    cell = max(28, int(min(canvas.width, canvas.height) / (7 * p.detail)))
    for gy in range(0, canvas.height + cell, cell):
        for gx in range(0, canvas.width + cell, cell):
            color = palette[rng.randrange(1, len(palette))]
            choice = rng.random()
            alpha = rng.uniform(0.25, 0.85)
            if choice < 0.34:
                canvas.rect(gx, gy, cell - 2, cell - 2, color, alpha * 0.5)
            elif choice < 0.62:
                canvas.disc(gx + cell / 2, gy + cell / 2, cell * 0.38, color, alpha)
            elif choice < 0.84:
                # A filled half-cell triangle, drawn as a scanline ramp.
                for row in range(cell):
                    span = int(cell * row / cell)
                    canvas.hline(gx, gx + span, gy + row, color, alpha * 0.7)
            else:
                canvas.ring(gx + cell / 2, gy + cell / 2, cell * 0.34, 2, color, alpha)


def render_spiral(canvas: Canvas, p: RenderPlan, rng: random.Random) -> None:
    """A logarithmic spiral of discs — vortex / galaxy-arm composition."""
    palette = p.palette
    canvas.radial_gradient(palette[1], palette[0])
    cx, cy = canvas.width / 2, canvas.height / 2
    arms = rng.choice((2, 3, 4, 5))
    points = int(560 * p.detail)
    max_radius = min(canvas.width, canvas.height) * 0.46
    for arm in range(arms):
        offset = (math.tau / arms) * arm
        for i in range(points):
            t = i / points
            angle = offset + t * math.tau * 1.9
            radius = max_radius * (t ** 0.72)
            # Scatter perpendicular to the arm so it reads as a band, not a line.
            jitter = rng.gauss(0, max_radius * 0.028 * (0.4 + t))
            x = cx + math.cos(angle) * radius + jitter
            y = cy + math.sin(angle) * radius * 0.62 + jitter * 0.6
            color = mix(palette[-1], palette[2], t)
            canvas.disc(x, y, max(0.7, 2.6 * (1 - t)), color, 0.55 * (1 - t * 0.55))
    canvas.disc(cx, cy, max_radius * 0.09, palette[-1], 0.9)
    canvas.disc(cx, cy, max_radius * 0.2, palette[-1], 0.12)


def render_gradient(canvas: Canvas, p: RenderPlan, rng: random.Random) -> None:
    """A soft mesh gradient — the wallpaper / backdrop composition."""
    palette = p.palette
    canvas.linear_gradient(palette[0], palette[1], rng.uniform(20, 160))
    blobs = [
        (
            rng.uniform(0, canvas.width),
            rng.uniform(0, canvas.height),
            rng.uniform(canvas.width * 0.2, canvas.width * 0.55),
            palette[rng.randrange(2, len(palette))],
            rng.uniform(0.18, 0.42),
        )
        for _ in range(int(7 * p.detail))
    ]
    canvas.soft_blobs(blobs)
    # A faint grain layer keeps large flat areas from banding.
    for _ in range(canvas.width * canvas.height // 260):
        canvas.blend_pixel(
            rng.randrange(canvas.width), rng.randrange(canvas.height),
            palette[-1], rng.uniform(0.02, 0.07),
        )


def render_poster(canvas: Canvas, p: RenderPlan, rng: random.Random) -> None:
    """A typographic title card with a generated backdrop and framing."""
    render_gradient(canvas, p, rng)

    # Darkened plate so the type always meets contrast requirements.
    margin = int(min(canvas.width, canvas.height) * 0.07)
    canvas.rounded_rect(
        margin, margin, canvas.width - margin * 2, canvas.height - margin * 2,
        int(margin * 0.5), p.palette[0], 0.55,
    )
    canvas.rect_outline(
        margin, margin, canvas.width - margin * 2, canvas.height - margin * 2,
        p.palette[-1], 1, 0.28,
    )

    caption = p.caption or "AETHERIS"
    ink = readable_on(p.palette[0])

    # Choose the largest scale that fits, then wrap to at most three lines.
    usable = canvas.width - margin * 3
    scale = max(2, min(12, usable // max(1, text_width(caption, 1))))
    lines = _wrap_to_width(caption, usable, scale)
    while len(lines) > 3 and scale > 2:
        scale -= 1
        lines = _wrap_to_width(caption, usable, scale)

    line_height = 7 * scale + scale * 3
    block_top = canvas.height // 2 - (line_height * len(lines)) // 2
    for index, line in enumerate(lines):
        canvas.text_centered(canvas.width // 2, block_top + index * line_height, line, ink, scale)

    # Accent rule and a small brand mark.
    rule_y = block_top + line_height * len(lines) + scale * 2
    rule_w = int(canvas.width * 0.16)
    canvas.rect(canvas.width // 2 - rule_w // 2, rule_y, rule_w, max(2, scale // 2), p.palette[2])
    canvas.text(margin + scale * 2, canvas.height - margin - 10, "AETHERIS", ink, 1, alpha=0.55)


def _wrap_to_width(text: str, max_width: int, scale: int) -> list[str]:
    """Greedy word wrap against a pixel width at the given font scale."""
    words = text.split()
    if not words:
        return [""]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if text_width(candidate, scale) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


_RENDERERS = {
    "landscape": render_landscape,
    "space": render_space,
    "waves": render_waves,
    "particles": render_particles,
    "geometric": render_geometric,
    "spiral": render_spiral,
    "gradient": render_gradient,
    "poster": render_poster,
}

STYLES: tuple[str, ...] = tuple(sorted(_RENDERERS))


def _vignette(canvas: Canvas, strength: float = 0.35) -> None:
    """Darken the corners so the eye settles on the centre.

    Operates directly on the pixel buffer: a full-canvas pass through
    ``blend_pixel`` costs several seconds at poster resolutions.
    """
    cx, cy = canvas.width / 2, canvas.height / 2
    longest = math.hypot(cx, cy)
    pixels = canvas.pixels
    width = canvas.width
    for y in range(canvas.height):
        dy2 = (y - cy) ** 2
        row = y * width * 3
        for x in range(width):
            t = math.sqrt((x - cx) ** 2 + dy2) / longest
            if t <= 0.55:
                continue
            keep = 1.0 - (t - 0.55) * strength
            offset = row + x * 3
            pixels[offset] = int(pixels[offset] * keep)
            pixels[offset + 1] = int(pixels[offset + 1] * keep)
            pixels[offset + 2] = int(pixels[offset + 2] * keep)


def render(p: RenderPlan, *, vignette: bool = True, caption: bool = True) -> Canvas:
    """Execute a render plan and return the finished canvas."""
    rng = random.Random(p.seed)
    canvas = Canvas(p.width, p.height, p.palette[0])
    _RENDERERS[p.scene](canvas, p, rng)

    if vignette and p.scene != "poster":
        _vignette(canvas)

    # Every non-poster image gets a discreet caption strip naming the prompt,
    # which makes generated assets self-documenting in a conversation.
    if caption and p.scene != "poster":
        label = p.caption or p.prompt
        label = label if len(label) <= 52 else label[:49] + "..."
        strip_h = 22
        canvas.rect(0, p.height - strip_h, p.width, strip_h, (0, 0, 0), 0.42)
        canvas.text(10, p.height - strip_h + 8, label, (248, 249, 250), 1, alpha=0.9)
        badge = f"{p.scene}/{p.palette_name}"
        canvas.text(
            p.width - text_width(badge, 1) - 10, p.height - strip_h + 8,
            badge, (0, 180, 216), 1, alpha=0.85,
        )
    return canvas


def generate(
    prompt: str,
    *,
    width: int = 1024,
    height: int = 576,
    style: str | None = None,
    palette: str | None = None,
    seed: int | None = None,
    caption: bool = True,
) -> tuple[bytes, RenderPlan]:
    """Generate a PNG from a prompt. Returns ``(png_bytes, plan)``."""
    p = plan(prompt, width=width, height=height, style=style, palette=palette, seed=seed)
    canvas = render(p, caption=caption)
    return canvas.to_png(), p


__all__ = [
    "PALETTES",
    "STYLES",
    "RenderPlan",
    "plan",
    "render",
    "generate",
    "choose_palette",
    "choose_scene",
]

"""Image remix — palette-aware reimagining of an existing image, fully offline.

Real diffusion models can restyle an image with a text prompt. Aetheris cannot
run one in-process, so this module does the next best thing *honestly*, using
classical image-processing techniques that need no model at all:

* ``restyle`` — a **palette transfer**: every pixel of the source image is
  mapped to the nearest colour of a target palette using Floyd–Steinberg
  error-diffusion dithering. The result keeps the source's composition and
  shading but re-voices it in the target palette — the same idea behind
  posterization and retro game art. Works on any stored PNG.
* ``reimagine`` — **palette-inspired regeneration**: the dominant colours are
  extracted from the source image with a deterministic k-means quantizer, and
  those colours are then handed to the procedural renderer to draw a *new*
  scene from the prompt. When the prompt names no scene, the source's own
  colour character (brightness, saturation, blue-ness) suggests one, so a
  starlit photo reimagines into space, a candy-coloured one into geometry.

Both are deterministic for a given input, and both state plainly in their
metadata that they are palette remixes — not photoreal edits.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from .canvas import RGB, encode_png
from .image_edit import decode_png
from .images import RenderPlan, choose_scene, render, _SCENE_HINTS


@dataclass
class PaletteExtraction:
    """The dominant colours of an image."""

    colors: list[RGB] = field(default_factory=list)
    coverage: list[float] = field(default_factory=list)  # fraction per colour

    @property
    def hexes(self) -> list[str]:
        return [f"#{r:02x}{g:02x}{b:02x}" for r, g, b in self.colors]


def _sample_pixels(rgb: bytearray, width: int, height: int, cap: int = 4096) -> list[RGB]:
    """Deterministically sample up to ``cap`` pixels on a strided grid."""
    count = width * height
    stride = max(1, count // cap)
    return [
        (rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])
        for i in range(0, count, stride)
    ]


def extract_palette(
    rgb: bytearray,
    width: int,
    height: int,
    n: int = 5,
    *,
    seed: int = 7,
) -> PaletteExtraction:
    """Extract the ``n`` dominant colours with deterministic k-means.

    Seeds are spread evenly along the lightness axis so the run is stable,
    then a few Lloyd iterations refine them. Deterministic for a given input.
    """
    n = max(2, min(12, n))
    pixels = _sample_pixels(rgb, width, height)
    if not pixels:
        raise ValueError("Cannot extract a palette from an empty image.")
    rng = random.Random(seed)

    ordered = sorted(pixels, key=lambda p: (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]))
    centres: list[list[float]] = []
    for i in range(n):
        index = min(len(ordered) - 1, i * (len(ordered) - 1) // max(1, n - 1))
        centre = [float(c) for c in ordered[index]]
        for channel in range(3):  # tiny deterministic jitter to separate ties
            centre[channel] += rng.uniform(-4, 4)
        centres.append(centre)

    assignments = [0] * len(pixels)
    for _ in range(6):
        for i, pixel in enumerate(pixels):
            best, best_distance = 0, float("inf")
            for j, centre in enumerate(centres):
                d = sum((pixel[k] - centre[k]) ** 2 for k in range(3))
                if d < best_distance:
                    best, best_distance = j, d
            assignments[i] = best
        sums = [[0.0, 0.0, 0.0, 0] for _ in centres]
        for i, pixel in enumerate(pixels):
            j = assignments[i]
            for k in range(3):
                sums[j][k] += pixel[k]
            sums[j][3] += 1
        changed = False
        for j, total in enumerate(sums):
            if total[3] == 0:
                continue
            new_centre = [total[k] / total[3] for k in range(3)]
            if any(abs(new_centre[k] - centres[j][k]) > 0.5 for k in range(3)):
                changed = True
            centres[j] = new_centre
        if not changed:
            break

    colours = [tuple(max(0, min(255, round(c))) for c in centre) for centre in centres]
    coverage = [
        sum(1 for a in assignments if a == j) / max(1, len(pixels))
        for j in range(len(centres))
    ]
    pairs = sorted(zip(colours, coverage), key=lambda pair: -pair[1])
    return PaletteExtraction(
        colors=[pair[0] for pair in pairs],
        coverage=[pair[1] for pair in pairs],
    )


def _nearest(pixel: RGB, palette: list[RGB]) -> int:
    best, best_distance = 0, float("inf")
    for j, colour in enumerate(palette):
        d = sum((pixel[k] - colour[k]) ** 2 for k in range(3))
        if d < best_distance:
            best, best_distance = j, d
    return best


def _parse_hex(token: str) -> RGB:
    token = token.strip().lstrip("#")
    if len(token) != 6 or any(c not in "0123456789abcdefABCDEF" for c in token):
        raise ValueError(f"'{token}' is not a hex colour like 3a86ff.")
    return tuple(int(token[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _resolve_palette(palette: str) -> tuple[str, list[RGB]]:
    """Resolve a palette name or comma-separated hex ramp to colours."""
    from .images import PALETTES

    key = palette.strip().lower()
    if key in PALETTES:
        return key, list(PALETTES[key])
    colors = [_parse_hex(t) for t in palette.split(",") if t.strip()]
    if len(colors) >= 2:
        return "custom", colors
    raise ValueError(
        f"Unknown palette '{palette}'. Choose one of: {', '.join(sorted(PALETTES))}, "
        "or pass comma-separated hex colours."
    )


def restyle(
    data: bytes,
    palette: str,
    *,
    dither: bool = True,
    blend: float = 0.0,
) -> tuple[bytes, dict]:
    """Remap a PNG onto ``palette`` (name or comma-separated hex colours).

    ``dither`` applies Floyd–Steinberg error diffusion so gradients survive
    the quantization instead of banding; ``blend`` (0–1) mixes the result back
    toward the original to soften the effect.
    """
    width, height, rgb = decode_png(data)
    name, colors = _resolve_palette(palette)

    out = bytearray(width * height * 3)
    errors = [0.0] * (width * 3)

    for y in range(height):
        next_errors = [0.0] * (width * 3)
        for x in range(width):
            base = (y * width + x) * 3
            value = [
                rgb[base + k] + (errors[x * 3 + k] if dither else 0.0)
                for k in range(3)
            ]
            index = _nearest((value[0], value[1], value[2]), colors)
            chosen = colors[index]
            for k in range(3):
                out[base + k] = chosen[k]
            if dither:
                error = [value[k] - chosen[k] for k in range(3)]
                if x < width - 1:
                    for k in range(3):
                        errors[(x + 1) * 3 + k] += error[k] * 7 / 16
                        next_errors[(x + 1) * 3 + k] += error[k] * 1 / 16
                if x > 0:
                    for k in range(3):
                        next_errors[(x - 1) * 3 + k] += error[k] * 3 / 16
                for k in range(3):
                    next_errors[x * 3 + k] += error[k] * 5 / 16
        errors = next_errors

    if blend > 0:
        t = max(0.0, min(1.0, blend))
        for i in range(len(out)):
            out[i] = round(out[i] * (1 - t) + rgb[i] * t)

    meta = {
        "operation": "restyle",
        "palette": name,
        "palette_colors": [f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}" for c in colors],
        "dither": dither,
        "blend": round(blend, 2),
        "width": width,
        "height": height,
    }
    return encode_png(width, height, bytes(out)), meta


def reimagine(
    data: bytes,
    prompt: str,
    *,
    width: int = 1024,
    height: int = 576,
    style: str | None = None,
    seed: int | None = None,
    caption: bool = True,
) -> tuple[bytes, dict]:
    """Re-render ``prompt`` using the dominant colours of the source image.

    The source contributes its palette (sorted by coverage, darkest first);
    everything else — subject, composition, geometry — comes from the prompt
    through the regular procedural renderer. If the prompt names no scene,
    the source's own colour character suggests one.
    """
    width, height = _bounded(width, height)
    source_w, source_h, rgb = decode_png(data)
    extraction = extract_palette(rgb, source_w, source_h, n=5)
    ordered = sorted(
        extraction.colors,
        key=lambda c: (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]),
    )
    palette = tuple(ordered)

    if style:
        scene = choose_scene(prompt, style)  # validates the explicit style
    elif _prompt_names_scene(prompt):
        scene = choose_scene(prompt)
    else:
        scene = _scene_from_colour_character(extraction.colors)

    plan = RenderPlan(
        prompt=prompt.strip() or "palette remix",
        scene=scene,
        palette=palette,
        palette_name="inherited",
        width=width,
        height=height,
        seed=seed if seed is not None else _source_seed(rgb, source_w, source_h),
        caption=prompt.strip() or "palette remix",
        tags=["remix", scene],
    )
    canvas = render(plan, caption=caption)
    meta = {
        "operation": "reimagine",
        "scene": scene,
        "inherited_palette": extraction.hexes,
        "palette_coverage": [round(c, 3) for c in extraction.coverage],
        "source_dimensions": f"{source_w}x{source_h}",
        "width": width,
        "height": height,
        "seed": plan.seed,
    }
    return canvas.to_png(), meta


def _prompt_names_scene(prompt: str) -> bool:
    text = prompt.lower()
    return any(hint in text for hints in _SCENE_HINTS.values() for hint in hints)


def _scene_from_colour_character(colors: list[RGB]) -> str:
    mean = tuple(sum(c[k] for c in colors) / len(colors) for k in range(3))
    luminance = 0.299 * mean[0] + 0.587 * mean[1] + 0.114 * mean[2]
    maximum, minimum = max(mean), min(mean)
    saturation = (maximum - minimum) / maximum if maximum else 0.0
    if mean[2] > mean[0] + 18 and mean[2] > 110:
        return "space"
    if saturation > 0.35:
        return "geometric"
    if luminance < 70:
        return "cityscape"
    if luminance > 180:
        return "waves"
    return "gradient"


def _bounded(width: int, height: int) -> tuple[int, int]:
    return (max(64, min(2048, width)), max(64, min(2048, height)))


def _source_seed(rgb: bytearray, width: int, height: int) -> int:
    """A stable seed derived from the source pixels."""
    total = 0
    for i in range(0, min(len(rgb), 4096), 13):
        total = (total * 31 + rgb[i]) & 0x7FFFFFFF
    return total or 1


def remix(
    data: bytes,
    prompt: str,
    *,
    operation: str = "reimagine",
    palette: str | None = None,
    width: int = 1024,
    height: int = 576,
    style: str | None = None,
    dither: bool = True,
    seed: int | None = None,
) -> tuple[bytes, dict]:
    """Remix a stored PNG: ``reimagine`` (new scene, source palette) or
    ``restyle`` (same pixels, new palette)."""
    operation = (operation or "reimagine").lower()
    if operation == "restyle":
        if not palette:
            source_w, source_h, rgb = decode_png(data)
            extraction = extract_palette(rgb, source_w, source_h)
            palette = ",".join(extraction.hexes[:5]) or "aetheris"
        return restyle(data, palette, dither=dither)
    if operation not in ("reimagine", "remix"):
        raise ValueError(f"Unknown remix operation '{operation}'. Choose reimagine or restyle.")
    return reimagine(data, prompt, width=width, height=height, style=style, seed=seed)


__all__ = [
    "PaletteExtraction",
    "extract_palette",
    "restyle",
    "reimagine",
    "remix",
]

"""Collage sheets — combine several stored images into one composition.

Takes any number of PNG artifacts (the outputs of earlier image generations,
remixes, or edits) and composes them into a single sheet with three layouts:

* ``grid``      — a tidy table of cells; every image letterboxed to fit.
* ``polaroid``  — white-framed prints scattered with deterministic rotation,
                  drop shadows, and a caption under each.
* ``filmstrip`` — a horizontal band of frames with sprocket holes.

The output is a plain PNG composed offline from the decoded pixels, with a
discreet footer naming the sources. Like the rest of the studio, everything is
deterministic for a given input set.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

from .canvas import Canvas, readable_on
from .image_edit import decode_png

LAYOUTS: tuple[str, ...] = ("grid", "polaroid", "filmstrip")


@dataclass
class CollageItem:
    """One source image with an optional caption."""

    data: bytes
    caption: str = ""


def _fit(
    canvas: Canvas,
    rgb: bytearray,
    src_w: int,
    src_h: int,
    x: int,
    y: int,
    w: int,
    h: int,
) -> None:
    """Letterbox-copy an image into a region, preserving aspect ratio."""
    scale = min(w / src_w, h / src_h)
    draw_w, draw_h = max(1, int(src_w * scale)), max(1, int(src_h * scale))
    offset_x = x + (w - draw_w) // 2
    offset_y = y + (h - draw_h) // 2
    for dy in range(draw_h):
        sy = min(src_h - 1, dy * src_h // draw_h)
        for dx in range(draw_w):
            sx = min(src_w - 1, dx * src_w // draw_w)
            src = (sy * src_w + sx) * 3
            canvas.set_pixel(offset_x + dx, offset_y + dy, (rgb[src], rgb[src + 1], rgb[src + 2]))


def _shadow(canvas: Canvas, x: int, y: int, w: int, h: int, dx: int = 6, dy: int = 7) -> None:
    canvas.rect(x + dx, y + dy, w, h, (0, 0, 0), 0.28)


def build(
    items: list[CollageItem],
    *,
    layout: str = "grid",
    width: int = 1280,
    height: int = 720,
    background: str = "#0b132b",
    caption_footer: bool = True,
    seed: int = 11,
) -> tuple[bytes, dict]:
    """Compose ``items`` into a collage PNG. Returns ``(png_bytes, meta)``."""
    layout = (layout or "grid").lower()
    if layout not in LAYOUTS:
        raise ValueError(f"Unknown layout '{layout}'. Choose one of: {', '.join(LAYOUTS)}.")
    if not items:
        raise ValueError("A collage needs at least one image.")
    if len(items) > 16:
        raise ValueError("A collage holds at most 16 images.")

    decoded: list[tuple[int, int, bytearray]] = []
    for item in items:
        w, h, rgb = decode_png(item.data)
        decoded.append((w, h, rgb))

    bg = tuple(int(background.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))
    canvas = Canvas(width, height, bg)  # type: ignore[arg-type]
    rng = random.Random(seed)

    if layout == "grid":
        _build_grid(canvas, decoded, items, rng)
    elif layout == "polaroid":
        _build_polaroid(canvas, decoded, items, rng)
    else:
        _build_filmstrip(canvas, decoded, items, rng)

    if caption_footer:
        canvas.rect(0, height - 24, width, 24, (0, 0, 0), 0.5)
        label = f"aetheris collage · {len(items)} image{'s' if len(items) != 1 else ''} · {layout}"
        canvas.text(10, height - 17, label, readable_on(bg), 1, alpha=0.9)

    meta = {
        "layout": layout,
        "images": len(items),
        "captions": [i.caption for i in items],
        "dimensions": [f"{w}x{h}" for w, h, _ in decoded],
        "width": width,
        "height": height,
        "seed": seed,
    }
    return canvas.to_png(), meta


def _build_grid(canvas: Canvas, decoded: list, items: list[CollageItem], rng: random.Random) -> None:
    width, height = canvas.width, canvas.height
    n = len(decoded)
    cols = {1: 1, 2: 2, 3: 3, 4: 2}.get(n, min(3, math.ceil(math.sqrt(n))) if n > 4 else 3)
    cols = min(cols, n)
    rows = math.ceil(n / cols)
    margin = 28
    gap = 18
    cell_w = (width - 2 * margin - (cols - 1) * gap) // cols
    cell_h = (height - 2 * margin - (rows - 1) * gap - 26) // rows
    for index, ((sw, sh, rgb), item) in enumerate(zip(decoded, items)):
        row, col = divmod(index, cols)
        x = margin + col * (cell_w + gap)
        y = margin + row * (cell_h + gap)
        _shadow(canvas, x, y, cell_w, cell_h)
        canvas.rect(x, y, cell_w, cell_h, (10, 14, 26))
        _fit(canvas, rgb, sw, sh, x, y, cell_w, cell_h)
        canvas.rect_outline(x, y, cell_w, cell_h, (255, 255, 255), alpha=0.16)
        if item.caption:
            canvas.rect(x, y + cell_h - 20, cell_w, 20, (0, 0, 0), 0.55)
            canvas.text(x + 8, y + cell_h - 14, _clip(item.caption, cell_w // 7),
                        (240, 242, 248), 1, alpha=0.95)


def _build_polaroid(canvas: Canvas, decoded: list, items: list[CollageItem], rng: random.Random) -> None:
    width, height = canvas.width, canvas.height
    n = len(decoded)
    n = min(n, 9)
    frame_w = min(300, int(width * 0.42))
    frame_h = int(frame_w * 0.82)
    border = max(8, frame_w // 14)

    anchors = {
        1: [(0.5, 0.52)], 2: [(0.32, 0.5), (0.68, 0.5)],
        3: [(0.28, 0.42), (0.6, 0.3), (0.45, 0.68)],
        4: [(0.27, 0.35), (0.6, 0.32), (0.3, 0.68), (0.64, 0.66)],
        5: [(0.2, 0.3), (0.5, 0.26), (0.76, 0.38), (0.32, 0.66), (0.64, 0.64)],
        6: [(0.22, 0.28), (0.5, 0.24), (0.78, 0.3), (0.24, 0.66), (0.52, 0.62), (0.78, 0.66)],
        7: [(0.2, 0.26), (0.47, 0.22), (0.74, 0.28), (0.24, 0.58), (0.5, 0.54),
            (0.76, 0.6), (0.62, 0.82)],
        8: [(0.18, 0.26), (0.45, 0.22), (0.72, 0.24), (0.2, 0.6), (0.48, 0.56),
            (0.76, 0.56), (0.34, 0.86), (0.66, 0.86)],
        9: [(0.16, 0.24), (0.43, 0.2), (0.7, 0.24), (0.18, 0.56), (0.45, 0.52),
            (0.72, 0.54), (0.2, 0.88), (0.48, 0.86), (0.74, 0.86)],
    }
    for index, ((sw, sh, rgb), item) in enumerate(zip(decoded[:n], items[:n])):
        ax, ay = anchors.get(n, anchors[9])[index]
        x = int(ax * width - frame_w / 2)
        y = int(ay * height - frame_h / 2)
        angle = rng.uniform(-0.09, 0.09)
        _shadow(canvas, x, y, frame_w, frame_h, 8, 10)
        _draw_rotated_frame(canvas, rgb, sw, sh, x, y, frame_w, frame_h, border, angle)
        if item.caption:
            canvas.text_centered(x + frame_w // 2, y + frame_h - border // 2 - 4,
                                 _clip(item.caption, frame_w // 6), (45, 48, 60), 1)


def _draw_rotated_frame(
    canvas: Canvas, rgb: bytearray, sw: int, sh: int,
    x: int, y: int, frame_w: int, frame_h: int, border: int, angle: float,
) -> None:
    """Draw one polaroid frame (photo + white border) rotated by ``angle``."""
    cx, cy = x + frame_w / 2, y + frame_h / 2
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    # Rotated bounding box.
    corners = [(0, 0), (frame_w, 0), (frame_w, frame_h), (0, frame_h)]
    rotated = [(cx + (px - frame_w / 2) * cos_a - (py - frame_h / 2) * sin_a,
                cy + (px - frame_w / 2) * sin_a + (py - frame_h / 2) * cos_a)
               for px, py in corners]
    min_x, max_x = int(min(p[0] for p in rotated)), int(max(p[0] for p in rotated))
    min_y, max_y = int(min(p[1] for p in rotated)), int(max(p[1] for p in rotated))
    min_x, max_x = max(0, min_x), min(canvas.width, max_x)
    min_y, max_y = max(0, min_y), min(canvas.height, max_y)

    for py in range(min_y, max_y + 1):
        for px in range(min_x, max_x + 1):
            # Inverse-rotate this canvas point into frame space.
            fx = (px - cx) * cos_a + (py - cy) * sin_a + frame_w / 2
            fy = -(px - cx) * sin_a + (py - cy) * cos_a + frame_h / 2
            if not (0 <= fx < frame_w and 0 <= fy < frame_h):
                continue
            colour = (250, 250, 252)  # paper border
            if border <= fx < frame_w - border and border <= fy < frame_h - border:
                sx = min(sw - 1, int((fx - border) / (frame_w - 2 * border) * sw))
                sy = min(sh - 1, int((fy - border) / (frame_h - 2 * border) * sh))
                src = (sy * sw + sx) * 3
                colour = (rgb[src], rgb[src + 1], rgb[src + 2])
            canvas.set_pixel(px, py, colour)


def _build_filmstrip(canvas: Canvas, decoded: list, items: list[CollageItem], rng: random.Random) -> None:
    width, height = canvas.width, canvas.height
    n = len(decoded)
    frame_h = height - 120
    frame_w = int(frame_h * 1.5)
    gap = 18
    total_w = n * frame_w + (n + 1) * gap
    x = (width - total_w) // 2
    y = (height - frame_h) // 2 + 10
    # Strip backing with sprocket holes above and below.
    canvas.rect(x - 26, y - 26, total_w + 52, frame_h + 52, (18, 22, 34))
    for sx in range(x - 8, x + total_w + 8, 26):
        canvas.rect(sx, y - 18, 12, 10, (8, 10, 18))
        canvas.rect(sx, y + frame_h + 8, 12, 10, (8, 10, 18))
    for index, ((sw, sh, rgb), item) in enumerate(zip(decoded, items)):
        fx = x + index * (frame_w + gap) + gap
        canvas.rect(fx, y, frame_w, frame_h, (0, 0, 0))
        _fit(canvas, rgb, sw, sh, fx, y, frame_w, frame_h)
        canvas.rect_outline(fx, y, frame_w, frame_h, (255, 255, 255), alpha=0.35)
        if item.caption:
            canvas.text_centered(fx + frame_w // 2, y + frame_h + 30,
                                 _clip(item.caption, frame_w // 7), (200, 206, 220), 1)


def _clip(text: str, max_chars: int) -> str:
    text = text.strip()
    return text if len(text) <= max_chars else text[: max_chars - 1] + "…"


__all__ = ["LAYOUTS", "CollageItem", "build"]

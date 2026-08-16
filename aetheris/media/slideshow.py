"""Slideshow video — an animated Ken Burns deck from stored images.

Turn any sequence of PNG artifacts (generated images, remixes, edits) into a
looping animated GIF presentation. Each slide is held for a few seconds while
the camera drifts or zooms across it — the classic Ken Burns effect — and
slides are joined by deterministic transitions:

* ``crossfade`` — dissolve between slides (default).
* ``pan``      — the next slide pushes in from the right.
* ``zoom``     — the outgoing slide scales up as it fades.
* ``wipe``     — a hard edge sweeps across the frame.

Captions are composited under each slide in a footer strip, and the deck
loops seamlessly. Pure Python, deterministic per seed — no codec required.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from .canvas import Canvas
from .font import text_width
from .image_edit import decode_png

TRANSITIONS: tuple[str, ...] = ("crossfade", "pan", "zoom", "wipe")


@dataclass
class Slide:
    """One slide: image bytes and an optional caption."""

    data: bytes
    caption: str = ""


def _draw_scaled(
    canvas: Canvas,
    rgb: bytearray,
    src_w: int,
    src_h: int,
    x: float,
    y: float,
    scale: float,
    alpha: float = 1.0,
    *,
    clip_x0: int | None = None,
    clip_x1: int | None = None,
) -> None:
    """Composite an image at (x, y) scaled by ``scale`` (Ken Burns camera).

    ``clip_x0``/``clip_x1`` optionally restrict drawing to a horizontal band
    (used by the wipe transition).
    """
    draw_w = max(1, int(src_w * scale))
    draw_h = max(1, int(src_h * scale))
    for dy in range(draw_h):
        sy = min(src_h - 1, dy * src_h // draw_h)
        row = sy * src_w
        for dx in range(draw_w):
            px, py = int(x) + dx, int(y) + dy
            if not (0 <= px < canvas.width and 0 <= py < canvas.height):
                continue
            if clip_x0 is not None and px < clip_x0:
                continue
            if clip_x1 is not None and px >= clip_x1:
                continue
            sx = min(src_w - 1, dx * src_w // draw_w)
            src = (row + sx) * 3
            if alpha >= 1.0:
                canvas.set_pixel(px, py, (rgb[src], rgb[src + 1], rgb[src + 2]))
            else:
                canvas.blend_pixel(px, py, (rgb[src], rgb[src + 1], rgb[src + 2]), alpha)


def _cover_scale(src_w: int, src_h: int, frame_w: int, frame_h: int, zoom: float = 1.0) -> float:
    return max(frame_w / src_w, frame_h / src_h) * zoom


def _footer(canvas: Canvas, caption: str, index: int, total: int) -> None:
    canvas.rect(0, canvas.height - 26, canvas.width, 26, (0, 0, 0), 0.55)
    if caption:
        canvas.text(12, canvas.height - 19, _clip(caption, canvas.width // 8),
                    (240, 242, 248), 1, alpha=0.95)
    badge = f"slide {index + 1}/{total}"
    canvas.text(canvas.width - text_width(badge, 1) - 12, canvas.height - 19,
                badge, (0, 180, 216), 1, alpha=0.9)


def _clip(text: str, max_chars: int) -> str:
    text = text.strip()
    return text if len(text) <= max_chars else text[: max_chars - 1] + "…"


def _ease(t: float) -> float:
    """Smoothstep easing for natural camera moves."""
    return t * t * (3 - 2 * t)


def render_frames(
    slides: list[Slide],
    *,
    width: int = 640,
    height: int = 360,
    seconds_per_slide: float = 2.5,
    transition_seconds: float = 0.8,
    fps: int = 12,
    transition: str = "crossfade",
    seed: int = 5,
) -> list[Canvas]:
    """Render the slideshow deck as a list of Canvas frames."""
    transition = (transition or "crossfade").lower()
    if transition not in TRANSITIONS:
        raise ValueError(
            f"Unknown transition '{transition}'. Choose one of: {', '.join(TRANSITIONS)}."
        )
    if not slides:
        raise ValueError("A slideshow needs at least one slide.")

    decoded = [(w, h, rgb) for w, h, rgb in (decode_png(s.data) for s in slides)]
    total = len(decoded)
    hold = max(6, int(seconds_per_slide * fps))
    trans = max(3, int(transition_seconds * fps))
    frames: list[Canvas] = []
    rng = random.Random(seed)

    for index, (sw, sh, rgb) in enumerate(decoded):
        slide = slides[index]
        for frame in range(hold):
            t = frame / max(1, hold - 1)
            canvas = Canvas(width, height, (8, 10, 18))
            # Ken Burns drift: slow zoom-in, direction alternates per slide.
            zoom = 1.06 + 0.14 * _ease(t) * (1.0 if index % 2 == 0 else 1.08)
            scale = _cover_scale(sw, sh, width, height, zoom)
            draw_w, draw_h = int(sw * scale), int(sh * scale)
            # Pan along the longer overflow axis.
            ox = max(0, (draw_w - width) / 2)
            oy = max(0, (draw_h - height) / 2)
            x = -ox + rng.uniform(-4, 4) + (ox * 0.3 * _ease(t) if index % 2 else -ox * 0.3 * _ease(t))
            y = -oy + (oy * 0.25 * _ease(t))
            _draw_scaled(canvas, rgb, sw, sh, x, y, scale)
            _footer(canvas, slide.caption, index, total)
            frames.append(canvas)

        # Transition into the next slide.
        if index < total - 1:
            next_sw, next_sh, next_rgb = decoded[index + 1]
            next_slide = slides[index + 1]
            for frame in range(1, trans + 1):
                t = frame / (trans + 1)
                canvas = Canvas(width, height, (8, 10, 18))
                scale = _cover_scale(sw, sh, width, height, 1.1)
                n_scale = _cover_scale(next_sw, next_sh, width, height, 1.1)
                if transition == "crossfade":
                    _draw_scaled(canvas, rgb, sw, sh, 0, -max(0, (int(sh * scale) - height) / 2), scale)
                    _draw_scaled(canvas, next_rgb, next_sw, next_sh, 0,
                                 -max(0, (int(next_sw * n_scale) - height) / 2),
                                 n_scale, alpha=_ease(t))
                elif transition == "pan":
                    offset = int(width * (1 - _ease(t)))
                    _draw_scaled(canvas, rgb, sw, sh, -offset, 0, scale)
                    _draw_scaled(canvas, next_rgb, next_sw, next_sh, width - offset, 0, n_scale)
                elif transition == "zoom":
                    out_scale = scale * (1 + 0.5 * _ease(t))
                    _draw_scaled(canvas, rgb, sw, sh, -(int(sw * out_scale) - width) / 2,
                                 -(int(sh * out_scale) - height) / 2, out_scale,
                                 alpha=1 - _ease(t) * 0.6)
                    _draw_scaled(canvas, next_rgb, next_sw, next_sh, 0,
                                 -max(0, (int(next_sw * n_scale) - height) / 2), n_scale,
                                 alpha=_ease(t))
                else:  # wipe: the incoming slide sweeps across from the left
                    edge = int(width * _ease(t))
                    _draw_scaled(canvas, rgb, sw, sh, 0,
                                 -max(0, (int(sh * scale) - height) / 2), scale)
                    _draw_scaled(canvas, next_rgb, next_sw, next_sh, 0,
                                 -max(0, (int(next_sw * n_scale) - height) / 2), n_scale,
                                 clip_x1=edge)
                _footer(canvas, next_slide.caption, index + 1, total)
                frames.append(canvas)

    return frames


def build(
    slides: list[Slide],
    *,
    width: int = 640,
    height: int = 360,
    seconds_per_slide: float = 2.5,
    transition_seconds: float = 0.8,
    fps: int = 12,
    transition: str = "crossfade",
    seed: int = 5,
) -> tuple[bytes, dict]:
    """Build the deck and encode it as a looping GIF. Returns ``(gif, meta)``."""
    from .canvas import encode_gif

    width = max(160, min(1024, width))
    height = max(90, min(768, height))
    fps = max(4, min(30, fps))
    frames = render_frames(
        slides, width=width, height=height,
        seconds_per_slide=seconds_per_slide, transition_seconds=transition_seconds,
        fps=fps, transition=transition, seed=seed,
    )
    delay_cs = max(2, round(100 / fps))
    gif = encode_gif(frames, delay_cs=delay_cs, loop=True)
    meta = {
        "slides": len(slides),
        "frames": len(frames),
        "fps": fps,
        "duration_seconds": round(len(frames) / fps, 2),
        "transition": transition,
        "seconds_per_slide": seconds_per_slide,
        "captions": [s.caption for s in slides],
        "width": width,
        "height": height,
        "seed": seed,
    }
    return gif, meta


__all__ = ["TRANSITIONS", "Slide", "render_frames", "build"]

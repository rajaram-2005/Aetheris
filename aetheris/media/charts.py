"""Data charts — publishable PNG charts from plain JSON numbers.

A chart is the most useful kind of generated image a reasoning assistant can
hand back, and it needs no model at all: take a title, labelled series, and
draw axes, gridlines, legends, and geometry directly. Five kinds:

* ``line``   — one or more labelled series with markers and a legend.
* ``bar``    — vertical bars, one per label, with value callouts.
* ``pie``    — proportional disc with percentage labels.
* ``donut``  — the same with a hole for the title and total.
* ``radar``  — K-axis spider chart comparing series.

Everything is deterministic, anti-aliasing is done by the canvas primitives,
and the output is a real PNG — ready for a slide, a README, or a report.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .canvas import Canvas, RGB
from .font import text_width

KINDS: tuple[str, ...] = ("line", "bar", "pie", "donut", "radar")

_DEFAULT_COLORS: tuple[RGB, ...] = (
    (0, 180, 216), (130, 110, 245), (255, 179, 71), (64, 201, 162),
    (255, 99, 132), (250, 204, 21), (168, 216, 250), (244, 114, 182),
)


@dataclass
class ChartSeries:
    """One named series of numbers."""

    name: str
    values: list[float] = field(default_factory=list)
    color: RGB | None = None


@dataclass
class ChartSpec:
    """A full chart request."""

    title: str = ""
    labels: list[str] = field(default_factory=list)
    series: list[ChartSeries] = field(default_factory=list)


def _series_color(series: ChartSeries, index: int) -> RGB:
    if series.color:
        return series.color
    return _DEFAULT_COLORS[index % len(_DEFAULT_COLORS)]


def _clip(text: str, max_chars: int) -> str:
    return text if len(text) <= max_chars else text[: max_chars - 1] + "…"


def _plot_area(canvas: Canvas) -> tuple[int, int, int, int]:
    """Return (x0, y0, x1, y1) for the plotting region (title + axis margins)."""
    margin_l, margin_r, margin_t, margin_b = 64, 40, 74, 64
    return margin_l, margin_t, canvas.width - margin_r, canvas.height - margin_b


def _draw_title(canvas: Canvas, title: str, subtitle: str = "") -> None:
    canvas.text(40, 26, _clip(title, (canvas.width - 80) // 9), (248, 249, 250), 2)
    if subtitle:
        canvas.text(40, 52, _clip(subtitle, (canvas.width - 80) // 8),
                    (150, 158, 178), 1)


def render(spec: ChartSpec, *, kind: str = "line", width: int = 960, height: int = 560) -> Canvas:
    """Draw a ChartSpec onto a canvas."""
    kind = (kind or "line").lower()
    if kind not in KINDS:
        raise ValueError(f"Unknown chart kind '{kind}'. Choose one of: {', '.join(KINDS)}.")
    if not spec.series:
        raise ValueError("A chart needs at least one series.")

    canvas = Canvas(width, height, (13, 18, 38))
    if kind in ("line", "bar", "radar"):
        _draw_title(canvas, spec.title, f"aetheris chart · {kind}")
        if kind == "line":
            _render_line(canvas, spec)
        elif kind == "bar":
            _render_bar(canvas, spec)
        else:
            _render_radar(canvas, spec)
    else:
        _render_pie(canvas, spec, donut=(kind == "donut"))
    return canvas


# --- Line ------------------------------------------------------------------------

def _nice_ticks(lo: float, hi: float, count: int = 5) -> list[float]:
    if hi == lo:
        hi = lo + 1
    span = hi - lo
    step = 10 ** math.floor(math.log10(span / max(1, count)))
    for multiplier in (1, 2, 2.5, 5, 10):
        if span / (step * multiplier) <= count:
            step *= multiplier
            break
    start = math.ceil(lo / step) * step
    return [round(start + i * step, 6) for i in range(int((hi - start) / step) + 2)]


def _render_line(canvas: Canvas, spec: ChartSpec) -> None:
    x0, y0, x1, y1 = _plot_area(canvas)
    n = len(spec.labels)
    if n == 0:
        n = max(len(s.values) for s in spec.series)
        spec.labels = [str(i + 1) for i in range(n)]
    all_values = [v for s in spec.series for v in s.values]
    lo, hi = min(all_values, default=0), max(all_values, default=1)
    pad = (hi - lo) * 0.08 or 1.0
    lo, hi = max(0, lo - pad) if lo >= 0 else lo - pad, hi + pad

    # Gridlines + y labels.
    for tick in _nice_ticks(lo, hi):
        ty = y1 - int((tick - lo) / (hi - lo) * (y1 - y0))
        canvas.hline(x0, x1, ty, (255, 255, 255), 0.08)
        canvas.text(x0 - 12 - text_width(f"{tick:g}", 1), ty - 4, f"{tick:g}",
                    (150, 158, 178), 1)
    canvas.vline(x0, y0, y1, (255, 255, 255), 0.2)
    canvas.hline(x0, x1, y1, (255, 255, 255), 0.2)

    # X labels.
    step = max(1, n // 12)
    for i in range(0, n, step):
        px = x0 + int((i + 0.5) * (x1 - x0) / n) if n else x0
        canvas.text_centered(px, y1 + 18, _clip(str(spec.labels[i]), 10),
                             (150, 158, 178), 1)

    legend_x = x0
    for index, series in enumerate(spec.series):
        colour = _series_color(series, index)
        canvas.text(legend_x, 24, f"● {_clip(series.name, 24)}", colour, 1)
        legend_x += text_width(f"● {_clip(series.name, 24)}", 1) + 22
        points = []
        for i, value in enumerate(series.values):
            if i >= n:
                continue
            px = x0 + int((i + 0.5) * (x1 - x0) / n)
            py = y1 - int((value - lo) / (hi - lo) * (y1 - y0))
            points.append((px, py))
            canvas.disc(px, py, 3.5, colour)
        for a, b in zip(points, points[1:]):
            canvas.line(a[0], a[1], b[0], b[1], colour, 2)


# --- Bar -------------------------------------------------------------------------

def _render_bar(canvas: Canvas, spec: ChartSpec) -> None:
    x0, y0, x1, y1 = _plot_area(canvas)
    series = spec.series[0]
    labels = spec.labels or [str(i + 1) for i in range(len(series.values))]
    values = series.values
    lo, hi = min(values, default=0), max(values, default=1)
    if lo > 0:
        lo = 0
    pad = (hi - lo) * 0.06 or 1.0
    hi += pad

    for tick in _nice_ticks(lo, hi):
        ty = y1 - int((tick - lo) / (hi - lo) * (y1 - y0))
        canvas.hline(x0, x1, ty, (255, 255, 255), 0.08)
        canvas.text(x0 - 12 - text_width(f"{tick:g}", 1), ty - 4, f"{tick:g}",
                    (150, 158, 178), 1)
    canvas.vline(x0, y0, y1, (255, 255, 255), 0.2)
    canvas.hline(x0, x1, y1, (255, 255, 255), 0.2)

    n = len(values)
    gap = 10
    bar_w = max(6, min(64, (x1 - x0) / n - gap))
    step_x = (x1 - x0) / n if n else 0
    for i, value in enumerate(values):
        px = x0 + int((i + 0.5) * step_x - bar_w / 2)
        bar_h = int((value - lo) / (hi - lo) * (y1 - y0))
        top = y1 - max(0, bar_h)
        bottom = y1
        if value < 0:
            top, bottom = y1, y1 - bar_h
        canvas.rect(px, top, bar_w, bottom - top, _series_color(series, 0))
        canvas.text_centered(px + bar_w // 2, top - 16, f"{value:g}", (240, 242, 248), 1)
        canvas.text_centered(px + bar_w // 2, y1 + 18,
                             _clip(str(labels[i]) if i < len(labels) else "", 12),
                             (150, 158, 178), 1)


# --- Pie / donut -------------------------------------------------------------------

def _render_pie(canvas: Canvas, spec: ChartSpec, donut: bool) -> None:
    width, height = canvas.width, canvas.height
    series = spec.series[0]
    labels = spec.labels or [str(i + 1) for i in range(len(series.values))]
    total = sum(series.values)
    if total <= 0:
        raise ValueError("Pie charts need positive values.")

    cx = width * (0.32 if donut else 0.5)
    cy = height / 2 + 14
    radius = min(height * 0.36, width * 0.3)
    angle = -math.pi / 2
    for index, value in enumerate(series.values):
        sweep = value / total * math.tau
        colour = _series_color(series, index)
        # Draw the wedge by sampling: fill pixels inside the sector.
        _wedge(canvas, cx, cy, radius, angle, angle + sweep, colour,
               inner=radius * 0.52 if donut else 0)
        # Label line + percentage for slices ≥ 4 %.
        if value / total >= 0.04:
            mid = angle + sweep / 2
            pct = f"{value / total * 100:.1f}%"
            lx = cx + math.cos(mid) * (radius + 18)
            ly = cy + math.sin(mid) * (radius + 18)
            align_right = lx > cx
            canvas.line(int(cx + math.cos(mid) * radius), int(cy + math.sin(mid) * radius),
                        int(lx), int(ly), (255, 255, 255), alpha=0.35)
            label = f"{_clip(str(labels[index]) if index < len(labels) else '', 16)} {pct}"
            tx = lx - (text_width(label, 1) if align_right else 0) + (2 if align_right else 0)
            canvas.text(int(tx), int(ly) - 4, label, (220, 226, 240), 1)
        angle += sweep

    if donut:
        canvas.text_centered(int(cx), int(cy) - 12, spec.title if spec.title else "Total",
                             (248, 249, 250), 2)
        canvas.text_centered(int(cx), int(cy) + 14, f"{total:g}", (0, 180, 216), 2)
    else:
        canvas.text_centered(int(cx), 30, spec.title, (248, 249, 250), 2)


def _wedge(canvas: Canvas, cx: float, cy: float, radius: float,
           start: float, end: float, colour: RGB, inner: float = 0) -> None:
    """Fill an annular sector between two angles (radians)."""
    box = int(radius) + 1
    for dy in range(-box, box + 1):
        for dx in range(-box, box + 1):
            distance = math.hypot(dx, dy)
            if distance > radius or distance < inner:
                continue
            theta = math.atan2(dy, dx)
            if start <= theta <= end or start <= theta + math.tau <= end:
                canvas.set_pixel(int(cx + dx), int(cy + dy), colour)


# --- Radar -------------------------------------------------------------------------

def _render_radar(canvas: Canvas, spec: ChartSpec) -> None:
    width, height = canvas.width, canvas.height
    cx, cy = width / 2 + 20, height / 2 + 24
    radius = min(height * 0.34, width * 0.32)
    k = len(spec.labels)
    if k < 3:
        raise ValueError("Radar charts need at least three axis labels.")
    lo = min(v for s in spec.series for v in s.values)
    hi = max(v for s in spec.series for v in s.values)
    lo, hi = min(0, lo), max(1, hi)

    # Grid rings.
    for ring in range(1, 5):
        r = radius * ring / 4
        points = [(int(cx + r * math.cos(i * math.tau / k - math.pi / 2)),
                   int(cy + r * math.sin(i * math.tau / k - math.pi / 2)))
                  for i in range(k)]
        for a, b in zip(points, points[1:] + points[:1]):
            canvas.line(a[0], a[1], b[0], b[1], (255, 255, 255), alpha=0.1)
        canvas.text(int(cx) + 4, int(cy - r) + 2, f"{lo + (hi - lo) * ring / 4:g}",
                    (150, 158, 178), 1)

    # Axis spokes + labels.
    for i, label in enumerate(spec.labels):
        theta = i * math.tau / k - math.pi / 2
        canvas.line(int(cx), int(cy),
                    int(cx + radius * math.cos(theta)), int(cy + radius * math.sin(theta)),
                    (255, 255, 255), alpha=0.14)
        lx = cx + (radius + 24) * math.cos(theta)
        ly = cy + (radius + 24) * math.sin(theta)
        canvas.text_centered(int(lx), int(ly) - 4, _clip(str(label), 12), (200, 206, 220), 1)

    # Series polygons.
    legend_x = 40
    for index, series in enumerate(spec.series):
        colour = _series_color(series, index)
        points = []
        for i in range(k):
            value = series.values[i] if i < len(series.values) else 0
            t = (value - lo) / (hi - lo) if hi > lo else 0.5
            theta = i * math.tau / k - math.pi / 2
            points.append((int(cx + radius * t * math.cos(theta)),
                           int(cy + radius * t * math.sin(theta))))
        for a, b in zip(points, points[1:] + points[:1]):
            canvas.line(a[0], a[1], b[0], b[1], colour, 2)
        for px, py in points:
            canvas.disc(px, py, 3, colour)
        canvas.text(legend_x, 24, f"● {_clip(series.name, 22)}", colour, 1)
        legend_x += text_width(f"● {_clip(series.name, 22)}", 1) + 24


def build(
    spec: ChartSpec,
    *,
    kind: str = "line",
    width: int = 960,
    height: int = 560,
) -> tuple[bytes, dict]:
    """Render a chart to PNG bytes. Returns ``(png_bytes, meta)``."""
    canvas = render(spec, kind=kind, width=width, height=height)
    meta = {
        "kind": kind,
        "series": [s.name for s in spec.series],
        "points": [len(s.values) for s in spec.series],
        "labels": len(spec.labels),
        "width": width,
        "height": height,
    }
    return canvas.to_png(), meta


__all__ = ["KINDS", "ChartSeries", "ChartSpec", "render", "build"]

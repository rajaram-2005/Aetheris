"""A dependency-free RGB raster canvas plus PNG and animated-GIF encoders.

Aetheris generates real image and video files without Pillow, ImageMagick, or
ffmpeg — only the standard library. That keeps image generation available in
every deployment (including the offline mock provider) instead of degrading to
a "not configured" message.

Contents:

* :class:`Canvas` — an RGB pixel buffer with the drawing primitives the
  generators need (fills, gradients, shapes, the bitmap font, alpha blending).
* :func:`encode_png` — a spec-compliant PNG encoder (filter type 0 + zlib).
* :func:`encode_gif` — an animated GIF89a encoder with real LZW compression,
  used to deliver generated video as a universally playable file.
"""

from __future__ import annotations

import math
import struct
import zlib
from dataclasses import dataclass

from .font import GLYPH_HEIGHT, GLYPH_WIDTH, glyph

RGB = tuple[int, int, int]


def clamp(value: float, low: float = 0.0, high: float = 255.0) -> int:
    """Clamp a channel value into ``[low, high]`` as an int."""
    return int(max(low, min(high, value)))


def hex_to_rgb(value: str) -> RGB:
    """Parse ``#rrggbb`` (or ``rrggbb`` / ``#rgb``) into an RGB triple."""
    text = value.strip().lstrip("#")
    if len(text) == 3:
        text = "".join(c * 2 for c in text)
    if len(text) != 6:
        raise ValueError(f"'{value}' is not a valid hex colour.")
    try:
        return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))
    except ValueError as exc:
        raise ValueError(f"'{value}' is not a valid hex colour.") from exc


def mix(a: RGB, b: RGB, t: float) -> RGB:
    """Linearly interpolate between two colours (``t`` in ``[0, 1]``)."""
    t = max(0.0, min(1.0, t))
    return (
        clamp(a[0] + (b[0] - a[0]) * t),
        clamp(a[1] + (b[1] - a[1]) * t),
        clamp(a[2] + (b[2] - a[2]) * t),
    )


def luminance(color: RGB) -> float:
    """Perceived brightness in ``[0, 1]`` (Rec. 601 weighting)."""
    return (0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]) / 255.0


def readable_on(background: RGB) -> RGB:
    """Pick near-black or near-white text for contrast against ``background``."""
    return (14, 18, 30) if luminance(background) > 0.55 else (248, 249, 250)


@dataclass
class Canvas:
    """A mutable RGB raster image."""

    width: int
    height: int
    pixels: bytearray

    def __init__(self, width: int, height: int, background: RGB = (0, 0, 0)) -> None:
        if width <= 0 or height <= 0:
            raise ValueError("Canvas dimensions must be positive.")
        self.width = width
        self.height = height
        self.pixels = bytearray(bytes(background) * (width * height))

    # --- Pixel access ---------------------------------------------------------

    def set_pixel(self, x: int, y: int, color: RGB) -> None:
        """Write one pixel, ignoring out-of-bounds writes."""
        if 0 <= x < self.width and 0 <= y < self.height:
            offset = (y * self.width + x) * 3
            self.pixels[offset : offset + 3] = bytes(color)

    def get_pixel(self, x: int, y: int) -> RGB:
        """Read one pixel (clamped to the canvas edge)."""
        x = max(0, min(self.width - 1, x))
        y = max(0, min(self.height - 1, y))
        offset = (y * self.width + x) * 3
        return (self.pixels[offset], self.pixels[offset + 1], self.pixels[offset + 2])

    def blend_pixel(self, x: int, y: int, color: RGB, alpha: float) -> None:
        """Alpha-composite ``color`` over the existing pixel.

        This is the hottest path in the renderer, so the buffer arithmetic is
        inlined rather than delegated to ``get_pixel``/``set_pixel``/``mix``.
        """
        if alpha <= 0 or x < 0 or y < 0 or x >= self.width or y >= self.height:
            return
        offset = (y * self.width + x) * 3
        pixels = self.pixels
        if alpha >= 1:
            pixels[offset] = color[0]
            pixels[offset + 1] = color[1]
            pixels[offset + 2] = color[2]
            return
        inverse = 1.0 - alpha
        pixels[offset] = int(pixels[offset] * inverse + color[0] * alpha)
        pixels[offset + 1] = int(pixels[offset + 1] * inverse + color[1] * alpha)
        pixels[offset + 2] = int(pixels[offset + 2] * inverse + color[2] * alpha)

    # --- Fills ----------------------------------------------------------------

    def fill(self, color: RGB) -> None:
        """Flood the whole canvas with one colour."""
        self.pixels = bytearray(bytes(color) * (self.width * self.height))

    def linear_gradient(self, start: RGB, end: RGB, angle: float = 90.0) -> None:
        """Fill with a linear gradient at ``angle`` degrees (90 = top→bottom).

        Touches every pixel, so colours are precomputed into a 256-entry ramp and
        the row is built as a bytes buffer instead of per-pixel method calls.
        """
        radians = math.radians(angle)
        dx, dy = math.cos(radians), math.sin(radians)
        extent = abs(dx) * self.width + abs(dy) * self.height or 1.0
        origin_x = self.width if dx < 0 else 0
        origin_y = self.height if dy < 0 else 0

        ramp = [bytes(mix(start, end, i / 255.0)) for i in range(256)]
        pixels = self.pixels
        for y in range(self.height):
            row = bytearray()
            base = (y - origin_y) * dy
            for x in range(self.width):
                t = abs(((x - origin_x) * dx + base) / extent)
                row += ramp[255 if t >= 1.0 else int(t * 255)]
            offset = y * self.width * 3
            pixels[offset : offset + len(row)] = row

    def radial_gradient(
        self, inner: RGB, outer: RGB, cx: float | None = None, cy: float | None = None
    ) -> None:
        """Fill with a radial gradient centred at ``(cx, cy)``."""
        cx = self.width / 2 if cx is None else cx
        cy = self.height / 2 if cy is None else cy
        longest = math.hypot(max(cx, self.width - cx), max(cy, self.height - cy)) or 1.0

        ramp = [bytes(mix(inner, outer, i / 255.0)) for i in range(256)]
        pixels = self.pixels
        for y in range(self.height):
            row = bytearray()
            dy2 = (y - cy) ** 2
            for x in range(self.width):
                t = math.sqrt((x - cx) ** 2 + dy2) / longest
                row += ramp[255 if t >= 1.0 else int(t * 255)]
            offset = y * self.width * 3
            pixels[offset : offset + len(row)] = row

    # --- Shapes ---------------------------------------------------------------

    def rect(self, x: int, y: int, w: int, h: int, color: RGB, alpha: float = 1.0) -> None:
        """Draw a filled rectangle."""
        for py in range(max(0, y), min(self.height, y + h)):
            for px in range(max(0, x), min(self.width, x + w)):
                self.blend_pixel(px, py, color, alpha)

    def rect_outline(
        self, x: int, y: int, w: int, h: int, color: RGB, thickness: int = 1, alpha: float = 1.0
    ) -> None:
        """Draw a rectangle outline of the given thickness."""
        for i in range(thickness):
            self.hline(x, x + w - 1, y + i, color, alpha)
            self.hline(x, x + w - 1, y + h - 1 - i, color, alpha)
            self.vline(x + i, y, y + h - 1, color, alpha)
            self.vline(x + w - 1 - i, y, y + h - 1, color, alpha)

    def rounded_rect(
        self, x: int, y: int, w: int, h: int, radius: int, color: RGB, alpha: float = 1.0
    ) -> None:
        """Draw a filled rectangle with antialiased rounded corners."""
        radius = max(0, min(radius, w // 2, h // 2))
        for py in range(max(0, y), min(self.height, y + h)):
            for px in range(max(0, x), min(self.width, x + w)):
                # Distance into the nearest corner's circle, if any.
                dx = min(px - (x + radius), 0) or max(px - (x + w - 1 - radius), 0)
                dy = min(py - (y + radius), 0) or max(py - (y + h - 1 - radius), 0)
                if dx or dy:
                    distance = math.hypot(dx, dy)
                    if distance > radius:
                        continue
                    edge = min(1.0, max(0.0, radius - distance))
                    self.blend_pixel(px, py, color, alpha * edge)
                else:
                    self.blend_pixel(px, py, color, alpha)

    def hline(self, x0: int, x1: int, y: int, color: RGB, alpha: float = 1.0) -> None:
        """Draw a horizontal line."""
        for x in range(min(x0, x1), max(x0, x1) + 1):
            self.blend_pixel(x, y, color, alpha)

    def vline(self, x: int, y0: int, y1: int, color: RGB, alpha: float = 1.0) -> None:
        """Draw a vertical line."""
        for y in range(min(y0, y1), max(y0, y1) + 1):
            self.blend_pixel(x, y, color, alpha)

    def line(
        self, x0: int, y0: int, x1: int, y1: int, color: RGB, thickness: int = 1, alpha: float = 1.0
    ) -> None:
        """Draw a line with Bresenham's algorithm."""
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        while True:
            if thickness <= 1:
                self.blend_pixel(x0, y0, color, alpha)
            else:
                self.disc(x0, y0, thickness / 2, color, alpha)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def disc(self, cx: float, cy: float, radius: float, color: RGB, alpha: float = 1.0) -> None:
        """Draw a filled, antialiased circle."""
        if radius <= 0:
            return
        for y in range(int(cy - radius) - 1, int(cy + radius) + 2):
            for x in range(int(cx - radius) - 1, int(cx + radius) + 2):
                distance = math.hypot(x - cx, y - cy)
                if distance <= radius - 0.5:
                    self.blend_pixel(x, y, color, alpha)
                elif distance <= radius + 0.5:
                    # Feather the boundary pixel for a smooth edge.
                    self.blend_pixel(x, y, color, alpha * (radius + 0.5 - distance))

    def ring(
        self, cx: float, cy: float, radius: float, thickness: float, color: RGB, alpha: float = 1.0
    ) -> None:
        """Draw a circular outline."""
        outer, inner = radius + thickness / 2, radius - thickness / 2
        for y in range(int(cy - outer) - 1, int(cy + outer) + 2):
            for x in range(int(cx - outer) - 1, int(cx + outer) + 2):
                distance = math.hypot(x - cx, y - cy)
                if inner - 0.5 <= distance <= outer + 0.5:
                    edge = min(1.0, outer + 0.5 - distance, distance - inner + 0.5)
                    self.blend_pixel(x, y, color, alpha * max(0.0, min(1.0, edge)))

    def soft_blobs(
        self,
        blobs: list[tuple[float, float, float, RGB, float]],
        divisor: int = 8,
    ) -> None:
        """Composite large, soft colour blobs (a "mesh gradient") efficiently.

        Stacking big feathered discs pixel-by-pixel is the single most expensive
        thing this renderer can do — a 500px-radius blob touches ~800k pixels.
        Because the result is smooth by construction, the field is evaluated on a
        grid reduced by ``divisor`` and then bilinearly upsampled, which is
        visually indistinguishable and roughly two orders of magnitude cheaper.

        Args:
            blobs: ``(cx, cy, radius, colour, strength)`` tuples.
            divisor: Downsampling factor for the low-resolution field.
        """
        if not blobs:
            return
        divisor = max(1, divisor)
        lw = max(2, self.width // divisor + 2)
        lh = max(2, self.height // divisor + 2)

        # Accumulate weighted colour and total weight on the coarse grid.
        acc_r = [0.0] * (lw * lh)
        acc_g = [0.0] * (lw * lh)
        acc_b = [0.0] * (lw * lh)
        acc_w = [0.0] * (lw * lh)

        for cx, cy, radius, color, strength in blobs:
            if radius <= 0 or strength <= 0:
                continue
            lcx, lcy, lr = cx / divisor, cy / divisor, radius / divisor
            x0, x1 = max(0, int(lcx - lr)), min(lw - 1, int(lcx + lr) + 1)
            y0, y1 = max(0, int(lcy - lr)), min(lh - 1, int(lcy + lr) + 1)
            inv = 1.0 / (lr * lr) if lr else 0.0
            cr, cg, cb = color
            for gy in range(y0, y1 + 1):
                dy2 = (gy - lcy) ** 2
                row = gy * lw
                for gx in range(x0, x1 + 1):
                    d2 = (gx - lcx) ** 2 + dy2
                    if d2 >= lr * lr:
                        continue
                    # Smooth quadratic falloff to a zero edge.
                    falloff = (1.0 - d2 * inv) ** 2 * strength
                    index = row + gx
                    acc_r[index] += cr * falloff
                    acc_g[index] += cg * falloff
                    acc_b[index] += cb * falloff
                    acc_w[index] += falloff

        pixels = self.pixels
        for y in range(self.height):
            fy = y / divisor
            gy0 = min(lh - 1, int(fy))
            gy1 = min(lh - 1, gy0 + 1)
            wy = fy - gy0
            row0, row1 = gy0 * lw, gy1 * lw
            base = y * self.width * 3
            for x in range(self.width):
                fx = x / divisor
                gx0 = min(lw - 1, int(fx))
                gx1 = min(lw - 1, gx0 + 1)
                wx = fx - gx0

                # Bilinear sample of the accumulated weight and colour.
                i00, i01 = row0 + gx0, row0 + gx1
                i10, i11 = row1 + gx0, row1 + gx1
                w = (
                    acc_w[i00] * (1 - wx) * (1 - wy) + acc_w[i01] * wx * (1 - wy)
                    + acc_w[i10] * (1 - wx) * wy + acc_w[i11] * wx * wy
                )
                if w <= 0.001:
                    continue
                r = (
                    acc_r[i00] * (1 - wx) * (1 - wy) + acc_r[i01] * wx * (1 - wy)
                    + acc_r[i10] * (1 - wx) * wy + acc_r[i11] * wx * wy
                ) / w
                g = (
                    acc_g[i00] * (1 - wx) * (1 - wy) + acc_g[i01] * wx * (1 - wy)
                    + acc_g[i10] * (1 - wx) * wy + acc_g[i11] * wx * wy
                ) / w
                b = (
                    acc_b[i00] * (1 - wx) * (1 - wy) + acc_b[i01] * wx * (1 - wy)
                    + acc_b[i10] * (1 - wx) * wy + acc_b[i11] * wx * wy
                ) / w

                alpha = w if w < 1.0 else 1.0
                inverse = 1.0 - alpha
                offset = base + x * 3
                pixels[offset] = clamp(pixels[offset] * inverse + r * alpha)
                pixels[offset + 1] = clamp(pixels[offset + 1] * inverse + g * alpha)
                pixels[offset + 2] = clamp(pixels[offset + 2] * inverse + b * alpha)

    # --- Text -----------------------------------------------------------------

    def text(
        self,
        x: int,
        y: int,
        content: str,
        color: RGB,
        scale: int = 1,
        tracking: int = 1,
        alpha: float = 1.0,
    ) -> int:
        """Draw a single line of bitmap text; returns the x cursor after it."""
        cursor = x
        for char in content:
            bitmap = glyph(char)
            for row in range(GLYPH_HEIGHT):
                for col in range(GLYPH_WIDTH):
                    if not bitmap[row][col]:
                        continue
                    for sy in range(scale):
                        for sx in range(scale):
                            self.blend_pixel(
                                cursor + col * scale + sx, y + row * scale + sy, color, alpha
                            )
            cursor += (GLYPH_WIDTH + tracking) * scale
        return cursor

    def text_centered(
        self, cx: int, y: int, content: str, color: RGB, scale: int = 1, alpha: float = 1.0
    ) -> None:
        """Draw text horizontally centred on ``cx``."""
        from .font import text_width

        self.text(cx - text_width(content, scale) // 2, y, content, color, scale, alpha=alpha)

    # --- Export ---------------------------------------------------------------

    def to_png(self, compression: int = 6) -> bytes:
        """Encode this canvas as a PNG file."""
        return encode_png(self.width, self.height, bytes(self.pixels), compression)

    def copy(self) -> "Canvas":
        """Return an independent duplicate of this canvas."""
        clone = Canvas(self.width, self.height)
        clone.pixels = bytearray(self.pixels)
        return clone


# --- PNG ----------------------------------------------------------------------


def _chunk(tag: bytes, payload: bytes) -> bytes:
    """Build one PNG chunk: length, type, payload, CRC32."""
    return (
        struct.pack(">I", len(payload))
        + tag
        + payload
        + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
    )


def encode_png(width: int, height: int, rgb: bytes, compression: int = 6) -> bytes:
    """Encode raw RGB bytes as a PNG.

    Uses filter type 0 (None) on every scanline: the drawings Aetheris produces
    are flat-shaded and gradient-heavy, where the added complexity of adaptive
    filtering buys little over zlib's own matching.
    """
    stride = width * 3
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type: None
        raw += rgb[y * stride : (y + 1) * stride]

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit truecolour
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(bytes(raw), compression))
        + _chunk(b"IEND", b"")
    )


# --- GIF ----------------------------------------------------------------------


def _quantize(frames: list[Canvas], max_colors: int = 256) -> tuple[list[RGB], list[bytes]]:
    """Build a shared palette and map every frame onto it.

    Uses a uniform 6x7x6 RGB lattice (252 entries) rather than median-cut: it is
    deterministic, fast in pure Python, and well suited to the synthetic
    gradients and flat panels these generators produce.
    """
    levels_r, levels_g, levels_b = 6, 7, 6
    palette: list[RGB] = []
    for r in range(levels_r):
        for g in range(levels_g):
            for b in range(levels_b):
                palette.append(
                    (
                        round(r * 255 / (levels_r - 1)),
                        round(g * 255 / (levels_g - 1)),
                        round(b * 255 / (levels_b - 1)),
                    )
                )
    palette = palette[:max_colors]
    while len(palette) < max_colors:
        palette.append((0, 0, 0))

    indexed: list[bytes] = []
    for frame in frames:
        buffer = bytearray(frame.width * frame.height)
        pixels = frame.pixels
        for i in range(frame.width * frame.height):
            r, g, b = pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2]
            ri = round(r * (levels_r - 1) / 255)
            gi = round(g * (levels_g - 1) / 255)
            bi = round(b * (levels_b - 1) / 255)
            buffer[i] = ri * levels_g * levels_b + gi * levels_b + bi
        indexed.append(bytes(buffer))
    return palette, indexed


def _lzw_compress(data: bytes, min_code_size: int) -> bytes:
    """GIF-flavoured LZW compression (variable code width, with clear codes)."""
    clear_code = 1 << min_code_size
    end_code = clear_code + 1
    code_size = min_code_size + 1
    next_code = end_code + 1
    table: dict[bytes, int] = {bytes([i]): i for i in range(clear_code)}

    out = bytearray()
    bit_buffer = 0
    bit_count = 0

    def emit(code: int) -> None:
        nonlocal bit_buffer, bit_count
        bit_buffer |= code << bit_count
        bit_count += code_size
        while bit_count >= 8:
            out.append(bit_buffer & 0xFF)
            bit_buffer >>= 8
            bit_count -= 8

    emit(clear_code)
    current = b""
    for byte in data:
        candidate = current + bytes([byte])
        if candidate in table:
            current = candidate
            continue
        emit(table[current])
        table[candidate] = next_code
        next_code += 1
        if next_code > (1 << code_size):
            if code_size < 12:
                code_size += 1
            else:
                # Dictionary is full: reset so decoders stay in sync.
                emit(clear_code)
                table = {bytes([i]): i for i in range(clear_code)}
                next_code = end_code + 1
                code_size = min_code_size + 1
        current = bytes([byte])

    if current:
        emit(table[current])
    emit(end_code)
    if bit_count:
        out.append(bit_buffer & 0xFF)

    # Split the stream into GIF sub-blocks of at most 255 bytes.
    blocked = bytearray()
    for i in range(0, len(out), 255):
        piece = out[i : i + 255]
        blocked.append(len(piece))
        blocked += piece
    blocked.append(0)
    return bytes(blocked)


def encode_gif(frames: list[Canvas], delay_cs: int = 8, loop: bool = True) -> bytes:
    """Encode canvases as an animated GIF89a.

    Args:
        frames: One or more equally sized canvases.
        delay_cs: Inter-frame delay in centiseconds (``8`` ≈ 12.5 fps).
        loop: Whether the animation loops forever.
    """
    if not frames:
        raise ValueError("At least one frame is required.")
    width, height = frames[0].width, frames[0].height
    if any(f.width != width or f.height != height for f in frames):
        raise ValueError("All frames must share the same dimensions.")

    palette, indexed = _quantize(frames)
    out = bytearray(b"GIF89a")
    # Logical screen descriptor: global colour table, 8 bits per channel, 256 entries.
    out += struct.pack("<HHBBB", width, height, 0xF7, 0, 0)
    for color in palette:
        out += bytes(color)

    if loop:
        # NETSCAPE2.0 application extension = infinite loop.
        out += b"\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00"

    for frame in indexed:
        out += b"\x21\xf9\x04\x04" + struct.pack("<H", max(2, delay_cs)) + b"\x00\x00"
        out += b"\x2c" + struct.pack("<HHHHB", 0, 0, width, height, 0)
        out += bytes([8]) + _lzw_compress(frame, 8)

    out += b"\x3b"
    return bytes(out)


__all__ = [
    "RGB",
    "Canvas",
    "encode_png",
    "encode_gif",
    "hex_to_rgb",
    "mix",
    "clamp",
    "luminance",
    "readable_on",
]

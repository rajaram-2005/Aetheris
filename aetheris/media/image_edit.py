"""Offline image editing — real pixel operations, no dependencies.

Aetheris generates PNGs in-process, so it can also *edit* them in-process:
this module decodes the PNG subset Aetheris itself emits (8-bit RGB/RGBA,
non-interlaced, zlib), applies a pixel-level operation, and re-encodes. Every
operation is deterministic and works without Pillow or any native image
library — the same offline-first rule the generators follow.

Operations
----------

===========================  ==================================================
``grayscale``                luma conversion (Rec. 601)
``sepia``                    warm archival tone curve
``invert``                   channel inversion (negative)
``brightness``               ±1 around neutral at ``strength`` 0.5
``contrast``                 ±1 around neutral at ``strength`` 0.5
``saturate``                 ±1 around neutral at ``strength`` 0.5
``blur``                     separable box blur, radius scales with strength
``sharpen``                  unsharp mask (blur is subtracted back out)
``pixelate``                 block averaging, block size scales with strength
``posterize``                quantise each channel to fewer levels
``duotone``                  map luma onto a named palette's dark→light ramp
``vignette``                 darken the corners, strength-scaled
===========================  ==================================================

JPEG artifacts cannot be decoded without a native library, so editing them
raises a clear error instead of silently failing.
"""

from __future__ import annotations

import math
import random
import struct
import zlib

from .canvas import RGB, encode_png, hex_to_rgb, mix
from .images import PALETTES, choose_palette

OPERATIONS: tuple[str, ...] = (
    "grayscale", "sepia", "invert", "brightness", "contrast", "saturate",
    "blur", "sharpen", "pixelate", "posterize", "duotone", "vignette",
    "flip_h", "flip_v", "rotate90", "emboss", "grain",
)

# Rec. 601 luma weights, as integers over 1000 for exact LUT math.
_LUMA_R, _LUMA_G, _LUMA_B = 299, 587, 114


# --- PNG decoding (the subset Aetheris emits) ---------------------------------

def decode_png(data: bytes) -> tuple[int, int, bytearray]:
    """Decode an 8-bit non-interlaced RGB/RGBA PNG into ``(w, h, rgb)``.

    Supports every scanline filter, which together with zlib covers all
    PNGs produced by :meth:`Canvas.to_png` and the vast majority of PNGs
    from upstream image providers.
    """
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Editing supports PNG artifacts; this is not a PNG file.")

    width = height = 0
    color_type = interlace = 0
    idat = bytearray()
    offset = 8
    while offset + 8 <= len(data):
        length, tag = struct.unpack(">I4s", data[offset : offset + 8])
        payload = data[offset + 8 : offset + 8 + length]
        offset += 12 + length
        if tag == b"IHDR":
            width, height, depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", payload)
            if depth != 8:
                raise ValueError(f"Editing supports 8-bit PNGs; this is {depth}-bit.")
            if color_type not in (2, 6):
                raise ValueError(
                    "Editing supports RGB PNGs; this uses a palette or "
                    "grayscale encoding."
                )
            if interlace != 0:
                raise ValueError("Editing does not support interlaced PNGs.")
        elif tag == b"IDAT":
            idat.extend(payload)
        elif tag == b"IEND":
            break
    if not width or not height:
        raise ValueError("Malformed PNG: missing image header.")

    channels = 3 if color_type == 2 else 4
    bpp = channels
    stride = width * bpp
    raw = zlib.decompress(bytes(idat))
    expected = (stride + 1) * height
    if len(raw) < expected:
        raise ValueError("Malformed PNG: truncated pixel data.")

    out = bytearray(stride * height)
    prev = bytearray(stride)
    pos = 0
    for y in range(height):
        filter_type = raw[pos]
        pos += 1
        line = bytearray(raw[pos : pos + stride])
        pos += stride
        if filter_type == 1:  # Sub
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif filter_type == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif filter_type == 3:  # Average
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif filter_type == 4:  # Paeth
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                predictor = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + predictor) & 0xFF
        elif filter_type != 0:
            raise ValueError(f"Malformed PNG: unknown filter {filter_type}.")
        out[y * stride : (y + 1) * stride] = line
        prev = line

    if channels == 3:
        return width, height, out
    # Drop the alpha plane (Aetheris renders are opaque).
    rgb = bytearray(stride * height // 4 * 3)
    for y in range(height):
        row = y * stride
        dst = y * width * 3
        for x in range(width):
            src = row + x * 4
            rgb[dst : dst + 3] = out[src : src + 3]
            dst += 3
    return width, height, rgb


# --- Helpers -------------------------------------------------------------------

def _lut(fn) -> bytes:
    """Build a 256-entry per-byte translation table."""
    return bytes(max(0, min(255, int(fn(v)))) for v in range(256))


def _channels(rgb: bytearray, width: int, height: int) -> list[bytearray]:
    return [bytearray(rgb[i::3]) for i in range(3)]


def _merge(channels: list[bytearray]) -> bytearray:
    out = bytearray(len(channels[0]) * 3)
    for c, channel in enumerate(channels):
        out[c::3] = channel
    return out


def _box_blur(channel: bytearray, width: int, height: int, radius: int) -> bytearray:
    """Separable box blur over one channel using running-window sums.

    The window for output position ``x`` spans ``[x - radius, x + radius]``
    clamped to the image, so edge samples are duplicated rather than
    darkened — the divisor always matches the accumulated count.
    """
    if radius < 1:
        return channel

    def _span(pos: int, limit: int) -> tuple[int, int]:
        return max(0, pos - radius), min(limit - 1, pos + radius)

    temp = bytearray(len(channel))
    # Horizontal pass. The window is the plain (clamped) span — each sample
    # counted once — so sliding adds a sample only when a new column truly
    # enters, and drops one only when an old column truly leaves.
    for y in range(height):
        row = y * width
        lo, hi = _span(0, width)
        window = sum(channel[row + i] for i in range(lo, hi + 1))
        for x in range(width):
            temp[row + x] = window // (hi - lo + 1)
            if x + 1 < width:
                entering = x + 1 + radius
                if entering <= width - 1:
                    window += channel[row + entering]
                leaving = x - radius
                if leaving >= 0:
                    window -= channel[row + leaving]
                lo, hi = _span(x + 1, width)

    out = bytearray(len(channel))
    # Vertical pass, same sliding rule.
    for x in range(width):
        lo, hi = _span(0, height)
        window = sum(temp[i * width + x] for i in range(lo, hi + 1))
        for y in range(height):
            out[y * width + x] = window // (hi - lo + 1)
            if y + 1 < height:
                entering = y + 1 + radius
                if entering <= height - 1:
                    window += temp[entering * width + x]
                leaving = y - radius
                if leaving >= 0:
                    window -= temp[leaving * width + x]
                lo, hi = _span(y + 1, height)
    return out


# --- Operations ----------------------------------------------------------------

def _op_grayscale(rgb, width, height, strength):
    # Luma is a weighted channel sum; per-channel LUTs keep the loop cheap.
    tr = _lut(lambda v: (v * _LUMA_R) // 1000)
    tg = _lut(lambda v: (v * _LUMA_G) // 1000)
    tb = _lut(lambda v: (v * _LUMA_B) // 1000)
    yr = bytes(rgb[0::3]).translate(tr)
    yg = bytes(rgb[1::3]).translate(tg)
    yb = bytes(rgb[2::3]).translate(tb)
    out = bytearray(len(rgb))
    for i, (r, g, b) in enumerate(zip(yr, yg, yb)):
        y = min(255, r + g + b)
        out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = y
    return out


def _op_sepia(rgb, width, height, strength):
    amount = 0.4 + 0.6 * strength
    out = bytearray(len(rgb))
    for i in range(0, len(rgb), 3):
        r, g, b = rgb[i], rgb[i + 1], rgb[i + 2]
        sr = min(255, (r * 393 + g * 769 + b * 189) // 1000)
        sg = min(255, (r * 349 + g * 686 + b * 168) // 1000)
        sb = min(255, (r * 272 + g * 534 + b * 131) // 1000)
        out[i] = int(r + (sr - r) * amount)
        out[i + 1] = int(g + (sg - g) * amount)
        out[i + 2] = int(b + (sb - b) * amount)
    return out


def _op_invert(rgb, width, height, strength):
    return rgb.translate(_lut(lambda v: 255 - v))


def _op_brightness(rgb, width, height, strength):
    delta = (strength - 0.5) * 510  # -255..255
    return rgb.translate(_lut(lambda v: v + delta))


def _op_contrast(rgb, width, height, strength):
    factor = max(0.1, 0.5 + strength * 3.0)  # 0.6x .. 3.5x
    return rgb.translate(_lut(lambda v: (v - 128) * factor + 128))


def _op_saturate(rgb, width, height, strength):
    delta = (strength - 0.5) * 2.0  # -1 (gray) .. +1 (boosted)
    out = bytearray(len(rgb))
    for i in range(0, len(rgb), 3):
        r, g, b = rgb[i], rgb[i + 1], rgb[i + 2]
        luma = (r * _LUMA_R + g * _LUMA_G + b * _LUMA_B) // 1000
        out[i] = max(0, min(255, int(luma + (r - luma) * (1 + delta))))
        out[i + 1] = max(0, min(255, int(luma + (g - luma) * (1 + delta))))
        out[i + 2] = max(0, min(255, int(luma + (b - luma) * (1 + delta))))
    return out


def _op_blur(rgb, width, height, strength):
    radius = max(1, round(1 + strength * 7))
    blurred = [_box_blur(c, width, height, radius) for c in _channels(rgb, width, height)]
    return _merge(blurred)


def _op_sharpen(rgb, width, height, strength):
    amount = strength * 2.5
    soft = [_box_blur(c, width, height, 2) for c in _channels(rgb, width, height)]
    out = bytearray(len(rgb))
    for i in range(len(out)):
        base = rgb[i]
        out[i] = max(0, min(255, int(base + (base - soft[i % 3][i // 3]) * amount)))
    return out


def _op_pixelate(rgb, width, height, strength):
    block = max(2, round(2 + strength * 30))
    out = bytearray(len(rgb))
    for by in range(0, height, block):
        for bx in range(0, width, block):
            x2, y2 = min(bx + block, width), min(by + block, height)
            count = (x2 - bx) * (y2 - by)
            sums = [0, 0, 0]
            for y in range(by, y2):
                row = y * width * 3
                for x in range(bx, x2):
                    o = row + x * 3
                    sums[0] += rgb[o]
                    sums[1] += rgb[o + 1]
                    sums[2] += rgb[o + 2]
            means = bytes(s // count for s in sums)
            for y in range(by, y2):
                row = y * width * 3
                for x in range(bx, x2):
                    o = row + x * 3
                    out[o : o + 3] = means
    return out


def _op_posterize(rgb, width, height, strength):
    levels = max(2, round(2 + (1.0 - strength) * 12))
    if levels >= 255:
        return bytes(rgb)
    step = 255.0 / (levels - 1)
    return rgb.translate(_lut(lambda v: int(round(v / step) * step)))


def _op_duotone(rgb, width, height, strength, palette_name=None):
    name, colors = choose_palette("", palette_name or "aetheris")
    dark, light = colors[1], colors[-1]
    out = bytearray(len(rgb))
    for i in range(0, len(rgb), 3):
        r, g, b = rgb[i], rgb[i + 1], rgb[i + 2]
        t = min(1.0, ((r * _LUMA_R + g * _LUMA_G + b * _LUMA_B) // 1000) / 255)
        tone: RGB = mix(dark, light, t)
        out[i], out[i + 1], out[i + 2] = tone
    return out


def _op_vignette(rgb, width, height, strength):
    power = 0.2 + strength * 0.8
    cx, cy = width / 2, height / 2
    longest = math.hypot(cx, cy)
    out = bytearray(rgb)
    for y in range(height):
        dy2 = (y - cy) ** 2
        row = y * width * 3
        for x in range(width):
            t = math.sqrt((x - cx) ** 2 + dy2) / longest
            if t <= 0.55:
                continue
            keep = max(0.0, 1.0 - (t - 0.55) * power)
            o = row + x * 3
            out[o] = int(out[o] * keep)
            out[o + 1] = int(out[o + 1] * keep)
            out[o + 2] = int(out[o + 2] * keep)
    return out




def _op_flip_h(rgb, width, height, strength):
    """Mirror left-to-right (``strength`` is ignored)."""
    out = bytearray(len(rgb))
    for y in range(height):
        src_row = y * width * 3
        dst_row = src_row
        for x in range(width):
            src = src_row + x * 3
            dst = dst_row + (width - 1 - x) * 3
            out[dst : dst + 3] = rgb[src : src + 3]
    return out


def _op_flip_v(rgb, width, height, strength):
    """Mirror top-to-bottom (``strength`` is ignored)."""
    out = bytearray(len(rgb))
    stride = width * 3
    for y in range(height):
        src = y * stride
        dst = (height - 1 - y) * stride
        out[dst : dst + stride] = rgb[src : src + stride]
    return out


def _op_rotate90(rgb, width, height, strength):
    """Rotate 90° clockwise; the canvas becomes ``height``×``width``."""
    out = bytearray(len(rgb))
    for y in range(height):
        src_row = y * width * 3
        for x in range(width):
            src = src_row + x * 3
            dst = ((x * height) + (height - 1 - y)) * 3
            out[dst : dst + 3] = rgb[src : src + 3]
    return out


def _op_emboss(rgb, width, height, strength):
    """3×3 emboss convolution; strength scales the relief factor."""
    factor = 0.5 + strength * 3.5
    out = bytearray(len(rgb))
    row_next = width * 3
    for y in range(1, height - 1):
        row = y * width * 3
        for x in range(1, width - 1):
            o = row + x * 3
            for c in range(3):
                # Bottom-left minus top-right emboss kernel.
                v = rgb[o + row_next - 3 + c] - rgb[o - row_next + 3 + c]
                v = int((v * factor) + 128)
                out[o + c] = max(0, min(255, v))
    return out


def _op_grain(rgb, width, height, strength):
    """Deterministic film grain: seeded per-pixel luminance noise."""
    rng = random.Random(width * 7919 + height)
    amount = strength * 90.0
    if amount <= 0:
        return bytes(rgb)
    out = bytearray(rgb)
    for i in range(0, len(out), 3):
        n = (rng.random() * 2.0 - 1.0) * amount
        for c in range(3):
            out[i + c] = max(0, min(255, int(out[i + c] + n)))
    return out


def upscale(data: bytes, *, scale: int = 2, method: str = "bilinear") -> tuple[bytes, dict]:
    """Enlarge a PNG by an integer factor (2–4), nearest or bilinear.

    Returns ``(png_bytes, detail)`` with the new dimensions.
    """
    if scale not in (2, 3, 4):
        raise ValueError("Scale must be 2, 3, or 4.")
    method = (method or "bilinear").strip().lower()
    if method not in ("nearest", "bilinear"):
        raise ValueError("Method must be 'nearest' or 'bilinear'.")
    width, height, rgb = decode_png(data)
    new_w, new_h = width * scale, height * scale
    out = bytearray(new_w * new_h * 3)
    if method == "nearest":
        for y in range(new_h):
            src_y = y // scale
            src_row = src_y * width * 3
            dst_row = y * new_w * 3
            for x in range(new_w):
                src = src_row + (x // scale) * 3
                dst = dst_row + x * 3
                out[dst : dst + 3] = rgb[src : src + 3]
    else:
        inv = 1.0 / scale
        for y in range(new_h):
            fy = y * inv
            y0, y1 = min(height - 1, int(fy)), min(height - 1, int(fy) + 1)
            wy = fy - int(fy)
            row0, row1 = y0 * width * 3, y1 * width * 3
            dst_row = y * new_w * 3
            for x in range(new_w):
                fx = x * inv
                x0, x1 = min(width - 1, int(fx)), min(width - 1, int(fx) + 1)
                wx = fx - int(fx)
                o00, o01 = row0 + x0 * 3, row0 + x1 * 3
                o10, o11 = row1 + x0 * 3, row1 + x1 * 3
                dst = dst_row + x * 3
                for c in range(3):
                    v = (
                        rgb[o00 + c] * (1 - wx) * (1 - wy)
                        + rgb[o01 + c] * wx * (1 - wy)
                        + rgb[o10 + c] * (1 - wx) * wy
                        + rgb[o11 + c] * wx * wy
                    )
                    out[dst + c] = int(round(v))
    detail = {
        "operation": "upscale",
        "method": method,
        "scale": scale,
        "width": new_w,
        "height": new_h,
        "source_width": width,
        "source_height": height,
    }
    return encode_png(new_w, new_h, out, compression=6), detail


# --- Entry point ----------------------------------------------------------------
def apply(
    data: bytes,
    operation: str,
    *,
    strength: float = 0.5,
    palette: str | None = None,
) -> tuple[bytes, dict]:
    """Apply one operation to PNG bytes. Returns ``(png_bytes, detail)``.

    ``strength`` is always 0–1 with 0.5 neutral where a neutral point exists
    (brightness / contrast / saturate); other operations scale their effect
    with it monotonically.
    """
    key = (operation or "").strip().lower()
    if key not in OPERATIONS:
        raise ValueError(
            f"Unknown operation '{operation}'. Choose one of: {', '.join(OPERATIONS)}."
        )
    strength = max(0.0, min(1.0, float(strength)))
    width, height, rgb = decode_png(data)

    if key == "grayscale":
        result = _op_grayscale(rgb, width, height, strength)
    elif key == "sepia":
        result = _op_sepia(rgb, width, height, strength)
    elif key == "invert":
        result = _op_invert(rgb, width, height, strength)
    elif key == "brightness":
        result = _op_brightness(rgb, width, height, strength)
    elif key == "contrast":
        result = _op_contrast(rgb, width, height, strength)
    elif key == "saturate":
        result = _op_saturate(rgb, width, height, strength)
    elif key == "blur":
        result = _op_blur(rgb, width, height, strength)
    elif key == "sharpen":
        result = _op_sharpen(rgb, width, height, strength)
    elif key == "pixelate":
        result = _op_pixelate(rgb, width, height, strength)
    elif key == "posterize":
        result = _op_posterize(rgb, width, height, strength)
    elif key == "duotone":
        result = _op_duotone(rgb, width, height, strength, palette)
    elif key == "flip_h":
        result = _op_flip_h(rgb, width, height, strength)
    elif key == "flip_v":
        result = _op_flip_v(rgb, width, height, strength)
    elif key == "rotate90":
        result = _op_rotate90(rgb, width, height, strength)
    elif key == "emboss":
        result = _op_emboss(rgb, width, height, strength)
    elif key == "grain":
        result = _op_grain(rgb, width, height, strength)
    else:
        result = _op_vignette(rgb, width, height, strength)

    out_width, out_height = (height, width) if key == "rotate90" else (width, height)
    detail = {
        "operation": key,
        "strength": round(strength, 3),
        "width": out_width,
        "height": out_height,
        **({"palette": palette} if palette else {}),
    }
    return encode_png(out_width, out_height, result, compression=6), detail


__all__ = ["OPERATIONS", "apply", "upscale", "decode_png"]

"""Ambient soundscapes and one-shot sound effects — stereo WAV, fully offline.

Two families of audio, synthesized from noise, filters, and oscillators:

**Soundscapes** (durations up to minutes; generated with decorrelated left and
right channels for real stereo space):

* ``rain``      — filtered noise plus droplet ticks.
* ``wind``      — slow-swept band-passed noise with gusts.
* ``ocean``     — surf: noise with a deep amplitude swell.
* ``fire``      — crackling embers (random impulses over warm noise).
* ``forest``    — breeze with occasional bird chirps (FM sweeps).
* ``night``     — cricket trills and a soft wind bed.
* ``cafe``      — brown-noise murmur, distant clinks.
* ``spaceship`` — a low engine hum with slow LFO beating.

**Sound effects** (one-shots, a few hundred milliseconds to a couple of
seconds): ``laser``, ``coin``, ``powerup``, ``whoosh``, ``explosion``,
``heartbeat``, ``alarm``, ``click``, ``sonar``, ``zap``, ``thunder``.

Everything is additive synthesis over a seeded PRNG — deterministic per seed,
no samples, no network.
"""

from __future__ import annotations

import io
import math
import random
import struct
import wave

SAMPLE_RATE = 44_100

def _stable_seed(text: str) -> int:
    """A process-independent seed so renders are reproducible everywhere."""
    value = 0
    for char in text:
        value = (value * 131 + ord(char)) & 0x7FFFFFFF
    return value or 1


SOUNDSCAPES: tuple[str, ...] = (
    "rain", "wind", "ocean", "fire", "forest", "night", "cafe", "spaceship",
)
SFX: tuple[str, ...] = (
    "laser", "coin", "powerup", "whoosh", "explosion", "heartbeat",
    "alarm", "click", "sonar", "zap", "thunder",
)
KINDS: tuple[str, ...] = SOUNDSCAPES + SFX


# --- Noise and filter primitives ----------------------------------------------------

def _white_noise(length: int, rng: random.Random) -> list[float]:
    return [rng.uniform(-1.0, 1.0) for _ in range(length)]


def _brown_noise(length: int, rng: random.Random) -> list[float]:
    """Brownian noise: random walk with leak, deep and mellow."""
    out: list[float] = []
    value = 0.0
    for _ in range(length):
        value = value * 0.98 + rng.uniform(-1.0, 1.0) * 0.12
        out.append(value * 6.0)
    return out


def _one_pole_lowpass(source: list[float], cutoff: float) -> list[float]:
    """Simple one-pole low-pass (alpha from cutoff)."""
    alpha = max(0.0, min(1.0, cutoff / (cutoff + SAMPLE_RATE)))
    out: list[float] = []
    value = 0.0
    for sample in source:
        value += alpha * (sample - value)
        out.append(value)
    return out


def _one_pole_highpass(source: list[float], cutoff: float) -> list[float]:
    """Low-pass subtracted from the signal = high-pass."""
    low = _one_pole_lowpass(source, cutoff)
    return [s - l for s, l in zip(source, low)]


def _bandpass(source: list[float], centre: float, q: float = 1.2) -> list[float]:
    """Two-pole band-pass around ``centre`` Hz with resonance ``q``."""
    out: list[float] = []
    omega = 2 * math.pi * centre / SAMPLE_RATE
    alpha = math.sin(omega) / (2 * q)
    b0, b2 = alpha, -alpha
    a1, a2 = -2 * math.cos(omega), 1 - alpha
    x1 = x2 = y1 = y2 = 0.0
    for sample in source:
        y = b0 * sample + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, sample
        y2, y1 = y1, y
        out.append(y)
    return out


def _normalize(samples: list[float], peak: float = 0.85) -> list[float]:
    loudest = max((abs(s) for s in samples), default=0.0)
    if loudest <= 0:
        return samples
    factor = peak / loudest
    return [s * factor for s in samples]


def _envelope(length: int, attack: float, release: float) -> list[float]:
    """Linear attack/release envelope over ``length`` samples."""
    a = min(length - 1, int(attack * SAMPLE_RATE))
    r = min(length - a, int(release * SAMPLE_RATE))
    env = []
    for i in range(length):
        if i < a:
            value = i / max(1, a)
        elif i > length - r:
            value = max(0.0, (length - i) / max(1, r))
        else:
            value = 1.0
        env.append(value)
    return env


def _sine(length: int, frequency: float, phase: float = 0.0, glide_to: float | None = None) -> list[float]:
    """Sine tone with an optional linear frequency glide."""
    out: list[float] = []
    angle = phase
    for i in range(length):
        freq = frequency + (glide_to - frequency) * (i / max(1, length - 1)) if glide_to else frequency
        out.append(math.sin(angle))
        angle += math.tau * freq / SAMPLE_RATE
    return out


# --- Soundscape renderers ------------------------------------------------------------

def _rain(length: int, rng: random.Random) -> list[float]:
    bed = _bandpass(_white_noise(length, rng), 900, 0.6)
    bed = _one_pole_highpass(bed, 250)
    out = [s * 0.5 for s in bed]
    # Random droplet ticks, ~18 per second.
    for _ in range(int(length / SAMPLE_RATE * 18)):
        at = rng.randrange(0, max(1, length - 200))
        tick = _bandpass([rng.uniform(-1, 1) for _ in range(90)], 3200, 2.5)
        for i, value in enumerate(tick):
            if at + i < length:
                out[at + i] += value * 0.8
    return out


def _wind(length: int, rng: random.Random) -> list[float]:
    base = _bandpass(_white_noise(length, rng), 420, 0.5)
    # Gust envelope: slow random LFO.
    gust = _sine(length, rng.uniform(0.06, 0.12), rng.uniform(0, 6))
    gust = [max(0.0, g) ** 2 for g in gust]
    return [s * (0.35 + 0.65 * g) for s, g in zip(base, gust)]


def _ocean(length: int, rng: random.Random) -> list[float]:
    surf = _one_pole_lowpass(_white_noise(length, rng), 700)
    swell = [max(0.0, math.sin(math.tau * 0.11 * i / SAMPLE_RATE + 1.3)) ** 3
             for i in range(length)]
    out = [s * (0.25 + 0.75 * w) for s, w in zip(surf, swell)]
    # Occasional crash: a louder burst as a wave breaks.
    for _ in range(int(length / SAMPLE_RATE / 9) + 1):
        at = rng.randrange(0, max(1, length - SAMPLE_RATE))
        crash = _envelope(SAMPLE_RATE, 0.25, 0.75)
        for i in range(SAMPLE_RATE):
            if at + i < length:
                out[at + i] += surf[(at + i) % length] * crash[i] * 1.4
    return out


def _fire(length: int, rng: random.Random) -> list[float]:
    bed = _one_pole_lowpass(_brown_noise(length, rng), 260)
    out = [s * 0.35 for s in bed]
    for _ in range(int(length / SAMPLE_RATE * 14)):
        at = rng.randrange(0, max(1, length - 300))
        size = rng.randrange(30, 260)
        burst = [rng.uniform(-1, 1) for _ in range(size)]
        burst = _one_pole_highpass(burst, 1400)
        decay = [math.exp(-8 * i / max(1, size)) for i in range(size)]
        for i in range(size):
            if at + i < length:
                out[at + i] += burst[i] * decay[i] * 0.9
    return out


def _bird(length: int, rng: random.Random) -> list[float]:
    """One chirp: three short FM sweeps in sequence."""
    out: list[float] = []
    for _ in range(3):
        base = rng.uniform(2400, 4600)
        sweep_len = rng.randrange(220, 480)
        tone = _sine(sweep_len, base, 0, base * rng.uniform(0.7, 1.25))
        env = _envelope(sweep_len, 0.004, 0.02)
        out.extend(t * e * 0.5 for t, e in zip(tone, env))
        out.extend(0.0 for _ in range(rng.randrange(60, 200)))
    return out


def _forest(length: int, rng: random.Random) -> list[float]:
    out = [s * 0.4 for s in _wind(length, rng)]
    for _ in range(int(length / SAMPLE_RATE / 3) + 1):
        at = rng.randrange(0, max(1, length - 4000))
        chirp = _bird(2200, rng)
        for i, value in enumerate(chirp):
            if at + i < length:
                out[at + i] += value * 0.7
    return out


def _cricket_trill(length: int, rng: random.Random) -> list[float]:
    carrier = rng.uniform(3900, 4600)
    pulse = [1.0 if (i // 320) % 2 == 0 else 0.0 for i in range(length)]
    tone = _sine(length, carrier, rng.uniform(0, 6))
    return [t * p * 0.4 for t, p in zip(tone, pulse)]


def _night(length: int, rng: random.Random) -> list[float]:
    out = [s * 0.28 for s in _wind(length, rng)]
    for _ in range(int(length / SAMPLE_RATE / 2) + 1):
        at = rng.randrange(0, max(1, length - SAMPLE_RATE))
        trill = _cricket_trill(rng.randrange(SAMPLE_RATE // 2, SAMPLE_RATE), rng)
        for i, value in enumerate(trill):
            if at + i < length:
                out[at + i] += value
    return out


def _cafe(length: int, rng: random.Random) -> list[float]:
    murmur = _one_pole_lowpass(_brown_noise(length, rng), 900)
    out = [s * 0.5 for s in murmur]
    for _ in range(int(length / SAMPLE_RATE / 2.2)):
        at = rng.randrange(0, max(1, length - 200))
        clink = _bandpass([rng.uniform(-1, 1) for _ in range(160)], 5200, 6.0)
        decay = [math.exp(-22 * i / 160) for i in range(160)]
        for i in range(160):
            if at + i < length:
                out[at + i] += clink[i] * decay[i] * 0.5
    return out


def _spaceship(length: int, rng: random.Random) -> list[float]:
    hum = _sine(length, rng.uniform(52, 64), rng.uniform(0, 6))
    wobble = [max(0.0, math.sin(math.tau * 0.07 * i / SAMPLE_RATE)) for i in range(length)]
    second = _sine(length, 92, 1.2)
    beat = [0.5 + 0.5 * math.sin(math.tau * 0.3 * i / SAMPLE_RATE) for i in range(length)]
    return [0.5 * h * (0.8 + 0.2 * w) + 0.25 * s * b for h, w, s, b in zip(hum, wobble, second, beat)]


_SCAPE_RENDERERS = {
    "rain": _rain, "wind": _wind, "ocean": _ocean, "fire": _fire,
    "forest": _forest, "night": _night, "cafe": _cafe, "spaceship": _spaceship,
}


# --- SFX renderers -------------------------------------------------------------------

def _sfx_laser(rng: random.Random) -> list[float]:
    length = int(0.35 * SAMPLE_RATE)
    tone = _sine(length, rng.uniform(1600, 2200), 0, 240)
    env = _envelope(length, 0.002, 0.3)
    return [t * e for t, e in zip(tone, env)]


def _sfx_coin(rng: random.Random) -> list[float]:
    out: list[float] = []
    for frequency in (988.0, 1319.0):
        tone = _sine(int(0.09 * SAMPLE_RATE), frequency, 0)
        env = _envelope(len(tone), 0.001, 0.08)
        out.extend(t * e * 0.6 for t, e in zip(tone, env))
    return out


def _sfx_powerup(rng: random.Random) -> list[float]:
    out: list[float] = []
    for step, frequency in enumerate((523, 659, 784, 1047, 1319)):
        tone = _sine(int(0.08 * SAMPLE_RATE), frequency, 0)
        env = _envelope(len(tone), 0.002, 0.06)
        offset = step * int(0.07 * SAMPLE_RATE)
        padded = [0.0] * offset + [t * e * 0.5 for t, e in zip(tone, env)]
        for i, value in enumerate(padded):
            if i >= len(out):
                out.append(value)
            else:
                out[i] += value
    return out


def _sfx_whoosh(rng: random.Random) -> list[float]:
    length = int(0.6 * SAMPLE_RATE)
    noise = _white_noise(length, rng)
    # Centre-frequency sweep: crossfade three bands.
    low = _bandpass(noise, 350, 0.8)
    mid = _bandpass(noise, 1400, 0.8)
    high = _bandpass(noise, 4200, 0.8)
    env = _envelope(length, 0.15, 0.4)
    out = []
    for i in range(length):
        t = i / length
        value = low[i] * max(0, 1 - t * 2) + mid[i] * (1 - abs(t * 2 - 1)) + high[i] * max(0, t * 2 - 1)
        out.append(value * env[i] * 1.1)
    return out


def _sfx_explosion(rng: random.Random) -> list[float]:
    length = int(1.4 * SAMPLE_RATE)
    noise = _one_pole_lowpass(_white_noise(length, rng), 300)
    rumble = _sine(length, 55, 0, 38)
    env = [math.exp(-3.2 * i / length) for i in range(length)]
    return [n * e * 1.2 + r * e * 0.9 for n, r, e in zip(noise, rumble, env)]


def _sfx_heartbeat(rng: random.Random) -> list[float]:
    out: list[float] = []
    for _ in range(2):
        for frequency, seconds, gain in ((58, 0.1, 1.0), (46, 0.12, 0.75)):
            tone = _sine(int(seconds * SAMPLE_RATE), frequency, 0, frequency * 0.8)
            env = _envelope(len(tone), 0.01, seconds * 0.9)
            out.extend(t * e * gain for t, e in zip(tone, env))
        out.extend(0.0 for _ in range(int(0.12 * SAMPLE_RATE)))
    return out


def _sfx_alarm(rng: random.Random) -> list[float]:
    length = int(1.2 * SAMPLE_RATE)
    rate = [920.0 if (i // (SAMPLE_RATE // 2)) % 2 == 0 else 680.0 for i in range(length)]
    out = []
    angle = 0.0
    for i in range(length):
        out.append(math.sin(angle) * 0.6)
        angle += math.tau * rate[i] / SAMPLE_RATE
    return out


def _sfx_click(rng: random.Random) -> list[float]:
    length = int(0.05 * SAMPLE_RATE)
    noise = _one_pole_highpass(_white_noise(length, rng), 2200)
    env = [math.exp(-90 * i / length) for i in range(length)]
    return [n * e * 0.8 for n, e in zip(noise, env)]


def _sfx_sonar(rng: random.Random) -> list[float]:
    tone = _sine(int(0.9 * SAMPLE_RATE), 880, 0)
    env = _envelope(len(tone), 0.01, 0.85)
    ping = [t * e * 0.8 for t, e in zip(tone, env)]
    echo = [t * 0.35 for t in ping]
    out = ping + [0.0] * int(0.25 * SAMPLE_RATE) + echo
    return out


def _sfx_zap(rng: random.Random) -> list[float]:
    length = int(0.28 * SAMPLE_RATE)
    noise = _bandpass(_white_noise(length, rng), 2600, 1.5)
    tone = _sine(length, rng.uniform(300, 700), 0, 90)
    env = _envelope(length, 0.002, 0.25)
    return [(n * 0.7 + t * 0.5) * e for n, t, e in zip(noise, tone, env)]


def _sfx_thunder(rng: random.Random) -> list[float]:
    length = int(2.4 * SAMPLE_RATE)
    rumble = _one_pole_lowpass(_brown_noise(length, rng), 190)
    lfo = [0.6 + 0.4 * math.sin(math.tau * 0.8 * i / SAMPLE_RATE + rng.uniform(0, 6))
           for i in range(length)]
    env = [math.exp(-1.9 * i / length) for i in range(length)]
    out = [r * l * e * 1.3 for r, l, e in zip(rumble, lfo, env)]
    at = rng.randrange(0, length // 3)
    crack = _one_pole_highpass(_white_noise(700, rng), 900)
    crack_env = [math.exp(-40 * i / 700) for i in range(700)]
    for i in range(700):
        if at + i < length:
            out[at + i] += crack[i] * crack_env[i] * 1.0
    return out


_SFX_RENDERERS = {
    "laser": _sfx_laser, "coin": _sfx_coin, "powerup": _sfx_powerup,
    "whoosh": _sfx_whoosh, "explosion": _sfx_explosion,
    "heartbeat": _sfx_heartbeat, "alarm": _sfx_alarm, "click": _sfx_click,
    "sonar": _sfx_sonar, "zap": _sfx_zap, "thunder": _sfx_thunder,
}


# --- Stereo encoding -------------------------------------------------------------------

def _to_stereo_wav(left: list[float], right: list[float], rate: int = SAMPLE_RATE) -> bytes:
    """Encode two float channels as a 16-bit stereo PCM WAV."""
    length = max(len(left), len(right))
    left = _normalize(left + [0.0] * (length - len(left)))
    right = _normalize(right + [0.0] * (length - len(right)))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        frames = bytearray()
        for l, r in zip(left, right):
            frames += struct.pack(
                "<hh",
                int(max(-1.0, min(1.0, l)) * 32767),
                int(max(-1.0, min(1.0, r)) * 32767),
            )
        handle.writeframes(bytes(frames))
    return buffer.getvalue()


def soundscape(kind: str, *, seconds: float = 12.0, seed: int | None = None) -> tuple[bytes, dict]:
    """Synthesise a stereo ambient soundscape. Returns ``(wav_bytes, meta)``."""
    kind = (kind or "rain").lower()
    if kind not in SOUNDSCAPES:
        raise ValueError(
            f"Unknown soundscape '{kind}'. Choose one of: {', '.join(SOUNDSCAPES)}."
        )
    seconds = max(2.0, min(120.0, seconds))
    length = int(seconds * SAMPLE_RATE)
    used_seed = seed if seed is not None else _stable_seed(kind)
    rng = random.Random(used_seed)
    left = _SCAPE_RENDERERS[kind](length, rng)
    right = _SCAPE_RENDERERS[kind](length, rng)  # decorrelated twin
    left, right = _normalize(left, 0.62), _normalize(right, 0.62)
    wav = _to_stereo_wav(left, right)
    meta = {
        "kind": kind,
        "seconds": round(len(left) / SAMPLE_RATE, 2),
        "channels": 2,
        "sample_rate": SAMPLE_RATE,
        "seed": used_seed,
    }
    return wav, meta


def sfx(name: str, *, seed: int | None = None) -> tuple[bytes, dict]:
    """Synthesise a one-shot sound effect (stereo, lightly widened). Returns
    ``(wav_bytes, meta)``."""
    name = (name or "click").lower()
    if name not in SFX:
        raise ValueError(f"Unknown sound effect '{name}'. Choose one of: {', '.join(SFX)}.")
    used_seed = seed if seed is not None else _stable_seed(name)
    rng = random.Random(used_seed)
    mono = _SFX_RENDERERS[name](rng)
    mono = _normalize(mono, 0.85)
    # Pseudo-stereo: tiny delay on the right channel widens the sound.
    delay = int(0.008 * SAMPLE_RATE)
    right = [0.0] * delay + mono
    left = mono + [0.0] * delay
    wav = _to_stereo_wav(left, right)
    meta = {
        "kind": name,
        "seconds": round(len(mono) / SAMPLE_RATE, 2),
        "channels": 2,
        "sample_rate": SAMPLE_RATE,
        "seed": used_seed,
    }
    return wav, meta


def render(kind: str, *, seconds: float = 12.0, seed: int | None = None) -> tuple[bytes, dict]:
    """Generate ``kind`` — a soundscape or an SFX name — as stereo WAV."""
    key = (kind or "").lower()
    if key in SOUNDSCAPES:
        return soundscape(key, seconds=seconds, seed=seed)
    if key in SFX:
        return sfx(key, seed=seed)
    raise ValueError(
        f"Unknown ambient kind '{kind}'. Soundscapes: {', '.join(SOUNDSCAPES)}. "
        f"Effects: {', '.join(SFX)}."
    )


__all__ = [
    "SAMPLE_RATE", "SOUNDSCAPES", "SFX", "KINDS",
    "soundscape", "sfx", "render",
]

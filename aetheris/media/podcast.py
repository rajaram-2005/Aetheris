"""Podcast builder — spoken narration mixed over a music bed, offline.

Cross-modal production in one call: text-to-speech (the in-process formant
synthesizer) is laid over a synthesized music bed (chord pad or arpeggio),
with **sidechain-style ducking** — the music dips automatically while the
voice speaks and swells back in the gaps — plus an optional signature jingle
at the top, a fade-out at the end, and normalisation. The output is a real
16-bit stereo WAV.

The voice is the same honest synthetic voice as ``POST /v1/audio/speech``;
the mixdown is what makes it feel like a produced intro:

1. Synthesize the narration at 22.05 kHz, resample to 44.1 kHz.
2. Synthesize a music bed a little longer than the narration.
3. Duck the bed by a speech-activity envelope (attack/release smoothed).
4. Add a two-note jingle, mix stereo (voice centre, bed wide), fade, master.
"""

from __future__ import annotations

import io
import math
import random
import struct
import wave

from . import audio as A
from .ambient import _stable_seed, SAMPLE_RATE
from .speech import synthesize_samples

MUSIC_STYLES: tuple[str, ...] = ("pad", "arp", "drone", "none")


def _resample(samples: list[float], from_rate: int, to_rate: int) -> list[float]:
    """Linear-interpolation resampler (exact for 2:1 here)."""
    if from_rate == to_rate:
        return samples
    ratio = from_rate / to_rate
    out: list[float] = []
    for i in range(int(len(samples) / ratio)):
        position = i * ratio
        base = int(position)
        frac = position - base
        a = samples[base]
        b = samples[base + 1] if base + 1 < len(samples) else a
        out.append(a + (b - a) * frac)
    return out


def _duck_envelope(total: int, speech_samples: list[float], lead: float,
                   tail: float, depth: float, threshold: float) -> list[float]:
    """A music-gain envelope (0..1) that dips while speech is active."""
    window = int(0.03 * SAMPLE_RATE)  # 30 ms activity windows
    activity: list[bool] = []
    for start in range(0, len(speech_samples), window):
        chunk = speech_samples[start : start + window]
        rms = math.sqrt(sum(s * s for s in chunk) / max(1, len(chunk)))
        activity.append(rms > threshold)
    active = [False] * total
    for i, is_active in enumerate(activity):
        if is_active:
            begin = max(0, i * window - int(lead * SAMPLE_RATE))
            end = min(total, (i + 1) * window + int(tail * SAMPLE_RATE))
            for j in range(begin, end):
                active[j] = True
    # Smooth with attack/release ramps.
    gain = 1.0 - depth
    attack, release = 0.06, 0.35
    env: list[float] = []
    for is_active in active:
        target = gain if is_active else 1.0
        step = 1.0 / max(1, int((attack if target < gain else release) * SAMPLE_RATE))
        gain += (target - gain) * step
        env.append(gain)
    return env


def _jingle(rng: random.Random, seconds: float = 1.2) -> tuple[list[float], list[float]]:
    """A little two-note signature: a seeded pentatonic hop, bell timbre."""
    length = int(seconds * SAMPLE_RATE)
    pentatonic = (1.0, 1.2, 1.5, 1.8, 2.0)
    base = 523.25 * pentatonic[rng.randrange(len(pentatonic))]
    hop = pentatonic[rng.randrange(len(pentatonic))]
    notes = [(base, 0.0, 0.5), (base * hop, 0.45, 0.75)]
    left = [0.0] * length
    right = [0.0] * length
    for frequency, at, duration in notes:
        tone = A.synth_note(frequency, duration, "bell", 0.5)
        start = int(at * SAMPLE_RATE)
        for i, value in enumerate(tone):
            index = start + i
            if index >= length:
                break
            left[index] += value * 0.8
            right[index] += value * 0.2
    return left, right


def build_intro(
    text: str,
    *,
    voice: str = "default",
    rate: float = 1.0,
    pitch: float = 1.0,
    music: str = "pad",
    key: str = "Cmaj7",
    tempo: int = 96,
    duck_depth: float = 0.35,
    jingle: bool = True,
    seed: int | None = None,
) -> tuple[bytes, dict]:
    """Produce a podcast-style intro: narration over a ducked music bed.

    Returns ``(wav_bytes, meta)`` — stereo 16-bit 44.1 kHz WAV.
    """
    from .speech import SAMPLE_RATE as SPEECH_RATE

    text = (text or "").strip()
    if not text:
        raise ValueError("The intro needs narration text.")
    music = (music or "pad").lower()
    if music not in MUSIC_STYLES:
        raise ValueError(f"Unknown music style '{music}'. Choose one of: {', '.join(MUSIC_STYLES)}.")
    used_seed = seed if seed is not None else _stable_seed(f"{text[:60]}:{voice}:{music}")
    rng = random.Random(used_seed)

    speech = _resample(
        synthesize_samples(text, voice=voice, rate=rate, pitch=pitch),
        SPEECH_RATE, SAMPLE_RATE,
    )
    speech_seconds = len(speech) / SAMPLE_RATE
    lead = 0.4 if jingle else 0.25
    total_seconds = speech_seconds + lead + 2.2
    total = int(total_seconds * SAMPLE_RATE)
    left = [0.0] * total
    right = [0.0] * total

    # Music bed.
    if music != "none":
        bars = max(2, math.ceil(total_seconds / (4 * 60 / tempo)) + 1)
        if music == "pad":
            bed = A.render_pad(key, bars=bars, tempo=tempo, timbre="strings")
        elif music == "arp":
            bed = A.render_arp(key, tempo=tempo, timbre="pluck", bars=bars, pattern="updown")
        else:  # drone: sustained organ tone on the key's root, looped if needed
            import re as _re
            root_match = _re.fullmatch(r"([A-Ga-g][#b]?)(-?\d)?", key.strip().split()[0])
            root = (root_match.group(1) if root_match else "C") + "3"
            tone = A.render_tone(A.note_frequency(root), min(30.0, total_seconds), "organ")
            cycles = math.ceil(total_seconds / max(0.5, tone.duration))
            drone = (tone.samples * cycles)[:total]
            bed = A.Track(drone)
        env = _duck_envelope(total, speech, lead=0.15, tail=0.25,
                             depth=max(0.0, min(0.9, duck_depth)), threshold=0.02)
        start = int(lead * SAMPLE_RATE)
        for i in range(min(len(bed.samples), total - start)):
            value = bed.samples[i] * 0.5 * env[start + i]
            left[start + i] += value * 0.85
            right[start + i] += value * 0.55

    # Voice, centred.
    start = int(lead * SAMPLE_RATE)
    for i, value in enumerate(speech):
        index = start + i
        if index >= total:
            break
        left[index] += value * 0.85
        right[index] += value * 0.85

    # Signature jingle on top.
    if jingle:
        jl, jr = _jingle(rng)
        for i in range(min(len(jl), total)):
            left[i] += jl[i] * 0.6
            right[i] += jr[i] * 0.6

    # Master: soft limit, fade out.
    for channel in (left, right):
        peak = max((abs(s) for s in channel), default=0.0) or 1.0
        factor = 0.9 / peak
        for i in range(len(channel)):
            channel[i] = math.tanh(channel[i] * factor * 1.6) / math.tanh(1.6)
    fade = int(2.0 * SAMPLE_RATE)
    for i in range(fade):
        t = i / fade
        left[-1 - i] *= t
        right[-1 - i] *= t

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for l, r in zip(left, right):
            frames += struct.pack(
                "<hh",
                int(max(-1.0, min(1.0, l)) * 32767),
                int(max(-1.0, min(1.0, r)) * 32767),
            )
        handle.writeframes(bytes(frames))

    meta = {
        "kind": "podcast_intro",
        "voice": voice,
        "rate": rate,
        "pitch": pitch,
        "music": music,
        "key": key,
        "tempo": tempo,
        "duck_depth": round(duck_depth, 2),
        "jingle": jingle,
        "chars": len(text),
        "seconds": round(total_seconds, 2),
        "channels": 2,
        "sample_rate": SAMPLE_RATE,
        "seed": used_seed,
    }
    return buffer.getvalue(), meta


__all__ = ["MUSIC_STYLES", "build_intro"]

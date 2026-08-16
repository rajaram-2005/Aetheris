"""Song composer — structured music with a real arrangement and stereo mixdown.

Where the single-track modes of :mod:`aetheris.media.audio` deliver a melody
or a drum loop, this module composes a **complete song**: an arrangement of
intro → verse → chorus → verse → bridge → chorus → outro, with every section
drawing its harmony from a real chord progression in the chosen key.

Five moods:

* ``uplifting`` — major key, I–V–vi–IV, bright melody, four-on-the-floor.
* ``mellow``    — dorian colour, i–IV–VII, slow pad-led arrangement.
* ``epic``      — minor key, i–VI–III–VII, brass/strings, big drums.
* ``noir``      — bluesy minor, i7–iv7–v7, plucked bass, sparse drums.
* ``sparkle``   — pentatonic, I–IV–V–IV, bell arpeggios over a light beat.

The mixdown is stereo: pads sit left, melody and arpeggios right, bass and
drums centre — with a soft limiter, fade-in/out, and normalisation, written as
16-bit 44.1 kHz stereo WAV. Deterministic per seed.
"""

from __future__ import annotations

import io
import math
import struct
import wave

from . import audio as A
from .ambient import _stable_seed, SAMPLE_RATE

MOODS: tuple[str, ...] = ("uplifting", "mellow", "epic", "noir", "sparkle")

# Semitone offsets for scale degrees.
_MAJOR_DEGREES = (0, 2, 4, 5, 7, 9, 11)
_MINOR_DEGREES = (0, 2, 3, 5, 7, 8, 10)

_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Each mood: scale kind, numerals per section (intro/verse/chorus/bridge/outro),
# tempo range, timbres, drum gain.
_MOODS: dict[str, dict] = {
    "uplifting": {
        "scale": "major", "numerals": ("I", "V", "vi", "IV"),
        "tempo": 118, "melody": "bright", "pad": "warm", "bass": "chip",
        "arp": "pluck", "drums": 1.0,
    },
    "mellow": {
        "scale": "dorian", "numerals": ("i", "IV", "VII", "iv"),
        "tempo": 84, "melody": "flute", "pad": "strings", "bass": "warm",
        "arp": "pluck", "drums": 0.55,
    },
    "epic": {
        "scale": "minor", "numerals": ("i", "VI", "III", "VII"),
        "tempo": 96, "melody": "brass", "pad": "strings", "bass": "organ",
        "arp": "bell", "drums": 1.05,
    },
    "noir": {
        "scale": "blues", "numerals": ("i7", "iv7", "i7", "V7"),
        "tempo": 76, "melody": "pluck", "pad": "organ", "bass": "pluck",
        "arp": "sine", "drums": 0.4,
    },
    "sparkle": {
        "scale": "pentatonic", "numerals": ("I", "IV", "V", "IV"),
        "tempo": 108, "melody": "bell", "pad": "warm", "bass": "bright",
        "arp": "bell", "drums": 0.7,
    },
}


def _note_for_degree(key_root: str, degree_index: int, scale_kind: str, octave: int = 3) -> str:
    """Absolute note name for a scale-degree index in a key like 'C' or 'F#'."""
    degrees = _MAJOR_DEGREES if scale_kind in ("major", "pentatonic", "blues") else _MINOR_DEGREES
    root_index = _NOTE_NAMES.index(key_root)
    octaves = degree_index // 7
    semitone = root_index + degrees[degree_index % 7] + octaves * 12
    return f"{_NOTE_NAMES[semitone % 12]}{octave + semitone // 12}"


def _chords_for(key: str, numerals: tuple[str, ...], scale_kind: str) -> list[str]:
    """Expand roman numerals (e.g. ('I','V','vi','IV')) into chord names in ``key``.

    ``key`` is like 'C', 'Am', or 'F#m' — a root plus optional 'm' for a minor
    key centre. ``scale_kind`` selects the degree intervals used to spell the
    chords.
    """
    match_key = key.strip()
    minor_centre = match_key.endswith("m")
    if minor_centre:
        match_key = match_key[:-1]
        scale_kind = "minor"
    root = match_key.upper()
    if root not in _NOTE_NAMES:
        raise ValueError(f"'{key}' is not a valid key like C, Am, or F#m.")
    degree_map = {
        "I": 0, "II": 1, "III": 2, "IV": 3, "V": 4, "VI": 5, "VII": 6,
        "i": 0, "ii": 1, "iii": 2, "iv": 3, "v": 4, "vi": 5, "vii": 6,
    }
    chords: list[str] = []
    for numeral in numerals:
        base = numeral.rstrip("7")
        degree = degree_map[base]
        note = _note_for_degree(root, degree, scale_kind, 3)
        is_minor = base.islower()
        if numeral.endswith("7"):
            quality = "min7" if is_minor else "dom7"
        elif is_minor:
            quality = "min"
        else:
            quality = "maj"
        chords.append(f"{note}{quality}")
    return chords


def _place(left: list[float], right: list[float], samples: list[float],
           at: float, gain: float, pan: float) -> None:
    """Mix a mono buffer at ``at`` seconds with constant-power panning
    (``pan`` -1 = full left, +1 = full right)."""
    theta = (max(-1.0, min(1.0, pan)) + 1.0) * math.pi / 4
    gain_l = gain * math.cos(theta)
    gain_r = gain * math.sin(theta)
    start = max(0, int(at * SAMPLE_RATE))
    for i, value in enumerate(samples):
        index = start + i
        if index >= len(left):
            break
        left[index] += value * gain_l
        right[index] += value * gain_r


def _soft_limit(samples: list[float], drive: float = 0.9) -> list[float]:
    """Saturating limiter (tanh) then normalise to a target peak."""
    out = [math.tanh(s * drive * 1.8) / math.tanh(drive * 1.8) for s in samples]
    peak = max((abs(s) for s in out), default=0.0) or 1.0
    factor = 0.9 / peak
    return [s * factor for s in out]


def _fades(left: list[float], right: list[float], fade_in: float, fade_out: float) -> None:
    fade_in_n = int(fade_in * SAMPLE_RATE)
    fade_out_n = int(fade_out * SAMPLE_RATE)
    for i in range(fade_in_n):
        t = i / max(1, fade_in_n)
        left[i] *= t
        right[i] *= t
    for i in range(fade_out_n):
        t = i / max(1, fade_out_n)
        left[-1 - i] *= t
        right[-1 - i] *= t


def _to_stereo_wav(left: list[float], right: list[float]) -> bytes:
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
    return buffer.getvalue()


def compose(
    mood: str = "uplifting",
    *,
    key: str = "C",
    tempo: int | None = None,
    verse_bars: int = 4,
    chorus_bars: int = 4,
    seed: int | None = None,
) -> tuple[bytes, dict]:
    """Compose a full song as stereo WAV. Returns ``(wav_bytes, meta)``."""
    mood = (mood or "uplifting").lower()
    if mood not in _MOODS:
        raise ValueError(f"Unknown mood '{mood}'. Choose one of: {', '.join(MOODS)}.")
    profile = _MOODS[mood]
    tempo = max(40, min(200, tempo or profile["tempo"]))
    used_seed = seed if seed is not None else _stable_seed(f"{mood}:{key}:{tempo}")

    scale_kind = "minor" if key.strip().endswith("m") else profile["scale"]
    key_root = key.strip().rstrip("m").upper()
    numerals = profile["numerals"]
    chords = _chords_for(key, numerals, scale_kind)
    notation = " ".join(chords)

    beat = 60.0 / tempo
    bar_seconds = 4 * beat

    # Section plan: (kind, bars).
    sections = [
        ("intro", 2),
        ("verse", max(2, verse_bars)),
        ("chorus", max(2, chorus_bars)),
        ("verse", max(2, verse_bars)),
        ("bridge", 2),
        ("chorus", max(2, chorus_bars)),
        ("outro", 2),
    ]
    total_seconds = sum(bars * bar_seconds for _, bars in sections) + 3.0
    left = [0.0] * int(total_seconds * SAMPLE_RATE)
    right = [0.0] * int(total_seconds * SAMPLE_RATE)

    section_meta: list[dict] = []
    cursor = 0.5  # half a second of air before the first note
    melody_seed = used_seed
    for kind, bars in sections:
        start = cursor
        if kind in ("intro", "outro", "bridge"):
            pad = A.render_pad(notation, bars=bars, tempo=tempo, timbre=profile["pad"])
            pad_gain = 0.5 if kind == "outro" else 0.42
            _place(left, right, pad.samples, cursor, pad_gain, -0.55)
        if kind in ("verse", "chorus", "bridge"):
            bass = A.render_bass(notation, bars=bars, tempo=tempo, timbre=profile["bass"])
            _place(left, right, bass.samples, cursor, 0.42 if kind == "verse" else 0.5, 0.0)
        if kind in ("verse", "chorus", "bridge"):
            melody, _ = A.render_melody_from_scale(
                f"{key_root}4" if not key.strip().endswith("m") else f"{key_root}4",
                scale_kind, bars=bars, tempo=tempo,
                timbre=profile["melody"], seed=melody_seed,
            )
            melody_seed += 1
            _place(left, right, melody.samples, cursor,
                   0.4 if kind == "verse" else 0.48, 0.5)
        if kind == "chorus":
            drums = A.render_drums(bars, tempo=tempo, seed=melody_seed, fill=True)
            melody_seed += 1
            _place(left, right, drums.samples, cursor, 0.5 * profile["drums"], 0.0)
            arp = A.render_arp(notation, tempo=tempo, timbre=profile["arp"],
                               bars=bars, pattern="updown")
            _place(left, right, arp.samples, cursor, 0.24, 0.35)
        cursor += bars * bar_seconds
        section_meta.append({
            "section": kind, "bars": bars, "start": round(start, 2),
            "end": round(cursor, 2),
        })

    left = _soft_limit(left)
    right = _soft_limit(right)
    _fades(left, right, fade_in=0.4, fade_out=2.2)
    wav = _to_stereo_wav(left, right)
    meta = {
        "mood": mood,
        "key": key,
        "tempo": tempo,
        "chords": notation,
        "scale": scale_kind,
        "sections": section_meta,
        "seconds": round(len(left) / SAMPLE_RATE, 2),
        "channels": 2,
        "sample_rate": SAMPLE_RATE,
        "seed": used_seed,
    }
    return wav, meta


def build(mood: str = "uplifting", *, key: str = "C", tempo: int | None = None,
          seed: int | None = None) -> tuple[bytes, dict]:
    """Alias of :func:`compose` (``mood`` + optional ``key``/``tempo``)."""
    return compose(mood, key=key, tempo=tempo, seed=seed)


__all__ = ["MOODS", "compose", "build", "SAMPLE_RATE"]

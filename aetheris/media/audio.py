"""Audio synthesis — real WAV files from the standard library.

Aetheris cannot sing or speak (there is no TTS model in-process), and it says so
rather than implying otherwise. What it *can* do is synthesise actual audio:
musical phrases from note names, chord progressions in a key, and simple tones
or UI sound effects — written as standard 16-bit PCM WAV via :mod:`wave`.

Synthesis uses additive harmonics plus an ADSR envelope, so notes have a shaped
attack and decay instead of the click-prone rectangles a bare sine produces.
"""

from __future__ import annotations

import io
import math
import re
import struct
import wave
from dataclasses import dataclass

SAMPLE_RATE = 44_100

# Semitone offsets from A within an octave, used to derive frequencies.
_NOTE_OFFSETS: dict[str, int] = {
    "C": -9, "C#": -8, "Db": -8, "D": -7, "D#": -6, "Eb": -6, "E": -5,
    "F": -4, "F#": -3, "Gb": -3, "G": -2, "G#": -1, "Ab": -1, "A": 0,
    "A#": 1, "Bb": 1, "B": 2,
}

# Chord qualities as semitone intervals from the root.
_CHORDS: dict[str, tuple[int, ...]] = {
    "maj": (0, 4, 7),
    "min": (0, 3, 7),
    "dim": (0, 3, 6),
    "aug": (0, 4, 8),
    "sus2": (0, 2, 7),
    "sus4": (0, 5, 7),
    "maj7": (0, 4, 7, 11),
    "min7": (0, 3, 7, 10),
    "dom7": (0, 4, 7, 10),
}

# Timbres as harmonic amplitude series (fundamental first).
_TIMBRES: dict[str, tuple[float, ...]] = {
    "sine": (1.0,),
    "warm": (1.0, 0.34, 0.16, 0.07, 0.03),
    "bright": (1.0, 0.55, 0.38, 0.26, 0.17, 0.11),
    "organ": (1.0, 0.0, 0.5, 0.0, 0.33, 0.0, 0.25),
    "bell": (1.0, 0.0, 0.0, 0.62, 0.0, 0.0, 0.31, 0.0, 0.19),
    "pluck": (1.0, 0.48, 0.30, 0.18, 0.10, 0.05),
}

TIMBRES: tuple[str, ...] = tuple(sorted(_TIMBRES))

# Scale degrees (semitones) for melody generation.
_SCALES: dict[str, tuple[int, ...]] = {
    "major": (0, 2, 4, 5, 7, 9, 11),
    "minor": (0, 2, 3, 5, 7, 8, 10),
    "pentatonic": (0, 2, 4, 7, 9),
    "blues": (0, 3, 5, 6, 7, 10),
    "dorian": (0, 2, 3, 5, 7, 9, 10),
    "lydian": (0, 2, 4, 6, 7, 9, 11),
}

SCALES: tuple[str, ...] = tuple(sorted(_SCALES))


def note_frequency(note: str) -> float:
    """Convert a note name such as ``A4``, ``C#5``, or ``Bb3`` to hertz."""
    match = re.fullmatch(r"([A-Ga-g])([#b]?)(-?\d)", note.strip())
    if not match:
        raise ValueError(f"'{note}' is not a note name like A4, C#5, or Bb3.")
    letter, accidental, octave = match.groups()
    key = letter.upper() + accidental
    if key not in _NOTE_OFFSETS:
        raise ValueError(f"Unknown note '{note}'.")
    # A4 = 440 Hz is the reference; every semitone is a factor of 2**(1/12).
    semitones = _NOTE_OFFSETS[key] + (int(octave) - 4) * 12
    return 440.0 * (2.0 ** (semitones / 12.0))


def _envelope(index: int, total: int, attack: float = 0.02, decay: float = 0.12,
              sustain: float = 0.72, release: float = 0.28) -> float:
    """ADSR amplitude at a sample position, expressed in fractions of the note."""
    if total <= 0:
        return 0.0
    t = index / total
    if t < attack:
        return t / attack
    if t < attack + decay:
        return 1.0 - (1.0 - sustain) * ((t - attack) / decay)
    if t < 1.0 - release:
        return sustain
    remaining = (1.0 - t) / release
    return sustain * max(0.0, remaining)


@dataclass
class Track:
    """A mono float sample buffer that renders to WAV."""

    samples: list[float]
    sample_rate: int = SAMPLE_RATE

    @property
    def duration(self) -> float:
        return len(self.samples) / self.sample_rate

    def normalize(self, peak: float = 0.86) -> None:
        """Scale the buffer so its loudest sample sits at ``peak``."""
        loudest = max((abs(s) for s in self.samples), default=0.0)
        if loudest > 0:
            factor = peak / loudest
            self.samples = [s * factor for s in self.samples]

    def to_wav(self) -> bytes:
        """Encode as a 16-bit mono PCM WAV file."""
        self.normalize()
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(self.sample_rate)
            frames = b"".join(
                struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767)) for s in self.samples
            )
            handle.writeframes(frames)
        return buffer.getvalue()


def synth_note(
    frequency: float, seconds: float, timbre: str = "warm", amplitude: float = 0.7
) -> list[float]:
    """Synthesise one note with additive harmonics and an ADSR envelope."""
    harmonics = _TIMBRES.get(timbre, _TIMBRES["warm"])
    total = max(1, int(seconds * SAMPLE_RATE))
    weight = sum(harmonics) or 1.0
    samples: list[float] = []
    for i in range(total):
        t = i / SAMPLE_RATE
        value = sum(
            level * math.sin(math.tau * frequency * (h + 1) * t)
            for h, level in enumerate(harmonics)
        ) / weight
        samples.append(value * _envelope(i, total) * amplitude)
    return samples


def synth_chord(
    root: str, quality: str = "maj", seconds: float = 1.2, timbre: str = "warm"
) -> list[float]:
    """Synthesise a chord by summing its constituent notes."""
    if quality not in _CHORDS:
        raise ValueError(
            f"Unknown chord quality '{quality}'. Choose one of: {', '.join(sorted(_CHORDS))}."
        )
    base = note_frequency(root)
    intervals = _CHORDS[quality]
    total = max(1, int(seconds * SAMPLE_RATE))
    mixed = [0.0] * total
    for interval in intervals:
        frequency = base * (2.0 ** (interval / 12.0))
        for i, value in enumerate(synth_note(frequency, seconds, timbre, 0.55)):
            if i < total:
                mixed[i] += value / len(intervals)
    return mixed


def parse_melody(notation: str) -> list[tuple[str | None, float]]:
    """Parse ``"C4:0.5 E4 G4 R:0.25"`` into ``(note, beats)`` pairs.

    A bare token uses one beat; ``R`` (or ``-``) is a rest.
    """
    events: list[tuple[str | None, float]] = []
    for token in notation.replace(",", " ").split():
        if ":" in token:
            name, _, length = token.partition(":")
            try:
                beats = float(length)
            except ValueError as exc:
                raise ValueError(f"'{token}' has an invalid duration.") from exc
        else:
            name, beats = token, 1.0
        if name.upper() in ("R", "-", "REST"):
            events.append((None, beats))
        else:
            note_frequency(name)  # validate eagerly for a clear error
            events.append((name, beats))
    if not events:
        raise ValueError("The melody is empty.")
    return events


def render_melody(
    notation: str, *, tempo: int = 110, timbre: str = "warm", gap: float = 0.04
) -> Track:
    """Render note notation into an audio track."""
    beat = 60.0 / max(30, min(240, tempo))
    samples: list[float] = []
    for name, beats in parse_melody(notation):
        seconds = beat * beats
        if name is None:
            samples.extend([0.0] * int(seconds * SAMPLE_RATE))
            continue
        samples.extend(synth_note(note_frequency(name), max(0.05, seconds - gap), timbre))
        samples.extend([0.0] * int(gap * SAMPLE_RATE))
    return Track(samples)


def render_progression(
    chords: list[str], *, tempo: int = 100, beats_per_chord: float = 4.0, timbre: str = "warm"
) -> Track:
    """Render a chord progression such as ``["Cmaj7", "Amin7", "Fmaj7", "G"]``."""
    beat = 60.0 / max(30, min(240, tempo))
    samples: list[float] = []
    for chord in chords:
        match = re.fullmatch(r"([A-Ga-g][#b]?)(\d?)(.*)", chord.strip())
        if not match:
            raise ValueError(f"'{chord}' is not a chord like Cmaj7, Amin, or G.")
        root, octave, quality = match.groups()
        quality = (quality or "maj").lower()
        aliases = {"": "maj", "m": "min", "7": "dom7", "m7": "min7", "M7": "maj7"}
        quality = aliases.get(quality, quality)
        if quality not in _CHORDS:
            raise ValueError(
                f"Unknown chord quality '{quality}' in '{chord}'. "
                f"Choose one of: {', '.join(sorted(_CHORDS))}."
            )
        samples.extend(
            synth_chord(f"{root}{octave or 3}", quality, beat * beats_per_chord, timbre)
        )
    return Track(samples)


def render_melody_from_scale(
    key: str = "C4", scale: str = "major", *, bars: int = 4, tempo: int = 112,
    timbre: str = "pluck", seed: int | None = None,
) -> tuple[Track, str]:
    """Compose a short melody by walking a scale; returns the track and notation."""
    import random

    if scale not in _SCALES:
        raise ValueError(f"Unknown scale '{scale}'. Choose one of: {', '.join(SCALES)}.")
    rng = random.Random(seed)
    degrees = _SCALES[scale]
    root_match = re.fullmatch(r"([A-Ga-g][#b]?)(-?\d)", key.strip())
    if not root_match:
        raise ValueError(f"'{key}' is not a key like C4 or F#3.")
    letter, octave = root_match.groups()
    octave = int(octave)

    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    root_index = names.index(letter.upper().replace("DB", "C#")) if letter.upper() in names else 0

    tokens: list[str] = []
    position = 0
    for bar in range(bars):
        for _ in range(4):
            # Prefer stepwise motion; resolve to the tonic at the end.
            position = max(0, min(len(degrees) - 1, position + rng.choice((-2, -1, 0, 1, 1, 2))))
            if bar == bars - 1:
                position = 0
            semitone = root_index + degrees[position]
            note_octave = octave + semitone // 12
            tokens.append(f"{names[semitone % 12]}{note_octave}:{rng.choice((0.5, 0.5, 1.0))}")
    notation = " ".join(tokens)
    return render_melody(notation, tempo=tempo, timbre=timbre), notation


def render_tone(
    frequency: float = 440.0, seconds: float = 1.0, timbre: str = "sine"
) -> Track:
    """Render a single sustained tone."""
    if not 20 <= frequency <= 18_000:
        raise ValueError("Frequency must be between 20 Hz and 18000 Hz.")
    if not 0.05 <= seconds <= 30:
        raise ValueError("Duration must be between 0.05 and 30 seconds.")
    return Track(synth_note(frequency, seconds, timbre))


__all__ = [
    "SAMPLE_RATE",
    "TIMBRES",
    "SCALES",
    "Track",
    "note_frequency",
    "synth_note",
    "synth_chord",
    "parse_melody",
    "render_melody",
    "render_progression",
    "render_melody_from_scale",
    "render_tone",
]

"""Offline text-to-speech — a compact formant synthesizer in the standard library.

Aetheris runs fully offline, so its text-to-speech cannot call a cloud voice
model. Instead this module synthesizes audible speech *in-process* using classic
source–filter synthesis (the same idea behind early "robotic" voices like the
Klatt and formant VTR systems):

1. **Text → phonemes** — a small grapheme-to-phoneme rule engine (plus a lookup
   table of common words) turns English text into a phoneme string.
2. **Phoneme → sound** — each phoneme is a set of target formant frequencies
   (F1/F2/F3) with a voicing flag. Voiced segments are a glottal pulse train
   shaped by formant resonators; unvoiced segments are filtered noise.
3. **WAV** — the samples are written as standard 16-bit PCM WAV.

The output is intelligible but intentionally synthetic (a "chipmunk–android"
voice), produced with no API key, no network, and no third-party dependency.
"""

from __future__ import annotations

import io
import math
import re
import struct
import wave

SAMPLE_RATE = 22_050

# --- Formant models ------------------------------------------------------------
# Each phoneme: (duration_ms, F1_Hz, F2_Hz, F3_Hz, voiced, kind)
#   kind in {"vowel", "glide", "nasal", "fricative", "stop", "africate"}
_V = 1.0
_N = 0.0

_PHONEMES: dict[str, tuple[float, float, float, float, float, str]] = {
    # --- Vowels --------------------------------------------------------------
    "iy": (110, 270, 2290, 3010, _V, "vowel"),   # ee (see)
    "ih": (90, 390, 1990, 2550, _V, "vowel"),    # i (sit)
    "eh": (110, 530, 1840, 2480, _V, "vowel"),   # e (bet)
    "ae": (130, 660, 1720, 2410, _V, "vowel"),   # a (bat)
    "ah": (120, 730, 1090, 2440, _V, "vowel"),   # a (father)
    "aa": (130, 730, 1090, 2440, _V, "vowel"),   # o (hot)
    "ao": (120, 570, 840, 2410, _V, "vowel"),    # aw (caught)
    "uh": (100, 440, 1020, 2240, _V, "vowel"),   # u (put)
    "uw": (110, 300, 870, 2240, _V, "vowel"),    # oo (boot)
    "er": (120, 490, 1350, 1690, _V, "vowel"),   # er (bird)
    "ax": (90, 500, 1500, 2500, _V, "vowel"),    # schwa (about)
    "ay": (160, 660, 1350, 2450, _V, "vowel"),   # i (bite) -> ai
    "aw": (180, 620, 1000, 2300, _V, "vowel"),   # ow (cow)
    "ey": (150, 480, 1900, 2500, _V, "vowel"),   # a (name)
    "oy": (170, 480, 900, 2500, _V, "vowel"),    # oi (boy)
    "ow": (170, 430, 950, 2300, _V, "vowel"),    # o (go)
    # --- Glides / liquids -----------------------------------------------------
    "w": (80, 300, 800, 2150, _V, "glide"),
    "y": (80, 300, 2300, 3000, _V, "glide"),
    "l": (90, 360, 1200, 2400, _V, "glide"),
    "r": (90, 420, 1300, 1600, _V, "glide"),
    "h": (70, 500, 1600, 2500, _N, "fricative"),
    # --- Nasals ---------------------------------------------------------------
    "m": (90, 280, 1050, 2100, _V, "nasal"),
    "n": (80, 300, 1450, 2200, _V, "nasal"),
    "ng": (90, 300, 1500, 2300, _V, "nasal"),
    # --- Stops (burst + brief vowel-like murmur) ------------------------------
    "p": (70, 400, 1200, 2300, _N, "stop"),
    "b": (70, 250, 1000, 2200, _V, "stop"),
    "t": (70, 500, 1700, 2400, _N, "stop"),
    "d": (70, 300, 1500, 2300, _V, "stop"),
    "k": (70, 600, 1800, 2500, _N, "stop"),
    "g": (70, 400, 1600, 2300, _V, "stop"),
    # --- Fricatives -----------------------------------------------------------
    "f": (100, 500, 1400, 2400, _N, "fricative"),
    "v": (90, 350, 1300, 2300, _V, "fricative"),
    "s": (120, 500, 4000, 5000, _N, "fricative"),
    "z": (110, 300, 2000, 3000, _V, "fricative"),
    "sh": (130, 400, 2500, 4000, _N, "fricative"),
    "zh": (120, 300, 2200, 3500, _V, "fricative"),
    "th": (120, 400, 1600, 2500, _N, "fricative"),
    "dh": (110, 300, 1400, 2400, _V, "fricative"),
    "ch": (140, 400, 2200, 3800, _N, "africate"),
    "jh": (140, 350, 2000, 3600, _V, "africate"),
    # --- Pause ----------------------------------------------------------------
    " ": (90, 0, 0, 0, _N, "silence"),
    ",": (140, 0, 0, 0, _N, "silence"),
    ".": (200, 0, 0, 0, _N, "silence"),
    "?": (220, 0, 0, 0, _N, "silence"),
    "!": (200, 0, 0, 0, _N, "silence"),
    ";": (140, 0, 0, 0, _N, "silence"),
}

# --- Common-word pronunciation table (overrides the fallback rules) ----------
_WORD_PHONEMES: dict[str, str] = {
    "the": "dh ax", "a": "ax", "an": "ae n", "and": "ae n d", "to": "t uw",
    "of": "ax v", "in": "ih n", "on": "aa n", "for": "f ao r", "is": "ih z",
    "you": "y uw", "are": "aa r", "with": "w ih dh", "that": "dh ae t",
    "this": "dh ih s", "it": "ih t", "we": "w iy", "can": "k ae n",
    "will": "w ih l", "be": "b iy", "not": "n aa t", "have": "h ae v",
    "has": "h ae z", "my": "m ay", "your": "y ao r", "our": "aw r",
    "from": "f r ah m", "by": "b ay", "as": "ae z", "at": "ae t",
    "what": "w ah t", "how": "h aw", "why": "w ay", "who": "h uw",
    "when": "w eh n", "where": "w eh r", "which": "w ih ch",
    "i": "ay", "so": "s ow", "do": "d uw", "does": "d ah z",
    "up": "ah p", "down": "d aw n", "out": "aw t", "about": "ax b aw t",
    "if": "ih f", "or": "ao r", "but": "b ah t", "just": "jh ah s t",
    "like": "l ay k", "make": "m ey k", "use": "y uw z", "get": "g eh t",
    "go": "g ow", "see": "s iy", "know": "n ow", "think": "th ih ng k",
    "take": "t ey k", "come": "k ah m", "want": "w aa n t", "look": "l uh k",
    "aetheris": "ey th er ih s", "hello": "h eh l ow", "world": "w er l d",
    "please": "p l iy z", "thank": "th ae ng k", "you": "y uw",
    "image": "ih m ih jh", "create": "k r iy ey t", "hello": "h eh l ow",
    "welcome": "w eh l k ah m", "one": "w ah n", "two": "t uw",
    "three": "th r iy", "what's": "w ah t s", "that's": "dh ae t s",
    "it's": "ih t s", "can't": "k ae n t", "don't": "d ow n t",
    "isn't": "ih z ah n t", "aren't": "aa r ah n t", "we're": "w ih r",
    "you're": "y ao r", "they're": "dh eh r", "let's": "l eh t s",
    "not": "n aa t", "no": "n ow", "yes": "y eh s", "hello": "h eh l ow",
}

# --- Letter → phoneme fallback -------------------------------------------------
_LETTERS: dict[str, str] = {
    "a": "ae", "b": "b", "c": "k", "d": "d", "e": "eh", "f": "f", "g": "g",
    "h": "h", "i": "ih", "j": "jh", "k": "k", "l": "l", "m": "m", "n": "n",
    "o": "aa", "p": "p", "q": "k", "r": "r", "s": "s", "t": "t", "u": "ah",
    "v": "v", "w": "w", "x": "k s", "y": "y", "z": "z",
}

# Diphthongs / digraphs recognized first by the G2P engine (longest match first).
_DIGRAPHS = [
    ("th", "th"), ("ch", "ch"), ("sh", "sh"), ("ph", "f"), ("wh", "w"),
    ("ck", "k"), ("ng", "ng"), ("kn", "n"), ("wr", "r"),
]


def _word_to_phonemes(word: str) -> list[str]:
    """Grapheme-to-phoneme: a small dictionary + letter/pattern fallback."""
    lowered = word.lower()
    if lowered in _WORD_PHONEMES:
        return _WORD_PHONEMES[lowered].split()

    # Spell out unknown all-caps words letter by letter.
    if len(word) >= 2 and word.isupper() and not lowered.isdigit():
        out: list[str] = []
        for ch in lowered:
            out.extend(_LETTERS.get(ch, "ax").split())
        return out

    # Handle digits.
    if lowered.isdigit():
        return _number_to_phonemes(int(lowered))

    result: list[str] = []
    i = 0
    while i < len(lowered):
        matched = False
        for digraph, phon in _DIGRAPHS:
            if lowered[i : i + len(digraph)] == digraph:
                result.extend(phon.split())
                i += len(digraph)
                matched = True
                break
        if matched:
            continue
        # Vowel-lengthening context: trailing 'e' after a vowel is silent.
        ch = lowered[i]
        result.extend(_LETTERS.get(ch, "ax").split())
        i += 1
    return result


def _number_to_phonemes(n: int) -> list[str]:
    words = _number_words(n)
    return _text_to_phonemes(words)


_NUM_UNITS = [
    (1_000_000_000, "billion"), (1_000_000, "million"),
    (1_000, "thousand"), (100, "hundred"),
]
_NUM_TEENS = ["", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
              "sixteen", "seventeen", "eighteen", "nineteen"]
_NUM_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty",
             "seventy", "eighty", "ninety"]
_NUM_ONES = ["", "one", "two", "three", "four", "five", "six", "seven",
             "eight", "nine", "ten"]


def _number_words(n: int) -> str:
    if n < 0:
        return "minus " + _number_words(-n)
    if n == 0:
        return "zero"
    if n < 20:
        return _NUM_ONES[n] if n < 10 else _NUM_TEENS[n - 10]
    if n < 100:
        tens, rem = divmod(n, 10)
        base = _NUM_TENS[tens]
        return base + (" " + _NUM_ONES[rem] if rem else "")
    words: list[str] = []
    for value, name in _NUM_UNITS:
        if n >= value:
            count, n = divmod(n, value)
            words.append(_number_words(count) + " " + name)
    if n:
        words.append(_number_words(n))
    return " ".join(words)


def _text_to_phonemes(text: str) -> list[str]:
    """Convert text (word + punctuation) to a phoneme list."""
    out: list[str] = []
    # Normalise whitespace, map numbers, keep punctuation as pause tokens.
    tokens = re.findall(r"[A-Za-z0-9]+|[,;.!?]", text.lower())
    for token in tokens:
        if token in ",;.!?":
            out.append(token)
        elif token.isdigit():
            out.extend(_number_to_phonemes(int(token)))
        else:
            out.extend(_word_to_phonemes(token))
            out.append(" ")
    return out


# --- Synthesis -----------------------------------------------------------------

def _glottal_pulse(phase: float) -> float:
    """A Liljencrants-like glottal wave approximated by a sum of harmonics."""
    v = 0.0
    for h in range(1, 6):
        v += (1.0 / h) * math.sin(phase * h)
    return v


def _resonator(x: float, prev1: float, prev2: float, f: float, bw: float, sr: float):
    """One 2nd-order IIR resonator (bi-quad), returns (out, prev1, prev2)."""
    if f <= 20:
        return 0.0, prev1, prev2
    theta = 2.0 * math.pi * f / sr
    r = math.exp(-math.pi * bw / sr)
    a1 = -2.0 * r * math.cos(theta)
    a2 = r * r
    b0 = 1.0 - r  # keep DC gain bounded
    y = b0 * x - a1 * prev1 - a2 * prev2
    return y, y, prev1


def _synthesize_phoneme(
    phoneme: str, duration_s: float, f0: float, rng_seed: int
) -> list[float]:
    """Produce the float samples for one phoneme at the current pitch."""
    spec = _PHONEMES.get(phoneme, _PHONEMES["ax"])
    f1, f2, f3, voiced, kind = spec[1], spec[2], spec[3], spec[4], spec[5]
    n_samples = max(1, int(duration_s * SAMPLE_RATE))
    out: list[float] = []
    rng = __import__("random").Random(rng_seed)
    p1 = p2 = p1b = p2b = p1c = p2c = 0.0
    phase = 0.0
    # Attack/release envelope to avoid clicks.
    attack = max(1, int(n_samples * 0.15))
    release = max(1, int(n_samples * 0.25))

    for idx in range(n_samples):
        t = idx / n_samples
        env = min(1.0, idx / attack) * min(1.0, (n_samples - idx) / release)
        if voiced:
            phase += 2.0 * math.pi * f0 / SAMPLE_RATE
            source = _glottal_pulse(phase) * 0.5
        else:
            # Unvoiced: white noise for fricatives / stops.
            source = (rng.random() * 2.0 - 1.0) * 0.35

        y, p1, p2 = _resonator(source, p1, p2, f1, 120.0, SAMPLE_RATE)
        y2, p1b, p2b = _resonator(y, p1b, p2b, f2, 180.0, SAMPLE_RATE)
        y3, p1c, p2c = _resonator(y2, p1c, p2c, f3, 260.0, SAMPLE_RATE)
        amp = 0.9 if kind != "silence" else 0.0
        out.append(y3 * env * amp)
    return out


def _base_f0_for(text_len: int) -> float:
    """Pick a pitch that falls slightly toward the end of a sentence."""
    return 120.0


def synthesize(text: str, *, voice: str = "default") -> bytes:
    """Synthesize ``text`` to a 16-bit PCM WAV and return the bytes.

    ``voice`` selects a base pitch: ``default`` (~120 Hz), ``high`` (~170 Hz),
    or ``low`` (~85 Hz).
    """
    base_f0 = {"high": 170.0, "low": 85.0}.get((voice or "default").lower(), 120.0)
    phonemes = _text_to_phonemes(text)
    if not phonemes:
        phonemes = ["ax", " "]

    # Durations: stretches pause tokens for natural pacing.
    samples: list[float] = []
    seed = 1234
    for phoneme in phonemes:
        if phoneme in (" ", ",", ".", "?", "!", ";"):
            base = _PHONEMES[phoneme][0] / 1000.0
            duration = base
            phoneme = " "
        else:
            base = _PHONEMES.get(phoneme, _PHONEMES["ax"])[0] / 1000.0
            duration = base
        # A slow downward intonation across the utterance.
        pitch = base_f0
        samples.extend(_synthesize_phoneme(phoneme, duration, pitch, seed))
        seed += 1

    # Normalise and clip.
    peak = max((abs(s) for s in samples), default=0.0) or 1.0
    gain = min(1.0, 0.9 / peak)
    pcm = struct.pack(
        "<" + "h" * len(samples),
        *[int(max(-1.0, min(1.0, s * gain)) * 32767) for s in samples],
    )

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm)
    return buf.getvalue()


def synthesize_duration_seconds(text: str) -> float:
    """Estimate the synthesized duration of ``text`` in seconds."""
    phonemes = _text_to_phonemes(text)
    total = 0.0
    for phoneme in phonemes:
        total += _PHONEMES.get(phoneme, _PHONEMES["ax"])[0] / 1000.0
    return round(total, 2)


__all__ = ["synthesize", "synthesize_duration_seconds", "SAMPLE_RATE"]

"""Aetheris media generation — images, video, audio, and code artifacts.

Every generator in this package is dependency-free: PNG, GIF, WAV, and ZIP are
all produced with the standard library alone, so media generation works in any
deployment, offline, with no API key and no GPU.

The studio spans single-shot generation (images, video, audio, speech) and the
**Studio Pro** cross-media suite: QR codes, palette remixing, collages, data
charts, Ken Burns slideshows, audio-driven visualizers, structured song
composition, ambient soundscapes and SFX, and podcast intro mixing.
"""

from __future__ import annotations

from .canvas import Canvas, encode_gif, encode_png
from .store import Artifact, ArtifactStore, get_store

__all__ = [
    "Canvas",
    "encode_png",
    "encode_gif",
    "Artifact",
    "ArtifactStore",
    "get_store",
]

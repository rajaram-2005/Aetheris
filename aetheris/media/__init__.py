"""Aetheris media generation — images, video, audio, and code artifacts.

Every generator in this package is dependency-free: PNG, GIF, WAV, and ZIP are
all produced with the standard library alone, so media generation works in any
deployment, offline, with no API key and no GPU.
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

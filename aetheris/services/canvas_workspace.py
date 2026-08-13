"""Aetheris Interactive Canvas & Artifacts 2.0 Engine.

Provides live artifact generation, multi-version tracking, side-by-side execution,
and rendering for React, HTML, SVG, Code, Markdown, and Mermaid diagrams (Claude Artifacts style).
"""

from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Literal


ArtifactType = Literal["code", "html", "react", "svg", "markdown", "mermaid", "json"]


@dataclass
class ArtifactVersion:
    version: int
    content: str
    summary: str
    timestamp: float = field(default_factory=time.time)


@dataclass
class CanvasArtifact:
    id: str
    title: str
    artifact_type: ArtifactType
    language: str
    current_version: int
    versions: list[ArtifactVersion]
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


# Pre-populated flagship demo artifacts
DEMO_ARTIFACTS: list[CanvasArtifact] = [
    CanvasArtifact(
        id="art_quantum_core",
        title="Sovereign Neural Core 3D Interactive Component",
        artifact_type="svg",
        language="xml",
        current_version=1,
        versions=[
            ArtifactVersion(
                version=1,
                content="""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="100%" height="100%">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#060914" />
      <stop offset="100%" stop-color="#0e172e" />
    </linearGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00b4d8" />
      <stop offset="100%" stop-color="#3dffc2" />
    </linearGradient>
  </defs>
  <rect width="600" height="400" rx="16" fill="url(#bg)" stroke="#00b4d8" stroke-width="2"/>
  <circle cx="300" cy="200" r="80" fill="none" stroke="url(#glow)" stroke-width="3" stroke-dasharray="8 4"/>
  <circle cx="300" cy="200" r="40" fill="#00b4d8" opacity="0.8"/>
  <text x="300" y="206" fill="#060914" font-family="monospace" font-weight="bold" font-size="16" text-anchor="middle">AETHERIS</text>
  <text x="300" y="320" fill="#3dffc2" font-family="monospace" font-size="12" text-anchor="middle">✦ 100% AIR-GAPPED SOVEREIGN AI CORE ✦</text>
</svg>""",
                summary="Initial procedural SVG vector artifact",
            )
        ],
    ),
    CanvasArtifact(
        id="art_async_pipeline",
        title="High-Throughput Async Neural Pipeline",
        artifact_type="code",
        language="python",
        current_version=1,
        versions=[
            ArtifactVersion(
                version=1,
                content="""import asyncio
from typing import AsyncIterator

class SovereignPipeline:
    def __init__(self, concurrency: int = 16) -> None:
        self.semaphore = asyncio.Semaphore(concurrency)
        
    async def process_batch(self, items: list[str]) -> list[str]:
        async def worker(item: str) -> str:
            async with self.semaphore:
                await asyncio.sleep(0.01)
                return f"[VERIFIED] {item.upper()}"
        return await asyncio.gather(*(worker(i) for i in items))
""",
                summary="Production-grade async pipeline scaffolding",
            )
        ],
    ),
]


class CanvasManager:
    """Manages versioned canvas artifacts for live UI interaction."""

    def __init__(self) -> None:
        self._artifacts: dict[str, CanvasArtifact] = {a.id: a for a in DEMO_ARTIFACTS}

    def list_artifacts(self) -> list[dict[str, Any]]:
        return [asdict(a) for a in self._artifacts.values()]

    def get_artifact(self, artifact_id: str) -> CanvasArtifact | None:
        return self._artifacts.get(artifact_id)

    def create_artifact(
        self,
        title: str,
        content: str,
        artifact_type: ArtifactType = "code",
        language: str = "python",
        summary: str = "Initial creation",
    ) -> dict[str, Any]:
        aid = f"art_{uuid.uuid4().hex[:8]}"
        ver = ArtifactVersion(version=1, content=content, summary=summary)
        artifact = CanvasArtifact(
            id=aid,
            title=title,
            artifact_type=artifact_type,
            language=language,
            current_version=1,
            versions=[ver],
        )
        self._artifacts[aid] = artifact
        return asdict(artifact)

    def update_artifact(
        self,
        artifact_id: str,
        new_content: str,
        summary: str = "Updated version",
    ) -> dict[str, Any] | None:
        art = self._artifacts.get(artifact_id)
        if not art:
            return None
        next_ver = art.current_version + 1
        ver = ArtifactVersion(version=next_ver, content=new_content, summary=summary)
        art.versions.append(ver)
        art.current_version = next_ver
        art.updated_at = time.time()
        return asdict(art)


_canvas_mgr: CanvasManager | None = None


def get_canvas_manager() -> CanvasManager:
    global _canvas_mgr
    if _canvas_mgr is None:
        _canvas_mgr = CanvasManager()
    return _canvas_mgr


__all__ = ["ArtifactType", "ArtifactVersion", "CanvasArtifact", "CanvasManager", "get_canvas_manager"]

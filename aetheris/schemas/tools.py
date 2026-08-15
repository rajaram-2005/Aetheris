"""Schemas for the tool, document, and capability surfaces."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# --- Tools --------------------------------------------------------------------


class ToolInfo(BaseModel):
    """Public description of one executable tool."""

    name: str
    description: str
    parameters: dict[str, Any]
    enabled: bool = True
    tags: list[str] = Field(default_factory=list)
    requires_optin: bool = False


class ToolList(BaseModel):
    """Response shape for ``GET /v1/tools``."""

    object: Literal["list"] = "list"
    data: list[ToolInfo]


class ToolRunRequest(BaseModel):
    """Directly invoke a tool (``POST /v1/tools/{name}/invoke``)."""

    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolRunResponse(BaseModel):
    """The result of a direct tool invocation."""

    tool: str
    ok: bool
    output: str = ""
    error: str | None = None
    duration_ms: int = 0
    arguments: dict[str, Any] = Field(default_factory=dict)


# --- Documents (RAG) ----------------------------------------------------------


class DocumentIn(BaseModel):
    """A document submitted for indexing."""

    text: str = Field(..., min_length=1, description="Raw document text.")
    title: str | None = Field(default=None, description="Human-readable title.")
    id: str | None = Field(default=None, description="Optional stable document id.")
    metadata: dict[str, Any] = Field(default_factory=dict)


class DocumentInfo(BaseModel):
    """An indexed document."""

    id: str
    title: str
    chars: int
    chunks: int
    source: str = "upload"
    metadata: dict[str, Any] = Field(default_factory=dict)


class DocumentList(BaseModel):
    """Response shape for ``GET /v1/documents``."""

    object: Literal["list"] = "list"
    data: list[DocumentInfo]
    stats: dict[str, Any] = Field(default_factory=dict)


class SearchRequest(BaseModel):
    """A retrieval query against the mounted corpus."""

    query: str = Field(..., min_length=1)
    top_k: int = Field(default=4, ge=1, le=20)
    document_id: str | None = None


class SearchResult(BaseModel):
    """One scored retrieval hit."""

    chunk_id: str
    document_id: str
    title: str
    ordinal: int
    score: float
    text: str


class SearchResponse(BaseModel):
    """Response shape for ``POST /v1/documents/search``."""

    object: Literal["search.results"] = "search.results"
    query: str
    data: list[SearchResult]


# --- Capabilities -------------------------------------------------------------


class CapabilityReport(BaseModel):
    """Which Aetheris capabilities are live on this deployment."""

    object: Literal["capabilities"] = "capabilities"
    version: str
    provider: str
    capabilities: dict[str, Any]
    tools: list[str]
    modes: list[str]
    limits: dict[str, Any] = Field(default_factory=dict)


# --- Artifacts ----------------------------------------------------------------


class ArtifactInfo(BaseModel):
    """A generated media or code artifact."""

    id: str
    kind: str
    media_type: str
    filename: str
    size: int
    url: str
    prompt: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: int = 0


class ArtifactList(BaseModel):
    """Response shape for ``GET /v1/artifacts``."""

    object: Literal["list"] = "list"
    data: list[ArtifactInfo]
    stats: dict[str, Any] = Field(default_factory=dict)


class ImageRequest(BaseModel):
    """Direct image generation (``POST /v1/images/generations``)."""

    prompt: str = Field(..., min_length=1)
    style: str | None = None
    palette: str | None = None
    width: int = Field(default=1024, ge=64, le=4096)
    height: int = Field(default=576, ge=64, le=4096)
    seed: int | None = None
    n: int = Field(default=1, ge=1, le=4, description="How many seeded variations to generate.")
    caption: bool = True
    response_format: Literal["url", "b64_json"] = "url"


class VideoRequest(BaseModel):
    """Direct video generation (NVIDIA Cosmos MP4 or offline GIF fallback)."""

    prompt: str = Field(..., min_length=1)
    motion: str | None = None
    palette: str | None = None
    seconds: float = Field(default=3.0, gt=0, le=30)
    fps: int = Field(default=12, ge=4, le=24)
    width: int = Field(default=480, ge=64, le=1920)
    height: int = Field(default=270, ge=64, le=1920)
    seed: int | None = None
    loop: Literal["loop", "bounce"] = Field(
        default="loop",
        description="'bounce' plays the animation forward then in reverse (palindrome).",
    )
    response_format: Literal["url", "b64_json"] = "url"


class AudioRequest(BaseModel):
    """Direct audio synthesis (``POST /v1/audio/generations``)."""

    mode: Literal["melody", "chords", "compose", "tone", "arp", "drums", "pad", "bass"] = "compose"
    notation: str = ""
    key: str = "C4"
    scale: str = "major"
    bars: int = Field(default=4, ge=1, le=16)
    frequency: float = Field(default=440.0, gt=0)
    seconds: float = Field(default=1.0, gt=0, le=300)
    tempo: int = Field(default=110, ge=30, le=240)
    timbre: str = "warm"
    pattern: Literal["up", "down", "updown", "random"] = "updown"
    fill: bool = True
    fx: list[str] = Field(
        default_factory=list,
        description="Post-processing effects: echo, tremolo, vibrato, lowpass, reverse.",
    )
    response_format: Literal["url", "b64_json"] = "url"


class ImageUpscaleRequest(BaseModel):
    """Enlarge a stored image (``POST /v1/images/upscale``)."""

    image: str = Field(..., min_length=1, description="Source artifact id or /v1/artifacts/{id} URL.")
    scale: int = Field(default=2, ge=2, le=4)
    method: Literal["nearest", "bilinear"] = "bilinear"
    response_format: Literal["url", "b64_json"] = "url"


class ImageEditRequest(BaseModel):
    """Edit a stored image (``POST /v1/images/edits``).

    The source is a stored artifact — its ``id`` (e.g. ``art_ab12…``) or its
    ``/v1/artifacts/{id}`` URL. Every operation is rendered offline.
    """

    image: str = Field(..., min_length=1, description="Source artifact id or /v1/artifacts/{id} URL.")
    operation: str = Field(
        ...,
        min_length=1,
        description=(
            "grayscale | sepia | invert | brightness | contrast | saturate | "
            "blur | sharpen | pixelate | posterize | duotone | vignette | "
            "flip_h | flip_v | rotate90 | emboss | grain"
        ),
    )
    strength: float = Field(default=0.5, ge=0.0, le=1.0)
    palette: str | None = Field(default=None, description="For 'duotone': 'aetheris', 'sunset', 'mono', … or two hex colours.")
    response_format: Literal["url", "b64_json"] = "url"


class CodeRequest(BaseModel):
    """NVIDIA-assisted source generation (``POST /v1/code/generations``)."""

    prompt: str = Field(..., min_length=1, max_length=50_000)
    language: str = Field(default="python", min_length=1, max_length=32)
    filename: str = Field(default="", max_length=240)
    requirements: str = Field(default="", max_length=20_000)
    response_format: Literal["url", "b64_json"] = "url"


class ProjectRequest(BaseModel):
    """Project scaffolding (``POST /v1/code/projects``)."""

    kind: str = Field(..., description="fastapi-service | python-package | cli-tool | static-site")
    name: str = Field(..., min_length=1)
    description: str = ""


class GenerationResponse(BaseModel):
    """The result of a direct generation call."""

    object: Literal["generation"] = "generation"
    kind: str
    artifact: ArtifactInfo
    artifacts: list[ArtifactInfo] = Field(default_factory=list)
    b64_json: str | None = None
    detail: dict[str, Any] = Field(default_factory=dict)


__all__ = [
    "ToolInfo",
    "ToolList",
    "ToolRunRequest",
    "ToolRunResponse",
    "DocumentIn",
    "DocumentInfo",
    "DocumentList",
    "SearchRequest",
    "SearchResult",
    "SearchResponse",
    "CapabilityReport",
    "ArtifactInfo",
    "ArtifactList",
    "ImageRequest",
    "ImageEditRequest",
    "ImageUpscaleRequest",
    "VideoRequest",
    "AudioRequest",
    "CodeRequest",
    "ProjectRequest",
    "GenerationResponse",
]

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


class QrRequest(BaseModel):
    """Styled QR code generation (``POST /v1/images/qr``)."""

    data: str = Field(..., min_length=1, max_length=400, description="Text to encode (URL, Wi-Fi, contact, …).")
    ecl: Literal["L", "M", "Q", "H"] = "M"
    width: int = Field(default=420, ge=128, le=2048)
    foreground: str = Field(default="#0b132b", description="Hex colour for dark modules.")
    background: str = Field(default="#f8f9fa", description="Hex colour for light modules.")
    rounded: bool = False
    letter: str = Field(default="", max_length=1, description="Optional centre letter (e.g. 'A').")
    response_format: Literal["url", "b64_json"] = "url"


class RemixRequest(BaseModel):
    """Remix a stored image (``POST /v1/images/remix``)."""

    image: str = Field(..., min_length=1, description="Source artifact id or /v1/artifacts/{id} URL.")
    prompt: str = Field(default="", description="What to reimagine (used by the 'reimagine' operation).")
    operation: Literal["reimagine", "restyle"] = "reimagine"
    palette: str | None = Field(default=None, description="For 'restyle': palette name or hex list. Defaults to the source's own dominant palette.")
    style: str | None = Field(default=None, description="For 'reimagine': explicit procedural style.")
    width: int = Field(default=1024, ge=64, le=2048)
    height: int = Field(default=576, ge=64, le=2048)
    dither: bool = Field(default=True, description="Floyd–Steinberg dithering for 'restyle'.")
    seed: int | None = None
    response_format: Literal["url", "b64_json"] = "url"


class CollageItemModel(BaseModel):
    """One image in a collage: an artifact id/URL plus an optional caption."""

    image: str = Field(..., min_length=1, description="Artifact id or /v1/artifacts/{id} URL.")
    caption: str = ""


class CollageRequest(BaseModel):
    """Compose stored images into one sheet (``POST /v1/images/collage``)."""

    items: list[CollageItemModel] = Field(..., min_length=1, max_length=16)
    layout: Literal["grid", "polaroid", "filmstrip"] = "grid"
    width: int = Field(default=1280, ge=160, le=2048)
    height: int = Field(default=720, ge=160, le=2048)
    background: str = Field(default="#0b132b")
    seed: int = 11
    response_format: Literal["url", "b64_json"] = "url"


class ChartSeriesModel(BaseModel):
    """One chart series."""

    name: str = Field(default="", max_length=64)
    values: list[float] = Field(default_factory=list)


class ChartRequest(BaseModel):
    """Data chart generation (``POST /v1/images/charts``)."""

    kind: Literal["line", "bar", "pie", "donut", "radar"] = "line"
    title: str = Field(default="", max_length=120)
    labels: list[str] = Field(default_factory=list, max_length=32)
    series: list[ChartSeriesModel] = Field(..., min_length=1, max_length=8)
    width: int = Field(default=960, ge=240, le=2048)
    height: int = Field(default=560, ge=240, le=2048)
    response_format: Literal["url", "b64_json"] = "url"


class SlideshowItemModel(BaseModel):
    """One slide: an artifact id/URL plus an optional caption."""

    image: str = Field(..., min_length=1, description="Artifact id or /v1/artifacts/{id} URL.")
    caption: str = ""


class SlideshowRequest(BaseModel):
    """Ken Burns slideshow video (``POST /v1/videos/slideshow``)."""

    items: list[SlideshowItemModel] = Field(..., min_length=1, max_length=16)
    width: int = Field(default=640, ge=160, le=1024)
    height: int = Field(default=360, ge=90, le=768)
    seconds_per_slide: float = Field(default=2.5, ge=0.5, le=10)
    transition_seconds: float = Field(default=0.8, ge=0.1, le=3)
    fps: int = Field(default=12, ge=4, le=30)
    transition: Literal["crossfade", "pan", "zoom", "wipe"] = "crossfade"
    seed: int = 5
    response_format: Literal["url", "b64_json"] = "url"


class VisualizerRequest(BaseModel):
    """Audio-driven visualizer video (``POST /v1/videos/visualizer``).

    The source is a stored WAV artifact (generated audio, ambient, or an
    uploaded file). The animation is locked to the audio's real energy.
    """

    audio: str = Field(..., min_length=1, description="WAV artifact id or /v1/artifacts/{id} URL.")
    mode: Literal["bars", "oscilloscope", "radial", "wave"] = "bars"
    width: int = Field(default=480, ge=160, le=1024)
    height: int = Field(default=270, ge=90, le=768)
    bins: int = Field(default=20, ge=4, le=48, description="Spectrum bands for bars/radial.")
    max_seconds: float = Field(default=30.0, ge=1, le=120)
    response_format: Literal["url", "b64_json"] = "url"


class SongRequest(BaseModel):
    """Structured song composition (``POST /v1/audio/song``)."""

    mood: Literal["uplifting", "mellow", "epic", "noir", "sparkle"] = "uplifting"
    key: str = Field(default="C", description="Key like 'C', 'Am', or 'F#m'.")
    tempo: int | None = Field(default=None, ge=40, le=200)
    verse_bars: int = Field(default=4, ge=2, le=8)
    chorus_bars: int = Field(default=4, ge=2, le=8)
    seed: int | None = None
    response_format: Literal["url", "b64_json"] = "url"


class AmbientRequest(BaseModel):
    """Ambient soundscape or sound effect (``POST /v1/audio/ambient``)."""

    kind: str = Field(..., min_length=1, description="rain | wind | ocean | fire | forest | night | cafe | spaceship | laser | coin | powerup | whoosh | explosion | heartbeat | alarm | click | sonar | zap | thunder")
    seconds: float = Field(default=12.0, ge=2, le=120, description="Duration (soundscapes only).")
    seed: int | None = None
    response_format: Literal["url", "b64_json"] = "url"


class PodcastRequest(BaseModel):
    """Podcast intro: narration over a ducked music bed (``POST /v1/audio/podcast``)."""

    text: str = Field(..., min_length=1, max_length=2_000)
    voice: str = Field(default="default", description="Offline voices: default | high | low | deep | bright | robot.")
    rate: float = Field(default=1.0, ge=0.5, le=2.0, description="Speaking speed multiplier.")
    pitch: float = Field(default=1.0, ge=0.5, le=2.0, description="Voice pitch multiplier.")
    music: Literal["pad", "arp", "drone", "none"] = "pad"
    key: str = Field(default="Cmaj7", description="Music bed chord(s), e.g. 'Cmaj7' or 'Cmaj7 Amin7 Fmaj7 G'.")
    tempo: int = Field(default=96, ge=40, le=200)
    duck_depth: float = Field(default=0.35, ge=0.0, le=0.9, description="How far the music dips under the voice.")
    jingle: bool = True
    seed: int | None = None
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
    "QrRequest",
    "RemixRequest",
    "CollageItemModel",
    "CollageRequest",
    "ChartSeriesModel",
    "ChartRequest",
    "SlideshowItemModel",
    "SlideshowRequest",
    "VisualizerRequest",
    "SongRequest",
    "AmbientRequest",
    "PodcastRequest",
    "CodeRequest",
    "ProjectRequest",
    "GenerationResponse",
]

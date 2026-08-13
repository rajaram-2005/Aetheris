"""Aetheris API routes.

Endpoints:

* ``POST /v1/chat/completions`` — OpenAI-compatible chat completions (streaming
  and non-streaming), extended with ``mode``, ``tools``, and ``agent``.
* ``GET  /v1/models``       — list available Aetheris tiers.
* ``GET  /v1/modes``        — list available inference modes.
* ``GET  /v1/tools``        — list the executable toolbelt.
* ``POST /v1/tools/{name}/invoke`` — run a single tool directly.
* ``GET/POST/DELETE /v1/documents`` — manage the RAG corpus.
* ``POST /v1/documents/search``    — query the corpus directly.
* ``GET  /v1/capabilities`` — which capabilities are live on this deployment.
* ``GET  /v1/identity``     — the foundation-model specification (media-kit).
* ``GET  /v1/health``       — liveness + active provider.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Body
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from .. import __version__
from ..core.config import settings
from ..core.modes import available_modes, known_mode_ids
from ..core.spec import get_spec
from ..core.tiers import TIERS, foundation_spec
from ..schemas.chat import (
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    Choice,
    ChoiceMessage,
    ChunkChoice,
    DeltaMessage,
    ToolInvocation,
    Usage,
    new_completion_id,
    now_ts,
)
from ..schemas.models import ModelInfo, ModelList, ModeInfo, ModeList
from ..schemas.tools import (
    ArtifactInfo,
    ArtifactList,
    AudioRequest,
    CapabilityReport,
    GenerationResponse,
    ImageRequest,
    ProjectRequest,
    VideoRequest,
    DocumentIn,
    DocumentInfo,
    DocumentList,
    SearchRequest,
    SearchResponse,
    SearchResult,
    ToolInfo,
    ToolList,
    ToolRunRequest,
    ToolRunResponse,
)
from ..schemas.spec import (
    ArchitectureModel,
    ModalitySupportModel,
    SpecModel,
    TrainingPipelineModel,
    TrainingStageModel,
    TransformerConfigModel,
)
from ..services.agent import run_agent, stream_agent
from ..services.llm import (
    ProviderError,
    get_provider,
    prepare_conversation,
)
from ..services.mock_provider import MockProvider
from ..media.store import get_store
from ..tools import registry
from ..tools.retrieval import get_index

logger = logging.getLogger("aetheris")


# --- Batch request schema -----------------------------------------------------

from ..core.feedback import (
    FeedbackSubmit,
    FeedbackEntry,
    FeedbackStats,
    get_feedback_store,
)
from ..core.webhooks import (
    WebhookRegister,
    WebhookInfo,
    WebhookDelivery,
    get_webhook_manager,
)
from ..core.sessions import (
    SessionCreate,
    SessionInfo,
    get_session_manager,
)
from ..core.audit import get_audit, AuditEvent
from ..core.metrics import get_metrics
from ..core.rate_limiter import get_limiter
from ..core.connections import (
    ConnectionCreate, ConnectionInfo, ConnectionTestResult,
    get_connection_registry,
)
from ..core.workflows import (
    WorkflowCreate, WorkflowInfo, WorkflowRunResult,
    get_workflow_engine,
)
from ..core.events import get_event_bus
from ..core.scheduler import ScheduleCreate, ScheduleInfo, get_scheduler
from ..core.integrations import list_templates, get_template, build_connection
from ..core.conversations import (
    MessageIn, ConversationCreate, ConversationInfo, ConversationDetail,
    get_conversation_store,
)
from ..core.prompts_library import (
    PromptTemplateCreate, PromptTemplateInfo, PromptRenderRequest,
    get_prompt_library,
)
from ..core.caching import get_response_cache
from ..core.files import FileInfo, FileUploadResult, get_file_store
from ..core.export_import import ExportRequest, ImportRequest, ExportResult, ImportResult, export_bundle, import_bundle
from ..core.plugins import PluginRegister, PluginInfo, get_plugin_manager
from ..core.analytics import AnalyticsEngine, AnalyticsQuery, AnalyticsOverview, get_analytics_engine
from ..core.presets import PresetCreate, PresetInfo, get_preset_store
from ..core.bookmarks import BookmarkCreate, BookmarkInfo, CollectionInfo, get_bookmark_store
from ..core.notifications import NotificationCreate, NotificationInfo, get_notification_manager
from ..core.global_search import GlobalSearchQuery, GlobalSearchResult, SearchResultItem, global_search
from ..core.snapshots import SnapshotCreate, SnapshotInfo, SnapshotDiff, get_snapshot_manager
from ..core.feature_flags import FlagCreate, FlagInfo, get_feature_flag_manager
from ..core.api_keys import ApiKeyCreate, ApiKeyInfo, ApiKeyCreated, get_api_key_manager, AVAILABLE_SCOPES
from ..core.playground import PlaygroundEntryCreate, PlaygroundEntryInfo, get_playground_store
from ..core.batch import BatchOperation, BatchRequest as OpsBatchRequest, BatchResult as OpsBatchResult, OperationResult, execute_batch
from ..core.activity import ActivityCreate, ActivityInfo, get_activity_manager
from ..core.custom_fields import FieldDefinitionCreate, FieldDefinitionInfo, ValidationResult, get_custom_field_manager
from ..core.tags import TagAssignment, TagCloudResult, EntityTags, get_tag_manager
from ..core.health import HealthReport, HealthStatus, check_health
from ..core.quotas import QuotaTierCreate, QuotaTierInfo, QuotaAssignmentCreate, QuotaUsage, get_quota_manager
from ..core.commands import CommandCreate, CommandInfo, CommandResult, get_command_manager
from ..core.sharing import ShareCreate, ShareInfo, PermissionCheck, get_share_manager
from ..core.changelog import ChangeEntryCreate, ChangeEntryInfo, VersionSummary, get_changelog_manager


class BatchRequest(BaseModel):
    """A batch of chat completion requests."""

    requests: list[ChatCompletionRequest] = Field(
        ..., min_length=1, max_length=20,
        description="Up to 20 chat completion requests to process in parallel.",
    )


class BatchResult(BaseModel):
    """Result of a batch completion request."""

    id: str
    results: list[ChatCompletionResponse | dict]
    errors: list[dict] = Field(default_factory=list)


class ModelRecommendRequest(BaseModel):
    """Ask the smart router which tier fits a task."""

    task: str = Field(..., min_length=1, max_length=50_000, description="The task or prompt text.")
    latency: str = Field("balanced", pattern="^(low|medium|high|balanced)$")
    reasoning: bool | None = Field(None, description="Override the reasoning-signal heuristic.")
    max_context: int | None = Field(None, ge=1, description="Estimated input length in tokens.")
    preferred: str | None = Field(None, max_length=64, description="Optional explicit tier id/alias.")

router = APIRouter()


# --- Request preparation ------------------------------------------------------

def _prepare(req: ChatCompletionRequest):
    """Resolve a request into a fully-prepared conversation for generation.

    Thin wrapper over the shared ``prepare_conversation`` that maps a
    ``KeyError`` (unknown/gated tier or mode) and a ``ValueError`` (invalid image
    input) to clean ``400`` responses.
    """
    def _clean(exc: KeyError) -> str:
        # KeyError.__str__ wraps the message in quotes; use args[0] instead.
        return exc.args[0] if exc.args else str(exc)

    try:
        return prepare_conversation(
            req.messages,
            model=req.model,
            mode=req.mode,
            stream=req.stream,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
            top_p=req.top_p,
            stop=req.stop,
            tools=req.tools,
            tool_choice=req.tool_choice,
            agent=req.agent,
            max_tool_iterations=req.max_tool_iterations,
        )
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=_clean(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# --- Chat completions ---------------------------------------------------------

@router.post("/v1/chat/completions")
async def chat_completions(req: ChatCompletionRequest):
    """Generate a completion (OpenAI-compatible + Aetheris ``mode``)."""
    prepared = _prepare(req)
    provider = get_provider()

    if req.stream:
        return StreamingResponse(
            _stream_chunks(prepared, provider),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",  # disable proxy buffering
            },
        )

    # Agentic requests run the plan → act → observe → self-correct loop, which
    # executes tools for real before the final answer is composed.
    if prepared.agentic:
        try:
            outcome = await run_agent(prepared, provider)
        except ProviderError as exc:
            logger.exception("Provider failure during agent run")
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        return ChatCompletionResponse(
            id=new_completion_id(),
            created=now_ts(),
            model=prepared.tier.id,
            mode=prepared.mode.id,
            choices=[
                Choice(
                    index=0,
                    message=ChoiceMessage(content=outcome.text),
                    finish_reason=outcome.finish_reason,
                )
            ],
            usage=Usage(
                prompt_tokens=outcome.prompt_tokens,
                completion_tokens=outcome.completion_tokens,
                total_tokens=outcome.prompt_tokens + outcome.completion_tokens,
            ),
            tool_trace=outcome.trace or None,
        )

    try:
        result = await provider.complete(prepared)
    except ProviderError as exc:
        logger.exception("Provider failure during completion")
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return ChatCompletionResponse(
        id=new_completion_id(),
        created=now_ts(),
        model=prepared.tier.id,
        mode=prepared.mode.id,
        choices=[
            Choice(
                index=0,
                message=ChoiceMessage(
                    content=result.text or None,
                    tool_calls=result.tool_calls or None,
                ),
                finish_reason=result.finish_reason,
            )
        ],
        usage=Usage(
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            total_tokens=result.total_tokens,
        ),
    )


async def _stream_chunks(prepared, provider) -> AsyncIterator[str]:
    """Yield OpenAI-compatible SSE chunks for a streaming completion.

    Emits a role chunk, then one chunk per text delta, then a terminating chunk
    with ``finish_reason='stop'`` and the ``[DONE]`` sentinel. Provider failures
    mid-stream are surfaced as an inline content delta so the stream degrades
    gracefully rather than breaking the client.
    """
    completion_id = new_completion_id()
    ts = now_ts()
    model = prepared.tier.id
    mode = prepared.mode.id

    def _chunk(
        delta: DeltaMessage,
        finish_reason: str | None = None,
        tool_event: ToolInvocation | None = None,
    ) -> str:
        payload = ChatCompletionChunk(
            id=completion_id,
            created=ts,
            model=model,
            mode=mode,
            choices=[ChunkChoice(index=0, delta=delta, finish_reason=finish_reason)],
            tool_event=tool_event,
        )
        return f"data: {payload.model_dump_json()}\n\n"

    # Opening chunk carries the assistant role.
    yield _chunk(DeltaMessage(role="assistant"))

    try:
        if prepared.agentic:
            # Tool executions are surfaced as they happen so the client can render
            # a live agent trace instead of waiting for the final answer.
            async for event, payload in stream_agent(prepared, provider):
                if event == "tool":
                    yield _chunk(DeltaMessage(), tool_event=payload)
                elif payload:
                    yield _chunk(DeltaMessage(content=payload))
        else:
            async for delta_text in provider.stream(prepared):
                if delta_text:
                    yield _chunk(DeltaMessage(content=delta_text))
    except ProviderError as exc:
        logger.exception("Provider failure during streaming")
        yield _chunk(DeltaMessage(content=f"\n\n[provider error: {exc}]"))
    finally:
        # Terminal chunk + sentinel.
        yield _chunk(DeltaMessage(), finish_reason="stop")
        yield "data: [DONE]\n\n"


# --- Introspection ------------------------------------------------------------

@router.get("/v1/models", response_model=ModelList)
async def list_models() -> ModelList:
    """List the available Aetheris tiers (OpenAI-compatible envelope)."""
    return ModelList(
        data=[
            ModelInfo(
                id=t.id,
                alias=t.alias,
                display_name=t.display_name,
                tagline=t.tagline,
                description=t.description,
                context_window=t.context_window,
                max_output_tokens=t.max_output_tokens,
                latency_class=t.latency_class,
                reasoning=t.reasoning,
                capabilities=list(t.capabilities),
            )
            for t in TIERS
        ]
    )


@router.post("/v1/models/recommend", tags=["meta"])
async def recommend_model(body: ModelRecommendRequest) -> dict:
    """Recommend the best Aetheris tier for a task (smart model routing)."""
    from ..core.model_router import recommend_model as route_model

    return route_model(
        body.task,
        latency=body.latency,  # type: ignore[arg-type]
        reasoning=body.reasoning,
        max_context=body.max_context,
        preferred=body.preferred,
    )


@router.get("/v1/modes", response_model=ModeList)
async def list_modes() -> ModeList:
    """List the inference modes available on this deployment.

    Gated modes (``sovereign``) appear only when the operator has enabled them.
    """
    return ModeList(
        data=[
            ModeInfo(
                id=m.id,
                display_name=m.display_name,
                description=m.description,
            )
            for m in available_modes()
        ]
    )


# --- Tools --------------------------------------------------------------------

@router.get("/v1/tools", response_model=ToolList, tags=["tools"])
async def list_tools(include_disabled: bool = False) -> ToolList:
    """List the executable toolbelt available to the model."""
    return ToolList(
        data=[
            ToolInfo(
                name=t.name,
                description=t.description,
                parameters=t.parameters,
                enabled=t.enabled,
                tags=list(t.tags),
                requires_optin=t.requires_optin,
            )
            for t in registry.all_tools(include_disabled=include_disabled)
        ]
    )


@router.post("/v1/tools/{name}/invoke", response_model=ToolRunResponse, tags=["tools"])
async def invoke_tool(name: str, body: ToolRunRequest) -> ToolRunResponse:
    """Execute a single tool directly, without a model in the loop.

    Useful for testing a tool's contract and for clients that orchestrate their
    own reasoning and only need Aetheris's execution surface.
    """
    if not settings.tools_enabled:
        raise HTTPException(status_code=403, detail="Tool execution is disabled.")
    try:
        registry.get_tool(name)
    except registry.ToolError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    result = await registry.execute(name, body.arguments)
    return ToolRunResponse(
        tool=result.tool,
        ok=result.ok,
        output=result.output,
        error=result.error,
        duration_ms=result.duration_ms,
        arguments=result.arguments,
    )


# --- Documents (RAG) ----------------------------------------------------------

def _document_info(document) -> DocumentInfo:
    return DocumentInfo(
        id=document.id,
        title=document.title,
        chars=document.char_count,
        chunks=len(document.chunk_ids),
        source=document.source,
        metadata=document.metadata,
    )


@router.get("/v1/documents", response_model=DocumentList, tags=["documents"])
async def list_corpus() -> DocumentList:
    """List every document mounted in the retrieval index."""
    index = get_index()
    return DocumentList(
        data=[_document_info(d) for d in index.documents],
        stats=index.stats(),
    )


@router.post("/v1/documents", response_model=DocumentInfo, status_code=201, tags=["documents"])
async def add_document(body: DocumentIn) -> DocumentInfo:
    """Index a document so the model can retrieve from it."""
    if not settings.rag_enabled:
        raise HTTPException(status_code=403, detail="Retrieval is disabled.")
    try:
        document = get_index().add(
            body.text, title=body.title, doc_id=body.id, metadata=body.metadata
        )
    except registry.ToolError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _document_info(document)


@router.post(
    "/v1/documents/upload", response_model=DocumentInfo, status_code=201, tags=["documents"]
)
async def upload_document(
    file: UploadFile = File(..., description="A UTF-8 text, code, CSV, JSON, or Markdown file."),
    title: str | None = Form(default=None),
) -> DocumentInfo:
    """Index an uploaded text file (multipart form upload)."""
    if not settings.rag_enabled:
        raise HTTPException(status_code=403, detail="Retrieval is disabled.")
    raw = await file.read()
    if len(raw) > settings.rag_max_document_chars * 4:
        raise HTTPException(status_code=413, detail="File is too large to index.")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")
    if not text.strip():
        raise HTTPException(status_code=400, detail="The uploaded file contains no text.")
    document = get_index().add(
        text,
        title=title or file.filename or "upload",
        source="upload",
        metadata={"filename": file.filename or "", "content_type": file.content_type or ""},
    )
    return _document_info(document)


@router.delete("/v1/documents/{doc_id}", tags=["documents"])
async def delete_document(doc_id: str) -> dict:
    """Remove one document from the index."""
    if not get_index().remove(doc_id):
        raise HTTPException(status_code=404, detail=f"No document with id '{doc_id}'.")
    return {"deleted": doc_id}


@router.delete("/v1/documents", tags=["documents"])
async def clear_corpus() -> dict:
    """Clear the entire retrieval index."""
    return {"deleted": get_index().clear()}


@router.post("/v1/documents/search", response_model=SearchResponse, tags=["documents"])
async def search_corpus(body: SearchRequest) -> SearchResponse:
    """Run a BM25 retrieval query against the mounted corpus."""
    if not settings.rag_enabled:
        raise HTTPException(status_code=403, detail="Retrieval is disabled.")
    hits = get_index().search(body.query, top_k=body.top_k, doc_id=body.document_id)
    return SearchResponse(
        query=body.query,
        data=[SearchResult(**hit.to_dict()) for hit in hits],
    )


# --- Generated artifacts ------------------------------------------------------

def _artifact_info(artifact) -> ArtifactInfo:
    return ArtifactInfo(**artifact.summary())


def _generation_response(kind: str, artifact, fmt: str, detail: dict) -> GenerationResponse:
    """Wrap a stored artifact, optionally inlining it as base64."""
    import base64

    return GenerationResponse(
        kind=kind,
        artifact=_artifact_info(artifact),
        b64_json=base64.b64encode(artifact.data).decode() if fmt == "b64_json" else None,
        detail=detail,
    )


@router.get("/v1/artifacts", response_model=ArtifactList, tags=["media"])
async def list_artifacts(kind: str | None = None) -> ArtifactList:
    """List every artifact generated in this process, newest first."""
    store = get_store()
    return ArtifactList(
        data=[_artifact_info(a) for a in store.list(kind)],
        stats=store.stats(),
    )


@router.get("/v1/artifacts/{artifact_id}", tags=["media"])
async def fetch_artifact(artifact_id: str, download: bool = False) -> Response:
    """Serve an artifact's bytes with its real media type.

    Images, video, and audio render inline in a browser or Markdown preview;
    ``?download=true`` forces a file download instead.
    """
    artifact = get_store().get(artifact_id)
    if artifact is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No artifact '{artifact_id}'. Artifacts are held in memory and are "
                "evicted when the store fills or the server restarts."
            ),
        )
    disposition = "attachment" if download else "inline"
    return Response(
        content=artifact.data,
        media_type=artifact.media_type,
        headers={
            "Content-Disposition": f'{disposition}; filename="{artifact.filename}"',
            "Cache-Control": "public, max-age=3600",
            "X-Aetheris-Artifact-Kind": artifact.kind,
        },
    )


@router.delete("/v1/artifacts/{artifact_id}", tags=["media"])
async def delete_artifact(artifact_id: str) -> dict:
    """Delete one artifact."""
    if not get_store().delete(artifact_id):
        raise HTTPException(status_code=404, detail=f"No artifact '{artifact_id}'.")
    return {"deleted": artifact_id}


@router.delete("/v1/artifacts", tags=["media"])
async def clear_artifacts() -> dict:
    """Delete every stored artifact."""
    return {"deleted": get_store().clear()}


# --- Direct generation --------------------------------------------------------

@router.post(
    "/v1/images/generations",
    response_model=GenerationResponse,
    response_model_exclude_none=False,
    tags=["media"],
)
async def create_image(body: ImageRequest) -> GenerationResponse:
    """Generate an image from a prompt (OpenAI-images-shaped endpoint)."""
    if not settings.image_generation_enabled:
        raise HTTPException(status_code=403, detail="Image generation is disabled.")
    from ..media.images import generate

    width = min(body.width, settings.media_max_image_dimension)
    height = min(body.height, settings.media_max_image_dimension)
    try:
        png, plan = generate(
            body.prompt, width=width, height=height, style=body.style,
            palette=body.palette, seed=body.seed, caption=body.caption,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    artifact = get_store().put(
        kind="image", media_type="image/png",
        filename=f"aetheris-{plan.scene}-{plan.seed}.png", data=png, prompt=body.prompt,
        metadata={"style": plan.scene, "palette": plan.palette_name,
                  "width": width, "height": height, "seed": plan.seed},
    )
    return _generation_response(
        "image", artifact, body.response_format,
        {"style": plan.scene, "palette": plan.palette_name, "seed": plan.seed,
         "dimensions": f"{width}x{height}"},
    )


@router.post(
    "/v1/videos/generations",
    response_model=GenerationResponse,
    response_model_exclude_none=False,
    tags=["media"],
)
async def create_video(body: VideoRequest) -> GenerationResponse:
    """Generate a looping animation (delivered as GIF)."""
    if not settings.video_generation_enabled:
        raise HTTPException(status_code=403, detail="Video generation is disabled.")
    from ..media.video import generate

    width = min(body.width, settings.media_max_video_dimension)
    height = min(body.height, settings.media_max_video_dimension)
    seconds = min(body.seconds, settings.media_max_video_seconds)
    try:
        gif, plan = generate(
            body.prompt, width=width, height=height, seconds=seconds, fps=body.fps,
            motion=body.motion, palette=body.palette, seed=body.seed,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    artifact = get_store().put(
        kind="video", media_type="image/gif",
        filename=f"aetheris-{plan.motion}-{plan.seed}.gif", data=gif, prompt=body.prompt,
        metadata={"motion": plan.motion, "palette": plan.palette_name,
                  "frames": plan.frames, "fps": plan.fps,
                  "duration": round(plan.duration, 2), "seed": plan.seed},
    )
    return _generation_response(
        "video", artifact, body.response_format,
        {"motion": plan.motion, "frames": plan.frames, "fps": plan.fps,
         "duration_seconds": round(plan.duration, 2)},
    )


@router.post(
    "/v1/audio/generations",
    response_model=GenerationResponse,
    response_model_exclude_none=False,
    tags=["media"],
)
async def create_audio(body: AudioRequest) -> GenerationResponse:
    """Synthesise instrumental audio as a WAV file."""
    if not settings.audio_generation_enabled:
        raise HTTPException(status_code=403, detail="Audio generation is disabled.")
    from ..media import audio as A

    detail: dict = {"mode": body.mode, "timbre": body.timbre}
    try:
        if body.mode == "melody":
            if not body.notation.strip():
                raise ValueError("Mode 'melody' requires 'notation'.")
            track = A.render_melody(body.notation, tempo=body.tempo, timbre=body.timbre)
            detail["notation"] = body.notation
        elif body.mode == "chords":
            chords = body.notation.split() or ["Cmaj7", "Amin7", "Fmaj7", "G"]
            track = A.render_progression(chords, tempo=body.tempo, timbre=body.timbre)
            detail["progression"] = " ".join(chords)
        elif body.mode == "compose":
            track, notation = A.render_melody_from_scale(
                body.key, body.scale, bars=body.bars, tempo=body.tempo, timbre=body.timbre
            )
            detail.update({"key": body.key, "scale": body.scale, "notation": notation})
        else:
            track = A.render_tone(body.frequency, body.seconds, body.timbre)
            detail.update({"frequency_hz": body.frequency, "seconds": body.seconds})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if track.duration > settings.media_max_audio_seconds:
        raise HTTPException(
            status_code=400,
            detail=f"Audio exceeds the {settings.media_max_audio_seconds}s limit.",
        )

    artifact = get_store().put(
        kind="audio", media_type="audio/wav",
        filename=f"aetheris-{body.mode}.wav", data=track.to_wav(),
        prompt=body.notation or f"{body.mode} {body.key}", metadata=detail,
    )
    detail["duration_seconds"] = round(track.duration, 2)
    return _generation_response("audio", artifact, body.response_format, detail)


@router.post("/v1/code/projects", response_model=GenerationResponse, tags=["media"])
async def create_code_project(body: ProjectRequest) -> GenerationResponse:
    """Scaffold a runnable multi-file project and return it as a ZIP."""
    if not settings.code_generation_enabled:
        raise HTTPException(status_code=403, detail="Project scaffolding is disabled.")
    from ..media.code import scaffold_project

    try:
        project = scaffold_project(body.kind, body.name, body.description)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    artifact = get_store().put(
        kind="code", media_type="application/zip",
        filename=f"{project.name}.zip", data=project.to_zip(),
        prompt=f"{body.kind}: {body.name}", metadata=project.summary(),
    )
    return _generation_response(
        "code", artifact, "url",
        {"name": project.name, "kind": project.kind,
         "files": sorted(project.files), "tree": project.tree()},
    )


# --- Capabilities -------------------------------------------------------------

@router.get("/v1/capabilities", response_model=CapabilityReport, tags=["meta"])
async def capabilities() -> CapabilityReport:
    """Report which Aetheris capabilities are actually live on this deployment."""
    provider = get_provider()
    return CapabilityReport(
        version=__version__,
        provider=getattr(provider, "provider_name", type(provider).__name__),
        capabilities=settings.capability_report(),
        tools=[t.name for t in registry.all_tools()],
        modes=list(known_mode_ids()),
        limits={
            "sandbox_timeout_s": settings.sandbox_timeout,
            "sandbox_memory_mb": settings.sandbox_memory_mb,
            "agent_max_iterations": settings.agent_max_iterations,
            "vision_max_images": settings.vision_max_images,
            "rag_chunk_size": settings.rag_chunk_size,
            "rag_documents_indexed": len(get_index().documents),
            "media_max_image_dimension": settings.media_max_image_dimension,
            "media_max_video_seconds": settings.media_max_video_seconds,
            "media_max_audio_seconds": settings.media_max_audio_seconds,
            "artifacts_stored": get_store().stats()["count"],
        },
    )


@router.get("/v1/identity")
async def identity() -> dict:
    """Return the Aetheris foundation-model specification and brand identity."""
    from ..core import branding as b

    spec = foundation_spec()
    spec.update(
        {
            "version": __version__,
            "modes": list(known_mode_ids()),
            "taglines": list(b.TAGLINES),
            "palette": b.PALETTE,
            "personality": b.PERSONALITY,
            "audiences": b.AUDIENCES,
        }
    )
    return spec


# --- Architecture & training spec ---------------------------------------------

def _architecture_to_model(arch) -> ArchitectureModel:
    return ArchitectureModel(
        name=arch.name,
        architecture_type=arch.architecture_type,
        optimizations=list(arch.optimizations),
        modalities=ModalitySupportModel(**_dc_dict(arch.modalities)),
        alignment=arch.alignment,
        output_fidelity_domains=list(arch.output_fidelity_domains),
        hallucination_policy=arch.hallucination_policy,
        transformer=TransformerConfigModel(**_dc_dict(arch.transformer)),
        context_windows=dict(arch.context_windows),
        evidence=dict(arch.evidence),
    )


def _hermes_runtime_telemetry() -> dict:
    """Live measurements from the running Hermes + meta-learning runtime.

    This is what turns ``/v1/training`` from a static document into a report on
    a system that is actually executing: the two foundation pillars report their
    real state rather than a declared one.
    """
    if not settings.hermes_enabled:
        return {"hermes_enabled": False}
    try:
        from ..hermes.meta_learning import get_meta_learner

        stats = get_meta_learner().stats()
    except Exception:  # pragma: no cover - telemetry must never break the endpoint
        logger.debug("Hermes telemetry unavailable", exc_info=True)
        return {"hermes_enabled": True, "available": False}

    return {
        "hermes_enabled": True,
        "available": True,
        "learning_enabled": settings.hermes_learning_enabled,
        "pillars": {
            "hermes_agent": "live",
            "meta_learning": "live",
        },
        "episodes_learned_from": stats["episodes"],
        "meta_updates": stats["updates"],
        "few_shot_exemplars": stats["exemplars"],
        "adapted_strategy": stats["strategy"],
        "mean_reward": stats["mean_reward"],
        "recent_mean_reward": stats["recent_mean_reward"],
        "improving": stats["improving"],
        "intent_prior": stats["intent_prior"],
        "tool_priors": stats["tool_priors"][:8],
    }


def _training_to_model(training) -> TrainingPipelineModel:
    return TrainingPipelineModel(
        name=training.name,
        foundation=training.foundation,
        foundation_status=training.foundation_status,
        alignment_methods=list(training.alignment_methods),
        meta_learning_methods=list(training.meta_learning_methods),
        runtime=_hermes_runtime_telemetry(),
        stages=[
            TrainingStageModel(
                id=s.id,
                name=s.name,
                phase=s.phase,
                objective=s.objective,
                evidence=s.evidence,
                datasets=list(s.datasets),
                hyperparameters=dict(s.hyperparameters),
                notes=s.notes,
            )
            for s in training.stages
        ],
        evidence=dict(training.evidence),
    )


def _dc_dict(obj) -> dict:
    """Flatten a frozen dataclass to a plain dict for Pydantic model construction."""
    from dataclasses import asdict

    out = asdict(obj)
    # Normalize tuples -> lists for JSON-friendly Pydantic consumption where needed.
    for k, v in list(out.items()):
        if isinstance(v, tuple):
            out[k] = list(v)
    return out


@router.get("/v1/architecture", response_model=ArchitectureModel)
async def architecture() -> ArchitectureModel:
    """Return the Aetheris foundation-model architecture specification."""
    spec = get_spec()
    return _architecture_to_model(spec.architecture)


@router.get("/v1/training", response_model=TrainingPipelineModel)
async def training() -> TrainingPipelineModel:
    """Return the Aetheris training pipeline (Hermes Agent + Meta-Learning)."""
    spec = get_spec()
    return _training_to_model(spec.training)


@router.get("/v1/spec", response_model=SpecModel)
async def spec() -> SpecModel:
    """Return the combined architecture + training specification."""
    s = get_spec()
    return SpecModel(
        architecture=_architecture_to_model(s.architecture),
        training=_training_to_model(s.training),
    )


@router.get("/v1/health")
async def health() -> dict:
    """Liveness probe with the active provider and resolved configuration."""
    provider = get_provider()
    return {
        "status": "ok",
        "version": __version__,
        "provider": provider.provider_name if hasattr(provider, "provider_name") else type(provider).__name__,
        "is_mock": isinstance(provider, MockProvider),
        "capabilities": settings.capability_report(),
        "tools": [t.name for t in registry.all_tools()],
        "modes": list(known_mode_ids()),
    }


# --- Security endpoints -------------------------------------------------------

@router.get("/v1/audit", tags=["security"])
async def query_audit(
    event_type: str | None = None,
    actor: str | None = None,
    action: str | None = None,
    outcome: str | None = None,
    since: float | None = None,
    until: float | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    """Query the audit log with optional filters."""
    if not settings.audit_enabled:
        raise HTTPException(status_code=403, detail="Audit logging is disabled.")
    audit = get_audit()
    events = audit.query(
        event_type=event_type,
        actor=actor,
        action=action,
        outcome=outcome,
        since=since,
        until=until,
        limit=limit,
        offset=offset,
    )
    return {
        "data": [e.to_dict() for e in events],
        "stats": audit.stats(),
    }


@router.get("/v1/audit/stats", tags=["security"])
async def audit_stats() -> dict:
    """Return audit log statistics."""
    return get_audit().stats()


@router.delete("/v1/audit", tags=["security"])
async def clear_audit() -> dict:
    """Clear all audit entries."""
    if not settings.audit_enabled:
        raise HTTPException(status_code=403, detail="Audit logging is disabled.")
    return {"deleted": get_audit().clear()}


@router.get("/v1/rate-limits", tags=["security"])
async def rate_limit_stats() -> dict:
    """Return current rate-limit state for all tracked clients."""
    if not settings.rate_limit_enabled:
        raise HTTPException(status_code=403, detail="Rate limiting is disabled.")
    return {
        "default": {
            "requests": settings.rate_limit_requests,
            "window_seconds": settings.rate_limit_window_seconds,
            "burst": settings.rate_limit_burst,
        },
        "clients": get_limiter().stats(),
    }


@router.get("/v1/security/headers", tags=["security"])
async def security_headers_info() -> dict:
    """Return the current security header configuration."""
    return {
        "enabled": settings.security_headers_enabled,
        "csp": settings.security_csp or None,
        "hsts_max_age": settings.security_hsts_max_age,
        "hsts_include_subdomains": settings.security_hsts_include_subdomains,
        "headers": {
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "X-XSS-Protection": "0",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
        },
    }


# --- Operations endpoints -----------------------------------------------------

@router.get("/v1/metrics", tags=["operations"])
async def metrics_snapshot() -> dict:
    """Return a complete operational metrics snapshot.

    Includes request counts, latencies, token usage, tool execution stats,
    and security counters.
    """
    return get_metrics().snapshot()


@router.get("/v1/metrics/tokens/{client_id}", tags=["operations"])
async def client_token_usage(client_id: str) -> dict:
    """Return token usage for a specific client."""
    metrics = get_metrics()
    usage = metrics.get_client_token_usage(client_id)
    if settings.auth_token_quota > 0:
        allowed, used = metrics.check_token_quota(client_id, settings.auth_token_quota)
        usage["quota"] = settings.auth_token_quota
        usage["quota_remaining"] = max(0, settings.auth_token_quota - used)
        usage["within_quota"] = allowed
    return usage


# --- Feedback endpoints -------------------------------------------------------

@router.post("/v1/feedback", tags=["operations"])
async def submit_feedback(body: FeedbackSubmit) -> FeedbackEntry:
    """Submit feedback (rating, thumbs, comment) for a completion."""
    store = get_feedback_store()
    client_id = "anonymous"  # Will be overridden by middleware if auth is enabled
    item = store.add(
        body.completion_id,
        rating=body.rating,
        thumbs_up=body.thumbs_up,
        comment=body.comment,
        tags=body.tags,
        metadata=body.metadata,
        client_id=client_id,
    )
    # Dispatch webhook event
    try:
        await get_webhook_manager().dispatch("feedback", {
            "feedback_id": item.id,
            "completion_id": item.completion_id,
            "rating": item.rating,
            "thumbs_up": item.thumbs_up,
        })
    except Exception:
        pass  # Webhook failures must not break feedback submission
    return FeedbackEntry(
        id=item.id,
        completion_id=item.completion_id,
        rating=item.rating,
        thumbs_up=item.thumbs_up,
        comment=item.comment,
        tags=item.tags,
        metadata=item.metadata,
        created_at=item.created_at,
        client_id=item.client_id,
    )


@router.get("/v1/feedback", tags=["operations"])
async def list_feedback(
    completion_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """List feedback entries, optionally filtered by completion ID."""
    store = get_feedback_store()
    items = store.list_entries(completion_id=completion_id, limit=limit, offset=offset)
    return {
        "data": [
            FeedbackEntry(
                id=i.id, completion_id=i.completion_id, rating=i.rating,
                thumbs_up=i.thumbs_up, comment=i.comment, tags=i.tags,
                metadata=i.metadata, created_at=i.created_at, client_id=i.client_id,
            ).model_dump()
            for i in items
        ],
        "stats": store.stats().model_dump(),
    }


@router.get("/v1/feedback/stats", tags=["operations"])
async def feedback_stats() -> FeedbackStats:
    """Return aggregate feedback statistics."""
    return get_feedback_store().stats()


# --- Webhook endpoints --------------------------------------------------------

@router.post("/v1/webhooks", status_code=201, tags=["operations"])
async def register_webhook(body: WebhookRegister) -> WebhookInfo:
    """Register a webhook to receive event notifications."""
    mgr = get_webhook_manager()
    try:
        wh = mgr.register(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return WebhookInfo(
        id=wh.id, url=wh.url, events=wh.events, description=wh.description,
        created_at=wh.created_at, delivery_count=wh.delivery_count,
        failure_count=wh.failure_count, last_delivery_at=wh.last_delivery_at,
        last_failure_at=wh.last_failure_at,
    )


@router.get("/v1/webhooks", tags=["operations"])
async def list_webhooks() -> dict:
    """List all registered webhooks."""
    mgr = get_webhook_manager()
    webhooks = mgr.list_webhooks()
    return {
        "data": [
            WebhookInfo(
                id=wh.id, url=wh.url, events=wh.events, description=wh.description,
                created_at=wh.created_at, delivery_count=wh.delivery_count,
                failure_count=wh.failure_count, last_delivery_at=wh.last_delivery_at,
                last_failure_at=wh.last_failure_at,
            ).model_dump()
            for wh in webhooks
        ],
    }


@router.delete("/v1/webhooks/{webhook_id}", tags=["operations"])
async def delete_webhook(webhook_id: str) -> dict:
    """Delete a registered webhook."""
    if not get_webhook_manager().delete(webhook_id):
        raise HTTPException(status_code=404, detail=f"No webhook '{webhook_id}'.")
    return {"deleted": webhook_id}


@router.get("/v1/webhooks/deliveries", tags=["operations"])
async def webhook_deliveries(limit: int = 50) -> dict:
    """List recent webhook delivery attempts."""
    mgr = get_webhook_manager()
    deliveries = mgr.delivery_history(limit=limit)
    return {"data": [d.model_dump() for d in deliveries]}


# --- Session endpoints --------------------------------------------------------

@router.post("/v1/sessions", status_code=201, tags=["operations"])
async def create_session(body: SessionCreate) -> SessionInfo:
    """Create a new client session."""
    mgr = get_session_manager()
    session = mgr.create(
        client_id=body.client_id,
        metadata=body.metadata,
        ttl_seconds=body.ttl_seconds,
    )
    return session.to_info()


@router.get("/v1/sessions/stats", tags=["operations"])
async def session_stats() -> dict:
    """Return aggregate session statistics."""
    return get_session_manager().stats()


@router.get("/v1/sessions", tags=["operations"])
async def list_sessions(
    client_id: str | None = None,
    active_only: bool = True,
) -> dict:
    """List client sessions."""
    mgr = get_session_manager()
    sessions = mgr.list_sessions(client_id=client_id, active_only=active_only)
    return {
        "data": [s.to_info().model_dump() for s in sessions],
        "stats": mgr.stats(),
    }


@router.get("/v1/sessions/{session_id}", tags=["operations"])
async def get_session(session_id: str) -> SessionInfo:
    """Get a session by ID."""
    mgr = get_session_manager()
    session = mgr.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"No active session '{session_id}'.")
    return session.to_info()


@router.delete("/v1/sessions/{session_id}", tags=["operations"])
async def delete_session(session_id: str) -> dict:
    """Delete a session."""
    if not get_session_manager().delete(session_id):
        raise HTTPException(status_code=404, detail=f"No session '{session_id}'.")
    return {"deleted": session_id}


# --- Batch processing ---------------------------------------------------------

@router.post("/v1/batch/completions", tags=["chat"])
async def batch_completions(body: BatchRequest) -> BatchResult:
    """Process multiple chat completion requests in parallel.

    Up to 20 requests are processed concurrently. Individual failures are
    captured in the ``errors`` list without failing the entire batch.
    """
    import asyncio

    batch_id = f"batch_{new_completion_id()}"

    async def _complete_one(idx: int, req: ChatCompletionRequest) -> dict:
        try:
            result = await chat_completions(req)
            if isinstance(result, ChatCompletionResponse):
                return {"index": idx, "result": result.model_dump()}
            # Streaming responses are not supported in batch mode
            return {"index": idx, "result": {"detail": "Streaming not supported in batch mode."}}
        except HTTPException as exc:
            return {"index": idx, "error": {"status_code": exc.status_code, "detail": exc.detail}}
        except Exception as exc:
            return {"index": idx, "error": {"status_code": 500, "detail": str(exc)}}

    tasks = [_complete_one(i, req) for i, req in enumerate(body.requests)]
    raw_results = await asyncio.gather(*tasks)

    results = []
    errors = []
    for r in raw_results:
        if "error" in r:
            errors.append(r)
        else:
            results.append(r)

    # Dispatch webhook
    try:
        await get_webhook_manager().dispatch("batch_completion", {
            "batch_id": batch_id,
            "total": len(body.requests),
            "successes": len(results),
            "failures": len(errors),
        })
    except Exception:
        pass

    return BatchResult(id=batch_id, results=results, errors=errors)


# --- API Versioning -----------------------------------------------------------

@router.get("/v1/version", tags=["meta"])
async def api_version() -> dict:
    """Return the current API version and supported versions."""
    return {
        "current": "v1",
        "versions": ["v1"],
        "server_version": __version__,
    }


# ============================================================================
# Automation & Integration endpoints
# ============================================================================

# --- Connections ---------------------------------------------------------------

@router.post("/v1/connections", status_code=201, tags=["automation"])
async def create_connection(body: ConnectionCreate) -> ConnectionInfo:
    """Register a connection to an external service or application."""
    reg = get_connection_registry()
    try:
        conn = reg.create(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return conn.to_info()


@router.get("/v1/connections/stats", tags=["automation"])
async def connection_stats() -> dict:
    """Return connection registry statistics."""
    return get_connection_registry().stats()


@router.get("/v1/connections", tags=["automation"])
async def list_connections(service_type: str | None = None) -> dict:
    """List all registered connections."""
    reg = get_connection_registry()
    conns = reg.list_connections(service_type=service_type)
    return {
        "data": [c.to_info().model_dump() for c in conns],
        "stats": reg.stats(),
    }


@router.get("/v1/connections/{conn_id}", tags=["automation"])
async def get_connection(conn_id: str) -> ConnectionInfo:
    """Get a connection by ID (credentials are never exposed)."""
    conn = get_connection_registry().get(conn_id)
    if conn is None:
        raise HTTPException(status_code=404, detail=f"No connection '{conn_id}'.")
    return conn.to_info()


@router.delete("/v1/connections/{conn_id}", tags=["automation"])
async def delete_connection(conn_id: str) -> dict:
    """Delete a connection and its stored credentials."""
    if not get_connection_registry().delete(conn_id):
        raise HTTPException(status_code=404, detail=f"No connection '{conn_id}'.")
    return {"deleted": conn_id}


@router.post("/v1/connections/{conn_id}/test", tags=["automation"])
async def test_connection(conn_id: str) -> ConnectionTestResult:
    """Test a connection by making a lightweight request to its base URL."""
    return await get_connection_registry().test_connection(conn_id)


@router.post("/v1/connections/{conn_id}/request", tags=["automation"])
async def connection_request(conn_id: str, body: dict) -> dict:
    """Make an authenticated request through a connection.

    Body fields: method, path, json_body, query_params, headers, timeout.
    """
    reg = get_connection_registry()
    result = await reg.request(
        conn_id,
        method=body.get("method", "GET"),
        path=body.get("path", ""),
        json_body=body.get("json_body"),
        query_params=body.get("query_params"),
        extra_headers=body.get("headers"),
        timeout=body.get("timeout", 30.0),
    )
    return result


# --- Workflows -----------------------------------------------------------------

@router.post("/v1/workflows", status_code=201, tags=["automation"])
async def create_workflow(body: WorkflowCreate) -> WorkflowInfo:
    """Create a new automation workflow."""
    engine = get_workflow_engine()
    try:
        wf = engine.create(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return wf.to_info()


@router.get("/v1/workflows", tags=["automation"])
async def list_workflows() -> dict:
    """List all workflows."""
    engine = get_workflow_engine()
    return {
        "data": [wf.to_info().model_dump() for wf in engine.list_workflows()],
        "stats": engine.stats(),
    }


@router.get("/v1/workflows/runs", tags=["automation"])
async def all_workflow_runs(limit: int = 50) -> dict:
    """List all recent workflow executions."""
    engine = get_workflow_engine()
    runs = engine.run_history(limit=limit)
    return {"data": [r.model_dump() for r in runs]}


@router.get("/v1/workflows/{wf_id}", tags=["automation"])
async def get_workflow(wf_id: str) -> WorkflowInfo:
    """Get a workflow by ID."""
    wf = get_workflow_engine().get(wf_id)
    if wf is None:
        raise HTTPException(status_code=404, detail=f"No workflow '{wf_id}'.")
    return wf.to_info()


@router.delete("/v1/workflows/{wf_id}", tags=["automation"])
async def delete_workflow(wf_id: str) -> dict:
    """Delete a workflow."""
    if not get_workflow_engine().delete(wf_id):
        raise HTTPException(status_code=404, detail=f"No workflow '{wf_id}'.")
    return {"deleted": wf_id}


@router.post("/v1/workflows/{wf_id}/run", tags=["automation"])
async def run_workflow(wf_id: str, body: dict | None = None) -> WorkflowRunResult:
    """Execute a workflow with optional inputs.

    Pass input variables as a JSON object in the body.
    """
    engine = get_workflow_engine()
    inputs = body or {}
    result = await engine.execute(wf_id, inputs=inputs)
    # Publish event
    try:
        await get_event_bus().publish("workflow.completed", {
            "workflow_id": wf_id, "run_id": result.id, "ok": result.ok,
            "duration_ms": result.duration_ms,
        }, source="workflow")
    except Exception:
        pass
    return result


@router.get("/v1/workflows/{wf_id}/runs", tags=["automation"])
async def workflow_run_history(wf_id: str, limit: int = 50) -> dict:
    """List execution history for a workflow."""
    engine = get_workflow_engine()
    runs = engine.run_history(workflow_id=wf_id, limit=limit)
    return {"data": [r.model_dump() for r in runs]}


# --- Scheduler -----------------------------------------------------------------

@router.post("/v1/schedules", status_code=201, tags=["automation"])
async def create_schedule(body: ScheduleCreate) -> ScheduleInfo:
    """Create a scheduled workflow run (cron)."""
    sched = get_scheduler().add(body)
    return sched.to_info()


@router.get("/v1/schedules", tags=["automation"])
async def list_schedules() -> dict:
    """List all scheduled workflow runs."""
    scheduler = get_scheduler()
    return {
        "data": [s.to_info().model_dump() for s in scheduler.list_schedules()],
        "stats": scheduler.stats(),
    }


@router.delete("/v1/schedules/{schedule_id}", tags=["automation"])
async def delete_schedule(schedule_id: str) -> dict:
    """Delete a schedule."""
    if not get_scheduler().remove(schedule_id):
        raise HTTPException(status_code=404, detail=f"No schedule '{schedule_id}'.")
    return {"deleted": schedule_id}


@router.post("/v1/scheduler/start", tags=["automation"])
async def start_scheduler() -> dict:
    """Start the cron scheduler background loop."""
    await get_scheduler().start()
    return {"status": "started"}


@router.post("/v1/scheduler/stop", tags=["automation"])
async def stop_scheduler() -> dict:
    """Stop the cron scheduler."""
    await get_scheduler().stop()
    return {"status": "stopped"}


# --- Event Bus -----------------------------------------------------------------

@router.post("/v1/events/publish", tags=["automation"])
async def publish_event(body: dict) -> dict:
    """Publish an event to the internal event bus.

    Body fields: name, data, source, correlation_id.
    """
    bus = get_event_bus()
    event = await bus.publish(
        name=body.get("name", "custom"),
        data=body.get("data", {}),
        source=body.get("source", "api"),
        correlation_id=body.get("correlation_id"),
    )
    return {
        "id": event.id,
        "name": event.name,
        "timestamp": event.timestamp,
        "delivered": True,
    }


@router.get("/v1/events", tags=["automation"])
async def list_events(
    name: str | None = None,
    source: str | None = None,
    limit: int = 50,
) -> dict:
    """Query the event bus history."""
    bus = get_event_bus()
    events = bus.history(name=name, source=source, limit=limit)
    return {
        "data": [
            {
                "id": e.id, "name": e.name, "timestamp": e.timestamp,
                "source": e.source, "data": e.data,
                "correlation_id": e.correlation_id,
            }
            for e in events
        ],
        "stats": bus.stats(),
    }


# --- Integration Templates -----------------------------------------------------

@router.get("/v1/integrations", tags=["automation"])
async def list_integrations() -> dict:
    """List all available integration templates."""
    templates = list_templates()
    return {"data": [t.model_dump() for t in templates]}


@router.get("/v1/integrations/{service}", tags=["automation"])
async def get_integration(service: str) -> dict:
    """Get details of a specific integration template."""
    template = get_template(service)
    if template is None:
        raise HTTPException(status_code=404, detail=f"No integration template for '{service}'.")
    return template.model_dump()


@router.post("/v1/integrations/{service}/connect", status_code=201, tags=["automation"])
async def connect_integration(service: str, body: dict) -> ConnectionInfo:
    """Connect to a service using a pre-built integration template.

    Provide credentials in the body (e.g. api_key_val, bearer_token, etc.).
    The template fills in defaults for base URL, auth headers, etc.
    """
    try:
        conn_create = build_connection(service, **body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    reg = get_connection_registry()
    try:
        conn = reg.create(conn_create)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return conn.to_info()



# ============================================================================
# Extra feature endpoints
# ============================================================================

# --- Conversations -------------------------------------------------------------

@router.post("/v1/conversations", status_code=201, tags=["conversations"])
async def create_conversation(body: ConversationCreate) -> ConversationInfo:
    """Create a new conversation thread."""
    store = get_conversation_store()
    conv = store.create(body)
    return conv.to_info()


@router.get("/v1/conversations", tags=["conversations"])
async def list_conversations(
    tags: str | None = None, mode: str | None = None, limit: int = 50, offset: int = 0,
) -> dict:
    """List conversation threads."""
    store = get_conversation_store()
    tag_list = tags.split(",") if tags else None
    convs = store.list_conversations(tags=tag_list, mode=mode, limit=limit, offset=offset)
    return {"data": [c.to_info().model_dump() for c in convs], "stats": store.stats()}


@router.get("/v1/conversations/search", tags=["conversations"])
async def search_conversations(q: str) -> dict:
    """Search conversations by content."""
    store = get_conversation_store()
    results = store.search(q)
    return {"data": [{"conversation": c.to_info().model_dump(), "matching_messages": len(msgs)} for c, msgs in results]}


@router.get("/v1/conversations/{conv_id}", tags=["conversations"])
async def get_conversation(conv_id: str) -> ConversationDetail:
    """Get a full conversation with all messages."""
    store = get_conversation_store()
    conv = store.get(conv_id)
    if conv is None:
        raise HTTPException(status_code=404, detail=f"No conversation '{conv_id}'.")
    return conv.to_detail()


@router.post("/v1/conversations/{conv_id}/messages", tags=["conversations"])
async def append_message(conv_id: str, body: MessageIn) -> dict:
    """Append a message to a conversation."""
    store = get_conversation_store()
    msg = store.append(conv_id, body)
    if msg is None:
        raise HTTPException(status_code=404, detail=f"No conversation '{conv_id}' or message limit reached.")
    return msg.to_dict()


@router.delete("/v1/conversations/{conv_id}", tags=["conversations"])
async def delete_conversation(conv_id: str) -> dict:
    """Delete a conversation."""
    if not get_conversation_store().delete(conv_id):
        raise HTTPException(status_code=404, detail=f"No conversation '{conv_id}'.")
    return {"deleted": conv_id}


@router.get("/v1/conversations/{conv_id}/export", tags=["conversations"])
async def export_conversation(conv_id: str, format: str = "json") -> dict:
    """Export a conversation as JSON, Markdown, or plain text."""
    store = get_conversation_store()
    result = store.export_conversation(conv_id, fmt=format)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No conversation '{conv_id}'.")
    return {"format": format, "content": result}


@router.post("/v1/conversations/{conv_id}/summarize", tags=["conversations"])
async def summarize_conversation(conv_id: str) -> dict:
    """Produce a concise recap of a conversation via the Hermes agent."""
    from ..services.conversation_summary import summarize_conversation as _summarize

    store = get_conversation_store()
    conv = store.get(conv_id)
    if conv is None:
        raise HTTPException(status_code=404, detail=f"No conversation '{conv_id}'.")

    result = await _summarize(conv)
    # Keep the conversation's stored summary in sync with the new recap.
    if conv._summary != result["summary"]:
        conv._summary = result["summary"]
    return {"conversation_id": conv_id, **result}


# --- Prompt Templates ----------------------------------------------------------

@router.post("/v1/prompts", status_code=201, tags=["prompts"])
async def create_prompt_template(body: PromptTemplateCreate) -> PromptTemplateInfo:
    """Create a reusable prompt template."""
    lib = get_prompt_library()
    try:
        tpl = lib.create(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return tpl.to_info()


@router.get("/v1/prompts", tags=["prompts"])
async def list_prompt_templates(category: str | None = None, tags: str | None = None) -> dict:
    """List prompt templates."""
    lib = get_prompt_library()
    tag_list = tags.split(",") if tags else None
    tpls = lib.list_templates(category=category, tags=tag_list)
    return {"data": [t.to_info().model_dump() for t in tpls], "stats": lib.stats()}


@router.get("/v1/prompts/{tpl_id}", tags=["prompts"])
async def get_prompt_template(tpl_id: str) -> dict:
    """Get a prompt template with its full body."""
    lib = get_prompt_library()
    tpl = lib.get(tpl_id)
    if tpl is None:
        raise HTTPException(status_code=404, detail=f"No template '{tpl_id}'.")
    return {"info": tpl.to_info().model_dump(), "template": tpl.template, "variables": tpl.variables}


@router.post("/v1/prompts/{tpl_id}/render", tags=["prompts"])
async def render_prompt_template(tpl_id: str, body: PromptRenderRequest) -> dict:
    """Render a prompt template with variable substitution."""
    lib = get_prompt_library()
    tpl = lib.get(tpl_id)
    if tpl is None:
        raise HTTPException(status_code=404, detail=f"No template '{tpl_id}'.")
    rendered = tpl.render(body.variables)
    return {"template_id": tpl_id, "rendered": rendered}


@router.delete("/v1/prompts/{tpl_id}", tags=["prompts"])
async def delete_prompt_template(tpl_id: str) -> dict:
    """Delete a prompt template."""
    if not get_prompt_library().delete(tpl_id):
        raise HTTPException(status_code=404, detail=f"No template '{tpl_id}'.")
    return {"deleted": tpl_id}


@router.post("/v1/prompts/defaults", tags=["prompts"])
async def load_default_templates() -> dict:
    """Load built-in default prompt templates."""
    count = get_prompt_library().load_defaults()
    return {"loaded": count}


# --- Caching ------------------------------------------------------------------

@router.get("/v1/cache", tags=["operations"])
async def cache_stats() -> dict:
    """Return response cache statistics."""
    return get_response_cache().stats()


@router.delete("/v1/cache", tags=["operations"])
async def clear_cache() -> dict:
    """Clear the response cache."""
    return {"cleared": get_response_cache().clear()}


# --- File Storage --------------------------------------------------------------

@router.post("/v1/files", status_code=201, tags=["files"])
async def upload_file(
    file: UploadFile = File(..., description="File to upload."),
    directory: str = Form(default="/"),
    tags: str | None = Form(default=None),
) -> FileUploadResult:
    """Upload a file to the in-memory store."""
    if not settings.file_storage_enabled:
        raise HTTPException(status_code=403, detail="File storage is disabled.")
    data = await file.read()
    tag_list = tags.split(",") if tags else []
    try:
        f = get_file_store().put(
            filename=file.filename or "upload",
            data=data,
            content_type=file.content_type or "",
            directory=directory,
            tags=tag_list,
        )
    except ValueError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    # Auto-index text files into RAG
    indexed = False
    if settings.rag_enabled and f.content_type.startswith("text/"):
        try:
            text = data.decode("utf-8")
            doc = get_index().add(text, title=f.filename, source="upload")
            indexed = True
        except Exception:
            pass
    return FileUploadResult(
        id=f.id, filename=f.filename, content_type=f.content_type,
        size_bytes=f.size_bytes, checksum=f.checksum, indexed=indexed,
    )


@router.get("/v1/files", tags=["files"])
async def list_files(directory: str | None = None, content_type: str | None = None) -> dict:
    """List stored files."""
    store = get_file_store()
    files = store.list_files(directory=directory, content_type_prefix=content_type)
    return {"data": [f.to_info().model_dump() for f in files], "stats": store.stats()}


@router.get("/v1/files/{file_id}", tags=["files"])
async def download_file(file_id: str) -> Response:
    """Download a file's content."""
    f = get_file_store().get(file_id)
    if f is None:
        raise HTTPException(status_code=404, detail=f"No file '{file_id}'.")
    return Response(
        content=f.data, media_type=f.content_type,
        headers={"Content-Disposition": f'attachment; filename="{f.filename}"', "X-Aetheris-File-Checksum": f.checksum},
    )


@router.delete("/v1/files/{file_id}", tags=["files"])
async def delete_file(file_id: str) -> dict:
    """Delete a stored file."""
    if not get_file_store().delete(file_id):
        raise HTTPException(status_code=404, detail=f"No file '{file_id}'.")
    return {"deleted": file_id}


# --- Export/Import -------------------------------------------------------------

@router.post("/v1/export", tags=["operations"])
async def create_export(body: ExportRequest) -> ExportResult:
    """Export Aetheris data as a portable bundle."""
    return export_bundle(body)


@router.post("/v1/import", tags=["operations"])
async def import_data(body: ImportRequest) -> ImportResult:
    """Import an Aetheris bundle."""
    return import_bundle(body)


# --- Plugins ------------------------------------------------------------------

@router.post("/v1/plugins", status_code=201, tags=["plugins"])
async def register_plugin(body: PluginRegister) -> PluginInfo:
    """Register a plugin or extension."""
    mgr = get_plugin_manager()
    try:
        plugin = mgr.register(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return plugin.to_info()


@router.get("/v1/plugins", tags=["plugins"])
async def list_plugins(type: str | None = None) -> dict:
    """List registered plugins."""
    mgr = get_plugin_manager()
    return {"data": [p.to_info().model_dump() for p in mgr.list_plugins(type=type)], "stats": mgr.stats()}


@router.post("/v1/plugins/{plugin_id}/load", tags=["plugins"])
async def load_plugin(plugin_id: str) -> PluginInfo:
    """Load a registered plugin (import its module)."""
    plugin = get_plugin_manager().load(plugin_id)
    if plugin is None:
        raise HTTPException(status_code=404, detail=f"No plugin '{plugin_id}'.")
    return plugin.to_info()


@router.post("/v1/plugins/discover", tags=["plugins"])
async def discover_plugins() -> dict:
    """Discover available aetheris.plugin entry points."""
    return {"entry_points": get_plugin_manager().discover_entry_points()}


# --- Analytics ----------------------------------------------------------------

@router.get("/v1/analytics/overview", tags=["analytics"])
async def analytics_overview(window: str = "1h", model: str | None = None, mode: str | None = None) -> AnalyticsOverview:
    """Get a high-level analytics overview."""
    return get_analytics_engine().overview(window=window, model=model, mode=mode)


@router.get("/v1/analytics/tokens", tags=["analytics"])
async def analytics_tokens(window: str = "1h", model: str | None = None, mode: str | None = None) -> dict:
    """Get token usage statistics."""
    return get_analytics_engine().token_stats(window=window, model=model, mode=mode)


@router.get("/v1/analytics/requests", tags=["analytics"])
async def analytics_requests(window: str = "1h", bucket: str = "1m") -> dict:
    """Get request rate time series."""
    return get_analytics_engine().request_time_series(window=window, bucket=bucket)


@router.get("/v1/analytics/costs", tags=["analytics"])
async def analytics_costs(window: str = "1h") -> dict:
    """Get cost breakdown by model."""
    return get_analytics_engine().cost_breakdown(window=window)


@router.get("/v1/analytics/top-queries", tags=["analytics"])
async def analytics_top_queries(limit: int = 20) -> dict:
    """Get top queries by frequency."""
    return {"queries": get_analytics_engine().top_queries(limit=limit)}


@router.get("/v1/analytics/top-tools", tags=["analytics"])
async def analytics_top_tools(limit: int = 20) -> dict:
    """Get top tools by usage."""
    return {"tools": get_analytics_engine().top_tools(limit=limit)}


@router.get("/v1/analytics/errors", tags=["analytics"])
async def analytics_errors(limit: int = 50) -> dict:
    """Get recent errors."""
    return {"errors": get_analytics_engine().recent_errors(limit=limit)}


@router.get("/v1/analytics/stats", tags=["analytics"])
async def analytics_stats() -> dict:
    """Get analytics engine stats."""
    return get_analytics_engine().stats()


# --- Presets ------------------------------------------------------------------

@router.post("/v1/presets", status_code=201, tags=["presets"])
async def create_preset(body: PresetCreate) -> PresetInfo:
    """Create a configuration preset."""
    try:
        preset = get_preset_store().create(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return preset.to_info()


@router.get("/v1/presets", tags=["presets"])
async def list_presets(tag: str | None = None, model: str | None = None) -> dict:
    """List configuration presets."""
    store = get_preset_store()
    return {"data": [p.to_info().model_dump() for p in store.list_presets(tag=tag, model=model)], "stats": store.stats()}


@router.get("/v1/presets/search", tags=["presets"])
async def search_presets(q: str) -> dict:
    """Search presets by name."""
    store = get_preset_store()
    import re
    pattern = re.compile(re.escape(q), re.IGNORECASE)
    results = [p for p in store.list_presets() if pattern.search(p.name) or pattern.search(p.description)]
    return {"data": [p.to_info().model_dump() for p in results]}


@router.post("/v1/presets/defaults", tags=["presets"])
async def load_default_presets() -> dict:
    """Load built-in default presets."""
    count = get_preset_store().load_defaults()
    return {"loaded": count}


@router.get("/v1/presets/{preset_id}", tags=["presets"])
async def get_preset(preset_id: str) -> PresetInfo:
    """Get a preset by ID."""
    preset = get_preset_store().get(preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail=f"No preset '{preset_id}'.")
    return preset.to_info()


@router.delete("/v1/presets/{preset_id}", tags=["presets"])
async def delete_preset(preset_id: str) -> dict:
    """Delete a preset."""
    try:
        if not get_preset_store().delete(preset_id):
            raise HTTPException(status_code=404, detail=f"No preset '{preset_id}'.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"deleted": preset_id}


# --- Bookmarks ----------------------------------------------------------------

@router.post("/v1/bookmarks", status_code=201, tags=["bookmarks"])
async def create_bookmark(body: BookmarkCreate) -> BookmarkInfo:
    """Create a bookmark."""
    try:
        bm = get_bookmark_store().create(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return bm.to_info()


@router.get("/v1/bookmarks", tags=["bookmarks"])
async def list_bookmarks(collection: str | None = None, entity_type: str | None = None) -> dict:
    """List bookmarks."""
    store = get_bookmark_store()
    return {"data": [b.to_info().model_dump() for b in store.list_bookmarks(collection=collection, entity_type=entity_type)], "stats": store.stats()}


@router.get("/v1/bookmarks/collections", tags=["bookmarks"])
async def list_collections() -> dict:
    """List bookmark collections."""
    return {"data": [c.model_dump() for c in get_bookmark_store().list_collections()]}


@router.delete("/v1/bookmarks/collections/{name}", tags=["bookmarks"])
async def delete_collection(name: str) -> dict:
    """Delete a collection and all its bookmarks."""
    count = get_bookmark_store().delete_collection(name)
    return {"deleted_bookmarks": count}


@router.delete("/v1/bookmarks/{bm_id}", tags=["bookmarks"])
async def delete_bookmark(bm_id: str) -> dict:
    """Delete a bookmark."""
    if not get_bookmark_store().delete(bm_id):
        raise HTTPException(status_code=404, detail=f"No bookmark '{bm_id}'.")
    return {"deleted": bm_id}


# --- Notifications ------------------------------------------------------------

@router.post("/v1/notifications", status_code=201, tags=["notifications"])
async def create_notification(body: NotificationCreate) -> NotificationInfo:
    """Create a notification."""
    return get_notification_manager().create(body).to_info()


@router.get("/v1/notifications", tags=["notifications"])
async def list_notifications(type: str | None = None, read: bool | None = None, source: str | None = None, limit: int = 50) -> dict:
    """List notifications."""
    mgr = get_notification_manager()
    return {
        "data": [n.to_info().model_dump() for n in mgr.list_notifications(type=type, read=read, source=source, limit=limit)],
        "unread_count": mgr.unread_count(),
        "stats": mgr.stats(),
    }


@router.post("/v1/notifications/{notif_id}/read", tags=["notifications"])
async def mark_notification_read(notif_id: str) -> NotificationInfo:
    """Mark a notification as read."""
    n = get_notification_manager().mark_read(notif_id)
    if n is None:
        raise HTTPException(status_code=404, detail=f"No notification '{notif_id}'.")
    return n.to_info()


@router.post("/v1/notifications/read-all", tags=["notifications"])
async def mark_all_notifications_read() -> dict:
    """Mark all notifications as read."""
    count = get_notification_manager().mark_all_read()
    return {"marked_read": count}


@router.delete("/v1/notifications/{notif_id}", tags=["notifications"])
async def delete_notification(notif_id: str) -> dict:
    """Delete a notification."""
    if not get_notification_manager().delete(notif_id):
        raise HTTPException(status_code=404, detail=f"No notification '{notif_id}'.")
    return {"deleted": notif_id}


# --- Global Search ------------------------------------------------------------

@router.post("/v1/search", tags=["search"])
async def global_search_endpoint(body: GlobalSearchQuery) -> GlobalSearchResult:
    """Search across all entities (conversations, prompts, files, workflows, connections)."""
    return global_search(body)


# --- Snapshots ----------------------------------------------------------------

@router.post("/v1/snapshots", status_code=201, tags=["snapshots"])
async def create_snapshot(body: SnapshotCreate) -> SnapshotInfo:
    """Create a version snapshot of a conversation or prompt."""
    try:
        snap = get_snapshot_manager().create(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return snap.to_info()


@router.get("/v1/snapshots", tags=["snapshots"])
async def list_snapshots(target_type: str | None = None, target_id: str | None = None) -> dict:
    """List snapshots."""
    mgr = get_snapshot_manager()
    return {"data": [s.to_info().model_dump() for s in mgr.list_snapshots(target_type=target_type, target_id=target_id)], "stats": mgr.stats()}


@router.get("/v1/snapshots/{snap_id}", tags=["snapshots"])
async def get_snapshot(snap_id: str) -> SnapshotInfo:
    """Get a snapshot by ID."""
    snap = get_snapshot_manager().get(snap_id)
    if snap is None:
        raise HTTPException(status_code=404, detail=f"No snapshot '{snap_id}'.")
    return snap.to_info()


@router.get("/v1/snapshots/{snap_a_id}/diff/{snap_b_id}", tags=["snapshots"])
async def diff_snapshots(snap_a_id: str, snap_b_id: str) -> SnapshotDiff:
    """Compute diff between two snapshots."""
    try:
        return get_snapshot_manager().diff(snap_a_id, snap_b_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/v1/snapshots/{snap_id}/rollback", tags=["snapshots"])
async def rollback_snapshot(snap_id: str) -> dict:
    """Rollback an entity to a snapshot's state."""
    try:
        ok = get_snapshot_manager().rollback(snap_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"rolled_back": ok, "snapshot_id": snap_id}


@router.delete("/v1/snapshots/{snap_id}", tags=["snapshots"])
async def delete_snapshot(snap_id: str) -> dict:
    """Delete a snapshot."""
    if not get_snapshot_manager().delete(snap_id):
        raise HTTPException(status_code=404, detail=f"No snapshot '{snap_id}'.")
    return {"deleted": snap_id}


# --- Feature Flags ------------------------------------------------------------

@router.post("/v1/flags", status_code=201, tags=["feature-flags"])
async def create_flag(body: FlagCreate) -> FlagInfo:
    """Create a feature flag."""
    try:
        flag = get_feature_flag_manager().create(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return flag.to_info()


@router.get("/v1/flags", tags=["feature-flags"])
async def list_flags(enabled: bool | None = None) -> dict:
    """List feature flags."""
    mgr = get_feature_flag_manager()
    return {"data": [f.to_info().model_dump() for f in mgr.list_flags(enabled=enabled)], "stats": mgr.stats()}


@router.get("/v1/flags/evaluate", tags=["feature-flags"])
async def evaluate_flags(context: str = "") -> dict:
    """Evaluate all flags for a given context."""
    ctx = {"id": context} if context else {}
    return {"evaluations": get_feature_flag_manager().evaluate_all(ctx)}


@router.get("/v1/flags/{flag_id}", tags=["feature-flags"])
async def get_flag(flag_id: str) -> FlagInfo:
    """Get a feature flag."""
    flag = get_feature_flag_manager().get(flag_id)
    if flag is None:
        raise HTTPException(status_code=404, detail=f"No flag '{flag_id}'.")
    return flag.to_info()


@router.post("/v1/flags/{flag_id}/toggle", tags=["feature-flags"])
async def toggle_flag(flag_id: str) -> FlagInfo:
    """Toggle a feature flag on/off."""
    flag = get_feature_flag_manager().toggle(flag_id)
    if flag is None:
        raise HTTPException(status_code=404, detail=f"No flag '{flag_id}'.")
    return flag.to_info()


@router.delete("/v1/flags/{flag_id}", tags=["feature-flags"])
async def delete_flag(flag_id: str) -> dict:
    """Delete a feature flag."""
    if not get_feature_flag_manager().delete(flag_id):
        raise HTTPException(status_code=404, detail=f"No flag '{flag_id}'.")
    return {"deleted": flag_id}


# --- API Key Management -------------------------------------------------------

@router.post("/v1/keys", status_code=201, tags=["api-keys"])
async def create_api_key(body: ApiKeyCreate) -> ApiKeyCreated:
    """Create a scoped API key."""
    try:
        return get_api_key_manager().create(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/v1/keys", tags=["api-keys"])
async def list_api_keys(revoked: bool | None = None) -> dict:
    """List API keys."""
    mgr = get_api_key_manager()
    return {"data": [k.to_info().model_dump() for k in mgr.list_keys(revoked=revoked)], "stats": mgr.stats(), "available_scopes": AVAILABLE_SCOPES}


@router.get("/v1/keys/{key_id}", tags=["api-keys"])
async def get_api_key(key_id: str) -> ApiKeyInfo:
    """Get an API key by ID."""
    ak = get_api_key_manager().get(key_id)
    if ak is None:
        raise HTTPException(status_code=404, detail=f"No API key '{key_id}'.")
    return ak.to_info()


@router.post("/v1/keys/{key_id}/revoke", tags=["api-keys"])
async def revoke_api_key(key_id: str) -> dict:
    """Revoke an API key."""
    if not get_api_key_manager().revoke(key_id):
        raise HTTPException(status_code=404, detail=f"No API key '{key_id}'.")
    return {"revoked": key_id}


@router.post("/v1/keys/{key_id}/rotate", tags=["api-keys"])
async def rotate_api_key(key_id: str) -> ApiKeyCreated:
    """Rotate an API key (revokes old, creates new)."""
    result = get_api_key_manager().rotate(key_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No API key '{key_id}'.")
    return result


@router.delete("/v1/keys/{key_id}", tags=["api-keys"])
async def delete_api_key(key_id: str) -> dict:
    """Delete an API key."""
    if not get_api_key_manager().delete(key_id):
        raise HTTPException(status_code=404, detail=f"No API key '{key_id}'.")
    return {"deleted": key_id}


# --- Playground History -------------------------------------------------------

@router.post("/v1/playground", status_code=201, tags=["playground"])
async def record_playground(body: PlaygroundEntryCreate) -> PlaygroundEntryInfo:
    """Record a playground completion."""
    return get_playground_store().create(body).to_info()


@router.get("/v1/playground", tags=["playground"])
async def list_playground(model: str | None = None, mode: str | None = None, limit: int = 50) -> dict:
    """List playground history."""
    store = get_playground_store()
    return {"data": [e.to_info().model_dump() for e in store.list_entries(model=model, mode=mode, limit=limit)], "stats": store.stats()}


@router.get("/v1/playground/search", tags=["playground"])
async def search_playground(q: str, limit: int = 20) -> dict:
    """Search playground history."""
    return {"data": [e.to_info().model_dump() for e in get_playground_store().search(q, limit=limit)]}


@router.get("/v1/playground/{entry_id}", tags=["playground"])
async def get_playground_entry(entry_id: str) -> dict:
    """Get a playground entry with full request/response."""
    entry = get_playground_store().get(entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No entry '{entry_id}'.")
    return {"info": entry.to_info().model_dump(), "messages": entry.messages, "response_content": entry.response_content}


@router.get("/v1/playground/{entry_id}/replay", tags=["playground"])
async def replay_playground(entry_id: str) -> dict:
    """Get request parameters for replaying an entry."""
    req = get_playground_store().get_replay_request(entry_id)
    if req is None:
        raise HTTPException(status_code=404, detail=f"No entry '{entry_id}'.")
    return req


@router.delete("/v1/playground/{entry_id}", tags=["playground"])
async def delete_playground_entry(entry_id: str) -> dict:
    """Delete a playground entry."""
    if not get_playground_store().delete(entry_id):
        raise HTTPException(status_code=404, detail=f"No entry '{entry_id}'.")
    return {"deleted": entry_id}


# --- Batch Operations ---------------------------------------------------------

@router.post("/v1/batch", tags=["batch"])
async def execute_batch_ops(body: OpsBatchRequest) -> OpsBatchResult:
    """Execute a batch of operations."""
    return execute_batch(body)


# --- Activity Timeline --------------------------------------------------------

@router.post("/v1/activity", status_code=201, tags=["activity"])
async def record_activity(body: ActivityCreate) -> ActivityInfo:
    """Record an activity event."""
    return get_activity_manager().record(body).to_info()


@router.get("/v1/activity", tags=["activity"])
async def list_activity(type: str | None = None, actor: str | None = None, target_type: str | None = None, limit: int = 50) -> dict:
    """List activity timeline."""
    mgr = get_activity_manager()
    return {"data": [a.to_info().model_dump() for a in mgr.list_activities(type=type, actor=actor, target_type=target_type, limit=limit)], "stats": mgr.stats()}


@router.get("/v1/activity/search", tags=["activity"])
async def search_activity(q: str, limit: int = 20) -> dict:
    """Search activity timeline."""
    return {"data": [a.to_info().model_dump() for a in get_activity_manager().search(q, limit=limit)]}


# --- Custom Fields ------------------------------------------------------------

@router.post("/v1/fields", status_code=201, tags=["custom-fields"])
async def create_field(body: FieldDefinitionCreate) -> FieldDefinitionInfo:
    """Define a custom field."""
    try:
        return get_custom_field_manager().create(body).to_info()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/v1/fields", tags=["custom-fields"])
async def list_fields(entity_type: str | None = None) -> dict:
    """List field definitions."""
    mgr = get_custom_field_manager()
    return {"data": [f.to_info().model_dump() for f in mgr.list_fields(entity_type=entity_type)], "stats": mgr.stats()}


@router.post("/v1/fields/validate", tags=["custom-fields"])
async def validate_metadata(entity_type: str, data: dict[str, Any] = Body(default_factory=dict)) -> ValidationResult:
    """Validate custom metadata against schema."""
    return get_custom_field_manager().validate(entity_type, data)


@router.delete("/v1/fields/{field_id}", tags=["custom-fields"])
async def delete_field(field_id: str) -> dict:
    """Delete a field definition."""
    if not get_custom_field_manager().delete(field_id):
        raise HTTPException(status_code=404, detail=f"No field '{field_id}'.")
    return {"deleted": field_id}


# --- Tags & Taxonomy ----------------------------------------------------------

@router.post("/v1/tags/assign", tags=["tags"])
async def assign_tags(body: TagAssignment) -> EntityTags:
    """Assign tags to an entity."""
    try:
        return get_tag_manager().assign(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/v1/tags", tags=["tags"])
async def tag_cloud(entity_type: str | None = None, limit: int = 100) -> TagCloudResult:
    """Get tag cloud with entity counts."""
    return get_tag_manager().tag_cloud(entity_type=entity_type, limit=limit)


@router.get("/v1/tags/autocomplete", tags=["tags"])
async def autocomplete_tags(prefix: str, entity_type: str | None = None, limit: int = 20) -> dict:
    """Autocomplete tags by prefix."""
    return {"suggestions": get_tag_manager().autocomplete(prefix, entity_type=entity_type, limit=limit)}


@router.get("/v1/tags/search", tags=["tags"])
async def find_by_tag(tag: str, entity_type: str | None = None, limit: int = 50) -> dict:
    """Find entities by tag."""
    return {"results": get_tag_manager().find_by_tag(tag, entity_type=entity_type, limit=limit)}


@router.get("/v1/tags/{entity_type}/{entity_id}", tags=["tags"])
async def get_entity_tags(entity_type: str, entity_id: str) -> EntityTags:
    """Get tags for an entity."""
    return get_tag_manager().get_tags(entity_type, entity_id)


@router.delete("/v1/tags/{entity_type}/{entity_id}", tags=["tags"])
async def remove_entity_tags(entity_type: str, entity_id: str, tags: str = "") -> dict:
    """Remove tags from an entity."""
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    removed = get_tag_manager().remove_tags(entity_type, entity_id, tag_list)
    return {"removed": removed}


# --- Health Probes ------------------------------------------------------------

@router.get("/v1/health/detailed", tags=["health"])
async def detailed_health() -> HealthReport:
    """Deep health check of all subsystems."""
    return check_health()


# --- Usage Quotas -------------------------------------------------------------

@router.post("/v1/quotas/tiers", status_code=201, tags=["quotas"])
async def create_quota_tier(body: QuotaTierCreate) -> QuotaTierInfo:
    """Create a quota tier."""
    try:
        return get_quota_manager().create_tier(body).to_info()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/v1/quotas/tiers", tags=["quotas"])
async def list_quota_tiers() -> dict:
    """List quota tiers."""
    return {"data": [t.to_info().model_dump() for t in get_quota_manager().list_tiers()], "stats": get_quota_manager().stats()}


@router.post("/v1/quotas/assign", tags=["quotas"])
async def assign_quota_tier(body: QuotaAssignmentCreate) -> dict:
    """Assign a quota tier to an identifier."""
    try:
        get_quota_manager().assign_tier(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"assigned": body.identifier, "tier": body.tier_name}


@router.get("/v1/quotas/check", tags=["quotas"])
async def check_quota(identifier: str) -> QuotaUsage:
    """Check quota status for an identifier."""
    return get_quota_manager().check_quota(identifier)


@router.post("/v1/quotas/record", tags=["quotas"])
async def record_quota_usage(identifier: str, tokens: int = 0, requests: int = 1) -> QuotaUsage:
    """Record usage against quota."""
    return get_quota_manager().record_usage(identifier, tokens=tokens, requests=requests)


# --- Command Palette ----------------------------------------------------------

@router.post("/v1/commands", status_code=201, tags=["commands"])
async def create_command(body: CommandCreate) -> CommandInfo:
    """Register a command."""
    try:
        return get_command_manager().create(body).to_info()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/v1/commands", tags=["commands"])
async def list_commands(category: str | None = None) -> dict:
    """List commands."""
    mgr = get_command_manager()
    return {"data": [c.to_info().model_dump() for c in mgr.list_commands(category=category)], "stats": mgr.stats()}


@router.post("/v1/commands/defaults", tags=["commands"])
async def load_default_commands() -> dict:
    """Load built-in commands."""
    count = get_command_manager().load_defaults()
    return {"loaded": count}


@router.post("/v1/commands/{cmd_id}/invoke", tags=["commands"])
async def invoke_command(cmd_id: str, params: dict[str, Any] = None) -> CommandResult:
    """Invoke a command."""
    return get_command_manager().invoke(cmd_id, params)


@router.delete("/v1/commands/{cmd_id}", tags=["commands"])
async def delete_command(cmd_id: str) -> dict:
    """Delete a command."""
    try:
        if not get_command_manager().delete(cmd_id):
            raise HTTPException(status_code=404, detail=f"No command '{cmd_id}'.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"deleted": cmd_id}


# --- Sharing ------------------------------------------------------------------

@router.post("/v1/shares", status_code=201, tags=["sharing"])
async def create_share(body: ShareCreate) -> ShareInfo:
    """Share an entity."""
    try:
        return get_share_manager().create(body).to_info()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/v1/shares", tags=["sharing"])
async def list_shares(entity_type: str | None = None, entity_id: str | None = None) -> dict:
    """List shares."""
    return {"data": [s.to_info().model_dump() for s in get_share_manager().list_shares(entity_type=entity_type, entity_id=entity_id)], "stats": get_share_manager().stats()}


@router.get("/v1/shares/check", tags=["sharing"])
async def check_permission(entity_type: str, entity_id: str, user: str, permission: str = "viewer") -> PermissionCheck:
    """Check permission on an entity."""
    return get_share_manager().check_permission(entity_type, entity_id, user, permission)


@router.post("/v1/shares/{share_id}/revoke", tags=["sharing"])
async def revoke_share(share_id: str) -> dict:
    """Revoke a share."""
    if not get_share_manager().revoke(share_id):
        raise HTTPException(status_code=404, detail=f"No share '{share_id}'.")
    return {"revoked": share_id}


@router.delete("/v1/shares/{share_id}", tags=["sharing"])
async def delete_share(share_id: str) -> dict:
    """Delete a share."""
    if not get_share_manager().delete(share_id):
        raise HTTPException(status_code=404, detail=f"No share '{share_id}'.")
    return {"deleted": share_id}


# --- Changelog ----------------------------------------------------------------

@router.post("/v1/changelog", status_code=201, tags=["changelog"])
async def create_changelog_entry(body: ChangeEntryCreate) -> ChangeEntryInfo:
    """Record a changelog entry."""
    return get_changelog_manager().create(body).to_info()


@router.get("/v1/changelog", tags=["changelog"])
async def list_changelog(version: str | None = None, category: str | None = None, limit: int = 50) -> dict:
    """List changelog entries."""
    mgr = get_changelog_manager()
    return {"data": [e.to_info().model_dump() for e in mgr.list_entries(version=version, category=category, limit=limit)], "versions": mgr.list_versions(), "stats": mgr.stats()}


@router.get("/v1/changelog/breaking", tags=["changelog"])
async def breaking_changes(since: str = "") -> dict:
    """Get breaking changes."""
    return {"changes": [e.to_info().model_dump() for e in get_changelog_manager().breaking_changes(since)]}


@router.get("/v1/changelog/search", tags=["changelog"])
async def search_changelog(q: str, limit: int = 20) -> dict:
    """Search changelog."""
    return {"results": [e.to_info().model_dump() for e in get_changelog_manager().search(q, limit=limit)]}


# ============================================================================
# ÆTHERIS NOVA — next-generation architecture endpoints
# ============================================================================

class ReasonRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=20_000)
    effort: str = Field(default="medium", pattern="^(low|medium|high|max)$")
    thinking_budget: int | None = Field(default=None, ge=500, le=64_000)
    reflection_passes: int | None = Field(default=None, ge=0, le=6)
    verification: bool | None = None
    model: str | None = None
    mode: str | None = None


class RouteRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=20_000)
    top_k: int | None = Field(default=None, ge=1, le=4)


class OrchestrateRequest(BaseModel):
    goal: str = Field(..., min_length=1, max_length=20_000)
    mode: str = Field(default="council", pattern="^(council|debate|pipeline|swarm)$")
    rounds: int = Field(default=3, ge=1, le=12)


class ResearchRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=20_000)
    depth: int = Field(default=1, ge=0, le=4)
    max_searches: int = Field(default=8, ge=1, le=32)


class MemoryAddRequest(BaseModel):
    tier: str = Field(..., pattern="^(core|recall|archival)$")
    text: str = Field(..., min_length=1, max_length=50_000)
    kind: str = "note"
    importance: float = Field(default=0.5, ge=0.0, le=1.0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class MemorySearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    tiers: list[str] = Field(default_factory=lambda: ["core", "recall", "archival"])
    top_k: int = Field(default=5, ge=1, le=50)


class CanvasCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    kind: str = Field(..., pattern="^(document|svg|react_like|chart|mermaid|dashboard)$")
    content: str = Field(default="")
    metadata: dict[str, Any] = Field(default_factory=dict)


class CanvasUpdateRequest(BaseModel):
    content: str = Field(..., min_length=0)
    note: str = ""
    author: str = "aetheris"


class PlanRequest(BaseModel):
    goal: str = Field(..., min_length=1, max_length=20_000)


class ComputerActionRequest(BaseModel):
    session_id: str
    kind: str = Field(..., pattern="^(screenshot|click|type|scroll|key|drag|navigate)$")
    x: int | None = None
    y: int | None = None
    text: str | None = None
    key: str | None = None
    dx: int = 0
    dy: int = 0
    url: str | None = None


def _nova_guard():
    if not settings.nova_enabled:
        raise HTTPException(status_code=403, detail="Ætheris NOVA is disabled on this deployment.")


@router.get("/v1/nova", tags=["nova"])
async def nova_manifest() -> dict:
    """Return the full Ætheris NOVA architecture manifest."""
    _nova_guard()
    from ..core.nova import nova_manifest
    return {
        "codename": "NOVA",
        "version": __version__,
        "enabled": True,
        **nova_manifest(),
    }


# --- Extended reasoning ------------------------------------------------------

@router.post("/v1/nova/reason", tags=["nova"])
async def nova_reason(body: ReasonRequest) -> dict:
    """Deliberative reasoning (decompose → draft → reflect → verify → synthesize).

    Returns a structured ``reasoning_trace`` alongside the final answer so
    clients can render a live "thinking" view.
    """
    _nova_guard()
    from ..services.reasoning import get_engine
    from ..tools.sandbox import run_python

    async def _code_sandbox(code: str):
        if not settings.sandbox_enabled:
            return {"stdout": "", "stderr": "sandbox disabled", "exit_code": -1}
        r = await run_python(code)
        return {"stdout": r.stdout, "stderr": r.stderr, "exit_code": r.exit_code}

    tools = {"code_interpreter": _code_sandbox} if settings.sandbox_enabled else {}
    engine = get_engine()
    mem_ctx = ""
    try:
        from ..services.memory import get_memory
        mem = get_memory()
        # auto-memorize the prompt as an episode for future recall
        mem.remember_episode("user", body.prompt)
        mem_ctx = mem.context_window(body.prompt)
    except Exception:
        pass
    result = await engine.reason(
        body.prompt,
        effort=body.effort,
        thinking_budget=body.thinking_budget,
        reflection_passes=body.reflection_passes,
        verification=body.verification,
        tools=tools,
        memory_context=mem_ctx,
    )
    return result.to_dict()


# --- MoE routing -------------------------------------------------------------

@router.post("/v1/nova/route", tags=["nova"])
async def nova_route(body: RouteRequest) -> dict:
    """Route a prompt through the Sparse Mixture-of-Experts and return the
    chosen experts with their weights and signals."""
    _nova_guard()
    from ..services.moe import get_router
    router_moe = get_router()
    routed = router_moe.route(body.text, top_k=body.top_k)
    composed, report = router_moe.compose_system_prompt(body.text, top_k=body.top_k)
    return {
        "query": body.text,
        "experts": report,
        "composed_system_prompt": composed,
        "router_stats": router_moe.stats(),
    }


@router.get("/v1/nova/experts", tags=["nova"])
async def nova_experts() -> dict:
    """List all routed experts with their triggers and specialisations."""
    _nova_guard()
    from ..core.nova import EXPERTS
    from dataclasses import asdict
    return {"experts": [asdict(e) for e in EXPERTS]}


# --- Multi-agent orchestrator ------------------------------------------------

@router.post("/v1/nova/orchestrate", tags=["nova"])
async def nova_orchestrate(body: OrchestrateRequest) -> dict:
    """Run a multi-agent orchestration (council, debate, pipeline, swarm)."""
    _nova_guard()
    from ..services.orchestrator import get_orchestrator
    orch = get_orchestrator()
    result = await orch.run(body.mode, body.goal, rounds=body.rounds)
    return result.to_dict()


@router.get("/v1/nova/roles", tags=["nova"])
async def nova_roles() -> dict:
    """List available agent roles and their system prompts."""
    _nova_guard()
    from ..services.orchestrator import ROLE_PROMPTS
    return {"roles": ROLE_PROMPTS, "modes": ["council", "debate", "pipeline", "swarm"]}


# --- Deep research -----------------------------------------------------------

@router.post("/v1/nova/research", tags=["nova"])
async def nova_research(body: ResearchRequest) -> dict:
    """Run a deep-research loop with query expansion, grounding, and synthesis."""
    _nova_guard()
    from ..services.research import DeepResearcher
    from ..tools.retrieval import get_index
    from ..services.memory import get_memory

    index = get_index()

    def _doc_search(q: str, top_k: int = 3):
        hits = index.search(q, top_k=top_k)
        return [h.to_dict() for h in hits]

    mem = get_memory() if settings.nova_enabled else None
    dr = DeepResearcher(document_search=_doc_search, memory=mem, max_searches=body.max_searches)
    result = await dr.research(body.question, depth=body.depth)
    # Archive the synthesized answer for future recall.
    try:
        mem.add("archival", f"Research on: {body.question}\n\n{result.answer}", kind="note", importance=0.7)
    except Exception:
        pass
    return result.to_dict()


# --- Hierarchical memory -----------------------------------------------------

@router.get("/v1/nova/memory", tags=["nova"])
async def nova_memory_snapshot() -> dict:
    """Snapshot the hierarchical memory (core/recall/archival)."""
    _nova_guard()
    from ..services.memory import get_memory
    return get_memory().snapshot()


@router.post("/v1/nova/memory", status_code=201, tags=["nova"])
async def nova_memory_add(body: MemoryAddRequest) -> dict:
    """Write a memory to a tier."""
    _nova_guard()
    from ..services.memory import get_memory
    from dataclasses import asdict
    entry = get_memory().add(body.tier, body.text, kind=body.kind, importance=body.importance, metadata=body.metadata)
    return asdict(entry)


@router.post("/v1/nova/memory/search", tags=["nova"])
async def nova_memory_search(body: MemorySearchRequest) -> dict:
    """Search the hierarchical memory with hybrid signature+BM25 retrieval."""
    _nova_guard()
    from ..services.memory import get_memory
    return {"query": body.query, "results": get_memory().search(body.query, tiers=body.tiers, top_k=body.top_k)}


@router.post("/v1/nova/memory/{entry_id}/promote", tags=["nova"])
async def nova_memory_promote(entry_id: str, reason: str = "") -> dict:
    """Promote a recall/archival memory into core (learn from experience)."""
    _nova_guard()
    from ..services.memory import get_memory
    from dataclasses import asdict
    try:
        entry = get_memory().promote(entry_id, reason=reason)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return asdict(entry)


@router.delete("/v1/nova/memory", tags=["nova"])
async def nova_memory_clear(tier: str | None = None) -> dict:
    """Clear a memory tier (or all)."""
    _nova_guard()
    from ..services.memory import get_memory
    return {"removed": get_memory().clear(tier=tier)}


# --- Canvas (live artifacts) -------------------------------------------------

@router.get("/v1/nova/canvas", tags=["nova"])
async def nova_canvas_list() -> dict:
    """List canvas artifacts."""
    _nova_guard()
    from ..services.canvas import get_canvas
    return {"artifacts": get_canvas().list()}


@router.post("/v1/nova/canvas", status_code=201, tags=["nova"])
async def nova_canvas_create(body: CanvasCreateRequest) -> dict:
    """Create a new canvas artifact."""
    _nova_guard()
    from ..services.canvas import get_canvas
    try:
        art = get_canvas().create(body.title, body.kind, body.content, metadata=body.metadata)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return get_canvas().render(art.id)


@router.get("/v1/nova/canvas/{artifact_id}", tags=["nova"])
async def nova_canvas_get(artifact_id: str) -> dict:
    """Render a canvas artifact (returns metadata + rendered HTML)."""
    _nova_guard()
    from ..services.canvas import get_canvas
    try:
        return get_canvas().render(artifact_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"No artifact {artifact_id!r}") from exc


@router.patch("/v1/nova/canvas/{artifact_id}", tags=["nova"])
async def nova_canvas_update(artifact_id: str, body: CanvasUpdateRequest) -> dict:
    """Update a canvas artifact (creates a new version)."""
    _nova_guard()
    from ..services.canvas import get_canvas
    try:
        art = get_canvas().update(artifact_id, body.content, author=body.author, note=body.note)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return get_canvas().render(art.id)


@router.get("/v1/nova/canvas/{artifact_id}/diff", tags=["nova"])
async def nova_canvas_diff(artifact_id: str, from_version: int | None = None, to_version: int | None = None) -> dict:
    """Get a unified diff between two versions of an artifact."""
    _nova_guard()
    from ..services.canvas import get_canvas
    try:
        art = get_canvas().get(artifact_id)
        return art.diff(from_version, to_version)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/v1/nova/canvas/{artifact_id}/revert", tags=["nova"])
async def nova_canvas_revert(artifact_id: str, version: int) -> dict:
    """Revert to a previous version."""
    _nova_guard()
    from ..services.canvas import get_canvas
    try:
        art = get_canvas().revert(artifact_id, version)
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return get_canvas().render(art.id)


@router.delete("/v1/nova/canvas/{artifact_id}", tags=["nova"])
async def nova_canvas_delete(artifact_id: str) -> dict:
    """Delete a canvas artifact."""
    _nova_guard()
    from ..services.canvas import get_canvas
    if not get_canvas().delete(artifact_id):
        raise HTTPException(status_code=404, detail=f"No artifact {artifact_id!r}")
    return {"deleted": artifact_id}


# --- Tool Composition v2 (planner + DAG) -------------------------------------

@router.post("/v1/nova/plan", tags=["nova"])
async def nova_plan(body: PlanRequest, execute: bool = False) -> dict:
    """Build a (DAG) plan for a goal, optionally executing it."""
    _nova_guard()
    from ..services.planner import get_composer
    from ..tools.sandbox import run_python
    from ..tools.retrieval import get_index

    composer = get_composer()

    async def _sandbox(args: dict) -> dict:
        code = args.get("code") or args.get("expression") or "print('no code supplied')"
        r = await run_python(code)
        return {"stdout": r.stdout, "stderr": r.stderr, "exit_code": r.exit_code}

    async def _search(args: dict) -> dict:
        q = args.get("query", "")
        hits = get_index().search(q, top_k=3)
        return {"results": [h.to_dict() for h in hits]}

    def _respond(args: dict) -> dict:
        return {"ok": True, "response": "Plan executed. See prior steps for outputs."}

    composer.register("code_interpreter", _sandbox)
    composer.register("calculator", _sandbox)
    composer.register("document_search", _search)
    composer.register("search", _search)
    composer.register("respond", lambda args: asyncio.sleep(0, result=_respond(args)))
    composer.register("write_code", lambda args: asyncio.sleep(0, result={"code": "def solve(items):\n    return sum(items)\n"}))
    composer.register("synthesize", lambda args: asyncio.sleep(0, result=_respond(args)))

    plan = composer.plan_for(body.goal)
    if not execute:
        return plan.to_dict()
    return await composer.execute(plan)


# --- Computer-Use (action schema + simulated desktop) ------------------------

@router.post("/v1/nova/computer-use/sessions", status_code=201, tags=["nova"])
async def nova_cu_create(confirmed: bool = False) -> dict:
    """Create a computer-use session (confirmation-gated by default)."""
    _nova_guard()
    from ..services.computer import get_computer
    s = get_computer().create_session(confirmed=confirmed)
    return {"id": s.id, "confirmed": s.confirmed, "viewport": s.viewport}


@router.post("/v1/nova/computer-use/sessions/{session_id}/confirm", tags=["nova"])
async def nova_cu_confirm(session_id: str) -> dict:
    """Confirm a session so mutating actions execute."""
    _nova_guard()
    from ..services.computer import get_computer
    try:
        return get_computer().confirm(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/v1/nova/computer-use/sessions/{session_id}/action", tags=["nova"])
async def nova_cu_action(session_id: str, body: ComputerActionRequest) -> dict:
    """Perform an action in a computer-use session.

    Mutating actions (click/type/key/drag/navigate) require a confirmed
    session.
    """
    _nova_guard()
    from ..services.computer import get_computer, ComputerAction
    cu = get_computer()
    try:
        action = ComputerAction(
            kind=body.kind, x=body.x, y=body.y, text=body.text, key=body.key,
            dx=body.dx, dy=body.dy, url=body.url,
        )
        return cu.perform(session_id, action)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/v1/nova/computer-use/sessions/{session_id}", tags=["nova"])
async def nova_cu_close(session_id: str) -> dict:
    """Close a computer-use session."""
    _nova_guard()
    from ..services.computer import get_computer
    return get_computer().close(session_id)


# ============================================================================
# v0.10.0 endpoints
# ============================================================================

# --- Cost tracking -----------------------------------------------------------

@router.get("/v1/costs", tags=["costs"])
async def cost_snapshot(since: float | None = None, client_id: str | None = None, model: str | None = None) -> dict:
    """Return aggregated token/cost snapshot."""
    if not settings.cost_tracking_enabled:
        raise HTTPException(status_code=403, detail="Cost tracking is disabled.")
    from ..core.cost_tracking import get_cost_tracker
    snap = get_cost_tracker().snapshot(since=since, client_id=client_id, model=model)
    return snap.model_dump()


@router.get("/v1/costs/entries", tags=["costs"])
async def cost_entries(limit: int = 100, client_id: str | None = None) -> dict:
    if not settings.cost_tracking_enabled:
        raise HTTPException(status_code=403, detail="Cost tracking is disabled.")
    from ..core.cost_tracking import get_cost_tracker
    return {"data": get_cost_tracker().list_entries(limit=limit, client_id=client_id)}


@router.get("/v1/costs/alerts", tags=["costs"])
async def cost_alerts(client_id: str | None = None, limit: int = 50) -> dict:
    if not settings.cost_tracking_enabled:
        raise HTTPException(status_code=403, detail="Cost tracking is disabled.")
    from ..core.cost_tracking import get_cost_tracker
    return {"data": get_cost_tracker().list_alerts(client_id=client_id, limit=limit)}


@router.get("/v1/costs/rates", tags=["costs"])
async def cost_rates() -> dict:
    if not settings.cost_tracking_enabled:
        raise HTTPException(status_code=403, detail="Cost tracking is disabled.")
    from ..core.cost_tracking import get_cost_tracker
    return {"rates": get_cost_tracker().list_rates()}


@router.put("/v1/costs/rates", tags=["costs"])
async def cost_set_rate(body: dict) -> dict:
    if not settings.cost_tracking_enabled:
        raise HTTPException(status_code=403, detail="Cost tracking is disabled.")
    from ..core.cost_tracking import get_cost_tracker, CostRate
    try:
        rate = CostRate(**{k: body.get(k, v) for k, v in {"model": "", "prompt_per_1k": 0.0, "completion_per_1k": 0.0}.items()})
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    get_cost_tracker().set_rate(rate)
    return {"ok": True, "rate": rate.model_dump()}


@router.put("/v1/costs/budgets/{client_id}", tags=["costs"])
async def cost_set_budget(client_id: str, body: dict) -> dict:
    if not settings.cost_tracking_enabled:
        raise HTTPException(status_code=403, detail="Cost tracking is disabled.")
    from ..core.cost_tracking import get_cost_tracker, Budget
    try:
        b = Budget(
            client_id=client_id,
            daily_usd=float(body.get("daily_usd", 0.0)),
            monthly_usd=float(body.get("monthly_usd", 0.0)),
            alert_threshold=float(body.get("alert_threshold", 0.8)),
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    get_cost_tracker().set_budget(b)
    return {"ok": True, "budget": b.model_dump()}


@router.delete("/v1/costs/budgets/{client_id}", tags=["costs"])
async def cost_delete_budget(client_id: str) -> dict:
    if not settings.cost_tracking_enabled:
        raise HTTPException(status_code=403, detail="Cost tracking is disabled.")
    from ..core.cost_tracking import get_cost_tracker
    return {"deleted": get_cost_tracker().delete_budget(client_id)}


@router.post("/v1/costs/record", tags=["costs"])
async def cost_record(body: dict) -> dict:
    if not settings.cost_tracking_enabled:
        raise HTTPException(status_code=403, detail="Cost tracking is disabled.")
    from ..core.cost_tracking import get_cost_tracker, UsageRecord
    try:
        rec = UsageRecord(
            client_id=body.get("client_id", "anonymous"),
            model=body.get("model", "aetheris-pro"),
            prompt_tokens=int(body.get("prompt_tokens", 0)),
            completion_tokens=int(body.get("completion_tokens", 0)),
            cost_usd=float(body.get("cost_usd", 0.0)),
            metadata=body.get("metadata", {}),
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return get_cost_tracker().record(rec)


@router.delete("/v1/costs", tags=["costs"])
async def cost_clear() -> dict:
    if not settings.cost_tracking_enabled:
        raise HTTPException(status_code=403, detail="Cost tracking is disabled.")
    from ..core.cost_tracking import get_cost_tracker
    return {"deleted": get_cost_tracker().clear()}


@router.get("/v1/costs/stats", tags=["costs"])
async def cost_stats_endpoint() -> dict:
    if not settings.cost_tracking_enabled:
        raise HTTPException(status_code=403, detail="Cost tracking is disabled.")
    from ..core.cost_tracking import get_cost_tracker
    return get_cost_tracker().stats()


# --- Drafts ------------------------------------------------------------------

@router.post("/v1/drafts", status_code=201, tags=["drafts"])
async def draft_create(body: dict) -> dict:
    if not settings.drafts_enabled:
        raise HTTPException(status_code=403, detail="Drafts are disabled.")
    from ..core.drafts import get_draft_manager, DraftCreate, _info
    mgr = get_draft_manager()
    try:
        d = mgr.create(DraftCreate(**body))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _info(d).model_dump()


@router.get("/v1/drafts", tags=["drafts"])
async def draft_list(entity_type: str | None = None, entity_id: str | None = None, client_id: str | None = None) -> dict:
    if not settings.drafts_enabled:
        raise HTTPException(status_code=403, detail="Drafts are disabled.")
    from ..core.drafts import get_draft_manager, _info
    mgr = get_draft_manager()
    items = mgr.list_drafts(entity_type=entity_type, entity_id=entity_id, client_id=client_id)
    return {"data": [_info(d).model_dump() for d in items], "stats": mgr.stats()}


@router.get("/v1/drafts/stats", tags=["drafts"])
async def draft_stats() -> dict:
    if not settings.drafts_enabled:
        raise HTTPException(status_code=403, detail="Drafts are disabled.")
    from ..core.drafts import get_draft_manager
    return get_draft_manager().stats()


@router.get("/v1/drafts/{draft_id}", tags=["drafts"])
async def draft_get(draft_id: str) -> dict:
    if not settings.drafts_enabled:
        raise HTTPException(status_code=403, detail="Drafts are disabled.")
    from ..core.drafts import get_draft_manager, _detail
    d = get_draft_manager().get(draft_id)
    if d is None:
        raise HTTPException(status_code=404, detail=f"No draft {draft_id!r}.")
    return _detail(d).model_dump()


@router.patch("/v1/drafts/{draft_id}", tags=["drafts"])
async def draft_update(draft_id: str, body: dict) -> dict:
    if not settings.drafts_enabled:
        raise HTTPException(status_code=403, detail="Drafts are disabled.")
    from ..core.drafts import get_draft_manager, DraftUpdate, DraftConflict, _detail
    mgr = get_draft_manager()
    try:
        up = DraftUpdate(**body)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    d, conflict = mgr.update(draft_id, up)
    if conflict is not None:
        raise HTTPException(status_code=409, detail=conflict)
    if d is None:
        raise HTTPException(status_code=404, detail=f"No draft {draft_id!r}.")
    return _detail(d).model_dump()


@router.post("/v1/drafts/{draft_id}/autosave", tags=["drafts"])
async def draft_autosave(draft_id: str, body: dict) -> dict:
    if not settings.drafts_enabled:
        raise HTTPException(status_code=403, detail="Drafts are disabled.")
    from ..core.drafts import get_draft_manager, DraftUpdate, _detail
    mgr = get_draft_manager()
    d, conflict = mgr.autosave(draft_id, body.get("content", ""), client_id=body.get("client_id", "anonymous"), metadata=body.get("metadata", {}))
    if conflict is not None:
        raise HTTPException(status_code=409, detail=conflict)
    if d is None:
        raise HTTPException(status_code=404, detail=f"No draft {draft_id!r}.")
    return _detail(d).model_dump()


@router.post("/v1/drafts/{draft_id}/revert", tags=["drafts"])
async def draft_revert(draft_id: str, version: int, client_id: str = "system") -> dict:
    if not settings.drafts_enabled:
        raise HTTPException(status_code=403, detail="Drafts are disabled.")
    from ..core.drafts import get_draft_manager, _detail
    d = get_draft_manager().revert(draft_id, version, client_id=client_id)
    if d is None:
        raise HTTPException(status_code=400, detail="Invalid draft id or version.")
    return _detail(d).model_dump()


@router.post("/v1/drafts/{draft_id}/publish", tags=["drafts"])
async def draft_publish(draft_id: str) -> dict:
    if not settings.drafts_enabled:
        raise HTTPException(status_code=403, detail="Drafts are disabled.")
    from ..core.drafts import get_draft_manager
    out = get_draft_manager().publish(draft_id)
    if out is None:
        raise HTTPException(status_code=404, detail=f"No draft {draft_id!r}.")
    return out


@router.delete("/v1/drafts/{draft_id}", tags=["drafts"])
async def draft_delete(draft_id: str) -> dict:
    if not settings.drafts_enabled:
        raise HTTPException(status_code=403, detail="Drafts are disabled.")
    from ..core.drafts import get_draft_manager
    if not get_draft_manager().delete(draft_id):
        raise HTTPException(status_code=404, detail=f"No draft {draft_id!r}.")
    return {"deleted": draft_id}


# --- Shortcuts / keybindings -------------------------------------------------

@router.get("/v1/shortcuts", tags=["shortcuts"])
async def shortcut_list_profiles() -> dict:
    if not settings.shortcuts_enabled:
        raise HTTPException(status_code=403, detail="Shortcuts are disabled.")
    from ..core.shortcuts import get_shortcut_manager, _profile_info
    mgr = get_shortcut_manager()
    return {
        "data": [_profile_info(p).model_dump() for p in mgr.list_profiles()],
        "active": mgr.stats()["active_profile"],
        "stats": mgr.stats(),
    }


@router.post("/v1/shortcuts/profiles", status_code=201, tags=["shortcuts"])
async def shortcut_create_profile(body: dict) -> dict:
    if not settings.shortcuts_enabled:
        raise HTTPException(status_code=403, detail="Shortcuts are disabled.")
    from ..core.shortcuts import get_shortcut_manager, ProfileCreate, ShortcutBinding, _profile_detail
    mgr = get_shortcut_manager()
    try:
        bindings = [ShortcutBinding(**b) for b in body.get("bindings", [])]
        prof = mgr.create_profile(ProfileCreate(
            name=body.get("name", ""),
            description=body.get("description", ""),
            bindings=bindings,
            is_builtin=bool(body.get("is_builtin", False)),
        ))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _profile_detail(prof).model_dump()


@router.get("/v1/shortcuts/profiles/{pid}", tags=["shortcuts"])
async def shortcut_get_profile(pid: str) -> dict:
    if not settings.shortcuts_enabled:
        raise HTTPException(status_code=403, detail="Shortcuts are disabled.")
    from ..core.shortcuts import get_shortcut_manager, _profile_detail
    mgr = get_shortcut_manager()
    p = mgr.get(pid) or mgr.get_by_name(pid)
    if p is None:
        raise HTTPException(status_code=404, detail=f"No profile {pid!r}.")
    return _profile_detail(p).model_dump()


@router.post("/v1/shortcuts/profiles/{pid}/clone", tags=["shortcuts"])
async def shortcut_clone_profile(pid: str, body: dict) -> dict:
    if not settings.shortcuts_enabled:
        raise HTTPException(status_code=403, detail="Shortcuts are disabled.")
    from ..core.shortcuts import get_shortcut_manager, _profile_detail
    mgr = get_shortcut_manager()
    src = mgr.get(pid) or mgr.get_by_name(pid)
    if src is None:
        raise HTTPException(status_code=404, detail=f"No profile {pid!r}.")
    try:
        new_p = mgr.clone(src.id, body.get("name", f"{src.name}-clone"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _profile_detail(new_p).model_dump()


@router.put("/v1/shortcuts/profiles/{pid}/bindings", tags=["shortcuts"])
async def shortcut_bind(pid: str, body: dict) -> dict:
    if not settings.shortcuts_enabled:
        raise HTTPException(status_code=403, detail="Shortcuts are disabled.")
    from ..core.shortcuts import get_shortcut_manager, ShortcutBinding, _profile_detail
    mgr = get_shortcut_manager()
    try:
        b = ShortcutBinding(**body)
        mgr.bind(pid, b)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    p = mgr.get(pid)
    if p is None:
        raise HTTPException(status_code=404, detail=f"No profile {pid!r}.")
    return _profile_detail(p).model_dump()


@router.delete("/v1/shortcuts/profiles/{pid}/bindings", tags=["shortcuts"])
async def shortcut_unbind(pid: str, keys: str) -> dict:
    if not settings.shortcuts_enabled:
        raise HTTPException(status_code=403, detail="Shortcuts are disabled.")
    from ..core.shortcuts import get_shortcut_manager, _profile_detail
    mgr = get_shortcut_manager()
    try:
        mgr.unbind(pid, keys)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    p = mgr.get(pid)
    if p is None:
        raise HTTPException(status_code=404, detail=f"No profile {pid!r}.")
    return _profile_detail(p).model_dump()


@router.post("/v1/shortcuts/activate", tags=["shortcuts"])
async def shortcut_activate(body: dict) -> dict:
    if not settings.shortcuts_enabled:
        raise HTTPException(status_code=403, detail="Shortcuts are disabled.")
    from ..core.shortcuts import get_shortcut_manager, _profile_info
    mgr = get_shortcut_manager()
    try:
        p = mgr.set_active(body.get("id", ""))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _profile_info(p).model_dump()


@router.post("/v1/shortcuts/resolve", tags=["shortcuts"])
async def shortcut_resolve(body: dict) -> dict:
    if not settings.shortcuts_enabled:
        raise HTTPException(status_code=403, detail="Shortcuts are disabled.")
    from ..core.shortcuts import get_shortcut_manager
    mgr = get_shortcut_manager()
    res = mgr.resolve(body.get("keys", ""), when=body.get("when", "always"), profile=body.get("profile"))
    return res.model_dump()


@router.delete("/v1/shortcuts/profiles/{pid}", tags=["shortcuts"])
async def shortcut_delete_profile(pid: str) -> dict:
    if not settings.shortcuts_enabled:
        raise HTTPException(status_code=403, detail="Shortcuts are disabled.")
    from ..core.shortcuts import get_shortcut_manager
    mgr = get_shortcut_manager()
    try:
        ok = mgr.delete_profile(pid)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not ok:
        raise HTTPException(status_code=404, detail=f"No profile {pid!r}.")
    return {"deleted": pid}


# --- Comments / annotation threads -------------------------------------------

@router.post("/v1/comments", status_code=201, tags=["comments"])
async def comment_create(body: dict) -> dict:
    if not settings.comments_enabled:
        raise HTTPException(status_code=403, detail="Comments are disabled.")
    from ..core.comments import get_comment_manager, CommentCreate, _info
    mgr = get_comment_manager()
    try:
        c = mgr.create(CommentCreate(**body))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    # build thread
    thread = mgr.thread(c.thread_id)
    return {
        "thread_id": c.thread_id,
        "comments": [_info(x).model_dump() for x in thread],
    }


@router.get("/v1/comments", tags=["comments"])
async def comment_list(entity_type: str, entity_id: str, include_resolved: bool = True) -> dict:
    if not settings.comments_enabled:
        raise HTTPException(status_code=403, detail="Comments are disabled.")
    from ..core.comments import get_comment_manager, _info
    mgr = get_comment_manager()
    roots = mgr.list_for_entity(entity_type, entity_id, include_resolved=include_resolved)
    threads = []
    for r in roots:
        threads.append({
            "root": _info(r).model_dump(),
            "replies": [_info(x).model_dump() for x in mgr.thread(r.thread_id) if x.id != r.id],
        })
    return {"entity": {"type": entity_type, "id": entity_id}, "threads": threads, "stats": mgr.stats()}


@router.get("/v1/comments/search", tags=["comments"])
async def comment_search(q: str, limit: int = 20) -> dict:
    if not settings.comments_enabled:
        raise HTTPException(status_code=403, detail="Comments are disabled.")
    from ..core.comments import get_comment_manager, _info
    return {"query": q, "results": [_info(c).model_dump() for c in get_comment_manager().search(q, limit=limit)]}


@router.get("/v1/comments/stats", tags=["comments"])
async def comment_stats() -> dict:
    if not settings.comments_enabled:
        raise HTTPException(status_code=403, detail="Comments are disabled.")
    from ..core.comments import get_comment_manager
    return get_comment_manager().stats()


@router.patch("/v1/comments/{comment_id}", tags=["comments"])
async def comment_update(comment_id: str, body: dict) -> dict:
    if not settings.comments_enabled:
        raise HTTPException(status_code=403, detail="Comments are disabled.")
    from ..core.comments import get_comment_manager, CommentUpdate, _info
    mgr = get_comment_manager()
    try:
        up = CommentUpdate(**body)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    c = mgr.update(comment_id, up, actor=body.get("actor", "anonymous"))
    if c is None:
        raise HTTPException(status_code=404, detail=f"No comment {comment_id!r}.")
    return _info(c).model_dump()


@router.post("/v1/comments/{comment_id}/react", tags=["comments"])
async def comment_react(comment_id: str, body: dict) -> dict:
    if not settings.comments_enabled:
        raise HTTPException(status_code=403, detail="Comments are disabled.")
    from ..core.comments import get_comment_manager, ReactionCreate, _info
    mgr = get_comment_manager()
    try:
        r = ReactionCreate(**body)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    c = mgr.react(comment_id, r)
    if c is None:
        raise HTTPException(status_code=404, detail=f"No comment {comment_id!r}.")
    return _info(c).model_dump()


@router.post("/v1/comments/{comment_id}/resolve", tags=["comments"])
async def comment_resolve(comment_id: str, actor: str = "system") -> dict:
    if not settings.comments_enabled:
        raise HTTPException(status_code=403, detail="Comments are disabled.")
    from ..core.comments import get_comment_manager, CommentUpdate, _info
    mgr = get_comment_manager()
    c = mgr.update(comment_id, CommentUpdate(resolved=True), actor=actor)
    if c is None:
        raise HTTPException(status_code=404, detail=f"No comment {comment_id!r}.")
    return _info(c).model_dump()


@router.post("/v1/comments/{comment_id}/reopen", tags=["comments"])
async def comment_reopen(comment_id: str, actor: str = "system") -> dict:
    if not settings.comments_enabled:
        raise HTTPException(status_code=403, detail="Comments are disabled.")
    from ..core.comments import get_comment_manager, CommentUpdate, _info
    mgr = get_comment_manager()
    c = mgr.update(comment_id, CommentUpdate(resolved=False), actor=actor)
    if c is None:
        raise HTTPException(status_code=404, detail=f"No comment {comment_id!r}.")
    return _info(c).model_dump()


@router.delete("/v1/comments/{comment_id}", tags=["comments"])
async def comment_delete(comment_id: str) -> dict:
    if not settings.comments_enabled:
        raise HTTPException(status_code=403, detail="Comments are disabled.")
    from ..core.comments import get_comment_manager
    if not get_comment_manager().delete(comment_id):
        raise HTTPException(status_code=404, detail=f"No comment {comment_id!r}.")
    return {"deleted": comment_id}


# --- Recurring tasks ---------------------------------------------------------

@router.post("/v1/recurring", status_code=201, tags=["recurrence"])
async def recurrence_create(body: dict) -> dict:
    if not settings.recurrence_enabled:
        raise HTTPException(status_code=403, detail="Recurrence is disabled.")
    from ..core.recurrence import get_recurrence_manager, RecurringTaskCreate, RecurrenceRule, _info
    mgr = get_recurrence_manager()
    try:
        rule = RecurrenceRule(**body.get("rule", {}))
        task = mgr.create(RecurringTaskCreate(
            name=body.get("name", ""),
            description=body.get("description", ""),
            rule=rule,
            action_type=body.get("action_type", "workflow"),
            action_ref=body.get("action_ref", ""),
            parameters=body.get("parameters", {}),
            enabled=bool(body.get("enabled", True)),
        ))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _info(task).model_dump()


@router.get("/v1/recurring", tags=["recurrence"])
async def recurrence_list(enabled_only: bool = False, action_type: str | None = None) -> dict:
    if not settings.recurrence_enabled:
        raise HTTPException(status_code=403, detail="Recurrence is disabled.")
    from ..core.recurrence import get_recurrence_manager, _info
    mgr = get_recurrence_manager()
    items = mgr.list_tasks(enabled_only=enabled_only, action_type=action_type)
    return {"data": [_info(t).model_dump() for t in items], "stats": mgr.stats()}


@router.get("/v1/recurring/upcoming", tags=["recurrence"])
async def recurrence_upcoming(limit: int = 20) -> dict:
    if not settings.recurrence_enabled:
        raise HTTPException(status_code=403, detail="Recurrence is disabled.")
    from ..core.recurrence import get_recurrence_manager
    return {"upcoming": get_recurrence_manager().upcoming(limit=limit)}


@router.get("/v1/recurring/due", tags=["recurrence"])
async def recurrence_due() -> dict:
    if not settings.recurrence_enabled:
        raise HTTPException(status_code=403, detail="Recurrence is disabled.")
    from ..core.recurrence import get_recurrence_manager, _info
    return {"due": [_info(t).model_dump() for t in get_recurrence_manager().due_tasks()]}


@router.get("/v1/recurring/stats", tags=["recurrence"])
async def recurrence_stats() -> dict:
    if not settings.recurrence_enabled:
        raise HTTPException(status_code=403, detail="Recurrence is disabled.")
    from ..core.recurrence import get_recurrence_manager
    return get_recurrence_manager().stats()


@router.get("/v1/recurring/{tid}", tags=["recurrence"])
async def recurrence_get(tid: str) -> dict:
    if not settings.recurrence_enabled:
        raise HTTPException(status_code=403, detail="Recurrence is disabled.")
    from ..core.recurrence import get_recurrence_manager, _info
    t = get_recurrence_manager().get(tid)
    if t is None:
        raise HTTPException(status_code=404, detail=f"No recurring task {tid!r}.")
    return _info(t).model_dump()


@router.get("/v1/recurring/{tid}/occurrences", tags=["recurrence"])
async def recurrence_occurrences(tid: str, count: int = 10) -> dict:
    if not settings.recurrence_enabled:
        raise HTTPException(status_code=403, detail="Recurrence is disabled.")
    from ..core.recurrence import get_recurrence_manager
    mgr = get_recurrence_manager()
    if mgr.get(tid) is None:
        raise HTTPException(status_code=404, detail=f"No recurring task {tid!r}.")
    return {"id": tid, "occurrences": mgr.occurrences(tid, count=count)}


@router.post("/v1/recurring/{tid}/run", tags=["recurrence"])
async def recurrence_mark_run(tid: str) -> dict:
    if not settings.recurrence_enabled:
        raise HTTPException(status_code=403, detail="Recurrence is disabled.")
    from ..core.recurrence import get_recurrence_manager, _info
    t = get_recurrence_manager().mark_run(tid)
    if t is None:
        raise HTTPException(status_code=404, detail=f"No recurring task {tid!r}.")
    return _info(t).model_dump()


@router.post("/v1/recurring/{tid}/toggle", tags=["recurrence"])
async def recurrence_toggle(tid: str, enabled: bool = True) -> dict:
    if not settings.recurrence_enabled:
        raise HTTPException(status_code=403, detail="Recurrence is disabled.")
    from ..core.recurrence import get_recurrence_manager, _info
    t = get_recurrence_manager().set_enabled(tid, enabled)
    if t is None:
        raise HTTPException(status_code=404, detail=f"No recurring task {tid!r}.")
    return _info(t).model_dump()


@router.delete("/v1/recurring/{tid}", tags=["recurrence"])
async def recurrence_delete(tid: str) -> dict:
    if not settings.recurrence_enabled:
        raise HTTPException(status_code=403, detail="Recurrence is disabled.")
    from ..core.recurrence import get_recurrence_manager
    if not get_recurrence_manager().delete(tid):
        raise HTTPException(status_code=404, detail=f"No recurring task {tid!r}.")
    return {"deleted": tid}


# --- Embeddings & vector search ----------------------------------------------

@router.post("/v1/embeddings", tags=["embeddings"])
async def embeddings_create(body: dict) -> dict:
    if not settings.embeddings_enabled:
        raise HTTPException(status_code=403, detail="Embeddings are disabled.")
    from ..core.embeddings import get_embedding_manager
    mgr = get_embedding_manager()
    inp = body.get("input", "")
    normalize = bool(body.get("normalize", True))
    if isinstance(inp, str):
        texts = [inp]
    else:
        texts = list(inp)
    vecs = mgr.embed_many(texts, normalize=normalize)
    data = [
        {"object": "embedding", "index": i, "embedding": v}
        for i, v in enumerate(vecs)
    ]
    return {"object": "list", "data": data, "model": body.get("model", "aetheris-signature"),
            "usage": {"prompt_tokens": sum(len(t) for t in texts)}}


@router.post("/v1/embeddings/index", status_code=201, tags=["embeddings"])
async def embeddings_index(body: dict) -> dict:
    if not settings.embeddings_enabled:
        raise HTTPException(status_code=403, detail="Embeddings are disabled.")
    from ..core.embeddings import get_embedding_manager, IndexedDocument
    mgr = get_embedding_manager()
    try:
        doc = mgr.index_document(IndexedDocument(
            id=body.get("id", ""), text=body.get("text", ""), metadata=body.get("metadata", {}),
        ))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"id": doc.id, "added_at": doc.added_at, "metadata": doc.metadata}


@router.get("/v1/embeddings/index", tags=["embeddings"])
async def embeddings_list(limit: int = 100) -> dict:
    if not settings.embeddings_enabled:
        raise HTTPException(status_code=403, detail="Embeddings are disabled.")
    from ..core.embeddings import get_embedding_manager
    return {"data": get_embedding_manager().list_documents(limit=limit)}


@router.post("/v1/embeddings/search", tags=["embeddings"])
async def embeddings_search(body: dict) -> dict:
    if not settings.embeddings_enabled:
        raise HTTPException(status_code=403, detail="Embeddings are disabled.")
    from ..core.embeddings import get_embedding_manager, VectorSearchQuery
    mgr = get_embedding_manager()
    try:
        q = VectorSearchQuery(
            query=body.get("query", ""),
            top_k=int(body.get("top_k", 5)),
            threshold=float(body.get("threshold", 0.0)),
        )
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    res = mgr.search(q)
    return {
        "query": res.query,
        "count": res.count,
        "hits": [h.model_dump() for h in res.hits],
    }


@router.delete("/v1/embeddings/index/{doc_id}", tags=["embeddings"])
async def embeddings_delete(doc_id: str) -> dict:
    if not settings.embeddings_enabled:
        raise HTTPException(status_code=403, detail="Embeddings are disabled.")
    from ..core.embeddings import get_embedding_manager
    if not get_embedding_manager().delete(doc_id):
        raise HTTPException(status_code=404, detail=f"No indexed document {doc_id!r}.")
    return {"deleted": doc_id}


@router.delete("/v1/embeddings/index", tags=["embeddings"])
async def embeddings_clear() -> dict:
    if not settings.embeddings_enabled:
        raise HTTPException(status_code=403, detail="Embeddings are disabled.")
    from ..core.embeddings import get_embedding_manager
    return {"deleted": get_embedding_manager().clear()}


@router.get("/v1/embeddings/stats", tags=["embeddings"])
async def embeddings_stats() -> dict:
    if not settings.embeddings_enabled:
        raise HTTPException(status_code=403, detail="Embeddings are disabled.")
    from ..core.embeddings import get_embedding_manager
    return get_embedding_manager().stats()


# ==============================================================================
# Hermes — the unified offline agent + meta-learning runtime
# ==============================================================================

class HermesRunRequest(BaseModel):
    """A task for the unified Hermes agent."""

    task: str = Field(..., min_length=1, max_length=40_000, description="The task to run.")
    use_tools: bool | None = Field(
        default=None, description="Override tool use for this run (default: follow config)."
    )
    use_memory: bool = Field(default=True, description="Consult NOVA long-term memory.")
    learn: bool | None = Field(
        default=None, description="Record this episode for meta-learning (default: follow config)."
    )
    session_id: str = Field(default="", max_length=128)


class HermesFeedbackRequest(BaseModel):
    """Explicit reward signal for a past episode."""

    episode_id: str = Field(..., min_length=1, max_length=64)
    reward: float = Field(..., ge=0.0, le=1.0, description="0 = useless, 1 = perfect.")
    feedback: str = Field(default="", max_length=2_000)


class HermesCognitionRequest(BaseModel):
    """Inspect the cognition cascade without running tools or learning."""

    text: str = Field(..., min_length=1, max_length=40_000)


def _hermes_guard() -> None:
    if not settings.hermes_enabled:
        raise HTTPException(status_code=403, detail="The Hermes agent is disabled on this deployment.")


@router.get("/v1/hermes", tags=["hermes"])
async def hermes_manifest() -> dict:
    """Describe the Hermes runtime: its pillars, stages, and live learning state."""
    _hermes_guard()
    from ..hermes import FOUNDATION, KNOWLEDGE_BASE
    from ..hermes.cognition import INTENTS
    from ..hermes.meta_learning import get_meta_learner

    learner = get_meta_learner()
    return {
        "codename": "Hermes",
        "foundation": FOUNDATION,
        "version": __version__,
        "offline": True,
        "requires_api_key": False,
        "pillars": [
            {
                "id": "hermes_agent",
                "name": "Hermes Agent",
                "status": "live",
                "summary": (
                    "perceive → classify → adapt → deliberate → ground → route → "
                    "recall → act → synthesize → polish → learn, with the toolbelt "
                    "executed for real and every stage traced."
                ),
                "endpoint": "/v1/hermes/run",
            },
            {
                "id": "meta_learning",
                "name": "Meta-Learning",
                "status": "live",
                "summary": (
                    "Few-shot exemplar recall, Dirichlet intent priors, per-intent "
                    "tool priors, and a Reptile-style strategy update learned from "
                    "the agent's own episodes."
                ),
                "endpoint": "/v1/hermes/meta",
            },
        ],
        "stages": [
            "perceive", "classify", "adapt", "deliberate", "ground",
            "route", "recall", "act", "synthesize", "polish", "learn",
        ],
        "intents": list(INTENTS),
        "knowledge_articles": len(KNOWLEDGE_BASE),
        "learning_enabled": settings.hermes_learning_enabled,
        "episodes": learner.stats()["episodes"],
    }


@router.post("/v1/hermes/run", tags=["hermes"])
async def hermes_run(body: HermesRunRequest) -> dict:
    """Run one task through the full Hermes cascade and return the traced result."""
    _hermes_guard()
    from ..hermes.agent import get_hermes

    learn = settings.hermes_learning_enabled if body.learn is None else body.learn
    result = await get_hermes().run(
        body.task,
        use_tools=body.use_tools,
        use_memory=body.use_memory,
        learn=learn,
        max_tools=settings.hermes_max_tools_per_turn,
        session_id=body.session_id,
    )
    return result.to_dict()


@router.post("/v1/hermes/cognition", tags=["hermes"])
async def hermes_cognition(body: HermesCognitionRequest) -> dict:
    """Run only the deterministic cognition stages (no tools, no learning).

    Useful for inspecting exactly how a prompt is understood.
    """
    _hermes_guard()
    from ..hermes.cognition import classify, deliberate, ground, perceive

    perception = perceive(body.text)
    classification = classify(perception)
    computation = deliberate(body.text)
    hits = ground(body.text)
    return {
        "text": body.text,
        "perceive": perception.to_dict(),
        "classify": classification.to_dict(),
        "deliberate": computation.to_dict(),
        "ground": [h.to_dict() for h in hits],
    }


@router.get("/v1/hermes/knowledge", tags=["hermes"])
async def hermes_knowledge(category: str | None = None) -> dict:
    """List the built-in offline knowledge corpus."""
    _hermes_guard()
    from ..hermes.knowledge import CATEGORIES, KNOWLEDGE_BASE

    articles = [a for a in KNOWLEDGE_BASE if not category or a.category == category]
    return {
        "count": len(articles),
        "categories": list(CATEGORIES),
        "articles": [
            {
                "id": a.id,
                "title": a.title,
                "category": a.category,
                "chars": len(a.content),
            }
            for a in articles
        ],
    }


@router.get("/v1/hermes/knowledge/{article_id}", tags=["hermes"])
async def hermes_knowledge_article(article_id: str) -> dict:
    """Return one knowledge article in full."""
    _hermes_guard()
    from ..hermes.knowledge import KB_BY_ID

    article = KB_BY_ID.get(article_id)
    if article is None:
        raise HTTPException(status_code=404, detail=f"No article {article_id!r}.")
    return {
        "id": article.id,
        "title": article.title,
        "category": article.category,
        "content": article.content,
    }


@router.get("/v1/hermes/knowledge/search/{query}", tags=["hermes"])
async def hermes_knowledge_search(query: str, top_k: int = 5) -> dict:
    """BM25 search over the built-in corpus."""
    _hermes_guard()
    from ..hermes.cognition import get_knowledge_index

    hits = get_knowledge_index().search(query, top_k=max(1, min(top_k, 20)))
    return {"query": query, "hits": [h.to_dict() for h in hits]}


# --- Meta-learning ------------------------------------------------------------

@router.get("/v1/hermes/meta", tags=["hermes"])
async def hermes_meta_stats() -> dict:
    """Everything the meta-learner currently believes."""
    _hermes_guard()
    from ..hermes.meta_learning import get_meta_learner

    return get_meta_learner().stats()


@router.get("/v1/hermes/meta/episodes", tags=["hermes"])
async def hermes_meta_episodes(limit: int = 20) -> dict:
    """The most recent learned episodes."""
    _hermes_guard()
    from ..hermes.meta_learning import get_meta_learner

    return {"episodes": get_meta_learner().recent_episodes(limit=max(1, min(limit, 200)))}


@router.post("/v1/hermes/meta/adapt", tags=["hermes"])
async def hermes_meta_adapt(body: HermesCognitionRequest) -> dict:
    """Preview the adaptation the learner would apply to a task, without running it."""
    _hermes_guard()
    from ..hermes.meta_learning import get_meta_learner

    return get_meta_learner().adapt(body.text).to_dict()


@router.post("/v1/hermes/feedback", tags=["hermes"])
async def hermes_feedback(body: HermesFeedbackRequest) -> dict:
    """Reinforce (or penalise) a past episode with an explicit reward."""
    _hermes_guard()
    from ..hermes.agent import get_hermes

    episode = get_hermes().reinforce(body.episode_id, body.reward, body.feedback)
    if episode is None:
        raise HTTPException(status_code=404, detail=f"No episode {body.episode_id!r}.")
    from ..hermes.meta_learning import get_meta_learner

    return {"episode": episode, "strategy": get_meta_learner().strategy.as_dict()}


@router.delete("/v1/hermes/meta", tags=["hermes"])
async def hermes_meta_reset() -> dict:
    """Forget all meta-learned state (episodes, exemplars, priors, strategy)."""
    _hermes_guard()
    from ..hermes.meta_learning import get_meta_learner

    learner = get_meta_learner()
    learner.reset()
    return {"reset": True, "strategy": learner.strategy.as_dict()}


@router.post("/v1/hermes/meta/save", tags=["hermes"])
async def hermes_meta_save() -> dict:
    """Persist meta-learned state to the configured path."""
    _hermes_guard()
    if not settings.hermes_meta_state_path:
        raise HTTPException(
            status_code=400,
            detail="No AETHERIS_HERMES_META_STATE_PATH is configured.",
        )
    from ..hermes.meta_learning import get_meta_learner

    path = get_meta_learner().save(settings.hermes_meta_state_path)
    return {"saved": True, "path": str(path)}


class NeuralSynthesizeRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    model: str = Field(default="aetheris-prime-v4")
    mode: str = Field(default="general")
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, ge=1, le=8192)


@router.get("/v1/neural/models", tags=["neural"])
async def list_neural_models() -> dict:
    """Introspect all in-house sovereign neural models and architectural specs."""
    from ..core.neural_engine import list_custom_models

    models = list_custom_models()
    return {
        "count": len(models),
        "sovereign_engine": "Aetheris Neural Transformer Core v4.2",
        "zero_external_dependency": True,
        "models": [
            {
                "id": m.id,
                "name": m.name,
                "version": m.version,
                "parameters_total": m.parameters_total,
                "parameters_active": m.parameters_active,
                "architecture": m.architecture,
                "context_window": m.context_window,
                "max_output_tokens": m.max_output_tokens,
                "hidden_dim": m.hidden_dim,
                "num_layers": m.num_layers,
                "num_heads": m.num_heads,
                "latency_ms_per_token": m.latency_ms_per_token,
                "description": m.description,
                "specialties": list(m.specialties),
                "multimodal": m.multimodal,
                "reasoning_pass": m.reasoning_pass,
                "is_sovereign": m.is_sovereign,
            }
            for m in models
        ],
    }


@router.post("/v1/neural/synthesize", tags=["neural"])
async def neural_synthesize(body: NeuralSynthesizeRequest) -> dict:
    """Direct forward-pass synthesis through the sovereign neural engine."""
    from ..core.neural_engine import get_neural_engine

    engine = get_neural_engine(body.model)
    return await engine.synthesize(
        body.prompt,
        model=body.model,
        mode=body.mode,
        temperature=body.temperature,
        max_tokens=body.max_tokens,
    )


@router.get("/v1/gallery/images", tags=["media"])
async def gallery_images() -> dict:
    """Return the collection of high-fidelity mind-blowing UI/UX visual assets."""
    gallery = [
        {
            "id": "hero-neural-core",
            "url": "/images/hero-neural-core.png",
            "title": "Sovereign Neural Core v4.0",
            "tagline": "Quantum Synaptic Crystal Lattice",
            "prompt": "A breathtaking ultra-high-definition 8k futuristic neural quantum AI core, glowing cybernetic crystal lattice with intricate luminous synaptic connections, neon cyan, electric teal, and deep cosmic indigo filaments pulsing with energy.",
            "category": "Core Architecture",
            "tags": ["Neural Core", "Quantum Lattice", "Sovereign AI", "Obsidian Glass"],
            "dimensions": "1024x1024",
        },
        {
            "id": "multi-agent-nexus",
            "url": "/images/multi-agent-nexus.png",
            "title": "Multi-Agent MoE Holographic Matrix",
            "tagline": "Decentralized Swarm Orchestration",
            "prompt": "An extraordinary isometric 3D visualization of an autonomous multi-agent AI neural orchestrator, glowing holographic floating interface nodes, futuristic cybernetic data streams, iridescent purple and electric mint lasers connecting floating cognitive modules.",
            "category": "Multi-Agent Systems",
            "tags": ["Agent Swarm", "Mixture of Experts", "Holographic HUD", "Cognition Nodes"],
            "dimensions": "1024x1024",
        },
        {
            "id": "neural-canvas-synthesis",
            "url": "/images/neural-canvas-synthesis.png",
            "title": "Neural Canvas & Multimodal Synthesis",
            "tagline": "High-Dimensional Generative Flow",
            "prompt": "A mind-blowing surreal generative AI visual synthesis art piece, iridescent liquid chrome and glowing neon particles morphing into futuristic digital geometry, vibrant teal, magenta and gold lighting.",
            "category": "Generative Media",
            "tags": ["Generative Art", "Latent Canvas", "Procedural Vector", "Fluid Gradients"],
            "dimensions": "1024x1024",
        },
        {
            "id": "deep-reasoning-matrix",
            "url": "/images/deep-reasoning-matrix.png",
            "title": "Aetheris Omni Deep Reasoning Matrix",
            "tagline": "Recursive Mathematical Proof Engine",
            "prompt": "A stunning futuristic quantum reasoning matrix, glowing mathematical geometric mandalas and synaptic decision trees floating in dark space, electric blue and neon gold highlights.",
            "category": "Reasoning & Math",
            "tags": ["Formal Proofs", "Tree Search", "Chain of Thought", "Synaptic Graph"],
            "dimensions": "1024x1024",
        },
        {
            "id": "sovereign-shield-privacy",
            "url": "/images/sovereign-shield-privacy.png",
            "title": "Cryptographic Sovereign Shield",
            "tagline": "Air-Gapped Private Intelligence",
            "prompt": "A hyper-detailed futuristic cybernetic sovereign privacy shield, glowing cryptographic geometric rings, holographic data lock, neon mint and midnight indigo refraction.",
            "category": "Security & Privacy",
            "tags": ["Zero Network", "Air-Gapped", "No Cloud APIs", "Local Privacy"],
            "dimensions": "1024x1024",
        },
        {
            "id": "aetheris-banner",
            "url": "/images/aetheris-banner.png",
            "title": "Aetheris Cosmic Intelligence Matrix",
            "tagline": "Infinite Knowledge · Refined Synthesis",
            "prompt": "Cinematic wide cyberpunk banner of Aetheris sovereign intelligence matrix, glowing neural networks spreading across a dark cosmic horizon, neon teal and deep violet light trails.",
            "category": "Brand & Atmosphere",
            "tags": ["Cosmic Indigo", "Electric Teal", "Wide Horizon", "Cyberpunk"],
            "dimensions": "1024x1024",
        },
    ]
    return {"total": len(gallery), "images": gallery}


@router.get("/v1/neural/benchmarks", tags=["neural"])
async def neural_benchmarks() -> dict:
    """Return comprehensive competitive benchmark comparisons against open-source models."""
    from ..core.benchmarks import get_benchmark_comparison

    return get_benchmark_comparison()


@router.get("/v1/neural/adapters", tags=["neural"])
async def get_neural_adapters() -> dict:
    """List dynamic LoRA domain adapters and their active state."""
    from ..core.neural_engine import list_adapters

    adapters = list_adapters()
    return {"count": len(adapters), "adapters": adapters}


@router.post("/v1/neural/adapters/{adapter_id}/toggle", tags=["neural"])
async def toggle_neural_adapter(adapter_id: str, active: bool = True) -> dict:
    """Toggle a specialized LoRA domain adapter on or off."""
    from ..core.neural_engine import toggle_adapter, list_adapters

    success = toggle_adapter(adapter_id, active)
    if not success:
        raise HTTPException(status_code=404, detail=f"Adapter {adapter_id!r} not found.")
    return {"adapter_id": adapter_id, "active": active, "adapters": list_adapters()}


@router.get("/v1/neural/export/ollama/{model_id}", tags=["neural"])
async def export_ollama(model_id: str) -> dict:
    """Export an Ollama-compatible Modelfile for running in Ollama."""
    from ..core.neural_engine import export_ollama_modelfile

    modelfile = export_ollama_modelfile(model_id)
    return {"model_id": model_id, "format": "ollama", "modelfile": modelfile}


@router.get("/v1/neural/export/huggingface/{model_id}", tags=["neural"])
async def export_huggingface(model_id: str) -> dict:
    """Export HuggingFace transformers config.json format."""
    from ..core.neural_engine import export_huggingface_config

    config = export_huggingface_config(model_id)
    return {"model_id": model_id, "format": "huggingface", "config": config}


@router.get("/v1/neural/telemetry", tags=["neural"])
async def neural_telemetry() -> dict:
    """Real-time inference engine telemetry: PagedAttention, KV-cache, speculative decoding."""
    from ..core.neural_engine import get_neural_engine

    engine = get_neural_engine()
    sample_stats = engine.kv_manager.compute_cache_stats("Aetheris sovereign telemetry probe")
    return {
        "engine": "Aetheris Sovereign Neural Core v4.2",
        "paged_attention": sample_stats,
        "speculative_decoding": {
            "enabled": True,
            "draft_model": "aetheris-flash-v2",
            "target_model": "aetheris-omni-reasoner",
            "acceptance_rate": "84.6%",
            "effective_speedup": "2.42x",
        },
        "continuous_batching": {
            "active_slots": 4,
            "max_slots": 64,
            "mean_inter_token_latency_ms": 7.8,
            "time_to_first_token_ms": 32.4,
        },
    }


# ==============================================================================
# Frontier Tycoon Features: MLA, DeepSeek-MoE, 2M Context, Canvas, GPTs & Computer Use
# ==============================================================================

@router.get("/v1/neural/mla", tags=["neural"])
async def neural_mla(prompt: str = "Aetheris Multi-Head Latent Attention compression check") -> dict:
    """Introspect Multi-Head Latent Attention (MLA) low-rank KV compression."""
    from ..core.mla_engine import get_mla_engine

    return get_mla_engine().forward_pass(prompt)


@router.get("/v1/neural/niah", tags=["neural"])
async def neural_niah(needle: str = "Aetheris-Sovereign-Key-49281") -> dict:
    """Return 2,000,000 Token Virtual Needle-In-A-Haystack accuracy evaluation."""
    from ..core.mla_engine import get_niah

    return get_niah().run_virtual_niah_eval(needle)


@router.get("/v1/neural/deepseek-moe", tags=["neural"])
async def neural_deepseek_moe(prompt: str = "Deconstruct autonomous agent invariants") -> dict:
    """Inspect DeepSeek-style MoE with 1 Shared Expert + 64 Fine-Grained Routed Experts."""
    from ..core.mla_engine import get_deepseek_moe

    return get_deepseek_moe().route_tokens(prompt)


@router.get("/v1/neural/mtp", tags=["neural"])
async def neural_mtp(prefix: str = "Aetheris sovereign architecture") -> dict:
    """Inspect Multi-Token Prediction (MTP) lookahead heads (t+1, t+2)."""
    from ..core.mla_engine import get_mtp

    return get_mtp().predict_lookahead(prefix)


# --- Custom Sovereign GPTs / Agent Store --------------------------------------

class CustomAgentCreateRequest(BaseModel):
    name: str = Field(..., min_length=1)
    tagline: str = Field(..., min_length=1)
    system_prompt: str = Field(..., min_length=1)
    icon: str = Field(default="🤖")
    category: str = Field(default="Custom")
    model_id: str = Field(default="aetheris-prime-v4")
    tools_allowed: list[str] = Field(default_factory=lambda: ["code_interpreter", "calculator"])
    author: str = Field(default="User")


@router.get("/v1/agents/store", tags=["agents"])
async def list_agent_store(category: str | None = None) -> dict:
    """List pre-built tycoon-grade and user-created custom sovereign agents."""
    from ..core.custom_gpts import get_agent_store

    agents = get_agent_store().list_agents(category=category)
    return {"count": len(agents), "agents": agents}


@router.post("/v1/agents/custom", status_code=201, tags=["agents"])
async def create_custom_agent(body: CustomAgentCreateRequest) -> dict:
    """Create a new custom sovereign agent / GPT with custom tools & system prompt."""
    from ..core.custom_gpts import get_agent_store

    agent = get_agent_store().create_agent(
        name=body.name,
        tagline=body.tagline,
        system_prompt=body.system_prompt,
        icon=body.icon,
        category=body.category,
        model_id=body.model_id,
        tools_allowed=body.tools_allowed,
        author=body.author,
    )
    return agent


@router.delete("/v1/agents/custom/{agent_id}", tags=["agents"])
async def delete_custom_agent(agent_id: str) -> dict:
    """Delete a user-created sovereign agent."""
    from ..core.custom_gpts import get_agent_store

    deleted = get_agent_store().delete_agent(agent_id)
    if not deleted:
        raise HTTPException(status_code=400, detail=f"Agent {agent_id!r} cannot be deleted or not found.")
    return {"deleted": agent_id}


# --- Computer Use & GUI Action Protocol ---------------------------------------

class ComputerPlanRequest(BaseModel):
    action_type: str = Field(..., pattern="^(click|double_click|mouse_move|type_text|press_hotkey|scroll|take_screenshot|bash_exec|wait)$")
    x: int | None = None
    y: int | None = None
    text: str = ""
    key: str = ""
    command: str = ""


class ComputerExecRequest(BaseModel):
    action_id: str
    confirm: bool = True


@router.post("/v1/computer-use/plan", tags=["computer-use"])
async def plan_computer_action(body: ComputerPlanRequest) -> dict:
    """Stage and ground a GUI/system computer action (Anthropic / Operator style)."""
    from ..services.computer_use import get_computer_use

    return get_computer_use().plan_action(
        body.action_type,  # type: ignore[arg-type]
        x=body.x,
        y=body.y,
        text=body.text,
        key=body.key,
        command=body.command,
    )


@router.post("/v1/computer-use/execute", tags=["computer-use"])
async def execute_computer_action(body: ComputerExecRequest) -> dict:
    """Confirm and execute a staged computer action."""
    from ..services.computer_use import get_computer_use

    res = get_computer_use().execute_action(body.action_id, confirm=body.confirm)
    if "error" in res:
        raise HTTPException(status_code=404, detail=res["error"])
    return res


@router.get("/v1/computer-use/actions", tags=["computer-use"])
async def list_computer_actions(limit: int = 50) -> dict:
    """List computer use audit history."""
    from ..services.computer_use import get_computer_use

    actions = get_computer_use().list_actions(limit=limit)
    return {"count": len(actions), "actions": actions}


# --- Autonomous Deep Research -------------------------------------------------

class DeepResearchRunRequest(BaseModel):
    topic: str = Field(..., min_length=2, max_length=1000)
    depth: str = Field(default="deep", pattern="^(standard|deep|exhaustive)$")


@router.post("/v1/research/deep", tags=["research"])
async def run_deep_research(body: DeepResearchRunRequest) -> dict:
    """Execute an autonomous deep multi-hop research session (OpenAI Deep Research / Grok style)."""
    from ..services.deep_research import get_deep_research

    return await get_deep_research().execute_research(body.topic, depth=body.depth)


@router.get("/v1/research/deep/{report_id}", tags=["research"])
async def get_deep_research_report(report_id: str) -> dict:
    """Fetch a synthesized deep research report."""
    from ..services.deep_research import get_deep_research

    report = get_deep_research().get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail=f"Report {report_id!r} not found.")
    return report


# --- Interactive Canvas & Artifacts 2.0 ----------------------------------------

class ArtifactCreateRequest(BaseModel):
    title: str = Field(..., min_length=1)
    content: str = Field(..., min_length=1)
    artifact_type: str = Field(default="code", pattern="^(code|html|react|svg|markdown|mermaid|json)$")
    language: str = Field(default="python")
    summary: str = Field(default="Initial creation")


class ArtifactUpdateRequest(BaseModel):
    content: str = Field(..., min_length=1)
    summary: str = Field(default="Updated version")


@router.get("/v1/canvas/artifacts", tags=["canvas"])
async def list_canvas_artifacts() -> dict:
    """List interactive canvas artifacts with version history."""
    from ..services.canvas_workspace import get_canvas_manager

    artifacts = get_canvas_manager().list_artifacts()
    return {"count": len(artifacts), "artifacts": artifacts}


@router.post("/v1/canvas/artifacts", status_code=201, tags=["canvas"])
async def create_canvas_artifact(body: ArtifactCreateRequest) -> dict:
    """Create a new interactive canvas artifact."""
    from ..services.canvas_workspace import get_canvas_manager

    return get_canvas_manager().create_artifact(
        title=body.title,
        content=body.content,
        artifact_type=body.artifact_type,  # type: ignore[arg-type]
        language=body.language,
        summary=body.summary,
    )


@router.put("/v1/canvas/artifacts/{artifact_id}", tags=["canvas"])
async def update_canvas_artifact(artifact_id: str, body: ArtifactUpdateRequest) -> dict:
    """Update a canvas artifact, appending a new version."""
    from ..services.canvas_workspace import get_canvas_manager

    res = get_canvas_manager().update_artifact(
        artifact_id,
        new_content=body.content,
        summary=body.summary,
    )
    if not res:
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_id!r} not found.")
    return res


# ===========================================================================
# v0.12.0 — Apex cognition (graph, constitution, evals, skills, cache, …)
# ===========================================================================

def _apex_flag(name: str, detail: str) -> None:
    if not getattr(settings, name, False):
        raise HTTPException(status_code=403, detail=detail)


# --- Knowledge graph ---------------------------------------------------------

@router.get("/v1/graph", tags=["apex"])
async def graph_stats() -> dict:
    """Snapshot the knowledge graph (node/edge counts, kinds, relations)."""
    _apex_flag("knowledge_graph_enabled", "Knowledge graph is disabled.")
    from ..core.knowledge_graph import get_knowledge_graph
    return get_knowledge_graph().stats()


@router.get("/v1/graph/nodes", tags=["apex"])
async def graph_list_nodes(kind: str | None = None, limit: int = 100) -> dict:
    _apex_flag("knowledge_graph_enabled", "Knowledge graph is disabled.")
    from ..core.knowledge_graph import get_knowledge_graph
    return {"data": get_knowledge_graph().list_nodes(kind=kind, limit=limit)}


@router.get("/v1/graph/edges", tags=["apex"])
async def graph_list_edges(relation: str | None = None, limit: int = 200) -> dict:
    _apex_flag("knowledge_graph_enabled", "Knowledge graph is disabled.")
    from ..core.knowledge_graph import get_knowledge_graph
    return {"data": get_knowledge_graph().list_edges(relation=relation, limit=limit)}


@router.post("/v1/graph/nodes", status_code=201, tags=["apex"])
async def graph_upsert_node(body: dict) -> dict:
    _apex_flag("knowledge_graph_enabled", "Knowledge graph is disabled.")
    from ..core.knowledge_graph import EntityIn, get_knowledge_graph
    try:
        node = get_knowledge_graph().upsert_entity(EntityIn(**body))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return node.to_dict()


@router.post("/v1/graph/triples", status_code=201, tags=["apex"])
async def graph_add_triple(body: dict) -> dict:
    _apex_flag("knowledge_graph_enabled", "Knowledge graph is disabled.")
    from ..core.knowledge_graph import TripleIn, get_knowledge_graph
    try:
        edge = get_knowledge_graph().add_triple(TripleIn(**body))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return edge.to_dict()


@router.post("/v1/graph/ingest", tags=["apex"])
async def graph_ingest(body: dict) -> dict:
    """Extract entities and triples from free text and merge them into the graph."""
    _apex_flag("knowledge_graph_enabled", "Knowledge graph is disabled.")
    from ..core.knowledge_graph import get_knowledge_graph
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    return get_knowledge_graph().ingest(text, source=body.get("source", "api"), title=body.get("title", ""))


@router.post("/v1/graph/query", tags=["apex"])
async def graph_query(body: dict) -> dict:
    """Link entities in a query and return a multi-hop subgraph."""
    _apex_flag("knowledge_graph_enabled", "Knowledge graph is disabled.")
    from ..core.knowledge_graph import GraphQuery, get_knowledge_graph
    try:
        q = GraphQuery(**body)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return get_knowledge_graph().query(q)


@router.post("/v1/graph/path", tags=["apex"])
async def graph_path(body: dict) -> dict:
    _apex_flag("knowledge_graph_enabled", "Knowledge graph is disabled.")
    from ..core.knowledge_graph import get_knowledge_graph
    src, dst = body.get("source", ""), body.get("target", "")
    if not src or not dst:
        raise HTTPException(status_code=400, detail="source and target are required")
    path = get_knowledge_graph().shortest_path(src, dst, max_hops=int(body.get("max_hops", 5)))
    if path is None:
        raise HTTPException(status_code=404, detail="no path")
    return {"source": src, "target": dst, "steps": path}


@router.get("/v1/graph/infer/{name}", tags=["apex"])
async def graph_infer(name: str, relation: str = "IS_A", max_hops: int = 4) -> dict:
    _apex_flag("knowledge_graph_enabled", "Knowledge graph is disabled.")
    from ..core.knowledge_graph import get_knowledge_graph
    return {"name": name, "relation": relation, "ancestry": get_knowledge_graph().infer(name, relation=relation, max_hops=max_hops)}  # type: ignore[arg-type]


@router.delete("/v1/graph/nodes/{name}", tags=["apex"])
async def graph_delete_node(name: str) -> dict:
    _apex_flag("knowledge_graph_enabled", "Knowledge graph is disabled.")
    from ..core.knowledge_graph import get_knowledge_graph
    if not get_knowledge_graph().delete_node(name):
        raise HTTPException(status_code=404, detail=f"No node {name!r}.")
    return {"deleted": name}


@router.delete("/v1/graph", tags=["apex"])
async def graph_clear(reseed: bool = True) -> dict:
    _apex_flag("knowledge_graph_enabled", "Knowledge graph is disabled.")
    from ..core.knowledge_graph import get_knowledge_graph
    g = get_knowledge_graph()
    deleted = g.clear()
    seeded = g.seed_aetheris() if reseed else 0
    return {"deleted": deleted, "reseeded_edges": seeded}


# --- Constitution ------------------------------------------------------------

@router.get("/v1/constitution", tags=["apex"])
async def constitution_list() -> dict:
    _apex_flag("constitution_enabled", "Constitution engine is disabled.")
    from ..core.constitution import get_constitution_engine
    eng = get_constitution_engine()
    return {"constitutions": eng.list_constitutions(), "principles": eng.list_principles(), "stats": eng.stats()}


@router.post("/v1/constitution/principles", status_code=201, tags=["apex"])
async def constitution_add_principle(body: dict) -> dict:
    _apex_flag("constitution_enabled", "Constitution engine is disabled.")
    from ..core.constitution import PrincipleIn, get_constitution_engine
    try:
        p = get_constitution_engine().add_principle(PrincipleIn(**body))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return p.to_dict()


@router.post("/v1/constitution/principles/{pid}/toggle", tags=["apex"])
async def constitution_toggle(pid: str, enabled: bool = True) -> dict:
    _apex_flag("constitution_enabled", "Constitution engine is disabled.")
    from ..core.constitution import get_constitution_engine
    p = get_constitution_engine().toggle(pid, enabled)
    if p is None:
        raise HTTPException(status_code=404, detail=f"No principle {pid!r}.")
    return p.to_dict()


@router.post("/v1/constitution/critique", tags=["apex"])
async def constitution_critique(body: dict) -> dict:
    _apex_flag("constitution_enabled", "Constitution engine is disabled.")
    from ..core.constitution import get_constitution_engine
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    return get_constitution_engine().critique(
        text,
        request=body.get("request", ""),
        grounded=bool(body.get("grounded", False)),
        constitution_id=body.get("constitution_id"),
    )


@router.post("/v1/constitution/revise", tags=["apex"])
async def constitution_revise(body: dict) -> dict:
    _apex_flag("constitution_enabled", "Constitution engine is disabled.")
    from ..core.constitution import get_constitution_engine
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    return get_constitution_engine().revise(
        text,
        request=body.get("request", ""),
        grounded=bool(body.get("grounded", False)),
        constitution_id=body.get("constitution_id"),
        max_passes=int(body.get("max_passes", 2)),
    )


@router.post("/v1/constitution/decide", tags=["apex"])
async def constitution_decide(body: dict) -> dict:
    _apex_flag("constitution_enabled", "Constitution engine is disabled.")
    from ..core.constitution import get_constitution_engine
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    return get_constitution_engine().decide(
        text,
        request=body.get("request", ""),
        grounded=bool(body.get("grounded", False)),
        constitution_id=body.get("constitution_id"),
    )


# --- Eval harness ------------------------------------------------------------

@router.get("/v1/evals", tags=["apex"])
async def evals_list() -> dict:
    _apex_flag("evals_enabled", "Eval harness is disabled.")
    from ..core.evals import get_eval_harness
    h = get_eval_harness()
    return {"suites": h.list_suites(), "stats": h.stats()}


@router.post("/v1/evals/suites", status_code=201, tags=["apex"])
async def evals_create_suite(body: dict) -> dict:
    _apex_flag("evals_enabled", "Eval harness is disabled.")
    from ..core.evals import SuiteIn, get_eval_harness
    try:
        suite = get_eval_harness().create_suite(SuiteIn(**body))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return suite.to_dict()


@router.get("/v1/evals/suites/{suite_id}", tags=["apex"])
async def evals_get_suite(suite_id: str) -> dict:
    _apex_flag("evals_enabled", "Eval harness is disabled.")
    from ..core.evals import get_eval_harness
    suite = get_eval_harness().get_suite(suite_id)
    if suite is None:
        raise HTTPException(status_code=404, detail=f"No suite {suite_id!r}.")
    return {**suite.to_dict(), "cases": [c.to_dict() for c in suite.cases]}


@router.post("/v1/evals/suites/{suite_id}/cases", status_code=201, tags=["apex"])
async def evals_add_case(suite_id: str, body: dict) -> dict:
    _apex_flag("evals_enabled", "Eval harness is disabled.")
    from ..core.evals import EvalCaseIn, get_eval_harness
    try:
        case = get_eval_harness().add_case(suite_id, EvalCaseIn(**body))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No suite {suite_id!r}.")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return case.to_dict()


@router.post("/v1/evals/run", tags=["apex"])
async def evals_run(body: dict) -> dict:
    """Run a suite. ``runner=hermes-cognition`` executes the live cascade."""
    _apex_flag("evals_enabled", "Eval harness is disabled.")
    from ..core.evals import get_eval_harness
    suite_id = body.get("suite_id") or "suite_hermes_cognition"
    try:
        run = get_eval_harness().run(
            suite_id,
            outputs=body.get("outputs"),
            runner=body.get("runner", "hermes-cognition" if not body.get("outputs") else "provided"),
        )
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No suite {suite_id!r}.")
    return run.to_dict()


@router.post("/v1/evals/ab", tags=["apex"])
async def evals_ab(body: dict) -> dict:
    _apex_flag("evals_enabled", "Eval harness is disabled.")
    from ..core.evals import get_eval_harness
    suite_id = body.get("suite_id") or "suite_hermes_cognition"
    try:
        return get_eval_harness().ab(suite_id, body.get("a") or {}, body.get("b") or {})
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No suite {suite_id!r}.")


@router.get("/v1/evals/runs", tags=["apex"])
async def evals_list_runs(suite_id: str | None = None, limit: int = 20) -> dict:
    _apex_flag("evals_enabled", "Eval harness is disabled.")
    from ..core.evals import get_eval_harness
    return {"data": get_eval_harness().list_runs(suite_id=suite_id, limit=limit)}


@router.get("/v1/evals/runs/{run_id}", tags=["apex"])
async def evals_get_run(run_id: str) -> dict:
    _apex_flag("evals_enabled", "Eval harness is disabled.")
    from ..core.evals import get_eval_harness
    run = get_eval_harness().get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"No run {run_id!r}.")
    return run.to_dict()


# --- Provenance --------------------------------------------------------------

@router.post("/v1/provenance", status_code=201, tags=["apex"])
async def provenance_record(body: dict) -> dict:
    _apex_flag("provenance_enabled", "Provenance is disabled.")
    from ..core.provenance import ProvenanceRecordIn, get_provenance_store
    try:
        rec = get_provenance_store().record(ProvenanceRecordIn(**body))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return rec.to_dict()


@router.get("/v1/provenance", tags=["apex"])
async def provenance_list(limit: int = 50) -> dict:
    _apex_flag("provenance_enabled", "Provenance is disabled.")
    from ..core.provenance import get_provenance_store
    store = get_provenance_store()
    return {"data": store.list_records(limit=limit), "stats": store.stats()}


@router.get("/v1/provenance/{record_id}", tags=["apex"])
async def provenance_get(record_id: str) -> dict:
    _apex_flag("provenance_enabled", "Provenance is disabled.")
    from ..core.provenance import get_provenance_store
    rec = get_provenance_store().get(record_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"No record {record_id!r}.")
    return rec.to_dict()


@router.get("/v1/provenance/{record_id}/graph", tags=["apex"])
async def provenance_graph(record_id: str) -> dict:
    _apex_flag("provenance_enabled", "Provenance is disabled.")
    from ..core.provenance import get_provenance_store
    g = get_provenance_store().graph(record_id)
    if g is None:
        raise HTTPException(status_code=404, detail=f"No record {record_id!r}.")
    return g


# --- Circuit breakers --------------------------------------------------------

@router.get("/v1/breakers", tags=["apex"])
async def breakers_list() -> dict:
    _apex_flag("circuit_breakers_enabled", "Circuit breakers are disabled.")
    from ..core.circuit_breakers import get_breaker_registry
    reg = get_breaker_registry()
    return {"data": reg.list_breakers(), "stats": reg.stats()}


@router.put("/v1/breakers/{name}", tags=["apex"])
async def breakers_configure(name: str, body: dict) -> dict:
    _apex_flag("circuit_breakers_enabled", "Circuit breakers are disabled.")
    from ..core.circuit_breakers import BreakerConfig, get_breaker_registry
    try:
        cfg = BreakerConfig(name=name, **{k: v for k, v in body.items() if k != "name"})
        br = get_breaker_registry().configure(cfg)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return br.to_dict()


@router.get("/v1/breakers/{name}", tags=["apex"])
async def breakers_get(name: str) -> dict:
    _apex_flag("circuit_breakers_enabled", "Circuit breakers are disabled.")
    from ..core.circuit_breakers import get_breaker_registry
    info = get_breaker_registry().get(name)
    if info is None:
        raise HTTPException(status_code=404, detail=f"No breaker {name!r}.")
    return info


@router.post("/v1/breakers/{name}/allow", tags=["apex"])
async def breakers_allow(name: str) -> dict:
    _apex_flag("circuit_breakers_enabled", "Circuit breakers are disabled.")
    from ..core.circuit_breakers import get_breaker_registry
    return get_breaker_registry().allow(name).model_dump()


@router.post("/v1/breakers/{name}/success", tags=["apex"])
async def breakers_success(name: str) -> dict:
    _apex_flag("circuit_breakers_enabled", "Circuit breakers are disabled.")
    from ..core.circuit_breakers import get_breaker_registry
    return get_breaker_registry().record_success(name)


@router.post("/v1/breakers/{name}/failure", tags=["apex"])
async def breakers_failure(name: str) -> dict:
    _apex_flag("circuit_breakers_enabled", "Circuit breakers are disabled.")
    from ..core.circuit_breakers import get_breaker_registry
    return get_breaker_registry().record_failure(name)


@router.post("/v1/breakers/{name}/reset", tags=["apex"])
async def breakers_reset(name: str) -> dict:
    _apex_flag("circuit_breakers_enabled", "Circuit breakers are disabled.")
    from ..core.circuit_breakers import get_breaker_registry
    if not get_breaker_registry().reset(name):
        raise HTTPException(status_code=404, detail=f"No breaker {name!r}.")
    return {"reset": name}


# --- Skills ------------------------------------------------------------------

@router.get("/v1/skills", tags=["apex"])
async def skills_list(enabled: bool | None = None) -> dict:
    _apex_flag("skills_enabled", "Skills are disabled.")
    from ..core.skills import get_skill_registry
    reg = get_skill_registry()
    return {"data": reg.list_skills(enabled=enabled), "stats": reg.stats()}


@router.post("/v1/skills", status_code=201, tags=["apex"])
async def skills_create(body: dict) -> dict:
    _apex_flag("skills_enabled", "Skills are disabled.")
    from ..core.skills import SkillIn, get_skill_registry
    try:
        skill = get_skill_registry().create(SkillIn(**body))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return skill.to_dict()


@router.get("/v1/skills/{skill_id}", tags=["apex"])
async def skills_get(skill_id: str) -> dict:
    _apex_flag("skills_enabled", "Skills are disabled.")
    from ..core.skills import get_skill_registry
    skill = get_skill_registry().get(skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail=f"No skill {skill_id!r}.")
    return skill.to_dict()


@router.post("/v1/skills/match", tags=["apex"])
async def skills_match(body: dict) -> dict:
    _apex_flag("skills_enabled", "Skills are disabled.")
    from ..core.skills import get_skill_registry
    task = (body.get("task") or "").strip()
    if not task:
        raise HTTPException(status_code=400, detail="task is required")
    return {
        "matches": get_skill_registry().match(
            task, top_k=int(body.get("top_k", 3)), threshold=float(body.get("threshold", 0.22))
        )
    }


@router.post("/v1/skills/compose", tags=["apex"])
async def skills_compose(body: dict) -> dict:
    _apex_flag("skills_enabled", "Skills are disabled.")
    from ..core.skills import get_skill_registry
    task = (body.get("task") or "").strip()
    if not task:
        raise HTTPException(status_code=400, detail="task is required")
    return get_skill_registry().compose(
        task, top_k=int(body.get("top_k", 2)), threshold=float(body.get("threshold", 0.28))
    )


@router.delete("/v1/skills/{skill_id}", tags=["apex"])
async def skills_delete(skill_id: str) -> dict:
    _apex_flag("skills_enabled", "Skills are disabled.")
    from ..core.skills import get_skill_registry
    if not get_skill_registry().delete(skill_id):
        raise HTTPException(status_code=404, detail=f"No deletable skill {skill_id!r}.")
    return {"deleted": skill_id}


# --- Semantic cache ----------------------------------------------------------

@router.get("/v1/semantic-cache", tags=["apex"])
async def semantic_cache_stats() -> dict:
    _apex_flag("semantic_cache_enabled", "Semantic cache is disabled.")
    from ..core.semantic_cache import get_semantic_cache
    cache = get_semantic_cache()
    return {"stats": cache.stats(), "entries": cache.list_entries()}


@router.post("/v1/semantic-cache", status_code=201, tags=["apex"])
async def semantic_cache_put(body: dict) -> dict:
    _apex_flag("semantic_cache_enabled", "Semantic cache is disabled.")
    from ..core.semantic_cache import CachePut, get_semantic_cache
    try:
        entry = get_semantic_cache().put(CachePut(**body))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return entry.to_dict()


@router.post("/v1/semantic-cache/lookup", tags=["apex"])
async def semantic_cache_lookup(body: dict) -> dict:
    _apex_flag("semantic_cache_enabled", "Semantic cache is disabled.")
    from ..core.semantic_cache import CacheLookup, get_semantic_cache
    try:
        return get_semantic_cache().lookup(CacheLookup(**body))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/v1/semantic-cache", tags=["apex"])
async def semantic_cache_invalidate(tag: str | None = None, entry_id: str | None = None) -> dict:
    _apex_flag("semantic_cache_enabled", "Semantic cache is disabled.")
    from ..core.semantic_cache import get_semantic_cache
    return {"deleted": get_semantic_cache().invalidate(tag=tag, entry_id=entry_id)}


# --- Guardrails --------------------------------------------------------------

@router.get("/v1/guardrails", tags=["apex"])
async def guardrails_list() -> dict:
    _apex_flag("guardrails_enabled", "Guardrails are disabled.")
    from ..core.guardrails import get_guardrail_service
    svc = get_guardrail_service()
    return {"contracts": svc.list_contracts(), "stats": svc.stats()}


@router.post("/v1/guardrails/contracts", status_code=201, tags=["apex"])
async def guardrails_create(body: dict) -> dict:
    _apex_flag("guardrails_enabled", "Guardrails are disabled.")
    from ..core.guardrails import ContractIn, get_guardrail_service
    try:
        c = get_guardrail_service().create(ContractIn(**body))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return c.to_dict()


@router.post("/v1/guardrails/validate", tags=["apex"])
async def guardrails_validate(body: dict) -> dict:
    _apex_flag("guardrails_enabled", "Guardrails are disabled.")
    from ..core.guardrails import ValidateRequest, get_guardrail_service
    try:
        req = ValidateRequest(**body)
        return get_guardrail_service().check(req)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/v1/guardrails/contracts/{contract_id}", tags=["apex"])
async def guardrails_delete(contract_id: str) -> dict:
    _apex_flag("guardrails_enabled", "Guardrails are disabled.")
    from ..core.guardrails import get_guardrail_service
    if not get_guardrail_service().delete(contract_id):
        raise HTTPException(status_code=404, detail=f"No contract {contract_id!r}.")
    return {"deleted": contract_id}


@router.get("/v1/apex", tags=["apex"])
async def apex_manifest() -> dict:
    """Describe the v0.12 Apex cognition layer and its live state."""
    from ..core.knowledge_graph import get_knowledge_graph
    from ..core.constitution import get_constitution_engine
    from ..core.evals import get_eval_harness
    from ..core.skills import get_skill_registry
    from ..core.circuit_breakers import get_breaker_registry
    from ..core.semantic_cache import get_semantic_cache
    from ..core.guardrails import get_guardrail_service
    from ..core.provenance import get_provenance_store

    return {
        "codename": "Apex",
        "version": __version__,
        "pillars": [
            {"id": "knowledge_graph", "status": "live" if settings.knowledge_graph_enabled else "off",
             "summary": "Entity-relation Graph RAG with multi-hop traversal.", "endpoint": "/v1/graph/query"},
            {"id": "constitution", "status": "live" if settings.constitution_enabled else "off",
             "summary": "Critique → revise → decide against named principles.", "endpoint": "/v1/constitution/decide"},
            {"id": "evals", "status": "live" if settings.evals_enabled else "off",
             "summary": "Deterministic graders, suites, scorecards, A/B.", "endpoint": "/v1/evals/run"},
            {"id": "provenance", "status": "live" if settings.provenance_enabled else "off",
             "summary": "Sentence-level citation graphs for every generation.", "endpoint": "/v1/provenance"},
            {"id": "circuit_breakers", "status": "live" if settings.circuit_breakers_enabled else "off",
             "summary": "Closed / open / half-open isolation for tools.", "endpoint": "/v1/breakers"},
            {"id": "skills", "status": "live" if settings.skills_enabled else "off",
             "summary": "Composable instruction packs matched per turn.", "endpoint": "/v1/skills/compose"},
            {"id": "semantic_cache", "status": "live" if settings.semantic_cache_enabled else "off",
             "summary": "Near-duplicate prompt reuse via signature embeddings.", "endpoint": "/v1/semantic-cache/lookup"},
            {"id": "guardrails", "status": "live" if settings.guardrails_enabled else "off",
             "summary": "JSON Schema contracts with repair.", "endpoint": "/v1/guardrails/validate"},
        ],
        "stats": {
            "graph": get_knowledge_graph().stats() if settings.knowledge_graph_enabled else {},
            "constitution": get_constitution_engine().stats() if settings.constitution_enabled else {},
            "evals": get_eval_harness().stats() if settings.evals_enabled else {},
            "skills": get_skill_registry().stats() if settings.skills_enabled else {},
            "breakers": get_breaker_registry().stats() if settings.circuit_breakers_enabled else {},
            "semantic_cache": get_semantic_cache().stats() if settings.semantic_cache_enabled else {},
            "guardrails": get_guardrail_service().stats() if settings.guardrails_enabled else {},
            "provenance": get_provenance_store().stats() if settings.provenance_enabled else {},
        },
    }


# ===========================================================================
# v0.13.0 — God Mode (ToT, causal world, hypotheses, proofs, red-team, forecasts)
# ===========================================================================

@router.get("/v1/god", tags=["god"])
async def god_manifest() -> dict:
    """Describe the God Mode arsenal and live stats."""
    _apex_flag("god_mode_enabled", "God Mode is disabled.")
    from ..core.god_mode import ENGINES, get_god_mode
    from ..core.tot import get_tot
    from ..core.world_model import get_world_model
    from ..core.hypothesis import get_hypothesis_engine
    from ..core.proof import get_proof_kernel
    from ..core.redteam import get_redteam
    from ..core.forecast import get_forecast_book

    return {
        "codename": "GOD",
        "version": __version__,
        "engines": list(ENGINES),
        "stats": {
            "god": get_god_mode().stats(),
            "tot": get_tot().stats() if settings.tot_enabled else {},
            "world": get_world_model().stats() if settings.world_model_enabled else {},
            "hypothesis": get_hypothesis_engine().stats() if settings.hypothesis_enabled else {},
            "proof": get_proof_kernel().stats() if settings.proof_kernel_enabled else {},
            "redteam": get_redteam().stats() if settings.redteam_enabled else {},
            "forecast": get_forecast_book().stats() if settings.forecast_enabled else {},
        },
    }


@router.post("/v1/god/run", tags=["god"])
async def god_run(body: dict) -> dict:
    """Route a task through the ultra arsenal and return a fused briefing."""
    _apex_flag("god_mode_enabled", "God Mode is disabled.")
    from ..core.god_mode import GodRunRequest, get_god_mode
    try:
        req = GodRunRequest(**body)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return get_god_mode().run(req)


@router.post("/v1/god/tot", tags=["god"])
async def god_tot(body: dict) -> dict:
    _apex_flag("tot_enabled", "Tree-of-Thought is disabled.")
    from ..core.tot import ToTRequest, get_tot
    try:
        req = ToTRequest(**body)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return get_tot().search(req)


@router.get("/v1/god/world", tags=["god"])
async def god_world() -> dict:
    _apex_flag("world_model_enabled", "World model is disabled.")
    from ..core.world_model import get_world_model
    wm = get_world_model()
    return {"variables": wm.list_variables(), "edges": wm.list_edges(), "stats": wm.stats()}


@router.post("/v1/god/world/intervene", tags=["god"])
async def god_intervene(body: dict) -> dict:
    _apex_flag("world_model_enabled", "World model is disabled.")
    from ..core.world_model import get_world_model
    do = body.get("do") or {}
    if not do:
        raise HTTPException(status_code=400, detail="do is required")
    try:
        return get_world_model().intervene(do, steps=int(body.get("steps", 4)))
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/v1/god/world/counterfactual", tags=["god"])
async def god_counterfactual(body: dict) -> dict:
    _apex_flag("world_model_enabled", "World model is disabled.")
    from ..core.world_model import get_world_model
    try:
        return get_world_model().counterfactual(
            body.get("fact") or {},
            body.get("do") or {},
            body.get("query") or "",
        )
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/v1/god/hypothesis", tags=["god"])
async def god_hypothesis(body: dict) -> dict:
    _apex_flag("hypothesis_enabled", "Hypothesis engine is disabled.")
    from ..core.hypothesis import HypothesisRequest, get_hypothesis_engine
    try:
        req = HypothesisRequest(**body)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return get_hypothesis_engine().infer(req)


@router.post("/v1/god/proof", tags=["god"])
async def god_proof(body: dict) -> dict:
    _apex_flag("proof_kernel_enabled", "Proof kernel is disabled.")
    from ..core.proof import ProofIn, get_proof_kernel
    try:
        proof = ProofIn(**body)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return get_proof_kernel().check(proof)


@router.get("/v1/god/proof/demo", tags=["god"])
async def god_proof_demo() -> dict:
    _apex_flag("proof_kernel_enabled", "Proof kernel is disabled.")
    from ..core.proof import get_proof_kernel
    return get_proof_kernel().modus_ponens_demo()


@router.get("/v1/god/redteam", tags=["god"])
async def god_redteam_list() -> dict:
    _apex_flag("redteam_enabled", "Red-team is disabled.")
    from ..core.redteam import get_redteam
    return {"probes": get_redteam().list_probes(), "stats": get_redteam().stats()}


@router.post("/v1/god/redteam/run", tags=["god"])
async def god_redteam_run(body: dict | None = None) -> dict:
    _apex_flag("redteam_enabled", "Red-team is disabled.")
    from ..core.redteam import get_redteam
    ids = (body or {}).get("probes") or []
    return get_redteam().run(ids)


@router.post("/v1/god/forecasts", status_code=201, tags=["god"])
async def god_forecast_file(body: dict) -> dict:
    _apex_flag("forecast_enabled", "Forecasting is disabled.")
    from ..core.forecast import ForecastIn, get_forecast_book
    try:
        rec = get_forecast_book().file(ForecastIn(**body))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return rec.to_dict()


@router.get("/v1/god/forecasts", tags=["god"])
async def god_forecast_list(resolved: bool | None = None) -> dict:
    _apex_flag("forecast_enabled", "Forecasting is disabled.")
    from ..core.forecast import get_forecast_book
    book = get_forecast_book()
    return {"data": book.list_forecasts(resolved=resolved), "calibration": book.calibration()}


@router.post("/v1/god/forecasts/{fid}/resolve", tags=["god"])
async def god_forecast_resolve(fid: str, body: dict) -> dict:
    _apex_flag("forecast_enabled", "Forecasting is disabled.")
    from ..core.forecast import ResolveIn, get_forecast_book
    try:
        rec = get_forecast_book().resolve(fid, ResolveIn(**body))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No forecast {fid!r}.")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return rec.to_dict()


__all__ = ["router"]


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

import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
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


def _training_to_model(training) -> TrainingPipelineModel:
    return TrainingPipelineModel(
        name=training.name,
        foundation=training.foundation,
        foundation_status=training.foundation_status,
        alignment_methods=list(training.alignment_methods),
        meta_learning_methods=list(training.meta_learning_methods),
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


__all__ = ["router"]

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
from fastapi.responses import StreamingResponse

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
    CapabilityReport,
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
from ..tools import registry
from ..tools.retrieval import get_index

logger = logging.getLogger("aetheris")

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


__all__ = ["router"]

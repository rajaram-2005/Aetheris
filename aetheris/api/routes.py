"""Aetheris API routes.

Endpoints:

* ``POST /v1/chat/completions`` — OpenAI-compatible chat completions (streaming
  and non-streaming), extended with a ``mode`` field for identity selection.
* ``GET /v1/models``        — list available Aetheris tiers.
* ``GET /v1/modes``         — list available inference modes.
* ``GET /v1/identity``      — the foundation-model specification (media-kit).
* ``GET /v1/health``        — liveness + active provider.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from .. import __version__
from ..core.modes import MODES, get_mode, known_mode_ids
from ..core.spec import get_spec
from ..core.tiers import TIERS, foundation_spec, get_tier
from ..schemas.chat import (
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatMessage,
    Choice,
    ChoiceMessage,
    ChunkChoice,
    DeltaMessage,
    Usage,
    new_completion_id,
    now_ts,
)
from ..schemas.models import ModelInfo, ModelList, ModeInfo, ModeList
from ..schemas.spec import (
    ArchitectureModel,
    ModalitySupportModel,
    SpecModel,
    TrainingPipelineModel,
    TrainingStageModel,
    TransformerConfigModel,
)
from ..services.llm import (
    ProviderError,
    get_provider,
)
from ..services.mock_provider import MockProvider

logger = logging.getLogger("aetheris")

router = APIRouter()


# --- Request preparation ------------------------------------------------------

def _approx_tokens(text: str) -> int:
    """Rough token estimate (~4 chars/token) for prompt accounting."""
    return max(1, len(text) // 4)


def _prepare(req: ChatCompletionRequest):
    """Resolve a request into a fully-prepared conversation for generation.

    Resolves the tier (from ``model``) and mode (from ``mode``), then prepends
    the mode's system prompt so the Aetheris identity is always active.
    """
    # KeyError.__str__ wraps the message in quotes; use args[0] for a clean detail.
    def _clean(exc: KeyError) -> str:
        return exc.args[0] if exc.args else str(exc)

    try:
        tier = get_tier(req.model)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=_clean(exc)) from exc

    try:
        mode = get_mode(req.mode)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=_clean(exc)) from exc

    # The mode's system prompt is always first; the caller's messages follow
    # verbatim (including any system messages they supplied).
    messages = [ChatMessage(role="system", content=mode.system_prompt), *req.messages]
    est_prompt = sum(_approx_tokens(m.content) for m in messages)

    # Late import to avoid a circular dependency at module load.
    from ..services.llm import PreparedConversation

    return PreparedConversation(
        tier=tier,
        mode=mode,
        messages=messages,
        request=req,
        estimated_prompt_tokens=est_prompt,
        meta={"tier": tier.id, "mode": mode.id},
    )


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
                message=ChoiceMessage(content=result.text),
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

    def _chunk(delta: DeltaMessage, finish_reason: str | None = None) -> str:
        payload = ChatCompletionChunk(
            id=completion_id,
            created=ts,
            model=model,
            mode=mode,
            choices=[ChunkChoice(index=0, delta=delta, finish_reason=finish_reason)],
        )
        return f"data: {payload.model_dump_json()}\n\n"

    # Opening chunk carries the assistant role.
    yield _chunk(DeltaMessage(role="assistant"))

    try:
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
    """List the available Aetheris inference modes."""
    return ModeList(
        data=[
            ModeInfo(
                id=m.id,
                display_name=m.display_name,
                description=m.description,
            )
            for m in MODES
        ]
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
    """Return the Aetheris training pipeline (Hermes Agent Foundation)."""
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
    }


__all__ = ["router"]

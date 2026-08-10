"""LLM provider abstraction and factory.

A provider turns a resolved (tier, mode, messages) tuple into generated text —
either as a single ``CompletionResult`` (non-streaming) or as an async iterator
of text deltas (streaming). The API layer is responsible for wrapping these
deltas into the OpenAI-compatible SSE chunk shape; providers stay focused on
generation only.

Two providers ship with Aetheris:

* ``MockProvider`` — a brand-aware, offline responder that demonstrates the
  Aetheris persona per mode. Active by default so the service runs anywhere.
* ``OpenAIProvider`` — forwards to any OpenAI-compatible ``/v1/chat/completions``
  endpoint, activated when ``AETHERIS_LLM_PROVIDER=openai`` and an API key is set.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import AsyncIterator

from ..core.config import settings
from ..core.modes import Mode
from ..core.tiers import ModelTier
from ..schemas.chat import ChatCompletionRequest, ChatMessage


class ProviderError(RuntimeError):
    """Raised when a backing provider fails to produce a completion."""


@dataclass
class CompletionResult:
    """The outcome of a non-streaming completion."""

    text: str
    finish_reason: str = "stop"
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


@dataclass
class PreparedConversation:
    """A request fully resolved for generation.

    ``messages`` already has the mode's system prompt prepended as the first
    ``system`` turn, guaranteeing the Aetheris identity is active regardless of
    what the caller supplied.
    """

    tier: ModelTier
    mode: Mode
    messages: list[ChatMessage]
    request: ChatCompletionRequest
    # Rough, provider-agnostic estimate of the prompt size in tokens.
    estimated_prompt_tokens: int = 0
    # Free-form metadata for logging/diagnostics.
    meta: dict[str, str] = field(default_factory=dict)


class LLMProvider(abc.ABC):
    """Interface every Aetheris backing provider implements."""

    @abc.abstractmethod
    async def complete(self, prepared: PreparedConversation) -> CompletionResult:
        """Generate a single completion."""

    @abc.abstractmethod
    def stream(self, prepared: PreparedConversation) -> AsyncIterator[str]:
        """Yield text deltas as an async iterator (used for SSE streaming)."""

    # Optional lifecycle hook; safe to override, no-op by default.
    async def aclose(self) -> None:  # pragma: no cover - default no-op
        """Release any provider-held resources."""


# --- Factory ------------------------------------------------------------------

_provider: LLMProvider | None = None


def get_provider() -> LLMProvider:
    """Return the process-wide provider, lazily constructed from settings.

    If ``openai`` is requested but no API key is configured, Aetheris falls back
    to the mock provider so the service remains functional and observable rather
    than failing to start.
    """
    global _provider
    if _provider is not None:
        return _provider

    # Local imports keep the factory decoupled from the implementations.
    from .mock_provider import MockProvider
    from .openai_provider import OpenAIProvider

    if settings.llm_provider == "openai" and settings.has_credentials:
        _provider = OpenAIProvider(
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key,
            default_model=settings.llm_model,
            timeout=settings.llm_timeout,
        )
    else:
        if settings.llm_provider == "openai" and not settings.has_credentials:
            # Graceful degradation: keep the API live and diagnosable.
            import logging

            logging.getLogger("aetheris").warning(
                "AETHERIS_LLM_PROVIDER=openai but no AETHERIS_LLM_API_KEY is set; "
                "falling back to the mock provider."
            )
        _provider = MockProvider()

    return _provider


async def close_provider() -> None:
    """Tear down the active provider, if any (called on app shutdown)."""
    global _provider
    if _provider is not None:
        await _provider.aclose()
        _provider = None


# --- Shared request preparation ----------------------------------------------

def approx_tokens(text: str) -> int:
    """A rough token estimate (~4 chars/token) suitable for usage accounting."""
    return max(1, len(text) // 4)


def prepare_conversation(
    messages: list[ChatMessage],
    *,
    model: str | None = None,
    mode: str | None = None,
    stream: bool = False,
    temperature: float | None = None,
    max_tokens: int | None = None,
    top_p: float | None = None,
    stop: str | list[str] | None = None,
) -> PreparedConversation:
    """Resolve a tier and mode, then assemble a ``PreparedConversation``.

    The selected mode's system prompt is prepended to ``messages`` so the
    Aetheris identity is always active regardless of what the caller supplied.
    ``messages`` must contain at least one ``user`` turn (validated by
    ``ChatCompletionRequest``).

    Raises:
        KeyError: If ``model`` or ``mode`` is not a known tier/mode. Callers
            translate this into the appropriate user-facing error.
    """
    # Local imports avoid an import cycle at module load time.
    from ..core.modes import get_mode
    from ..core.tiers import get_tier

    tier = get_tier(model)
    mode = get_mode(mode)
    prepared_messages = [
        ChatMessage(role="system", content=mode.system_prompt),
        *messages,
    ]
    est = sum(approx_tokens(m.content) for m in prepared_messages)
    request = ChatCompletionRequest(
        model=tier.id,
        messages=messages,
        mode=mode.id,
        stream=stream,
        temperature=temperature,
        max_tokens=max_tokens,
        top_p=top_p,
        stop=stop,
    )
    return PreparedConversation(
        tier=tier,
        mode=mode,
        messages=prepared_messages,
        request=request,
        estimated_prompt_tokens=est,
        meta={"tier": tier.id, "mode": mode.id},
    )


__all__ = [
    "ProviderError",
    "CompletionResult",
    "PreparedConversation",
    "LLMProvider",
    "get_provider",
    "close_provider",
    "approx_tokens",
    "prepare_conversation",
]

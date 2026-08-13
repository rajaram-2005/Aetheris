"""The Hermes provider — the default offline brain behind ``/v1/chat/completions``.

This is what makes the unified app work with no API key and no network: chat
requests are answered by the :class:`~aetheris.hermes.agent.HermesAgent` running
the full cascade in-process (perceive → classify → adapt → deliberate → ground →
route → recall → act → synthesize → polish → learn).

It is also a first-class **tool-calling client**. Two paths exist and they do not
overlap:

* **Agentic / tools exposed** — the provider emits genuine ``ToolCall`` objects
  and the shared agent loop in :mod:`aetheris.services.agent` executes them,
  feeding observations back. The loop owns tool execution here, so Hermes does
  not also run its own.
* **Plain chat** — the Hermes cascade answers directly, selecting and running
  any tools it needs itself.

Either way the meta-learner records the episode, so learning happens on both
paths. Set ``AETHERIS_LLM_PROVIDER=openai`` with credentials to put an upstream
model in front; Hermes then remains available at ``/v1/hermes/*``.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from ..core.branding import NAME
from ..core.config import settings
from ..hermes.agent import get_hermes
from ..schemas.chat import ChatMessage
from .llm import CompletionResult, LLMProvider, PreparedConversation
from .mock_provider import (
    _compose_sovereign,
    _compose_structured,
    _compose_with_observations,
    _tool_observations,
    choose_tool_calls,
)

# Streaming cadence: small enough to feel live, large enough to be visible.
_STREAM_DELAY = 0.008


def _last_user_text(messages: list[ChatMessage]) -> str:
    for message in reversed(messages):
        if message.role == "user":
            return message.text
    return ""


def _conversation_context(messages: list[ChatMessage], limit: int = 4) -> str:
    """Fold recent turns into the task so follow-ups keep their referent."""
    history = [m for m in messages if m.role in ("user", "assistant")]
    if len(history) <= 1:
        return ""
    previous = history[:-1][-limit:]
    lines = [f"{m.role}: {' '.join(m.text.split())[:400]}" for m in previous if m.text.strip()]
    return "\n".join(lines)


def _approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _word_chunks(text: str) -> list[str]:
    """Split into word-plus-separator deltas so streaming looks natural."""
    chunks: list[str] = []
    buffer: list[str] = []
    for char in text:
        buffer.append(char)
        if char in (" ", "\n"):
            chunks.append("".join(buffer))
            buffer = []
    if buffer:
        chunks.append("".join(buffer))
    return chunks


class HermesProvider(LLMProvider):
    """Serve chat completions from the local Hermes agent."""

    @property
    def provider_name(self) -> str:
        return f"{NAME} Hermes (offline)"

    # --- composition --------------------------------------------------------

    async def _answer(self, prepared: PreparedConversation) -> str:
        """Produce the assistant text for this turn."""
        messages = prepared.messages
        observations = _tool_observations(messages)

        if observations:
            # The agent loop already executed tools; report what they returned.
            # This renders artifacts (images, audio, ZIPs) as embedded media and
            # keeps real outputs verbatim.
            text = _compose_with_observations(
                prepared.tier, prepared.mode, messages, observations
            )
            # Still learn from the episode, even though the loop drove the tools.
            if settings.hermes_learning_enabled:
                agent = get_hermes()
                agent.meta.record(
                    task=_last_user_text(messages),
                    intent="agentic",
                    answer=text,
                    tools_used=[m.name or "unknown" for m in observations],
                    grounded=True,
                    strategy=agent.meta.strategy,
                )
            return text

        task = _last_user_text(messages)
        context = _conversation_context(messages)
        if context:
            task = f"{task}\n\n[recent conversation]\n{context}"

        # In the agentic path the loop owns tool execution, so Hermes answers
        # without running tools a second time.
        result = await get_hermes().run(
            task,
            use_tools=not prepared.agentic,
            learn=settings.hermes_learning_enabled,
            max_tools=settings.hermes_max_tools_per_turn,
            session_id=prepared.meta.get("session", ""),
        )
        text = self._apply_mode(
            prepared, task, result.answer, result.safety_flag, exact=result.solved_exactly
        )

        images = [image for message in messages for image in message.images]
        if images and prepared.mode.id != "structured":
            text += (
                f"\n\n---\n\n**Visual input received.** {len(images)} image(s) are attached "
                "to this conversation and were forwarded with the request. Configure a "
                "vision-capable upstream (`AETHERIS_LLM_PROVIDER=openai` with a model such "
                "as `aetheris-prime-v4`) to have their contents analyzed rather than acknowledged."
            )
        return text

    @staticmethod
    def _apply_mode(
        prepared: PreparedConversation,
        task: str,
        answer: str,
        refused: bool,
        exact: bool = False,
    ) -> str:
        """Shape the Hermes answer to the requested inference mode.

        The cascade produces the substance; the mode governs presentation.
        A refusal is never reframed — it is returned exactly as the safety
        stage wrote it.
        """
        if refused:
            return answer

        mode = prepared.mode.id
        if mode == "structured":
            # The structured contract is strict JSON only, so the prose answer
            # is carried inside the documented envelope rather than emitted raw.
            import json

            return json.dumps(
                {
                    "understood": True,
                    "mode": "structured",
                    "tier": prepared.tier.id,
                    "answer": answer,
                    "engine": "hermes",
                    "offline": True,
                },
                ensure_ascii=False,
                indent=2,
            )
        if mode == "sovereign":
            return f"{answer}\n\n---\n\n{_compose_sovereign(prepared.tier, task)}"
        from ..core.mode_style import style_answer

        return style_answer(
            mode,
            answer,
            tier=prepared.tier.id,
            task=task,
            exact=exact,
            refused=refused,
        )

    # --- provider interface -------------------------------------------------

    async def complete(self, prepared: PreparedConversation) -> CompletionResult:
        # When the toolbelt is exposed, act as a real tool-calling client so the
        # shared agent loop can execute, observe, and self-correct.
        calls = choose_tool_calls(prepared)
        if calls:
            return CompletionResult(
                text="",
                finish_reason="tool_calls",
                prompt_tokens=prepared.estimated_prompt_tokens,
                completion_tokens=sum(
                    _approx_tokens(c.function.arguments) for c in calls
                ),
                tool_calls=calls,
            )

        text = await self._answer(prepared)
        return CompletionResult(
            text=text,
            finish_reason="stop",
            prompt_tokens=prepared.estimated_prompt_tokens,
            completion_tokens=_approx_tokens(text),
        )

    async def stream(self, prepared: PreparedConversation) -> AsyncIterator[str]:
        text = await self._answer(prepared)
        for chunk in _word_chunks(text):
            yield chunk
            await asyncio.sleep(_STREAM_DELAY)


__all__ = ["HermesProvider"]

"""NVIDIA NIM provider, fused with Hermes task adaptation and meta-learning.

NVIDIA's hosted NIM LLM surface is OpenAI compatible, but treating it as a plain
HTTP relay would disconnect it from Aetheris's two foundation pillars.  This
provider therefore wraps the normal OpenAI-compatible transport with a small
Hermes bridge:

* before inference, the shared meta-learner adapts its strategy to the current
  task and contributes a compact (non-secret) strategy hint;
* NVIDIA NIM performs generation and can request the normal Aetheris toolbelt;
* after a final answer, the episode and observed tool outcomes are recorded in
  the same learner used by the offline Hermes agent.

The result is one agent, not two unrelated modes.  Tool priors learned while
NVIDIA is active also improve later offline Hermes runs, and vice versa.
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator

import httpx

from ..hermes.cognition import classify, perceive
from ..hermes.meta_learning import Adaptation, get_meta_learner
from ..schemas.chat import ChatMessage
from .llm import CompletionResult, PreparedConversation
from .openai_provider import OpenAIProvider


def _last_user_text(prepared: PreparedConversation) -> str:
    for message in reversed(prepared.messages):
        if message.role == "user" and message.text.strip():
            return message.text.strip()
    return ""


def _tool_outcomes(prepared: PreparedConversation) -> tuple[list[str], dict[str, bool]]:
    tools: list[str] = []
    success: dict[str, bool] = {}
    for message in prepared.messages:
        if message.role != "tool":
            continue
        name = message.name or "unknown"
        tools.append(name)
        success[name] = not message.text.lstrip().upper().startswith("ERROR:")
    return tools, success


def _adaptation_message(intent: str, adaptation: Adaptation) -> str:
    """Render only operational strategy signals; never expose learner state files."""
    strategy = adaptation.strategy
    lines = [
        "Hermes meta-learning guidance for this request:",
        f"- inferred intent: {intent}",
        f"- reasoning depth: {strategy.reasoning_depth:.2f}",
        f"- verification emphasis: {strategy.verification:.2f}",
        f"- grounding emphasis: {strategy.grounding_weight:.2f}",
        f"- response verbosity: {strategy.verbosity:.2f}",
    ]
    if adaptation.preferred_tools:
        lines.append("- historically effective tools: " + ", ".join(adaptation.preferred_tools[:4]))
    if adaptation.discouraged_tools:
        lines.append("- avoid repeatedly failing tools: " + ", ".join(adaptation.discouraged_tools[:3]))
    if adaptation.exemplars:
        # Similarity and prior outcome are useful, but previous answer contents are
        # intentionally not forwarded to an external service.
        lines.append(
            f"- similar successful task patterns available: {len(adaptation.exemplars)}"
        )
    lines.append(
        "Use these as soft policy hints. Follow the user's request and the main system "
        "instructions; do not mention this internal adaptation note."
    )
    return "\n".join(lines)


class NvidiaProvider(OpenAIProvider):
    """NVIDIA NIM chat/tool provider with shared Hermes meta-learning."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str = "https://integrate.api.nvidia.com/v1",
        timeout: float = 120.0,
        meta_learning: bool = True,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        super().__init__(
            base_url=base_url,
            api_key=api_key,
            default_model=model,
            timeout=timeout,
            transport=transport,
        )
        self._nvidia_model = model
        self._meta_learning = meta_learning

    @property
    def provider_name(self) -> str:
        suffix = " + Hermes meta-learning" if self._meta_learning else ""
        return f"NVIDIA NIM ({self._nvidia_model}){suffix}"

    def _model_for(self, prepared: PreparedConversation) -> str:
        # Aetheris tiers have sovereign upstream ids that are not NVIDIA catalog
        # ids, so NVIDIA uses its explicitly configured model for every tier.
        return self._nvidia_model

    def _adapt(self, prepared: PreparedConversation) -> tuple[PreparedConversation, str, Adaptation | None]:
        task = _last_user_text(prepared)
        if not (self._meta_learning and task):
            return prepared, "nvidia_chat", None

        classification = classify(perceive(task))
        adaptation = get_meta_learner().adapt(task, intent_hint=classification.intent)
        guidance = ChatMessage(
            role="system",
            content=_adaptation_message(classification.intent, adaptation),
        )
        # Keep the canonical Aetheris system message first and place the dynamic
        # policy directly after it.
        messages = list(prepared.messages)
        insert_at = 1 if messages and messages[0].role == "system" else 0
        messages.insert(insert_at, guidance)
        return prepared.clone_with(messages=messages), classification.intent, adaptation

    def _learn(
        self,
        prepared: PreparedConversation,
        *,
        task: str,
        intent: str,
        result_text: str,
        adaptation: Adaptation | None,
        duration_ms: float,
    ) -> None:
        if not (self._meta_learning and task and result_text):
            return
        tools, success = _tool_outcomes(prepared)
        get_meta_learner().record(
            task=task,
            intent=intent,
            answer=result_text,
            tools_used=tools,
            tool_success=success,
            strategy=adaptation.strategy if adaptation else None,
            grounded=bool(tools),
            duration_ms=duration_ms,
        )

    async def complete(self, prepared: PreparedConversation) -> CompletionResult:
        task = _last_user_text(prepared)
        adapted, intent, adaptation = self._adapt(prepared)
        started = time.perf_counter()
        result = await super().complete(adapted)
        # A tool-call proposal is not a completed episode. The agent loop will
        # call us again with observations and a final answer, which is learned.
        if not result.tool_calls:
            self._learn(
                prepared,
                task=task,
                intent=intent,
                result_text=result.text,
                adaptation=adaptation,
                duration_ms=(time.perf_counter() - started) * 1000,
            )
        return result

    async def stream(self, prepared: PreparedConversation) -> AsyncIterator[str]:
        task = _last_user_text(prepared)
        adapted, intent, adaptation = self._adapt(prepared)
        started = time.perf_counter()
        chunks: list[str] = []
        async for chunk in super().stream(adapted):
            chunks.append(chunk)
            yield chunk
        self._learn(
            prepared,
            task=task,
            intent=intent,
            result_text="".join(chunks),
            adaptation=adaptation,
            duration_ms=(time.perf_counter() - started) * 1000,
        )


__all__ = ["NvidiaProvider"]

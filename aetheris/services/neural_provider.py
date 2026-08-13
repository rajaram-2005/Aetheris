"""Aetheris Sovereign Neural LLM Provider.

Direct in-process inference provider running our proprietary neural models
(Aetheris Prime v4, Aetheris Omni Reasoner, Aetheris Flash v2, Aetheris Vision-Gen v3)
with zero external network dependencies or third-party keys.
"""

from __future__ import annotations

import asyncio
import time
from typing import AsyncIterator

from ..core.neural_engine import get_neural_engine, get_neural_model
from ..schemas.chat import FunctionCall, ToolCall
from .llm import CompletionResult, LLMProvider, PreparedConversation


class AetherisNeuralProvider(LLMProvider):
    """Sovereign in-house neural inference provider."""

    def __init__(self, default_model: str = "aetheris-prime-v4") -> None:
        self._default_model = default_model
        self._engine = get_neural_engine(default_model)

    @property
    def provider_name(self) -> str:
        spec = get_neural_model(self._default_model)
        return f"Aetheris Sovereign Neural Core ({spec.name})"

    async def complete(self, prepared: PreparedConversation) -> CompletionResult:
        # Construct full prompt context
        user_text = ""
        for m in reversed(prepared.messages):
            if m.role == "user":
                user_text = m.text
                break
        if not user_text and prepared.messages:
            user_text = prepared.messages[-1].text

        model_id = prepared.tier.upstream_model or self._default_model
        synth = await self._engine.synthesize(
            user_text,
            model=model_id,
            mode=prepared.mode.id,
            temperature=prepared.request.temperature or 0.7,
            max_tokens=prepared.request.max_tokens or 2048,
        )

        tool_calls: list[ToolCall] = []
        for raw_tool in synth.get("tool_calls", []):
            if isinstance(raw_tool, dict) and raw_tool.get("tool"):
                tool_calls.append(
                    ToolCall(
                        id=f"call_{int(time.time() * 1000)}",
                        function=FunctionCall(
                            name=raw_tool["tool"],
                            arguments=raw_tool.get("arguments") or "{}",
                        ),
                    )
                )

        return CompletionResult(
            text=synth["text"],
            finish_reason="stop",
            prompt_tokens=synth["prompt_tokens"],
            completion_tokens=synth["completion_tokens"],
            tool_calls=tool_calls,
        )

    async def stream(self, prepared: PreparedConversation) -> AsyncIterator[str]:
        user_text = ""
        for m in reversed(prepared.messages):
            if m.role == "user":
                user_text = m.text
                break
        if not user_text and prepared.messages:
            user_text = prepared.messages[-1].text

        model_id = prepared.tier.upstream_model or self._default_model
        async for chunk in self._engine.stream_tokens(
            user_text,
            model=model_id,
            mode=prepared.mode.id,
        ):
            yield chunk


__all__ = ["AetherisNeuralProvider"]

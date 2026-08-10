"""An OpenAI-compatible LLM provider.

Forwards prepared conversations to any endpoint that implements the
``/v1/chat/completions`` contract (OpenAI, Azure OpenAI, Together, Groq, vLLM,
Ollama's OpenAI shim, LM Studio, and others). Aetheris tiers are mapped to
upstream models via ``ModelTier.upstream_model``; the active mode's system prompt
is already prepended to the messages by the time this provider sees them.

Activated when ``AETHERIS_LLM_PROVIDER=openai`` and ``AETHERIS_LLM_API_KEY`` is set.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ..schemas.chat import ChatMessage
from .llm import CompletionResult, LLMProvider, PreparedConversation, ProviderError


class OpenAIProvider(LLMProvider):
    """Streams/forwards completions to an OpenAI-compatible backend."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        default_model: str,
        timeout: float = 120.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._default_model = default_model
        # A shared async client benefits from connection pooling across requests.
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

    @property
    def provider_name(self) -> str:
        return f"OpenAI-compatible @ {self._base_url}"

    async def aclose(self) -> None:
        await self._client.aclose()

    # --- Payload building -----------------------------------------------------

    def _model_for(self, prepared: PreparedConversation) -> str:
        return prepared.tier.upstream_model or self._default_model

    def _payload(self, prepared: PreparedConversation, *, stream: bool) -> dict[str, Any]:
        req = prepared.request
        payload: dict[str, Any] = {
            "model": self._model_for(prepared),
            "messages": [{"role": m.role, "content": m.content} for m in prepared.messages],
            "stream": stream,
        }
        # Only forward sampling params when the caller specified them; many
        # upstreams reject nulls or defaults they don't support.
        if req.temperature is not None:
            payload["temperature"] = req.temperature
        if req.max_tokens is not None:
            payload["max_tokens"] = req.max_tokens
        if req.top_p is not None:
            payload["top_p"] = req.top_p
        if req.stop is not None:
            payload["stop"] = req.stop
        return payload

    # --- Non-streaming --------------------------------------------------------

    async def complete(self, prepared: PreparedConversation) -> CompletionResult:
        payload = self._payload(prepared, stream=False)
        try:
            resp = await self._client.post("/chat/completions", json=payload)
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ProviderError(
                f"Upstream returned {exc.response.status_code}: "
                f"{exc.response.text[:200]}"
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"Upstream request failed: {exc}") from exc

        data = resp.json()
        choices = data.get("choices") or []
        if not choices:
            raise ProviderError("Upstream returned no choices.")
        choice = choices[0]
        text = (choice.get("message") or {}).get("content") or ""
        finish = choice.get("finish_reason") or "stop"
        usage = data.get("usage") or {}
        return CompletionResult(
            text=text,
            finish_reason=finish,
            prompt_tokens=int(usage.get("prompt_tokens", prepared.estimated_prompt_tokens)),
            completion_tokens=int(usage.get("completion_tokens", 0)),
        )

    # --- Streaming ------------------------------------------------------------

    async def stream(self, prepared: PreparedConversation) -> AsyncIterator[str]:
        payload = self._payload(prepared, stream=True)
        try:
            async with self._client.stream(
                "POST", "/chat/completions", json=payload
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    delta = _extract_delta(line)
                    if delta:
                        yield delta
        except httpx.HTTPStatusError as exc:
            raise ProviderError(
                f"Upstream stream failed ({exc.response.status_code}): "
                f"{exc.response.text[:200]}"
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"Upstream stream failed: {exc}") from exc


def _extract_delta(line: str) -> str | None:
    """Parse one SSE line from an OpenAI-compatible stream into a text delta."""
    line = line.strip()
    if not line or not line.startswith("data:"):
        return None
    data = line[len("data:") :].strip()
    if data == "[DONE]":
        return None
    try:
        obj = json.loads(data)
    except json.JSONDecodeError:
        # Ignore keepalive/comment lines that some proxies inject.
        return None
    choices = obj.get("choices") or []
    if not choices:
        return None
    delta = choices[0].get("delta") or {}
    content = delta.get("content")
    return content if content else None


__all__ = ["OpenAIProvider"]

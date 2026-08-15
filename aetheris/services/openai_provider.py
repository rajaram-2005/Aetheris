"""An OpenAI-compatible LLM provider.

Forwards prepared conversations to any endpoint that implements the
``/v1/chat/completions`` contract (OpenAI, Azure OpenAI, Together, Groq, vLLM,
Ollama's OpenAI shim, LM Studio, and others). Aetheris tiers are mapped to
upstream models via ``ModelTier.upstream_model``; the active mode's system prompt
is already prepended to the messages by the time this provider sees them.

It forwards the full capability surface:

* **tools / tool_choice** — the toolbelt is sent in the OpenAI ``tools`` array,
  and tool calls returned by the upstream are parsed back into ``ToolCall``
  objects for the agent loop to execute.
* **multimodal content** — messages carrying ``image_url`` parts are forwarded
  in the native OpenAI content-parts shape.

Activated when ``AETHERIS_LLM_PROVIDER=openai`` and ``AETHERIS_LLM_API_KEY`` is set.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ..schemas.chat import FunctionCall, ToolCall
from .llm import CompletionResult, LLMProvider, PreparedConversation, ProviderError


class OpenAIProvider(LLMProvider):
    """Streams/forwards completions to an OpenAI-compatible backend."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        default_model: str,
        timeout: float = 120.0,
        transport: httpx.AsyncBaseTransport | None = None,
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
            transport=transport,
        )

    @property
    def provider_name(self) -> str:
        return f"OpenAI-compatible @ {self._base_url}"

    async def aclose(self) -> None:
        await self._client.aclose()

    # --- Payload building -----------------------------------------------------

    def _model_for(self, prepared: PreparedConversation) -> str:
        return prepared.tier.upstream_model or self._default_model

    @staticmethod
    def _wire_messages(prepared: PreparedConversation) -> list[dict[str, Any]]:
        """Render messages in upstream wire shape, preserving tools and images."""
        wire: list[dict[str, Any]] = []
        for message in prepared.messages:
            item: dict[str, Any] = {"role": message.role}
            content = message.wire_content()
            # Assistant tool-call turns legitimately carry null content.
            if content is not None or message.tool_calls is None:
                item["content"] = content if content is not None else ""
            if message.name:
                item["name"] = message.name
            if message.tool_calls:
                item["tool_calls"] = [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.function.name,
                            "arguments": call.function.arguments,
                        },
                    }
                    for call in message.tool_calls
                ]
            if message.tool_call_id:
                item["tool_call_id"] = message.tool_call_id
            wire.append(item)
        return wire

    def _payload(self, prepared: PreparedConversation, *, stream: bool) -> dict[str, Any]:
        req = prepared.request
        payload: dict[str, Any] = {
            "model": self._model_for(prepared),
            "messages": self._wire_messages(prepared),
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

        tools = prepared.active_tools
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = prepared.tool_choice or "auto"
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
        message = choice.get("message") or {}
        text = message.get("content") or ""
        finish = choice.get("finish_reason") or "stop"
        usage = data.get("usage") or {}
        return CompletionResult(
            text=text,
            finish_reason=finish,
            prompt_tokens=int(usage.get("prompt_tokens", prepared.estimated_prompt_tokens)),
            completion_tokens=int(usage.get("completion_tokens", 0)),
            tool_calls=_parse_tool_calls(message.get("tool_calls")),
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


def _parse_tool_calls(raw: Any) -> list[ToolCall]:
    """Parse an upstream ``tool_calls`` array into Aetheris ``ToolCall`` objects."""
    if not isinstance(raw, list):
        return []
    calls: list[ToolCall] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        function = item.get("function") or {}
        name = function.get("name")
        if not name:
            continue
        arguments = function.get("arguments")
        if isinstance(arguments, dict):
            arguments = json.dumps(arguments)
        call = ToolCall(function=FunctionCall(name=name, arguments=arguments or "{}"))
        if item.get("id"):
            call.id = str(item["id"])
        calls.append(call)
    return calls


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

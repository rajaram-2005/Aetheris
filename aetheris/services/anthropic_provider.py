"""Anthropic Claude provider — the Messages API.

Forwards prepared conversations to the Anthropic ``/v1/messages`` endpoint.
Aetheris tiers are mapped to a Claude model via ``AETHERIS_ANTHROPIC_MODEL``; the
active mode's system prompt (already prepended by ``prepare_conversation``) is
lifted out and sent as the API's ``system`` field, which is where Anthropic
expects system instructions.

It supports:

* **tools** — the OpenAI toolbelt is converted to Anthropic ``tools`` /
  ``tool_choice`` and Claude ``tool_use`` blocks are parsed back into Aetheris
  ``ToolCall`` objects for the agent loop.
* **multimodal** — messages carrying ``image_url`` content parts are sent as
  Anthropic ``image`` content blocks.
* **streaming** — SSE text deltas are parsed and re-emitted.

Activated when ``AETHERIS_LLM_PROVIDER=anthropic`` and ``AETHERIS_ANTHROPIC_API_KEY``.
"""

from __future__ import annotations

import base64
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ..schemas.chat import FunctionCall, ToolCall
from .llm import CompletionResult, LLMProvider, PreparedConversation, ProviderError

logger = logging.getLogger("aetheris")

_API_VERSION = "2023-06-01"


def _to_anthropic_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert OpenAI-shaped tools to the Anthropic ``tools`` shape."""
    out: list[dict[str, Any]] = []
    for tool in tools:
        fn = tool.get("function", tool)
        name = fn.get("name")
        if not name:
            continue
        schema = fn.get("parameters") or {"type": "object", "properties": {}}
        out.append(
            {
                "name": name,
                "description": fn.get("description", ""),
                "input_schema": schema,
            }
        )
    return out


def _data_uri_to_image_block(url: str) -> dict[str, Any] | None:
    """Convert a ``data:image/*;base64,...`` URI to an Anthropic image block."""
    if not url.startswith("data:"):
        return None
    header, _, b64 = url.partition(",")
    media_type = header[len("data:") :].split(";", 1)[0] or "image/png"
    if not media_type.startswith("image/"):
        return None
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": b64,
        },
    }


def _to_anthropic_content(message) -> Any:
    """Render a message's content for Anthropic."""
    if message.content is None:
        return None
    if isinstance(message.content, str):
        return message.content
    blocks: list[dict[str, Any]] = []
    for part in message.content:
        if part.type == "text":
            blocks.append({"type": "text", "text": part.text})
        else:
            url = part.image_url.url
            if url.startswith(("http://", "https://")):
                blocks.append(
                    {
                        "type": "image",
                        "source": {"type": "url", "url": url},
                    }
                )
            else:
                block = _data_uri_to_image_block(url)
                if block:
                    blocks.append(block)
    return blocks


class AnthropicProvider(LLMProvider):
    """Streams/forwards completions to the Anthropic Messages API."""

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str = "https://api.anthropic.com",
        timeout: float = 120.0,
    ) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers={
                "x-api-key": api_key,
                "anthropic-version": _API_VERSION,
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

    @property
    def provider_name(self) -> str:
        return f"anthropic ({self._model})"

    async def aclose(self) -> None:
        await self._client.aclose()

    # --- Payload building -----------------------------------------------------

    def _payload(self, prepared: PreparedConversation, *, stream: bool) -> dict[str, Any]:
        system_parts: list[str] = []
        messages: list[dict[str, Any]] = []
        for message in prepared.messages:
            if message.role == "system":
                text = message.text
                if text:
                    system_parts.append(text)
                continue
            if message.role == "tool":
                # tool_result block linked to its tool_use id.
                content = {
                    "type": "tool_result",
                    "tool_use_id": message.tool_call_id or "",
                    "content": message.text,
                }
                messages.append({"role": "user", "content": [content]})
                continue
            item: dict[str, Any] = {"role": message.role}
            content = _to_anthropic_content(message)
            if message.tool_calls:
                # Assistant turn with tool-use blocks (content may be None).
                blocks: list[dict[str, Any]] = []
                if content:
                    if isinstance(content, str):
                        blocks.append({"type": "text", "text": content})
                    elif isinstance(content, list):
                        blocks.extend(content)
                for call in message.tool_calls:
                    blocks.append(
                        {
                            "type": "tool_use",
                            "id": call.id,
                            "name": call.function.name,
                            "input": json.loads(call.function.arguments or "{}"),
                        }
                    )
                item["content"] = blocks
            else:
                item["content"] = content if content is not None else ""
            messages.append(item)

        payload: dict[str, Any] = {
            "model": self._model,
            "max_tokens": prepared.request.max_tokens or 2048,
            "stream": stream,
            "messages": messages,
        }
        if system_parts:
            payload["system"] = "\n".join(system_parts)
        if prepared.request.temperature is not None:
            payload["temperature"] = prepared.request.temperature
        if prepared.request.top_p is not None:
            payload["top_p"] = prepared.request.top_p
        if prepared.request.stop is not None:
            stop = prepared.request.stop
            payload["stop_sequences"] = [stop] if isinstance(stop, str) else stop

        tools = prepared.active_tools
        if tools:
            payload["tools"] = _to_anthropic_tools(tools)
            choice = prepared.tool_choice
            if choice == "none":
                payload["tool_choice"] = {"type": "none"}
            elif choice == "required":
                payload["tool_choice"] = {"type": "any"}
            else:
                payload["tool_choice"] = {"type": "auto"}
        return payload

    # --- Non-streaming --------------------------------------------------------

    async def complete(self, prepared: PreparedConversation) -> CompletionResult:
        payload = self._payload(prepared, stream=False)
        try:
            resp = await self._client.post("/v1/messages", json=payload)
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ProviderError(
                f"Anthropic returned {exc.response.status_code}: "
                f"{exc.response.text[:300]}"
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"Anthropic request failed: {exc}") from exc

        data = resp.json()
        text = ""
        tool_calls: list[ToolCall] = []
        for block in data.get("content") or []:
            if block.get("type") == "text":
                text += block.get("text", "")
            elif block.get("type") == "tool_use":
                tool_calls.append(
                    ToolCall(
                        id=block.get("id", ""),
                        function=FunctionCall(
                            name=block.get("name", ""),
                            arguments=json.dumps(block.get("input") or {}),
                        ),
                    )
                )
        usage = data.get("usage") or {}
        return CompletionResult(
            text=text,
            finish_reason=_map_finish(data.get("stop_reason")),
            prompt_tokens=int(usage.get("input_tokens", prepared.estimated_prompt_tokens)),
            completion_tokens=int(usage.get("output_tokens", 0)),
            tool_calls=tool_calls,
        )

    # --- Streaming ------------------------------------------------------------

    async def stream(self, prepared: PreparedConversation) -> AsyncIterator[str]:
        payload = self._payload(prepared, stream=True)
        try:
            async with self._client.stream(
                "POST", "/v1/messages", json=payload
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    delta = _extract_delta(line)
                    if delta:
                        yield delta
        except httpx.HTTPStatusError as exc:
            raise ProviderError(
                f"Anthropic stream failed ({exc.response.status_code}): "
                f"{exc.response.text[:300]}"
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"Anthropic stream failed: {exc}") from exc


def _map_finish(reason: str | None) -> str:
    mapping = {
        "end_turn": "stop",
        "max_tokens": "length",
        "stop_sequence": "stop",
        "tool_use": "tool_calls",
    }
    return mapping.get(reason or "", "stop")


def _extract_delta(line: str) -> str | None:
    """Parse one Anthropic SSE line into a text delta."""
    line = line.strip()
    if not line.startswith("data:"):
        return None
    data = line[len("data:") :].strip()
    if data.startswith("[") or not data:
        return None
    try:
        obj = json.loads(data)
    except json.JSONDecodeError:
        return None
    if obj.get("type") != "content_block_delta":
        return None
    delta = obj.get("delta") or {}
    if delta.get("type") == "text_delta":
        return delta.get("text") or None
    return None


__all__ = ["AnthropicProvider"]

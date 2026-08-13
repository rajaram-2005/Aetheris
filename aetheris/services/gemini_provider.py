"""Google Gemini provider — the native ``generateContent`` API.

Forwards prepared conversations to the Google Generative Language API. The
active mode's system prompt is sent as ``system_instruction``; user messages
may carry images as ``inlineData`` for multimodal input. Tool calls use Gemini
``functionDeclarations`` / ``functionCall`` blocks so the agent loop works.

Activated when ``AETHERIS_LLM_PROVIDER=gemini`` and ``AETHERIS_GEMINI_API_KEY``.
"""

from __future__ import annotations

import base64
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ..schemas.chat import FunctionCall, ToolCall
from .llm import CompletionResult, LLMProvider, PreparedConversation, ProviderError


def _to_gemini_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert OpenAI-shaped tools to Gemini ``functionDeclarations``."""
    declarations: list[dict[str, Any]] = []
    for tool in tools:
        fn = tool.get("function", tool)
        name = fn.get("name")
        if not name:
            continue
        declarations.append(
            {
                "name": name,
                "description": fn.get("description", ""),
                "parameters": fn.get("parameters") or {"type": "object", "properties": {}},
            }
        )
    return [{"functionDeclarations": declarations}] if declarations else []


def _to_gemini_parts(message) -> list[dict[str, Any]]:
    """Render a message's content as Gemini ``parts``."""
    if message.content is None:
        return [{"text": ""}]
    if isinstance(message.content, str):
        return [{"text": message.content}]
    parts: list[dict[str, Any]] = []
    for part in message.content:
        if part.type == "text":
            parts.append({"text": part.text})
        else:
            url = part.image_url.url
            if url.startswith("data:"):
                header, _, b64 = url.partition(",")
                mime = header[len("data:") :].split(";", 1)[0] or "image/png"
                try:
                    decoded = base64.b64decode(b64)
                except Exception:
                    decoded = b64.encode()
                parts.append(
                    {
                        "inline_data": {
                            "mime_type": mime,
                            "data": base64.b64encode(decoded).decode(),
                        }
                    }
                )
            else:
                parts.append({"file_data": {"file_uri": url}})
    return parts


class GeminiProvider(LLMProvider):
    """Streams/forwards completions to the Gemini generateContent API."""

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str = "https://generativelanguage.googleapis.com",
        timeout: float = 120.0,
    ) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers={
                "x-goog-api-key": api_key,
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

    @property
    def provider_name(self) -> str:
        return f"gemini ({self._model})"

    async def aclose(self) -> None:
        await self._client.aclose()

    # --- Payload building -----------------------------------------------------

    def _payload(self, prepared: PreparedConversation, *, stream: bool) -> dict[str, Any]:
        system_parts: list[str] = []
        contents: list[dict[str, Any]] = []
        for message in prepared.messages:
            if message.role == "system":
                text = message.text
                if text:
                    system_parts.append(text)
                continue
            if message.role == "tool":
                contents.append(
                    {
                        "role": "user",
                        "parts": [
                            {
                                "function_response": {
                                    "name": message.name or "tool",
                                    "response": {
                                        "result": message.text,
                                        "tool_call_id": message.tool_call_id or "",
                                    },
                                }
                            }
                        ],
                    }
                )
                continue
            role = "model" if message.role == "assistant" else "user"
            parts: list[dict[str, Any]] = _to_gemini_parts(message)
            if message.tool_calls:
                for call in message.tool_calls:
                    try:
                        args = json.loads(call.function.arguments or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    parts.append(
                        {
                            "function_call": {
                                "name": call.function.name,
                                "args": args,
                            }
                        }
                    )
            contents.append({"role": role, "parts": parts})

        payload: dict[str, Any] = {"contents": contents}
        if system_parts:
            payload["system_instruction"] = {
                "parts": [{"text": "\n".join(system_parts)}]
            }
        gen: dict[str, Any] = {}
        req = prepared.request
        if req.temperature is not None:
            gen["temperature"] = req.temperature
        if req.top_p is not None:
            gen["topP"] = req.top_p
        if req.max_tokens is not None:
            gen["maxOutputTokens"] = req.max_tokens
        if req.stop is not None:
            gen["stopSequences"] = [req.stop] if isinstance(req.stop, str) else req.stop
        if gen:
            payload["generationConfig"] = gen

        tools = prepared.active_tools
        if tools:
            payload["tools"] = _to_gemini_tools(tools)
            choice = prepared.tool_choice
            if choice == "none":
                payload["toolConfig"] = {"functionCallingConfig": {"mode": "NONE"}}
            elif choice == "required":
                payload["toolConfig"] = {"functionCallingConfig": {"mode": "ANY"}}
            else:
                payload["toolConfig"] = {"functionCallingConfig": {"mode": "AUTO"}}
        return payload

    def _url(self, *, stream: bool) -> str:
        if stream:
            return (
                f"/v1beta/models/{self._model}:streamGenerateContent"
                "?alt=sse"
            )
        return f"/v1beta/models/{self._model}:generateContent"

    # --- Non-streaming --------------------------------------------------------

    async def complete(self, prepared: PreparedConversation) -> CompletionResult:
        payload = self._payload(prepared, stream=False)
        try:
            resp = await self._client.post(self._url(stream=False), json=payload)
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ProviderError(
                f"Gemini returned {exc.response.status_code}: "
                f"{exc.response.text[:300]}"
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"Gemini request failed: {exc}") from exc

        data = resp.json()
        return _parse_response(data, prepared)

    # --- Streaming ------------------------------------------------------------

    async def stream(self, prepared: PreparedConversation) -> AsyncIterator[str]:
        payload = self._payload(prepared, stream=True)
        try:
            async with self._client.stream(
                "POST", self._url(stream=True), json=payload
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    delta = _extract_stream_delta(line)
                    if delta:
                        yield delta
        except httpx.HTTPStatusError as exc:
            raise ProviderError(
                f"Gemini stream failed ({exc.response.status_code}): "
                f"{exc.response.text[:300]}"
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"Gemini stream failed: {exc}") from exc


def _parse_response(data: dict[str, Any], prepared: PreparedConversation) -> CompletionResult:
    text = ""
    tool_calls: list[ToolCall] = []
    candidates = data.get("candidates") or []
    for candidate in candidates:
        content = candidate.get("content") or {}
        for part in content.get("parts") or []:
            if "text" in part:
                text += part["text"]
            elif "functionCall" in part:
                fc = part["functionCall"]
                tool_calls.append(
                    ToolCall(
                        function=FunctionCall(
                            name=fc.get("name", ""),
                            arguments=json.dumps(fc.get("args") or {}),
                        )
                    )
                )
    usage = data.get("usageMetadata") or {}
    return CompletionResult(
        text=text,
        finish_reason=_map_finish((candidates[0].get("finishReason") if candidates else "")),
        prompt_tokens=int(usage.get("promptTokenCount", prepared.estimated_prompt_tokens)),
        completion_tokens=int(usage.get("candidatesTokenCount", 0)),
        tool_calls=tool_calls,
    )


def _map_finish(reason: str | None) -> str:
    mapping = {
        "STOP": "stop",
        "MAX_TOKENS": "length",
        "SAFETY": "content_filter",
        "RECITATION": "content_filter",
        "STOP_SEQUENCE": "stop",
    }
    return mapping.get(reason or "", "stop")


def _extract_stream_delta(line: str) -> str | None:
    """Parse one SSE line from ``streamGenerateContent?alt=sse``."""
    line = line.strip()
    if not line.startswith("data:"):
        return None
    data = line[len("data:") :].strip()
    if not data:
        return None
    try:
        obj = json.loads(data)
    except json.JSONDecodeError:
        return None
    text = ""
    for candidate in obj.get("candidates") or []:
        for part in (candidate.get("content") or {}).get("parts") or []:
            if "text" in part:
                text += part["text"]
    return text or None


__all__ = ["GeminiProvider"]

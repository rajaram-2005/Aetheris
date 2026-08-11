"""Chat-completion request and response schemas.

The wire format is OpenAI-compatible (``/v1/chat/completions``) so existing
clients can target Aetheris unchanged. Aetheris adds these extensions:

* ``mode``      — selects the active system-prompt identity (general, engineering,
  editorial, structured, sovereign).
* ``tools`` / ``tool_choice`` — OpenAI-style function calling. Aetheris also
  accepts the string ``"auto"`` shorthand and the ``"aetheris:*"`` built-in tool
  references resolved by the tool registry.
* ``agent``     — run the request through the autonomous agent loop (plan → call
  tools → observe → self-correct → answer).

Message content accepts either a plain string or a list of OpenAI-style content
parts (``text`` / ``image_url``), which is what activates multimodal input.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


# --- Request ------------------------------------------------------------------

Role = Literal["system", "user", "assistant", "tool"]


class ImageURL(BaseModel):
    """An image reference (remote URL or ``data:`` URI) for multimodal input."""

    url: str = Field(..., description="https:// URL or data:image/...;base64,... URI.")
    detail: Literal["auto", "low", "high"] = "auto"


class TextPart(BaseModel):
    """A text segment of a multimodal message."""

    type: Literal["text"] = "text"
    text: str


class ImagePart(BaseModel):
    """An image segment of a multimodal message."""

    type: Literal["image_url"] = "image_url"
    image_url: ImageURL


ContentPart = TextPart | ImagePart


class FunctionCall(BaseModel):
    """The function payload of a tool call (arguments are a JSON string)."""

    name: str
    arguments: str = "{}"


class ToolCall(BaseModel):
    """A model-requested tool invocation."""

    id: str = Field(default_factory=lambda: f"call_{uuid.uuid4().hex[:20]}")
    type: Literal["function"] = "function"
    function: FunctionCall


class FunctionDef(BaseModel):
    """A callable function exposed to the model."""

    name: str
    description: str = ""
    parameters: dict[str, Any] = Field(default_factory=lambda: {"type": "object", "properties": {}})


class ToolDef(BaseModel):
    """A tool definition in the OpenAI ``tools`` array shape."""

    type: Literal["function"] = "function"
    function: FunctionDef


class ChatMessage(BaseModel):
    """A single conversation message (text or multimodal content parts)."""

    role: Role
    content: str | list[ContentPart] | None = Field(
        default=None, description="Message content: a string or content parts."
    )
    name: str | None = Field(default=None, description="Optional author name.")
    tool_calls: list[ToolCall] | None = Field(
        default=None, description="Assistant-requested tool invocations."
    )
    tool_call_id: str | None = Field(
        default=None, description="Set on 'tool' messages to link the result to its call."
    )

    # --- Convenience accessors ------------------------------------------------

    @property
    def text(self) -> str:
        """Flatten the content to plain text (images become inline descriptors)."""
        if self.content is None:
            return ""
        if isinstance(self.content, str):
            return self.content
        pieces: list[str] = []
        for part in self.content:
            if isinstance(part, TextPart):
                pieces.append(part.text)
            else:
                pieces.append(f"[image: {_image_label(part.image_url.url)}]")
        return "\n".join(pieces)

    @property
    def images(self) -> list[ImageURL]:
        """Every image attached to this message."""
        if not isinstance(self.content, list):
            return []
        return [p.image_url for p in self.content if isinstance(p, ImagePart)]

    @property
    def has_images(self) -> bool:
        return bool(self.images)

    def wire_content(self) -> Any:
        """Content in upstream (OpenAI) wire shape."""
        if self.content is None:
            return None
        if isinstance(self.content, str):
            return self.content
        return [p.model_dump(exclude_none=True) for p in self.content]


def _image_label(url: str) -> str:
    """A short, log-safe label for an image reference."""
    if url.startswith("data:"):
        header = url.split(",", 1)[0]
        kind = header[5:].split(";", 1)[0] or "image"
        approx = int(len(url) * 0.75 / 1024)
        return f"inline {kind}, ~{approx}KB"
    return url[:120]


class ChatCompletionRequest(BaseModel):
    """Inbound chat-completion request (OpenAI-compatible + Aetheris fields)."""

    model: str | None = Field(
        default=None,
        description=(
            "Aetheris tier id or alias (aetheris-lite/flash, aetheris-pro/pro, "
            "aetheris-ultra/ultra). Omit for the default tier."
        ),
    )
    messages: list[ChatMessage] = Field(
        ..., min_length=1, description="The conversation messages."
    )
    mode: str | None = Field(
        default=None,
        description=(
            "Aetheris inference mode: general, engineering, editorial, structured, "
            "sovereign. Omit for the default (general)."
        ),
    )
    stream: bool = Field(default=False, description="Whether to stream SSE chunks.")
    temperature: float | None = Field(
        default=None, ge=0.0, le=2.0, description="Sampling temperature."
    )
    max_tokens: int | None = Field(
        default=None, ge=1, description="Maximum tokens to generate."
    )
    top_p: float | None = Field(default=None, ge=0.0, le=1.0, description="Nucleus sampling.")
    stop: str | list[str] | None = Field(default=None, description="Stop sequences.")

    # --- Aetheris capability extensions --------------------------------------
    tools: list[ToolDef] | Literal["auto", "all", "none"] | None = Field(
        default=None,
        description=(
            "Tool definitions, or 'auto'/'all' to expose the Aetheris built-in "
            "toolbelt (code_interpreter, document_search, calculator, web_fetch, …)."
        ),
    )
    tool_choice: str | dict[str, Any] | None = Field(
        default=None, description="'auto' | 'none' | 'required' | {'type':'function',…}."
    )
    agent: bool = Field(
        default=False,
        description=(
            "Run the autonomous agent loop: the model may call tools repeatedly "
            "and self-correct before producing its final answer."
        ),
    )
    max_tool_iterations: int | None = Field(
        default=None, ge=1, le=12, description="Cap on agent tool-calling rounds."
    )

    @field_validator("messages")
    @classmethod
    def _require_user_message(cls, messages: list[ChatMessage]) -> list[ChatMessage]:
        """Ensure the conversation contains at least one user turn."""
        if not any(m.role == "user" for m in messages):
            raise ValueError("At least one 'user' message is required.")
        return messages


# --- Response (non-streaming) -------------------------------------------------


class Usage(BaseModel):
    """Token usage accounting."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class ChoiceMessage(BaseModel):
    """The assistant message returned in a non-streaming choice."""

    role: Literal["assistant"] = "assistant"
    content: str | None = None
    tool_calls: list[ToolCall] | None = None


class Choice(BaseModel):
    """A single completion choice."""

    index: int = 0
    message: ChoiceMessage
    finish_reason: Literal["stop", "length", "tool_calls", "content_filter"] = "stop"


class ToolInvocation(BaseModel):
    """One executed step of the agent loop (Aetheris trace extension)."""

    step: int
    tool: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    ok: bool = True
    output: str = ""
    error: str | None = None
    duration_ms: int = 0


class ChatCompletionResponse(BaseModel):
    """The non-streaming chat-completion response (OpenAI-compatible)."""

    id: str
    object: Literal["chat.completion"] = "chat.completion"
    created: int
    model: str
    mode: str
    choices: list[Choice]
    usage: Usage = Field(default_factory=Usage)
    # Aetheris extension: the executed tool trace, when the agent loop ran.
    tool_trace: list[ToolInvocation] | None = None


# --- Streaming chunk ----------------------------------------------------------


class DeltaMessage(BaseModel):
    """A partial message delta emitted in a streaming chunk."""

    role: Literal["assistant"] | None = None
    content: str | None = None
    tool_calls: list[ToolCall] | None = None


class ChunkChoice(BaseModel):
    """A single choice within a streaming chunk."""

    index: int = 0
    delta: DeltaMessage
    finish_reason: Literal["stop", "length", "tool_calls", "content_filter"] | None = None


class ChatCompletionChunk(BaseModel):
    """A single SSE chunk in a streaming chat completion."""

    id: str
    object: Literal["chat.completion.chunk"] = "chat.completion.chunk"
    created: int
    model: str
    mode: str
    choices: list[ChunkChoice]
    # Aetheris extension: emitted on tool-execution chunks so clients can render
    # a live agent trace without waiting for the final message.
    tool_event: ToolInvocation | None = None


# --- Helpers ------------------------------------------------------------------


def new_completion_id() -> str:
    """Generate a unique completion id matching the OpenAI ``chatcmpl-`` style."""
    return f"chatcmpl-{uuid.uuid4().hex[:24]}"


def now_ts() -> int:
    """Current unix timestamp (seconds)."""
    return int(time.time())


__all__ = [
    "Role",
    "ImageURL",
    "TextPart",
    "ImagePart",
    "ContentPart",
    "FunctionCall",
    "ToolCall",
    "FunctionDef",
    "ToolDef",
    "ChatMessage",
    "ChatCompletionRequest",
    "Usage",
    "ChoiceMessage",
    "Choice",
    "ToolInvocation",
    "ChatCompletionResponse",
    "DeltaMessage",
    "ChunkChoice",
    "ChatCompletionChunk",
    "new_completion_id",
    "now_ts",
]

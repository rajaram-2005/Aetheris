"""Chat-completion request and response schemas.

The wire format is OpenAI-compatible (``/v1/chat/completions``) so existing
clients can target Aetheris unchanged. Aetheris adds one extension field,
``mode``, which selects the active system-prompt identity (general, engineering,
editorial, structured).
"""

from __future__ import annotations

import time
import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator


# --- Request ------------------------------------------------------------------

Role = Literal["system", "user", "assistant", "tool"]


class ChatMessage(BaseModel):
    """A single conversation message."""

    role: Role
    content: str = Field(..., description="The message content.")


class ChatCompletionRequest(BaseModel):
    """Inbound chat-completion request (OpenAI-compatible + ``mode``)."""

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
            "Aetheris inference mode: general, engineering, editorial, structured. "
            "Omit for the default (general)."
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
    content: str


class Choice(BaseModel):
    """A single completion choice."""

    index: int = 0
    message: ChoiceMessage
    finish_reason: Literal["stop", "length", "tool_calls", "content_filter"] = "stop"


class ChatCompletionResponse(BaseModel):
    """The non-streaming chat-completion response (OpenAI-compatible)."""

    id: str
    object: Literal["chat.completion"] = "chat.completion"
    created: int
    model: str
    mode: str
    choices: list[Choice]
    usage: Usage = Field(default_factory=Usage)


# --- Streaming chunk ----------------------------------------------------------


class DeltaMessage(BaseModel):
    """A partial message delta emitted in a streaming chunk."""

    role: Literal["assistant"] | None = None
    content: str | None = None


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


# --- Helpers ------------------------------------------------------------------


def new_completion_id() -> str:
    """Generate a unique completion id matching the OpenAI ``chatcmpl-`` style."""
    return f"chatcmpl-{uuid.uuid4().hex[:24]}"


def now_ts() -> int:
    """Current unix timestamp (seconds)."""
    return int(time.time())


__all__ = [
    "Role",
    "ChatMessage",
    "ChatCompletionRequest",
    "Usage",
    "ChoiceMessage",
    "Choice",
    "ChatCompletionResponse",
    "DeltaMessage",
    "ChunkChoice",
    "ChatCompletionChunk",
    "new_completion_id",
    "now_ts",
]

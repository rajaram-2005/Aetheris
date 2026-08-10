"""A brand-aware offline LLM provider.

The mock provider exists so Aetheris runs anywhere with zero configuration. It
does not call a real model; instead it composes a persona-faithful response that
honors the selected mode and tier, then streams it token-by-token. This makes the
identity, the tier/mode matrix, and the streaming contract observable in the live
preview without external dependencies.

When ``AETHERIS_LLM_PROVIDER=openai`` and credentials are configured, the
OpenAI-compatible provider takes over and this one is not used.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from ..core.branding import NAME
from ..core.modes import Mode
from ..core.tiers import ModelTier
from ..schemas.chat import ChatMessage
from .llm import CompletionResult, LLMProvider, PreparedConversation


# Streaming cadence: a small per-chunk delay so streamed responses visibly
# unfold (tuned to feel live without dragging out a short reply).
_STREAM_CHUNK_DELAY = 0.01


def _last_user_text(messages: list[ChatMessage]) -> str:
    """Return the content of the most recent user turn (empty string if none)."""
    for msg in reversed(messages):
        if msg.role == "user":
            return msg.content
    return ""


def _approx_tokens(text: str) -> int:
    """A rough token estimate (~4 chars/token) suitable for usage accounting."""
    return max(1, len(text) // 4)


def _truncate(text: str, limit: int = 280) -> str:
    """Shorten a user topic for inline quotation, preserving whole words."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[: limit - 1].rsplit(" ", 1)[0].rstrip(",.;:") + "…"


# --- Per-mode composition -----------------------------------------------------


def _compose_general(tier: ModelTier, user_text: str) -> str:
    topic = _truncate(user_text) or "your question"
    if tier.alias == "flash":
        return (
            f"Here's the quick read on {topic}: I'll keep this tight since you're "
            f"on Aetheris Lite.\n\n"
            "1. Core point — the crux of the matter in one line.\n"
            "2. Why it holds — the single strongest reason behind it.\n"
            "3. Next step — the smallest useful action you can take now.\n\n"
            "Want me to go deeper on any of these?"
        )
    if tier.alias == "ultra":
        return (
            f"Let me reason through {topic} carefully, step by step.\n\n"
            "## Framing\n"
            "I'll first state the assumptions I'm making, since the answer's shape "
            "depends on them. If any assumption is off, treat the rest as "
            "conditional on your correction.\n\n"
            "## Decomposition\n"
            "1. Identify the load-bearing constraint.\n"
            "2. Enumerate the viable approaches against that constraint.\n"
            "3. Score each on correctness, cost, and reversibility.\n"
            "4. Select and state the trade-off explicitly.\n\n"
            "## Synthesis\n"
            "The recommended path is the one that minimizes regret across the most "
            "plausible futures — not the one that's optimal in a single forecast.\n\n"
            "## Open questions\n"
            "Two assumptions above deserve a sanity check from you before this "
            "becomes a commitment. Which would you like to pressure-test first?"
        )
    # Pro (balanced workhorse)
    return (
        f"Good prompt. Here's a structured take on {topic}.\n\n"
        "**What's actually being asked.** The surface question and the underlying "
        "goal aren't always the same — naming both keeps the answer useful.\n\n"
        "**The reasoning.** I'll work from the strongest available evidence and "
        "call out where I'm inferring rather than knowing.\n\n"
        "**A concrete next step.** One small, reversible action that moves you "
        "forward and surfaces what else you need to know.\n\n"
        "If you tell me the context you're operating in, I can sharpen this "
        "considerably."
    )


def _compose_engineering(tier: ModelTier, user_text: str) -> str:
    topic = _truncate(user_text) or "the task"
    return (
        f"Engineering mode. Let me scope {topic} before writing code.\n\n"
        "## Architecture notes\n"
        "- Approach: a small, pure function with a single responsibility plus a "
        "thin wrapper for I/O. Keeps the core unit-testable in isolation.\n"
        "- Complexity: Time O(n), Space O(1) for the core; the wrapper is I/O-bound.\n"
        "- Error handling: explicit guard clauses; raise on contract violations, "
        "return a sentinel only where a missing value is a legitimate result.\n\n"
        "## Reference implementation (Python 3.11+)\n"
        "```python\n"
        "from __future__ import annotations\n"
        "from collections.abc import Iterable\n\n\n"
        "def first_match[T](items: Iterable[T], predicate) -> T | None:\n"
        '    """Return the first item satisfying ``predicate``, or ``None``.\n\n'
        "    Pure and side-effect free: safe to call from any context.\n"
        '    """\n'
        "    for item in items:\n"
        "        if predicate(item):\n"
        "            return item\n"
        "    return None\n"
        "```\n\n"
        "## Why this shape\n"
        "A generator-style iteration avoids materializing the whole input, so the "
        "same code serves small lists and large streams without change.\n\n"
        "Tell me the language and constraints you're targeting and I'll tailor this."
    )


def _compose_editorial(tier: ModelTier, user_text: str) -> str:
    text = _truncate(user_text, 320) or "the passage you shared"
    return (
        "Editorial mode. I'll diagnose before I touch a word — the goal is to "
        "amplify your voice, not replace it.\n\n"
        f"**What I'm reading.** You wrote: \"{text}\"\n\n"
        "**Diagnosis across four axes.**\n"
        "- *Clarity:* is the single sentence that carries the meaning easy to find?\n"
        "- *Structure:* does each sentence advance the previous one, or repeat it?\n"
        "- *Cadence:* are sentence lengths varied, or does a single rhythm flatten it?\n"
        "- *Impact:* does the strongest idea land first or get buried?\n\n"
        "**One concrete growth area.** The highest-leverage edit is usually at the "
        "boundary between two paragraphs — that's where readers lose or regain "
        "momentum.\n\n"
        "**Options, not a rewrite.** I can (a) tighten a specific sentence, "
        "(b) re-sequence two paragraphs for momentum, or (c) suggest three "
        "alternative openings in your register. Which would help most?"
    )


def _compose_structured(tier: ModelTier, user_text: str) -> str:
    topic = _truncate(user_text, 160) or "the request"
    payload = {
        "understood": True,
        "mode": "structured",
        "tier": tier.id,
        "topic": topic,
        "summary": f"Aetheris parsed this as a request about {topic}.",
        "actionable": True,
        "requires_clarification": False,
        "notes": None,
    }
    # Strict JSON only — no conversational filler, per the structured directive.
    return json.dumps(payload, ensure_ascii=False, indent=2)


_COMPOSERS = {
    "general": _compose_general,
    "engineering": _compose_engineering,
    "editorial": _compose_editorial,
    "structured": _compose_structured,
}


def compose_response(tier: ModelTier, mode: Mode, messages: list[ChatMessage]) -> str:
    """Build a persona-faithful reply for the given tier, mode, and conversation."""
    user_text = _last_user_text(messages)
    composer = _COMPOSERS.get(mode.id, _compose_general)
    body = composer(tier, user_text)
    # The identity line is omitted in structured mode (JSON-only output contract).
    if mode.id == "structured":
        return body
    return f"{body}"


class MockProvider(LLMProvider):
    """Offline, brand-aware provider used when no real LLM endpoint is configured."""

    @property
    def provider_name(self) -> str:
        return f"{NAME} Mock"

    async def complete(self, prepared: PreparedConversation) -> CompletionResult:
        text = compose_response(prepared.tier, prepared.mode, prepared.messages)
        completion_tokens = _approx_tokens(text)
        return CompletionResult(
            text=text,
            finish_reason="stop",
            prompt_tokens=prepared.estimated_prompt_tokens,
            completion_tokens=completion_tokens,
        )

    async def stream(self, prepared: PreparedConversation) -> AsyncIterator[str]:
        text = compose_response(prepared.tier, prepared.mode, prepared.messages)
        # Emit in word-sized deltas so clients observe genuine streaming.
        for chunk in _word_chunks(text):
            yield chunk
            await asyncio.sleep(_STREAM_CHUNK_DELAY)


def _word_chunks(text: str) -> list[str]:
    """Split text into word-plus-separator deltas, preserving whitespace and newlines."""
    chunks: list[str] = []
    buf: list[str] = []
    for char in text:
        buf.append(char)
        if char in (" ", "\n"):
            chunks.append("".join(buf))
            buf = []
    if buf:
        chunks.append("".join(buf))
    return chunks


__all__ = ["MockProvider", "compose_response"]

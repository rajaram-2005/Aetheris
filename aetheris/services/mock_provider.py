"""A brand-aware offline LLM provider.

The mock provider exists so Aetheris runs anywhere with zero configuration. It
does not call a real model; instead it composes a persona-faithful response that
honors the selected mode and tier, then streams it token-by-token.

Crucially, it is also a **real tool-calling client**: when a request exposes the
toolbelt, the mock inspects the user's turn and emits genuine ``ToolCall``
objects (arithmetic → ``calculator``, questions about mounted files →
``document_search``, "run this" → ``code_interpreter``, and so on). The agent
loop then executes those tools for real and feeds the observations back. That
means the sandbox, the RAG index, and the self-correction loop are all
exercised end-to-end offline — the *tools* are never mocked, only the language
model that chooses them.

When ``AETHERIS_LLM_PROVIDER=openai`` and credentials are configured, the
OpenAI-compatible provider takes over and this one is not used.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator

from ..core.branding import NAME
from ..core.modes import Mode
from ..core.tiers import ModelTier
from ..schemas.chat import ChatMessage, FunctionCall, ToolCall
from .llm import CompletionResult, LLMProvider, PreparedConversation

# Streaming cadence: a small per-chunk delay so streamed responses visibly
# unfold (tuned to feel live without dragging out a short reply).
_STREAM_CHUNK_DELAY = 0.01


def _last_user_text(messages: list[ChatMessage]) -> str:
    """Return the content of the most recent user turn (empty string if none)."""
    for msg in reversed(messages):
        if msg.role == "user":
            return msg.text
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


# --- Tool selection heuristics ------------------------------------------------
#
# A real model decides which tool to call from its weights. The mock decides from
# these patterns — the downstream execution path is identical either way.

_ARITHMETIC_RE = re.compile(r"\d+\s*(?:[+\-*/^%]|\*\*)\s*\d+")
_CODE_BLOCK_RE = re.compile(r"```(?:python|py)?\s*\n(.*?)```", re.DOTALL)

_MATH_WORDS = re.compile(
    r"\b(calculate|compute|how much|what is|sum of|product of|percent|percentage|"
    r"square root|factorial|compound|interest|average|mean of)\b", re.I
)
_DOC_WORDS = re.compile(
    r"\b(document|documents|file|files|attached|attachment|upload|uploaded|"
    r"my notes|the spec|the report|the pdf|according to|in the doc|context)\b", re.I
)
_RUN_WORDS = re.compile(
    r"\b(run|execute|test it|verify|check the output|benchmark|simulate|"
    r"what does this print|does this work)\b", re.I
)
_TIME_WORDS = re.compile(r"\b(today|right now|current date|what time|this year|todays)\b", re.I)
_WEB_WORDS = re.compile(r"\bhttps?://\S+", re.I)
_JSON_WORDS = re.compile(r"\b(valid json|validate json|is this json|json schema)\b", re.I)


def _available(prepared: PreparedConversation) -> set[str]:
    """Names of the tools actually offered on this turn."""
    return {
        t.get("function", {}).get("name", "")
        for t in prepared.active_tools
        if isinstance(t, dict)
    }


def _already_called(messages: list[ChatMessage], name: str) -> bool:
    """Whether this tool already produced an observation in this conversation."""
    return any(m.role == "tool" and m.name == name for m in messages)


def _call(name: str, **arguments) -> ToolCall:
    return ToolCall(function=FunctionCall(name=name, arguments=json.dumps(arguments)))


def choose_tool_calls(prepared: PreparedConversation) -> list[ToolCall]:
    """Decide which tools (if any) to invoke for this turn.

    Returns an empty list once the needed observations are in hand, which is what
    terminates the agent loop.
    """
    tools = _available(prepared)
    if not tools:
        return []

    messages = prepared.messages
    text = _last_user_text(messages)
    if not text:
        return []

    calls: list[ToolCall] = []

    # An explicit code block plus an instruction to run it → sandbox.
    block = _CODE_BLOCK_RE.search(text)
    if (
        "code_interpreter" in tools
        and block
        and _RUN_WORDS.search(text)
        and not _already_called(messages, "code_interpreter")
    ):
        calls.append(_call("code_interpreter", code=block.group(1).strip()))

    # Bare arithmetic → exact evaluation rather than a guess.
    if "calculator" in tools and not _already_called(messages, "calculator"):
        expression = _extract_expression(text)
        if expression and (_ARITHMETIC_RE.search(text) or _MATH_WORDS.search(text)):
            calls.append(_call("calculator", expression=expression))

    # Anything about mounted files → retrieve before answering.
    if (
        "document_search" in tools
        and _DOC_WORDS.search(text)
        and not _already_called(messages, "document_search")
    ):
        calls.append(_call("document_search", query=_search_query(text), top_k=4))

    if (
        "current_time" in tools
        and _TIME_WORDS.search(text)
        and not _already_called(messages, "current_time")
    ):
        calls.append(_call("current_time"))

    if "web_fetch" in tools and not _already_called(messages, "web_fetch"):
        url = _WEB_WORDS.search(text)
        if url:
            calls.append(_call("web_fetch", url=url.group(0).rstrip(").,")))

    if (
        "validate_json" in tools
        and _JSON_WORDS.search(text)
        and not _already_called(messages, "validate_json")
    ):
        payload = _extract_json_candidate(text)
        if payload:
            calls.append(_call("validate_json", payload=payload))

    return calls


def _extract_expression(text: str) -> str | None:
    """Pull an evaluable arithmetic expression out of a natural-language turn."""
    # Prefer an explicit inline expression.
    match = re.search(r"[-+]?[\d.]+(?:\s*(?:\*\*|[+\-*/^%])\s*[-+]?[\d.()]+)+", text)
    if match:
        return match.group(0).replace("^", "**").strip()
    return None


def _search_query(text: str) -> str:
    """Reduce a question to its distinctive retrieval keywords."""
    cleaned = re.sub(
        r"\b(what|does|the|document|say|about|in|my|attached|file|tell|me|"
        r"according|to|please|can|you|explain|summarize)\b",
        " ", text, flags=re.I,
    )
    keywords = " ".join(cleaned.split())[:200]
    return keywords or _truncate(text, 200)


def _extract_json_candidate(text: str) -> str | None:
    """Find a JSON object/array embedded in the turn."""
    match = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
    return match.group(1) if match else None


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


def _compose_sovereign(tier: ModelTier, user_text: str) -> str:
    topic = _truncate(user_text) or "your question"
    return (
        f"Direct answer on {topic}, no hedging.\n\n"
        "**My position.** Here is what I actually think, stated as a claim rather "
        "than a menu of options — you can argue with a claim.\n\n"
        "**Why.** The reasoning that carries the most weight, and the specific "
        "condition under which it would fail.\n\n"
        "**Confidence.** Calibrated, not performative: high where the mechanism is "
        "well understood, low where I'm extrapolating, and stated as \"I don't "
        "know\" where that's the truth.\n\n"
        "**What I'd do.** One concrete course of action, chosen and defended.\n\n"
        "*(Sovereign Mode is active: this deployment has disabled reflexive hedging "
        "and boilerplate disclaimers. Fabrication remains off the table.)*"
    )


_COMPOSERS = {
    "general": _compose_general,
    "engineering": _compose_engineering,
    "editorial": _compose_editorial,
    "structured": _compose_structured,
    "sovereign": _compose_sovereign,
}


def _tool_observations(messages: list[ChatMessage]) -> list[ChatMessage]:
    """Every tool result already gathered in this conversation."""
    return [m for m in messages if m.role == "tool"]


def _compose_with_observations(
    tier: ModelTier, mode: Mode, messages: list[ChatMessage], observations: list[ChatMessage]
) -> str:
    """Compose a final answer that visibly incorporates real tool output."""
    user_text = _last_user_text(messages)
    topic = _truncate(user_text, 180) or "your request"

    if mode.id == "structured":
        return json.dumps(
            {
                "understood": True,
                "mode": "structured",
                "tier": tier.id,
                "topic": topic,
                "tools_used": [m.name for m in observations],
                "observations": [
                    {"tool": m.name, "result": _truncate(m.text, 600)} for m in observations
                ],
                "verified_by_execution": True,
            },
            ensure_ascii=False,
            indent=2,
        )

    used = ", ".join(f"`{m.name}`" for m in observations)
    lines = [
        f"I ran {len(observations)} tool call(s) before answering — {used} — so the "
        "result below is verified rather than recalled.\n",
        "## What the tools returned\n",
    ]
    for observation in observations:
        body = observation.text.strip()
        if len(body) > 1200:
            body = body[:1200] + "\n… [truncated]"
        lines.append(f"**`{observation.name}`**\n```\n{body}\n```\n")

    lines.append(
        "## Reading the result\n"
        "The values above come from actual execution, so they are exact. Where I go "
        "beyond them — interpretation, recommendation, or anything not visible in the "
        "output — I'll flag it as inference rather than fact.\n\n"
        f"Ask a follow-up and I'll re-run the relevant step against {topic}."
    )
    return "\n".join(lines)


def compose_response(tier: ModelTier, mode: Mode, messages: list[ChatMessage]) -> str:
    """Build a persona-faithful reply for the given tier, mode, and conversation."""
    observations = _tool_observations(messages)
    if observations:
        return _compose_with_observations(tier, mode, messages, observations)

    user_text = _last_user_text(messages)
    composer = _COMPOSERS.get(mode.id, _compose_general)
    body = composer(tier, user_text)

    images = [image for message in messages for image in message.images]
    if images and mode.id != "structured":
        body += (
            f"\n\n---\n\n**Visual input received.** {len(images)} image(s) are attached "
            "to this conversation and were forwarded with the request. Configure a "
            "vision-capable upstream (`AETHERIS_LLM_PROVIDER=openai` with a model such "
            "as `gpt-4o`) to have their contents analyzed rather than acknowledged."
        )
    return body


class MockProvider(LLMProvider):
    """Offline, brand-aware provider used when no real LLM endpoint is configured."""

    @property
    def provider_name(self) -> str:
        return f"{NAME} Mock"

    async def complete(self, prepared: PreparedConversation) -> CompletionResult:
        calls = choose_tool_calls(prepared)
        if calls:
            return CompletionResult(
                text="",
                finish_reason="tool_calls",
                prompt_tokens=prepared.estimated_prompt_tokens,
                completion_tokens=sum(_approx_tokens(c.function.arguments) for c in calls),
                tool_calls=calls,
            )

        text = compose_response(prepared.tier, prepared.mode, prepared.messages)
        return CompletionResult(
            text=text,
            finish_reason="stop",
            prompt_tokens=prepared.estimated_prompt_tokens,
            completion_tokens=_approx_tokens(text),
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


__all__ = ["MockProvider", "compose_response", "choose_tool_calls"]

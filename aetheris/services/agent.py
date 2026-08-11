"""The Aetheris autonomous agent loop.

This is the concrete implementation of the blueprint's "Autonomous Agentic
Reasoning" capability: *multi-step planning, tool selection, and self-correction
before returning a final answer.*

The loop is provider-agnostic. It asks the active provider for a completion with
the toolbelt attached; if the provider replies with tool calls, the loop executes
them through the registry, appends the observations to the conversation, and asks
again — until the model produces a final answer or the iteration budget is spent.

Guarantees:

* **Bounded** — never exceeds ``max_iterations`` rounds, so a confused model
  cannot loop forever or run up unbounded cost.
* **Parallel** — independent tool calls in one round execute concurrently.
* **Non-fatal** — a tool failure becomes an observation the model can recover
  from, not a 500.
* **Observable** — every call is recorded in a ``ToolInvocation`` trace returned
  to the client and streamed as ``tool_event`` chunks.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from ..core.config import settings
from ..schemas.chat import ChatMessage, ToolCall, ToolInvocation
from ..tools import registry
from .llm import CompletionResult, PreparedConversation, ProviderError

logger = logging.getLogger("aetheris.agent")


@dataclass
class AgentOutcome:
    """The result of a completed agent run."""

    text: str
    trace: list[ToolInvocation] = field(default_factory=list)
    iterations: int = 0
    finish_reason: str = "stop"
    prompt_tokens: int = 0
    completion_tokens: int = 0
    truncated: bool = False


def _iteration_budget(prepared: PreparedConversation) -> int:
    """Resolve the tool-calling budget for this request."""
    requested = prepared.request.max_tool_iterations
    ceiling = settings.agent_max_iterations
    return max(1, min(requested or ceiling, ceiling))


async def _execute_calls(calls: list[ToolCall], step: int) -> list[ToolInvocation]:
    """Execute one round of tool calls concurrently, preserving order."""
    tasks = [
        registry.execute(call.function.name, call.function.arguments, step=step)
        for call in calls
    ]
    return list(await asyncio.gather(*tasks))


def _observation_messages(
    calls: list[ToolCall], results: list[ToolInvocation]
) -> list[ChatMessage]:
    """Turn executed calls into the ``tool`` messages fed back to the model."""
    messages: list[ChatMessage] = []
    for call, result in zip(calls, results):
        if result.ok:
            content = result.output or "(the tool returned no output)"
        else:
            content = (
                f"ERROR: {result.error}\n\n"
                "Diagnose what went wrong and either retry with corrected arguments "
                "or proceed without this tool."
            )
        messages.append(
            ChatMessage(role="tool", content=content, tool_call_id=call.id, name=call.function.name)
        )
    return messages


def _budget_notice(trace: list[ToolInvocation]) -> ChatMessage:
    """The final nudge when the iteration budget is exhausted."""
    used = ", ".join(sorted({t.tool for t in trace})) or "none"
    return ChatMessage(
        role="system",
        content=(
            "Tool budget exhausted. Do not request further tool calls. Produce your "
            f"best final answer now using what you have already gathered (tools used: {used}). "
            "State explicitly which parts remain unverified."
        ),
    )


async def run_agent(prepared: PreparedConversation, provider) -> AgentOutcome:
    """Run the plan → act → observe → self-correct loop to a final answer."""
    budget = _iteration_budget(prepared)
    conversation = list(prepared.messages)
    trace: list[ToolInvocation] = []
    prompt_tokens = prepared.estimated_prompt_tokens
    completion_tokens = 0

    for iteration in range(1, budget + 1):
        step = prepared.clone_with(messages=conversation)
        result: CompletionResult = await provider.complete(step)
        prompt_tokens = max(prompt_tokens, result.prompt_tokens)
        completion_tokens += result.completion_tokens

        if not result.tool_calls:
            return AgentOutcome(
                text=result.text,
                trace=trace,
                iterations=iteration - 1,
                finish_reason=result.finish_reason,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
            )

        calls = result.tool_calls
        logger.info(
            "Agent iteration %d/%d — calling: %s",
            iteration, budget, ", ".join(c.function.name for c in calls),
        )
        conversation.append(
            ChatMessage(role="assistant", content=result.text or None, tool_calls=calls)
        )
        results = await _execute_calls(calls, iteration)
        trace.extend(results)
        conversation.extend(_observation_messages(calls, results))

        if iteration == budget:
            conversation.append(_budget_notice(trace))

    # Budget spent: force one final, tool-free answer.
    final = prepared.clone_with(messages=conversation, tools_disabled=True)
    try:
        result = await provider.complete(final)
        text = result.text
        completion_tokens += result.completion_tokens
    except ProviderError as exc:  # pragma: no cover - defensive
        logger.exception("Agent failed to produce a final answer")
        text = f"[agent error: {exc}]"

    return AgentOutcome(
        text=text,
        trace=trace,
        iterations=budget,
        finish_reason="stop",
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        truncated=True,
    )


async def stream_agent(
    prepared: PreparedConversation, provider
) -> AsyncIterator[tuple[str, object]]:
    """Stream an agent run as ``(event, payload)`` pairs.

    Events:
        ``"tool"``  — payload is a ``ToolInvocation`` that just executed.
        ``"text"``  — payload is a text delta of the final answer.

    Tool-calling rounds are executed non-streamed (the model must emit complete
    call arguments before they can run); only the final answer is streamed, which
    is what the user actually reads.
    """
    budget = _iteration_budget(prepared)
    conversation = list(prepared.messages)
    trace: list[ToolInvocation] = []

    for iteration in range(1, budget + 1):
        step = prepared.clone_with(messages=conversation)
        result = await provider.complete(step)

        if not result.tool_calls:
            # No tools wanted: stream the answer for real rather than replaying it.
            final = prepared.clone_with(messages=conversation, tools_disabled=True)
            async for delta in provider.stream(final):
                yield "text", delta
            return

        calls = result.tool_calls
        conversation.append(
            ChatMessage(role="assistant", content=result.text or None, tool_calls=calls)
        )
        results = await _execute_calls(calls, iteration)
        trace.extend(results)
        for invocation in results:
            yield "tool", invocation
        conversation.extend(_observation_messages(calls, results))

        if iteration == budget:
            conversation.append(_budget_notice(trace))

    final = prepared.clone_with(messages=conversation, tools_disabled=True)
    async for delta in provider.stream(final):
        yield "text", delta


def render_trace(trace: list[ToolInvocation]) -> str:
    """Render a tool trace as compact Markdown (used by the CLI and exports)."""
    if not trace:
        return ""
    lines = ["**Tool trace**", ""]
    for item in trace:
        status = "✓" if item.ok else "✗"
        args = json.dumps(item.arguments, default=str)
        if len(args) > 160:
            args = args[:157] + "…"
        lines.append(f"{status} `{item.tool}` {args} — {item.duration_ms}ms")
        if not item.ok and item.error:
            lines.append(f"   ↳ {item.error}")
    return "\n".join(lines)


__all__ = ["AgentOutcome", "run_agent", "stream_agent", "render_trace"]

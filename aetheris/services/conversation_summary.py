"""Aetheris conversation summarizer.

Turns a stored conversation into a concise, reusable summary using the unified
Hermes agent. This is a *new* stage layered on top of the crude ``auto_summary``
preview: it runs the real cognition cascade over the full transcript and extracts
structured outputs (summary, key points, action items) that clients can surface
in a "resume / recap" UI.

The summarizer degrades gracefully — if the Hermes runtime is unavailable it
falls back to a deterministic extractive recap so the endpoint never fails.
"""

from __future__ import annotations

import re
from typing import Any

from ..core.conversations import _Conversation

_MAX_TRANSCRIPT_CHARS = 40_000

_BULLET_RE = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+(.+)$", re.MULTILINE)
_ACTION_RE = re.compile(
    r"\b(todo|action|next step|next: |do\s+not|should|must|fix|build|implement)\b",
    re.IGNORECASE,
)


def _transcript(conv: _Conversation) -> str:
    """Render the conversation as a compact user/assistant transcript."""
    lines: list[str] = []
    budget = _MAX_TRANSCRIPT_CHARS
    for msg in conv.messages:
        role = {"user": "User", "assistant": "Aetheris", "system": "System"}.get(
            msg.role, msg.role
        )
        content = msg.content.strip().replace("\r", "")
        if len(content) > 1600:
            content = content[:1600] + " …"
        line = f"{role}: {content}"
        if len(line) > budget:
            line = line[:budget]
        lines.append(line)
        budget -= len(line)
        if budget <= 0:
            break
    return "\n\n".join(lines)


def _extract_bullets(text: str, limit: int = 6) -> list[str]:
    """Pull bullet-style lines out of a summary as structured key points."""
    points: list[str] = []
    for match in _BULLET_RE.finditer(text or ""):
        point = " ".join(match.group(1).split())
        if point and point not in points:
            points.append(point)
        if len(points) >= limit:
            break
    return points


def _split_actions(text: str) -> list[str]:
    """Heuristic split of an answer into suggested next actions."""
    actions: list[str] = []
    for match in _BULLET_RE.finditer(text or ""):
        point = " ".join(match.group(1).split())
        if point and _ACTION_RE.search(point) and point not in actions:
            actions.append(point)
    return actions[:5]


def extractive_fallback(conv: _Conversation) -> dict[str, Any]:
    """Deterministic recap used when the Hermes runtime is unavailable."""
    transcript = _transcript(conv)
    words = transcript.split()
    summary = " ".join(words[:120]) + ("…" if len(words) > 120 else "")
    user_lines = [m.content.strip() for m in conv.messages if m.role == "user"]
    key_points = [u[:160] for u in user_lines[:5] if u]
    return {
        "summary": summary,
        "key_points": key_points,
        "action_items": [],
        "source": "extractive-fallback",
        "confidence": 0.5,
    }


async def summarize_conversation(conv: _Conversation) -> dict[str, Any]:
    """Summarize a conversation with the Hermes agent (or a fallback)."""
    transcript = _transcript(conv)
    if not transcript.strip():
        return {
            "summary": "This conversation is empty.",
            "key_points": [],
            "action_items": [],
            "source": "empty",
            "confidence": 1.0,
        }

    task = (
        "Summarize the following conversation into a concise recap. "
        "Output a short 2-4 sentence summary, then a bullet list of the 3-6 "
        "most important points, then a short bullet list of any concrete "
        "action items or next steps (write 'none' if there are none). "
        "Keep it factual and grounded only in what is in the transcript.\n\n"
        f"CONVERSATION:\n{transcript}"
    )

    try:
        from ..hermes.agent import run_hermes

        result = await run_hermes(task, use_tools=False, use_memory=False, learn=False)
        answer = result.answer or ""
    except Exception:  # pragma: no cover - fallback path
        return extractive_fallback(conv)

    summary = _strip_markers(answer)
    key_points = _extract_bullets(summary) or _extract_bullets(answer)
    action_items = _split_actions(summary) or _split_actions(answer)

    if not summary:
        fallback = extractive_fallback(conv)
        return {**fallback, "source": "extractive-fallback"}

    return {
        "summary": summary,
        "key_points": key_points,
        "action_items": action_items,
        "source": "hermes",
        "confidence": round(min(1.0, max(0.0, result.confidence)), 3),
    }


def _strip_markers(text: str) -> str:
    """Remove the synthetic '## Summary / ## Key points / ## Action items'
    section headers Hermes may add, keeping the prose."""
    lines = [ln for ln in (text or "").splitlines() if not re.match(r"^\s*#{1,4}\s+", ln)]
    return "\n".join(lines).strip()


__all__ = ["summarize_conversation", "extractive_fallback"]

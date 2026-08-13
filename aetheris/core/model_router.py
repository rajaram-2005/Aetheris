"""Aetheris Smart Model Router.

Given a task (and optional operator constraints) the router picks the best model
tier for the job *before* it is sent to the provider. It weighs hard signals from
the task surface — reasoning/proof demands, arithmetic, code, conversation length,
latency appetite — against the tier metadata in :mod:`aetheris.core.tiers` and
returns a scored recommendation with the reasons behind it.

This keeps the default offline path deterministic and dependency-free, and it is
the layer a client (or the CLI) can call to answer "which tier should I use for
this?" instead of hard-coding a model.

Example
-------
>>> from aetheris.core.model_router import recommend_model
>>> rec = recommend_model("Prove the square root of two is irrational")
>>> rec["model"]
'aetheris-ultra'
"""

from __future__ import annotations

import re
from typing import Any, Literal

from .tiers import TIERS

LatencyPref = Literal["low", "medium", "high", "balanced"]

_REASONING_RE = re.compile(
    r"\b(prove|proof|derive|verify|theorem|lemma|formal|why|explain|analyze|"
    r"compare|trade-off|architecture|design|hypothesis|evaluate)\b",
    re.IGNORECASE,
)
_MATH_RE = re.compile(
    r"\b(calculate|compute|solve|integral|derivative|eigenvalue|matrix|equation|"
    r"percent|probability|quadratic|statistics|variance)\b|\d+\s*[+\-*/^%]|"
    r"[-+]?\d+\.\d+",
    re.IGNORECASE,
)
_CODE_RE = re.compile(
    r"```|def\s+\w+|class\s+\w+|import\s+\w+|function\s+|const\s+\w+\s*=|"
    r"\b(compile|debug|refactor|optimize|deploy|test|write code|pipeline|API)\b",
    re.IGNORECASE,
)
_RESEARCH_RE = re.compile(
    r"\b(research|survey|review|sources|cite|literature|paper|study|document)\b",
    re.IGNORECASE,
)
# Token estimate: ~4 chars per token is a safe upper bound.
_LONG_CONTEXT_TOKENS = 24_000


def _tokens(text: str) -> int:
    return max(1, len(text.split()))


def recommend_model(
    task: str,
    *,
    latency: LatencyPref = "balanced",
    reasoning: bool | None = None,
    max_context: int | None = None,
    preferred: str | None = None,
) -> dict[str, Any]:
    """Score every tier for ``task`` and return the best match.

    Parameters
    ----------
    task:
        The user's task/prompt text.
    latency:
        Operator's latency appetite: ``low`` (fastest), ``high`` (accept slow),
        or ``balanced``.
    reasoning:
        Explicit override forcing ``True`` (needs extended reasoning) or
        ``False`` (never pick the reasoning tier).
    max_context:
        Estimated input length in tokens. When provided it overrides the
        estimate derived from ``task``.
    preferred:
        An explicit tier id/alias the caller would like; if supplied and valid,
        it is respected (still validated against constraints).

    Returns
    -------
    dict
        ``{"model", "alias", "display_name", "scores", "reasons", "reasoning"}``
    """
    text = (task or "").strip()
    reasons: list[str] = []
    estimated = max_context if max_context is not None else _tokens(text)

    # --- 1. Hard signals ----------------------------------------------------
    needs_reasoning = bool(_REASONING_RE.search(text)) if reasoning is None else reasoning
    has_math = bool(_MATH_RE.search(text))
    has_code = bool(_CODE_RE.search(text))
    has_research = bool(_RESEARCH_RE.search(text))
    is_short = estimated <= 3
    is_long = estimated >= _LONG_CONTEXT_TOKENS

    if needs_reasoning:
        reasons.append("task demands extended reasoning/verification")
    if has_math:
        reasons.append("contains symbolic/arithmetic content")
    if has_code:
        reasons.append("contains code or implementation intent")
    if has_research:
        reasons.append("research/source-grounded request")
    if is_short:
        reasons.append("very short request")
    if is_long:
        reasons.append(f"long context (~{estimated} tokens)")

    # --- 2. Score each tier -------------------------------------------------
    scores: dict[str, float] = {}
    for tier in TIERS:
        score = 1.0  # baseline
        if tier.reasoning:
            score += 0.9 if needs_reasoning else -0.9
        if has_math:
            score += 0.45 if tier.latency_class != "low" else -0.3
        if has_code:
            # Implementation work is the Pro workhorse's job; never route to Lite.
            score += 0.6 if tier.id == "aetheris-pro" else (
                0.2 if tier.id == "aetheris-ultra" else -0.4
            )
        if has_research:
            score += 0.3 if tier.context_window >= 131072 else -0.2
        if is_long:
            score += 0.5 if tier.context_window >= 131072 else -1.5
        if is_short:
            score += 0.5 if tier.latency_class == "low" else -0.3
        # Latency preference.
        if latency == "low":
            score += 1.2 if tier.latency_class == "low" else -1.0
        elif latency == "high":
            score += 0.8 if tier.latency_class == "high" else -0.2
        elif latency == "medium":
            score += 0.4 if tier.latency_class == "medium" else 0.0
        scores[tier.id] = round(score, 3)

    # --- 3. Honour an explicit preference (if it survives validation) ------
    if preferred:
        from .tiers import get_tier

        try:
            chosen_tier = get_tier(preferred)
        except KeyError:
            chosen_tier = None
        if chosen_tier is not None:
            reasons.append(f"explicit preference '{preferred}' respected")
            return _build(chosen_tier, scores, reasons, needs_reasoning)

    best_id = max(scores, key=lambda tid: (scores[tid], tid))
    best_tier = next(t for t in TIERS if t.id == best_id)
    reasons.append(
        f"best fit by composite score ({scores[best_id]:.2f}); "
        f"context {estimated} tokens"
    )
    return _build(best_tier, scores, reasons, needs_reasoning)


def _build(tier, scores: dict[str, float], reasons: list[str], reasoning: bool) -> dict[str, Any]:
    return {
        "model": tier.id,
        "alias": tier.alias,
        "display_name": tier.display_name,
        "reasoning": reasoning,
        "scores": scores,
        "reasons": reasons,
    }


def get_router() -> Any:
    """Return the shared router (single import seam for callers/tests)."""
    return recommend_model


__all__ = ["recommend_model", "get_router", "LatencyPref"]

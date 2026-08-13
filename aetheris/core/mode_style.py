"""Presentation layer for inference modes.

Modes are orthogonal to the three model tiers. This module (1) restyles an
already-computed answer so Flash / Lite / Pro / Myth / Legendary actually
*read* differently, and (2) builds the 3×N legend matrix friends can pick
from. Exact math and safety refusals are never rewritten.
"""

from __future__ import annotations

import re
from typing import Any

from .modes import available_modes, get_mode
from .tiers import TIERS, get_tier

_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def _first_sentences(text: str, n: int) -> str:
    parts = _SENTENCE.split((text or "").strip())
    kept = [p.strip() for p in parts if p.strip()][:n]
    return " ".join(kept).strip() or (text or "").strip()


def style_answer(
    mode: str | None,
    answer: str,
    *,
    tier: str | None = None,
    task: str = "",
    exact: bool = False,
    refused: bool = False,
) -> str:
    """Restyle ``answer`` for ``mode``. Identity for general / structured / unknown.

    ``exact`` (symbolic math) and ``refused`` (safety) answers are returned
    unchanged so mode never corrupts a number or a refusal.
    """
    if refused or exact or not (answer or "").strip():
        return answer
    try:
        resolved = get_mode(mode)
    except KeyError:
        return answer
    mid = resolved.id
    if mid in {"general", "engineering", "editorial", "structured", "sovereign"}:
        return answer

    body = answer.strip()
    topic = (task or "").strip().split("\n", 1)[0][:80]
    tier_name = ""
    try:
        tier_name = get_tier(tier).display_name if tier else ""
    except KeyError:
        tier_name = ""
    on = f" · {tier_name}" if tier_name else ""

    if mid == "flash":
        lead = _first_sentences(body, 2)
        return f"{lead}\n\n— Flash{on}"

    if mid == "lite":
        lead = _first_sentences(body, 3)
        return (
            f"**Simple version.** {lead}\n\n"
            "Want the longer cut? Ask and I'll go deeper.\n\n"
            f"— Lite{on}"
        )

    if mid == "pro":
        return (
            f"{body}\n\n"
            "## Position\n"
            "Ship the smallest reversible next step. If a fact above is inferred, "
            "treat it as a hypothesis until you verify it.\n\n"
            "## Next move\n"
            "Do one thing in the next hour that would change this answer if it failed.\n\n"
            f"— Pro{on}"
        )

    if mid == "myth":
        omen = topic or "the question you carried here"
        return (
            f"*At the well, the pattern named itself: {omen}.*\n\n"
            f"{body}\n\n"
            "The crossing is one concrete act, not another story. Take it, then "
            "return if the terrain shifts.\n\n"
            f"— Myth{on}"
        )

    if mid == "legendary":
        return (
            f"**The claim.** What follows is the campaign I would put my name on"
            f"{' for ' + topic if topic else ''}.\n\n"
            f"{body}\n\n"
            "**The stake.** Recant if the load-bearing assumption fails. Until then, "
            "do not dilute the move with a menu of milder options.\n\n"
            f"— Legendary{on}"
        )

    return answer


def legend_matrix() -> dict[str, Any]:
    """Every available mode × the three model tiers."""
    modes = available_modes()
    matrix: list[dict[str, Any]] = []
    for tier in TIERS:
        for mode in modes:
            matrix.append(
                {
                    "id": f"{tier.alias}-{mode.id}",
                    "model": tier.id,
                    "model_alias": tier.alias,
                    "model_name": tier.display_name,
                    "mode": mode.id,
                    "mode_name": mode.display_name,
                    "family": mode.family,
                    "label": f"{tier.display_name} · {mode.display_name}",
                    "tagline": f"{mode.display_name} on {tier.display_name} "
                    f"({tier.latency_class} latency, {tier.context_window:,} ctx).",
                }
            )
    return {
        "models": [
            {
                "id": t.id,
                "alias": t.alias,
                "display_name": t.display_name,
                "latency_class": t.latency_class,
                "context_window": t.context_window,
            }
            for t in TIERS
        ],
        "modes": [
            {
                "id": m.id,
                "display_name": m.display_name,
                "family": m.family,
                "aliases": list(m.aliases),
                "description": m.description,
            }
            for m in modes
        ],
        "matrix": matrix,
        "count": len(matrix),
    }


__all__ = ["style_answer", "legend_matrix"]

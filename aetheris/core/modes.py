"""Aetheris inference modes — the binding between a mode and its system prompt.

A "mode" selects which production system prompt activates the Aetheris identity
for a given request. Modes are orthogonal to model tiers: any tier can run in
any mode (e.g. ``aetheris-ultra`` in ``engineering`` mode).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from ..prompts.system_prompts import DEFAULT_MODE, SYSTEM_PROMPTS, get_system_prompt


@dataclass(frozen=True)
class Mode:
    """A single Aetheris inference mode."""

    id: str
    display_name: str
    description: str
    system_prompt: str


_MODES: Final[dict[str, Mode]] = {
    "general": Mode(
        id="general",
        display_name="General Assistant",
        description=(
            "Master identity. High-level reasoning, creative synthesis, and precise "
            "problem-solving as a constructive thought partner."
        ),
        system_prompt=get_system_prompt("general"),
    ),
    "engineering": Mode(
        id="engineering",
        display_name="Engineering (Pair-Programming)",
        description=(
            "Senior software architect and expert pair-programmer. Production-grade, "
            "modular code with architecture-first explanations."
        ),
        system_prompt=get_system_prompt("engineering"),
    ),
    "editorial": Mode(
        id="editorial",
        display_name="Editorial (Creative Writing)",
        description=(
            "Constructive writing coach and creative collaborator. Preserves the "
            "author's authentic voice while elevating clarity and impact."
        ),
        system_prompt=get_system_prompt("editorial"),
    ),
    "structured": Mode(
        id="structured",
        display_name="Structured Inference (JSON)",
        description=(
            "Structured inference node. Emits strict, schema-compliant JSON with no "
            "conversational filler, suitable for API and function-calling pipelines."
        ),
        system_prompt=get_system_prompt("structured"),
    ),
}

MODES: Final[tuple[Mode, ...]] = tuple(_MODES.values())


def get_mode(mode: str | None = None) -> Mode:
    """Resolve a request's ``mode`` field to a concrete Mode.

    ``None`` resolves to the default mode (``general``). Unknown modes raise a
    ``KeyError`` describing the valid options.
    """
    resolved = mode or DEFAULT_MODE
    if resolved not in _MODES:
        valid = ", ".join(sorted(_MODES))
        raise KeyError(f"Unknown Aetheris mode '{resolved}'. Valid modes: {valid}")
    return _MODES[resolved]


def known_mode_ids() -> tuple[str, ...]:
    """Return the tuple of registered mode ids in declaration order."""
    return tuple(_MODES.keys())


# Re-export the prompt registry so callers can import modes + prompts together.
__all__ = [
    "Mode",
    "MODES",
    "get_mode",
    "known_mode_ids",
    "SYSTEM_PROMPTS",
    "DEFAULT_MODE",
]

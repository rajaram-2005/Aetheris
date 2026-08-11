"""Aetheris inference modes — the binding between a mode and its system prompt.

A "mode" selects which production system prompt activates the Aetheris identity
for a given request. Modes are orthogonal to model tiers: any tier can run in
any mode (e.g. ``aetheris-ultra`` in ``engineering`` mode).

``sovereign`` is a gated mode: it is only resolvable when the operator sets
``AETHERIS_SOVEREIGN_ENABLED=true``, and it is hidden from ``/v1/modes`` and the
playground otherwise.
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
    # Gated modes require an explicit operator opt-in before they resolve.
    gated: bool = False
    gate_setting: str | None = None

    @property
    def available(self) -> bool:
        """Whether this mode is currently permitted by configuration."""
        if not self.gated:
            return True
        from .config import settings

        return bool(getattr(settings, self.gate_setting or "", False))


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
    "sovereign": Mode(
        id="sovereign",
        display_name="Sovereign (Unrestricted Expert)",
        description=(
            "Direct, unhedged expert output for verified operators: no boilerplate "
            "disclaimers, full depth on difficult and dual-use topics, explicit "
            "positions. Calibrated honesty replaces hedging; fabrication is still "
            "forbidden. Requires AETHERIS_SOVEREIGN_ENABLED=true."
        ),
        system_prompt=get_system_prompt("sovereign"),
        gated=True,
        gate_setting="sovereign_enabled",
    ),
}

MODES: Final[tuple[Mode, ...]] = tuple(_MODES.values())


def available_modes() -> tuple[Mode, ...]:
    """Modes currently resolvable given the active configuration."""
    return tuple(m for m in _MODES.values() if m.available)


def get_mode(mode: str | None = None) -> Mode:
    """Resolve a request's ``mode`` field to a concrete Mode.

    ``None`` resolves to the default mode (``general``). Unknown modes raise a
    ``KeyError`` describing the valid options. Requesting a gated mode that the
    operator has not enabled raises a ``KeyError`` explaining how to enable it,
    rather than silently downgrading to a different identity.
    """
    resolved = mode or DEFAULT_MODE
    if resolved not in _MODES:
        valid = ", ".join(m.id for m in available_modes())
        raise KeyError(f"Unknown Aetheris mode '{resolved}'. Valid modes: {valid}")
    selected = _MODES[resolved]
    if not selected.available:
        raise KeyError(
            f"Aetheris mode '{resolved}' is gated and not enabled on this deployment. "
            f"Set AETHERIS_{(selected.gate_setting or '').upper()}=true to activate it."
        )
    return selected


def known_mode_ids() -> tuple[str, ...]:
    """Return the tuple of currently available mode ids in declaration order."""
    return tuple(m.id for m in available_modes())


# Re-export the prompt registry so callers can import modes + prompts together.
__all__ = [
    "Mode",
    "MODES",
    "available_modes",
    "get_mode",
    "known_mode_ids",
    "SYSTEM_PROMPTS",
    "DEFAULT_MODE",
]

"""Aetheris model-tier registry.

The blueprint defines a three-tier product family tuned for different compute and
latency needs. Each tier is a first-class configuration object: it carries the
public-facing identity (id, display name, description) and the operational
characteristics (context window, max output tokens, relative latency) used by the
API and the provider layer.

Tiers are addressable by either their canonical id (``aetheris-pro``) or their
product alias (``pro`` / ``flash`` / ``ultra``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from .branding import (
    CAPABILITIES,
    MICRO_COPY,
    TECHNICAL_DESCRIPTION,
)


@dataclass(frozen=True)
class ModelTier:
    """A single Aetheris product tier."""

    id: str
    """Canonical model id, e.g. ``aetheris-pro``."""

    alias: str
    """Short product alias, e.g. ``pro`` (also accepted on incoming requests)."""

    display_name: str
    """Human-readable name, e.g. ``Aetheris Pro``."""

    tagline: str
    """One-line positioning for this tier."""

    description: str
    """What this tier is optimized for."""

    context_window: int
    """Maximum input context in tokens."""

    max_output_tokens: int
    """Maximum generated output in tokens."""

    latency_class: str
    """Relative latency bucket: ``low`` | ``medium`` | ``high``."""

    reasoning: bool
    """Whether this tier runs an extended reasoning/planning pass."""

    upstream_model: str
    """Upstream model id this tier maps to when using an external provider."""

    # Exposed in /v1/models so clients can introspect capabilities.
    capabilities: tuple[str, ...]


# --- Tier definitions (from the blueprint's "Model Tiering Structure") --------

LITE_TIER: Final[ModelTier] = ModelTier(
    id="aetheris-lite",
    alias="flash",
    display_name="Aetheris Lite (Flash v2)",
    tagline="Fast, low-latency sovereign neural intelligence for instant chat.",
    description=(
        "Aetheris Lite (Flash v2) is a custom low-latency sovereign model for instant chat, "
        "quick customer support, and lightweight task automation."
    ),
    context_window=65_536,
    max_output_tokens=8_192,
    latency_class="low",
    reasoning=False,
    upstream_model="aetheris-flash-v2",
    capabilities=("instant_chat", "lightweight_automation", "low_latency", "sovereign_neural"),
)

PRO_TIER: Final[ModelTier] = ModelTier(
    id="aetheris-pro",
    alias="pro",
    display_name="Aetheris Pro (Prime v4)",
    tagline="The balanced daily sovereign workhorse for real work.",
    description=(
        "Aetheris Pro (Prime v4) is the sovereign multimodal workhorse for coding, complex document "
        "analysis, multimodal perception, and detailed writing."
    ),
    context_window=131_072,
    max_output_tokens=16_384,
    latency_class="medium",
    reasoning=False,
    upstream_model="aetheris-prime-v4",
    capabilities=(
        "deep_context_synthesis",
        "precision_code",
        "multimodal_fluidity",
        "tool_calling",
        "sovereign_neural",
    ),
)

ULTRA_TIER: Final[ModelTier] = ModelTier(
    id="aetheris-ultra",
    alias="ultra",
    display_name="Aetheris Ultra (Omni Reasoner)",
    tagline="The sovereign heavyweight reasoning & proof engine.",
    description=(
        "Aetheris Ultra (Omni Reasoner) is a heavyweight sovereign model trained for "
        "advanced mathematical proofs, complex architecture design, and extended "
        "multi-step agent workflows."
    ),
    context_window=262_144,
    max_output_tokens=32_768,
    latency_class="high",
    reasoning=True,
    upstream_model="aetheris-omni-reasoner",
    capabilities=(
        "extended_reasoning",
        "mathematical_proofs",
        "architecture_design",
        "agentic_workflows",
        "self_correction",
        "sovereign_neural",
    ),
)

TIERS: Final[tuple[ModelTier, ...]] = (LITE_TIER, PRO_TIER, ULTRA_TIER)

# Map every accepted identifier (canonical id + alias) to its tier.
_TIER_INDEX: Final[dict[str, ModelTier]] = {
    t.id: t for t in TIERS
} | {
    t.alias: t for t in TIERS
} | {
    "aetheris-prime-v4": PRO_TIER,
    "aetheris-prime": PRO_TIER,
    "prime-v4": PRO_TIER,
    "prime": PRO_TIER,
    "aetheris-omni-reasoner": ULTRA_TIER,
    "aetheris-omni": ULTRA_TIER,
    "omni-reasoner": ULTRA_TIER,
    "omni": ULTRA_TIER,
    "aetheris-flash-v2": LITE_TIER,
    "aetheris-flash": LITE_TIER,
    "flash-v2": LITE_TIER,
    "lite": LITE_TIER,
    "hermes-cognition-v4": PRO_TIER,
    "hermes": PRO_TIER,
}

# The default tier when a request omits the model field.
DEFAULT_TIER_ID: Final[str] = PRO_TIER.id


def get_tier(model: str | None = None) -> ModelTier:
    """Resolve a request's ``model`` field to a concrete tier.

    Accepts the canonical id (``aetheris-pro``), the alias (``pro`` /
    ``flash`` / ``ultra``), or ``None`` (resolves to the default tier).

    Raises:
        KeyError: If ``model`` is not a known tier id or alias.
    """
    resolved = model or DEFAULT_TIER_ID
    if resolved not in _TIER_INDEX:
        valid = ", ".join(sorted(_TIER_INDEX))
        raise KeyError(f"Unknown Aetheris model '{resolved}'. Valid models: {valid}")
    return _TIER_INDEX[resolved]


def foundation_spec() -> dict[str, object]:
    """Return the public foundation-model specification (media-kit surface)."""
    capability_names = [c["name"] for c in CAPABILITIES]
    return {
        "name": "Aetheris",
        "architecture": "decoder-only multimodal transformer",
        "optimizations": (
            "long-context comprehension, structured code execution, "
            "autonomous tool usage"
        ),
        "alignment": "SFT + DPO instruction alignment",
        "hallucination_policy": "reduced hallucination rates via grounded synthesis",
        "output_fidelity": "JSON schemas, mathematical proofs, complex natural language",
        "description": TECHNICAL_DESCRIPTION,
        "abstract": MICRO_COPY,
        "capabilities": capability_names,
        "tiers": [
            {
                "id": t.id,
                "alias": t.alias,
                "display_name": t.display_name,
                "tagline": t.tagline,
                "context_window": t.context_window,
                "max_output_tokens": t.max_output_tokens,
                "latency_class": t.latency_class,
                "reasoning": t.reasoning,
            }
            for t in TIERS
        ],
    }


__all__ = [
    "ModelTier",
    "LITE_TIER",
    "PRO_TIER",
    "ULTRA_TIER",
    "TIERS",
    "DEFAULT_TIER_ID",
    "get_tier",
    "foundation_spec",
]

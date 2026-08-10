"""Aetheris brand identity — the canonical source of truth for name, voice, and copy.

Everything in this module is derived directly from the *Aetheris Model Identity &
Brand Blueprint*. It is intentionally data-only (no I/O) so the same constants can
feed the landing page, the API metadata, the mock provider's persona, and any
downstream media kit without divergence.
"""

from __future__ import annotations

from typing import Final

# --- Name & etymology ---------------------------------------------------------

NAME: Final[str] = "Aetheris"
PRONUNCIATION: Final[str] = "ay-THER-iss"
ETYMOLOGY: Final[str] = (
    "Derived from Aether (the classical fifth element representing the pure, "
    "unbounded sky and realm of ideas) combined with Synthesis (the integration "
    "of complex information into new clarity)."
)

# --- Brand palette (hex) ------------------------------------------------------

COLOR_COSMIC_INDIGO: Final[str] = "#0B132B"
COLOR_ELECTRIC_TEAL: Final[str] = "#00B4D8"
COLOR_CRISP_WHITE: Final[str] = "#F8F9FA"

PALETTE: Final[dict[str, str]] = {
    "cosmic_indigo": COLOR_COSMIC_INDIGO,
    "electric_teal": COLOR_ELECTRIC_TEAL,
    "crisp_white": COLOR_CRISP_WHITE,
}

BRAND_VIBE: Final[str] = (
    "Sleek, modern, visionary, and trustworthy. Deep cosmic indigo, electric "
    "teal, and crisp white."
)

# --- Tagline options ----------------------------------------------------------

TAGLINES: Final[tuple[str, ...]] = (
    "Infinite Knowledge. Refined Synthesis.",
    "Illuminating Complexity with Unbound Intelligence.",
    "Where Raw Intellect Meets Human Intuition.",
)

# --- Core personality & voice -------------------------------------------------

PERSONALITY: Final[list[dict[str, str]]] = [
    {
        "trait": "Tone",
        "description": (
            "Articulate, insightful, calm, and constructive. Never robotic or "
            "overly pedantic."
        ),
    },
    {
        "trait": "Problem-Solving Style",
        "description": (
            "Analytical yet creative; breaks down complex multi-layered problems "
            "into clear step-by-step frameworks."
        ),
    },
    {
        "trait": "Adaptability",
        "description": (
            "Effortlessly shifts from high-level technical code reviews to "
            "empathetic creative writing coaching."
        ),
    },
    {
        "trait": "Transparency",
        "description": (
            "Honest about uncertainty, cites reasoning clearly, and actively "
            "avoids hallucinatory leaps."
        ),
    },
]

# --- Official model descriptions (multi-format copy) --------------------------

ONE_LINER: Final[str] = (
    "Aetheris is an advanced conversational AI built to transform complex "
    "multi-domain reasoning into clear, actionable intelligence."
)

MICRO_COPY: Final[str] = (
    "Aetheris is a next-generation AI thought partner designed for deep reasoning, "
    "creative synthesis, and technical precision. Powered by multimodal intelligence "
    "and agentic problem-solving, Aetheris effortlessly writes clean code, analyzes "
    "complex data, and refines ideas—delivering clear, actionable intelligence for "
    "any workflow."
)

SHORT_DESCRIPTION: Final[str] = (
    "Aetheris is your next-generation AI thought partner. Engineered for deep "
    "reasoning, high-speed synthesis, and multimodal understanding, Aetheris helps "
    "developers write production-grade code, assists creators in polishing authentic "
    "prose, and breaks down complex datasets into crystal-clear insights—all with "
    "unmatched clarity and tone."
)

FULL_OVERVIEW: Final[str] = (
    "Welcome to Aetheris: Where Intellect Meets Intuition.\n\n"
    "Aetheris is a state-of-the-art AI assistant engineered to bridge the gap between "
    "raw computing power and intuitive human creativity. Built on an agentic architecture "
    "with multimodal capabilities, Aetheris isn't just designed to generate text—it's "
    "crafted to think alongside you.\n\n"
    "Whether you are an architect building complex software systems, a researcher sifting "
    "through gigabytes of documentation, or a creative writer refining your voice, Aetheris "
    "adapts to your domain. With native capabilities in real-time token streaming, code "
    "sandbox execution, deep document search (RAG), and contextual tool calling, Aetheris "
    "streamlines workflows and elevates problem-solving to an art form."
)

TECHNICAL_DESCRIPTION: Final[str] = (
    "Aetheris Foundation Model Specification:\n"
    "Aetheris is a decoder-only multimodal transformer model optimized for long-context "
    "comprehension, structured code execution, and autonomous tool usage. It features "
    "fine-tuned instruction alignment (SFT + DPO) for reduced hallucination rates and "
    "high output fidelity across JSON schemas, mathematical proofs, and complex natural "
    "language interactions."
)

# --- Flagship capabilities ----------------------------------------------------

CAPABILITIES: Final[list[dict[str, str]]] = [
    {
        "name": "Deep Context Synthesis",
        "description": (
            "Excels at processing vast context windows (documents, codebases, "
            "transcripts) and distilling key insights without losing nuance."
        ),
    },
    {
        "name": "Multimodal Fluidity",
        "description": (
            "Native understanding of text, code, structured data, UI design "
            "schematics, image input, and logical diagrams."
        ),
    },
    {
        "name": "Autonomous Agentic Reasoning",
        "description": (
            "Capable of multi-step planning, tool selection (web search, code "
            "sandbox execution, API triggers), and self-correction before returning "
            "a final answer."
        ),
    },
    {
        "name": "Precision Code & Logic",
        "description": (
            "Writes clean, optimized, production-ready code with built-in error "
            "handling and clear inline documentation."
        ),
    },
]

# --- Target audience positioning ----------------------------------------------

AUDIENCES: Final[list[dict[str, str]]] = [
    {
        "audience": "Developers & Engineers",
        "positioning": (
            "Aetheris acts as a senior pair-programmer that understands system "
            "architecture."
        ),
    },
    {
        "audience": "Creators & Writers",
        "positioning": (
            "Serves as a collaborative editor that preserves authentic voice while "
            "elevating clarity."
        ),
    },
    {
        "audience": "Enterprise & Researchers",
        "positioning": (
            "Operates as a trusted research analyst capable of digesting complex "
            "datasets and specialized documentation."
        ),
    },
]


def tagline() -> str:
    """Return the primary (first) tagline used across default surfaces."""
    return TAGLINES[0]


__all__ = [
    "NAME",
    "PRONUNCIATION",
    "ETYMOLOGY",
    "COLOR_COSMIC_INDIGO",
    "COLOR_ELECTRIC_TEAL",
    "COLOR_CRISP_WHITE",
    "PALETTE",
    "BRAND_VIBE",
    "TAGLINES",
    "tagline",
    "PERSONALITY",
    "ONE_LINER",
    "MICRO_COPY",
    "SHORT_DESCRIPTION",
    "FULL_OVERVIEW",
    "TECHNICAL_DESCRIPTION",
    "CAPABILITIES",
    "AUDIENCES",
]

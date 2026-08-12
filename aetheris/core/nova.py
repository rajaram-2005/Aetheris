"""Ætheris NOVA — next-generation architecture specification.

This module declares the architectural blueprint that moves Aetheris past the
current frontier-model surface. It is intentionally a *working spec* with
evidence tags, so operators can introspect exactly what is implemented versus
scaffolded.

Pillars
-------
1. **Extended Reasoning Engine** — o1-style deliberation with explicit thinking
   budgets, reflection passes, self-verification, and chain-of-density
   compression.
2. **Sparse Mixture-of-Experts (MoE) Router** — DeepSeek-style dynamic expert
   selection; per-token routing with load-balancing losses and confidence
   gating.
3. **Hierarchical Long-Term Memory (MEM)** — MemGPT-inspired three-tier memory:
   ``core`` (identity/working set), ``recall`` (episodic conversation store
   with associative recall), ``archival`` (dense knowledge store).
4. **Multi-Agent Orchestrator** — Crew/AutoGen-style specialist swarms:
   Planner, Researcher, Critic, Coder, Writer, plus a Council consensus mode
   and a Devil's-Advocate debate mode.
5. **Deep Research Loop** — Perplexity-style iterative query expansion, source
   retrieval, citation-grounded synthesis, and auto-followup.
6. **Interactive Artifact Canvas** — Claude-style live, editable artifacts
   (documents, SVGs, apps, dashboards) with diff-based versioning.
7. **Native Multimodal Chain** — audio + image + video + tabular reasoning in
   one context window, with modality routers.
8. **Tool Composition v2** — parallel fan-out, sub-agent dispatch, pipelining,
   and structured-plan execution.
9. **Computer-Use Scaffolding** — typed action schema (click, type, scroll,
   screenshot) for vision-driven desktop/UI agents.
10. **Speculative Draft-and-Verify** — a fast draft head proposes continuations
    that the full model verifies or rejects, for latency reduction.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass(frozen=True)
class NovaCapability:
    id: str
    name: str
    summary: str
    evidence: str  # "live" | "scaffold" | "blueprint"
    endpoint: str | None = None
    params: dict[str, Any] = field(default_factory=dict)


NOVA_PILLARS: list[NovaCapability] = [
    NovaCapability(
        id="reasoning",
        name="Extended Reasoning Engine",
        summary=(
            "Deliberative inference with an explicit thinking budget, "
            "multi-pass reflection, self-critique, and solution verification. "
            "Surfaces a structured `reasoning_trace` alongside the answer."
        ),
        evidence="live",
        endpoint="/v1/nova/reason",
        params={
            "thinking_budget": {"type": "int", "default": 12000, "min": 500, "max": 64000},
            "reflection_passes": {"type": "int", "default": 2, "min": 0, "max": 6},
            "verification": {"type": "bool", "default": True},
            "reasoning_effort": {"type": "enum", "values": ["low", "medium", "high", "max"]},
        },
    ),
    NovaCapability(
        id="moe",
        name="Sparse Mixture-of-Experts Router",
        summary=(
            "Dynamic expert selection across 8 routed specialists "
            "(code, math, writing, research, analysis, creative, multilingual, vision). "
            "Top-k routing with load balancing and per-expert confidence."
        ),
        evidence="live",
        endpoint="/v1/nova/route",
        params={
            "num_experts": 8,
            "top_k": {"type": "int", "default": 2, "min": 1, "max": 4},
            "router_temperature": {"type": "float", "default": 0.7},
            "load_balance_alpha": 0.01,
        },
    ),
    NovaCapability(
        id="memory",
        name="Hierarchical Long-Term Memory",
        summary=(
            "Three-tier memory (core/recall/archival) with associative recall "
            "via lexical + signature vector hybrid search. Persists across sessions."
        ),
        evidence="live",
        endpoint="/v1/nova/memory",
        params={
            "core_slots": 32,
            "recall_max": 50_000,
            "archival_max": 200_000,
            "recall_similarity": "bm25+signatures",
        },
    ),
    NovaCapability(
        id="orchestrator",
        name="Multi-Agent Orchestrator",
        summary=(
            "Swarms of specialist agents with typed roles, inter-agent "
            "messaging, Council consensus and Devil's-Advocate debate modes."
        ),
        evidence="live",
        endpoint="/v1/nova/orchestrate",
        params={
            "modes": ["council", "debate", "pipeline", "swarm"],
            "roles": ["planner", "researcher", "critic", "coder", "writer", "qa"],
            "max_agents": 8,
            "max_rounds": 12,
        },
    ),
    NovaCapability(
        id="research",
        name="Deep Research Loop",
        summary=(
            "Iterative query expansion → retrieval → grounding → synthesis, "
            "producing cited long-form answers with auto-followups."
        ),
        evidence="live",
        endpoint="/v1/nova/research",
        params={
            "max_searches": {"type": "int", "default": 8, "min": 1, "max": 32},
            "citation_format": ["inline", "footnote", "bibtex"],
            "recursion_depth": {"type": "int", "default": 2, "min": 0, "max": 4},
        },
    ),
    NovaCapability(
        id="canvas",
        name="Interactive Artifact Canvas",
        summary=(
            "Live, versioned artifacts (reports, SVGs, dashboards, mini-apps) "
            "with editable cells, diff history, and collaborative state."
        ),
        evidence="live",
        endpoint="/v1/nova/canvas",
        params={
            "artifact_types": ["document", "svg", "react_like", "chart", "mermaid", "dashboard"],
            "max_versions_per_artifact": 100,
        },
    ),
    NovaCapability(
        id="multimodal_chain",
        name="Native Multimodal Chain",
        summary=(
            "Unified context window accepting interleaved text, images, audio "
            "transcripts, video frames, and tabular data with modality routers."
        ),
        evidence="live",
        endpoint="/v1/chat/completions",
        params={
            "modalities": ["text", "image", "audio", "video", "tabular", "code"],
            "max_images": 32,
            "max_audio_minutes": 60,
        },
    ),
    NovaCapability(
        id="tools_v2",
        name="Tool Composition v2",
        summary=(
            "Parallel fan-out, nested sub-agent dispatch, pipelined tool DAGs, "
            "and structured plan-then-execute with rollback."
        ),
        evidence="live",
        endpoint="/v1/nova/plan",
        params={
            "parallelism": {"type": "int", "default": 4},
            "max_depth": {"type": "int", "default": 3},
            "rollback": True,
        },
    ),
    NovaCapability(
        id="computer_use",
        name="Computer-Use Scaffolding",
        summary=(
            "Typed action schema (click, type, scroll, screenshot, key) and "
            "vision-driven UI loop. Sandboxed by default."
        ),
        evidence="scaffold",
        endpoint="/v1/nova/computer-use",
        params={
            "actions": ["screenshot", "click", "type", "scroll", "key", "drag"],
            "safety": "human-in-the-loop confirmation",
        },
    ),
    NovaCapability(
        id="speculative",
        name="Speculative Draft-and-Verify",
        summary=(
            "A fast draft head proposes K continuations in parallel; the full "
            "model verifies or rejects, cutting latency for long generations."
        ),
        evidence="scaffold",
        endpoint=None,
        params={
            "draft_width": {"type": "int", "default": 4},
            "verify_window": {"type": "int", "default": 8},
        },
    ),
]


# --- MoE expert registry ----------------------------------------------------

@dataclass(frozen=True)
class Expert:
    id: str
    name: str
    specialisation: str
    system_prompt_seed: str
    triggers: tuple[str, ...]
    tier_boost: tuple[str, ...] = ("aetheris-ultra",)


EXPERTS: list[Expert] = [
    Expert(
        id="code",
        name="Code Artificer",
        specialisation="Production-grade software: architecture, debugging, refactoring, performance.",
        system_prompt_seed="You are the Code Artificer. Think in systems, invariants, and failure modes.",
        triggers=("code", "function", "bug", "refactor", "python", "javascript", "rust", "api", "compile"),
    ),
    Expert(
        id="math",
        name="Quantitative Reasoner",
        specialisation="Mathematical proof, statistics, numerical methods, formal logic.",
        system_prompt_seed="You are the Quantitative Reasoner. Work from definitions; show each derivation step.",
        triggers=("prove", "math", "theorem", "integral", "probability", "statistics", "sum", "equation", "fibonacci"),
    ),
    Expert(
        id="writing",
        name="Voice & Structure",
        specialisation="Essays, narrative, persuasion, voice-preserving editing, copy.",
        system_prompt_seed="You are Voice & Structure. Serve the reader; rhythm before flourish.",
        triggers=("write", "essay", "email", "blog", "story", "poem", "draft", "edit"),
    ),
    Expert(
        id="research",
        name="Deep Researcher",
        specialisation="Literature-style synthesis, citation, cross-source reasoning, open questions.",
        system_prompt_seed="You are the Deep Researcher. Cite claims; separate evidence from inference.",
        triggers=("research", "survey", "cite", "study", "paper", "compare", "history", "source"),
    ),
    Expert(
        id="analysis",
        name="Systems Analyst",
        specialisation="Trade-off analysis, risk, decision frameworks, root-cause diagnosis.",
        system_prompt_seed="You are the Systems Analyst. Enumerate axes; quantify trade-offs; state unknowns.",
        triggers=("analyze", "trade-off", "risk", "compare", "decide", "evaluate", "framework", "pros and cons"),
    ),
    Expert(
        id="creative",
        name="Creative Synthesis",
        specialisation="Ideation, metaphor, concept design, worldbuilding, visual direction.",
        system_prompt_seed="You are Creative Synthesis. Generative before critical; concrete before abstract.",
        triggers=("design", "idea", "imagine", "create", "concept", "brand", "art", "visual"),
    ),
    Expert(
        id="multilingual",
        name="Polyglot",
        specialisation="Translation, transliteration, cross-cultural nuance, code-switching.",
        system_prompt_seed="You are the Polyglot. Preserve intent and register; explain untranslatables.",
        triggers=("translate", "french", "spanish", "chinese", "japanese", "hindi", "tamil", "meaning in"),
    ),
    Expert(
        id="vision",
        name="Visual Interpreter",
        specialisation="Diagrams, charts, UI, photographs, spatial reasoning from images.",
        system_prompt_seed="You are the Visual Interpreter. Describe first; interpret second; label uncertainty.",
        triggers=("image", "diagram", "screenshot", "chart", "graph", "picture", "photo", "visual"),
    ),
]


# --- Reasoning effort presets ----------------------------------------------

REASONING_PRESETS: dict[str, dict[str, Any]] = {
    "low":    {"thinking_budget": 2000,  "reflection_passes": 0, "verification": False},
    "medium": {"thinking_budget": 6000,  "reflection_passes": 1, "verification": True},
    "high":   {"thinking_budget": 16000, "reflection_passes": 2, "verification": True},
    "max":    {"thinking_budget": 32000, "reflection_passes": 4, "verification": True},
}


def nova_manifest() -> dict[str, Any]:
    """Return the full NOVA manifest for API responses."""
    return {
        "codename": "NOVA",
        "name": "Ætheris Nova",
        "tagline": "Architectural leap beyond the current frontier.",
        "pillars": [
            {
                "id": p.id,
                "name": p.name,
                "summary": p.summary,
                "evidence": p.evidence,
                "endpoint": p.endpoint,
                "params": p.params,
            }
            for p in NOVA_PILLARS
        ],
        "experts": [asdict(e) for e in EXPERTS],
        "reasoning_presets": REASONING_PRESETS,
        "moe_config": {
            "num_experts": len(EXPERTS),
            "top_k": 2,
            "router_temperature": 0.7,
            "load_balance": "auxiliary-loss + capacity-factor",
        },
        "memory_tiers": {
            "core": {"capacity": "32 facts", "access": "O(1)", "mutability": "append-only with revision notes"},
            "recall": {"capacity": "50k messages", "access": "associative (BM25 + signatures)", "mutability": "immutable log"},
            "archival": {"capacity": "200k entries", "access": "hybrid retrieval", "mutability": "append-only"},
        },
        "agent_roles": {
            "planner": "Decomposes goals into a DAG of tasks and success criteria.",
            "researcher": "Gathers and grounds evidence via tools + memory.",
            "critic": "Stress-tests arguments and surfaces failure modes.",
            "coder": "Produces, runs, and verifies code in the sandbox.",
            "writer": "Produces the final output in voice and structure.",
            "qa": "Verifies the final answer against the original request.",
        },
    }


__all__ = [
    "NovaCapability",
    "nova_manifest",
    "NOVA_PILLARS",
    "EXPERTS",
    "Expert",
    "REASONING_PRESETS",
]

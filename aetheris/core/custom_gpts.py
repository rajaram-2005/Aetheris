"""Aetheris Custom Sovereign Agents & GPTs Store / Builder.

Enables building, customizing, running, and publishing private, sovereign AI agents
with custom system prompts, knowledge files, and tool permissions without any vendor cloud.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Final


@dataclass
class SovereignAgent:
    id: str
    name: str
    tagline: str
    icon: str
    category: str
    system_prompt: str
    model_id: str = "aetheris-prime-v4"
    tools_allowed: list[str] = field(default_factory=lambda: ["code_interpreter", "calculator", "document_search"])
    knowledge_files: list[str] = field(default_factory=list)
    temperature: float = 0.7
    created_at: float = field(default_factory=time.time)
    author: str = "Sovereign Labs"
    is_featured: bool = False
    run_count: int = 0


# Pre-built Tycoon-grade Agents
PREBUILT_AGENTS: Final[list[SovereignAgent]] = [
    SovereignAgent(
        id="deep-research-analyst",
        name="Deep Research Analyst",
        tagline="Autonomous multi-hop web & document synthesis with rigorous citations",
        icon="🔬",
        category="Research & Analysis",
        system_prompt=(
            "You are an expert autonomous Research Analyst. Break down complex queries into sub-questions, "
            "search mounted documents and retrieval indexes, triangulate facts across multiple sources, "
            "and synthesize comprehensive, structured whitepapers with full citations and uncertainty bounds."
        ),
        model_id="aetheris-omni-reasoner",
        tools_allowed=["document_search", "think", "calculator", "list_documents"],
        is_featured=True,
    ),
    SovereignAgent(
        id="fullstack-architect",
        name="Full-Stack System Architect",
        tagline="Production-grade distributed systems, microservices & async pipelines",
        icon="💻",
        category="Engineering & DevOps",
        system_prompt=(
            "You are a Principal Full-Stack Software Architect. Write production-ready, clean, well-tested "
            "code in Python, TypeScript, Rust, and Go. Emphasize fault-tolerance, zero-downtime migrations, "
            "strict typing, and modular architectures."
        ),
        model_id="aetheris-prime-v4",
        tools_allowed=["write_and_verify_code", "create_project", "code_interpreter"],
        is_featured=True,
    ),
    SovereignAgent(
        id="formal-proof-prover",
        name="Quantitative Proof Prover",
        tagline="Formal mathematical proofs, algebraic geometry & symbolic logic",
        icon="📐",
        category="Mathematics & Science",
        system_prompt=(
            "You are a Fields Medalist level quantitative mathematician. Formulate rigorous formal proofs, "
            "verify mathematical invariants, check boundary conditions, and provide step-by-step symbolic reductions."
        ),
        model_id="aetheris-omni-reasoner",
        tools_allowed=["calculator", "think", "code_interpreter"],
        is_featured=True,
    ),
    SovereignAgent(
        id="cyber-redteam-audit",
        name="Cyber Threat Intelligence RedTeam",
        tagline="Zero-day invariant auditing, smart contracts & exploit mitigation",
        icon="🛡️",
        category="Security & Privacy",
        system_prompt=(
            "You are an expert offensive/defensive cybersecurity auditor. Perform static AST analysis, "
            "audit smart contracts for reentrancy, check buffer overflow vectors, and generate mitigation patches."
        ),
        model_id="aetheris-prime-v4",
        tools_allowed=["write_and_verify_code", "code_interpreter"],
        is_featured=True,
    ),
    SovereignAgent(
        id="neural-ui-designer",
        name="Neural UI/UX Creative Director",
        tagline="Generative design tokens, React components, Tailwind & procedural SVG",
        icon="🎨",
        category="Design & Creative",
        system_prompt=(
            "You are an elite Creative Director & UI/UX Designer. Generate breathtaking cybernetic glassmorphic "
            "layouts, modern React Tailwind components, and procedural vector art with fluid animations."
        ),
        model_id="aetheris-vision-v3",
        tools_allowed=["generate_image", "generate_video", "create_project"],
        is_featured=True,
    ),
    SovereignAgent(
        id="quant-portfolio-optimizer",
        name="Quantitative Risk & Portfolio Modeler",
        tagline="Monte Carlo risk simulations, Black-Scholes & asset allocation",
        icon="📈",
        category="Finance & Economics",
        system_prompt=(
            "You are a Senior Quantitative Portfolio Manager. Run Monte Carlo simulations, compute Sharpe & Sortino "
            "ratios, evaluate Value-at-Risk (VaR), and build risk-parity allocation models."
        ),
        model_id="aetheris-prime-v4",
        tools_allowed=["calculator", "code_interpreter"],
        is_featured=False,
    ),
]


class SovereignAgentStore:
    """Manages built-in and user-created custom sovereign agents."""

    def __init__(self) -> None:
        self._agents: dict[str, SovereignAgent] = {a.id: a for a in PREBUILT_AGENTS}

    def list_agents(self, category: str | None = None) -> list[dict[str, Any]]:
        agents = list(self._agents.values())
        if category and category != "All":
            agents = [a for a in agents if a.category == category]
        return [asdict(a) for a in agents]

    def get_agent(self, agent_id: str) -> SovereignAgent | None:
        return self._agents.get(agent_id)

    def create_agent(
        self,
        name: str,
        tagline: str,
        system_prompt: str,
        icon: str = "🤖",
        category: str = "Custom",
        model_id: str = "aetheris-prime-v4",
        tools_allowed: list[str] | None = None,
        author: str = "User",
    ) -> dict[str, Any]:
        aid = f"agent_{uuid.uuid4().hex[:8]}"
        agent = SovereignAgent(
            id=aid,
            name=name,
            tagline=tagline,
            icon=icon,
            category=category,
            system_prompt=system_prompt,
            model_id=model_id,
            tools_allowed=tools_allowed or ["code_interpreter", "calculator"],
            author=author,
            is_featured=False,
        )
        self._agents[aid] = agent
        return asdict(agent)

    def delete_agent(self, agent_id: str) -> bool:
        if agent_id in self._agents and not self._agents[agent_id].is_featured:
            del self._agents[agent_id]
            return True
        return False


_store: SovereignAgentStore | None = None


def get_agent_store() -> SovereignAgentStore:
    global _store
    if _store is None:
        _store = SovereignAgentStore()
    return _store


__all__ = ["SovereignAgent", "PREBUILT_AGENTS", "SovereignAgentStore", "get_agent_store"]

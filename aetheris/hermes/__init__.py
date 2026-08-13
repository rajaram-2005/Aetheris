"""Ætheris **Hermes** — the unified offline cognition runtime.

This package is the single brain of the application. It merges what used to be
three disconnected halves of this repository:

* the FastAPI service's agent loop, toolbelt, and RAG index,
* the NOVA services (reasoning, MoE routing, hierarchical memory, orchestration),
* and the standalone browser app's C7 cascade, whose knowledge base and
  deterministic cognition now live in Python.

Two pillars, both live at runtime rather than described in a spec:

``agent``
    The **Hermes Agent** — perceive → classify → adapt → deliberate → ground →
    route → recall → act → synthesize → polish → learn. Tools execute for real
    and every stage is traced.

``meta_learning``
    The **Meta-Learning** engine — few-shot exemplar recall, intent priors, tool
    priors, and a Reptile-style strategy update, learned from the agent's own
    episodes.

Everything runs offline: no API key, no network, no model weights.
"""

from __future__ import annotations

from .agent import HermesAgent, HermesResult, StageTrace, get_hermes, run_hermes
from .cognition import (
    Classification,
    Deliberation,
    GroundingHit,
    Perception,
    Polish,
    check_safety,
    classify,
    deliberate,
    get_knowledge_index,
    ground,
    perceive,
    polish,
)
from .knowledge import KNOWLEDGE_BASE, KnowledgeArticle
from .meta_learning import (
    Adaptation,
    Episode,
    Exemplar,
    MetaLearner,
    Strategy,
    get_meta_learner,
    reset_meta_learner,
)
from .synthesis import synthesize

FOUNDATION = "Hermes Agent + Meta-Learning"

__all__ = [
    "FOUNDATION",
    # agent
    "HermesAgent",
    "HermesResult",
    "StageTrace",
    "get_hermes",
    "run_hermes",
    # cognition
    "Perception",
    "Classification",
    "Deliberation",
    "GroundingHit",
    "Polish",
    "perceive",
    "classify",
    "deliberate",
    "ground",
    "polish",
    "check_safety",
    "get_knowledge_index",
    "synthesize",
    # knowledge
    "KNOWLEDGE_BASE",
    "KnowledgeArticle",
    # meta-learning
    "MetaLearner",
    "Strategy",
    "Episode",
    "Exemplar",
    "Adaptation",
    "get_meta_learner",
    "reset_meta_learner",
]

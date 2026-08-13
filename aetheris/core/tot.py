"""Tree-of-Thought search with UCB1 Monte Carlo Tree Search.

Frontier models advertise "thinking." This module actually *searches*:
it expands competing thoughts, scores them, and runs a bounded MCTS
(UCB1) to pick a path. No GPU, no API key — the expansion and scoring
are deterministic heuristics so the same prompt always yields the same
tree (given the same seed).
"""

from __future__ import annotations

import math
import random
import re
import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field

_TOKEN = re.compile(r"[A-Za-z0-9_]+")

_LENSES: tuple[tuple[str, str], ...] = (
    ("formal", "State assumptions, then a numbered argument that a skeptic could check."),
    ("empirical", "Name the observable evidence that would confirm or kill this claim."),
    ("adversarial", "Attack the weakest premise. What would a hostile reviewer say?"),
    ("constructive", "Propose the smallest concrete next action that reduces uncertainty."),
    ("conservation", "What is conserved here — tokens, invariants, budget, trust?"),
    ("causal", "Separate correlation from intervention. What happens if we do X?"),
)


class ToTRequest(BaseModel):
    task: str = Field(..., min_length=1, max_length=20_000)
    simulations: int = Field(default=24, ge=4, le=128)
    beam: int = Field(default=3, ge=1, le=6)
    depth: int = Field(default=3, ge=1, le=6)
    seed: int = Field(default=7, ge=0)


@dataclass
class _Node:
    id: str
    thought: str
    lens: str
    parent: str | None
    children: list[str] = field(default_factory=list)
    visits: int = 0
    value: float = 0.0
    prior: float = 0.5
    depth: int = 0

    @property
    def mean(self) -> float:
        return self.value / self.visits if self.visits else self.prior

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "thought": self.thought,
            "lens": self.lens,
            "parent": self.parent,
            "children": list(self.children),
            "visits": self.visits,
            "mean": round(self.mean, 4),
            "prior": round(self.prior, 4),
            "depth": self.depth,
        }


def _tokens(text: str) -> set[str]:
    return {t.lower() for t in _TOKEN.findall(text or "") if len(t) > 2}


def score_thought(task: str, thought: str) -> float:
    """Heuristic value in [0, 1]: specificity, overlap, structure, numerics."""
    ttoks, qtoks = _tokens(thought), _tokens(task)
    if not thought.strip():
        return 0.0
    overlap = len(ttoks & qtoks) / max(len(qtoks), 1)
    length = min(len(thought) / 280.0, 1.0)
    structure = 0.15 if re.search(r"(?:^|\n)\s*(?:\d+[.)]|[-*])\s+", thought) else 0.0
    numeric = 0.1 if (re.search(r"\d", task) and re.search(r"\d", thought)) else 0.0
    hedges = 0.08 if re.search(r"\b(because|therefore|if|then|so that)\b", thought, re.I) else 0.0
    fluff = 0.12 if re.search(r"\b(as an ai|delve|tapestry|landscape)\b", thought, re.I) else 0.0
    return max(0.0, min(1.0, 0.25 + 0.35 * overlap + 0.2 * length + structure + numeric + hedges - fluff))


def _expand(task: str, parent_thought: str, lens: str, hint: str, rng: random.Random) -> str:
    q = task.strip().rstrip("?")
    stem = parent_thought.split(".")[0][:120] if parent_thought else q[:120]
    extras = [
        f"Check the boundary case of {rng.choice(['empty input', 'adversarial input', 'resource exhaustion'])}.",
        f"Name one invariant that must hold: {rng.choice(['idempotence', 'conservation', 'monotonicity'])}.",
        "Separate what we know from what we assume.",
    ]
    return f"[{lens}] {hint} Working from “{stem}”: {rng.choice(extras)}"


class TreeOfThought:
    """Bounded MCTS over thought nodes."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._runs = 0

    def search(self, req: ToTRequest) -> dict[str, Any]:
        started = time.perf_counter()
        rng = random.Random(req.seed ^ (len(req.task) * 2654435761))
        nodes: dict[str, _Node] = {}
        root = _Node(id="n_root", thought=req.task.strip(), lens="root", parent=None, prior=0.5, depth=0)
        nodes[root.id] = root

        # Seed first-level thoughts from every lens.
        for lens, hint in _LENSES[: max(req.beam + 1, 4)]:
            nid = f"n_{uuid.uuid4().hex[:8]}"
            thought = _expand(req.task, req.task, lens, hint, rng)
            child = _Node(
                id=nid, thought=thought, lens=lens, parent=root.id,
                prior=score_thought(req.task, thought), depth=1,
            )
            nodes[nid] = child
            root.children.append(nid)

        def ucb(node: _Node, parent_visits: int) -> float:
            if node.visits == 0:
                return node.prior + 1.5
            return node.mean + 1.25 * math.sqrt(math.log(parent_visits + 1) / node.visits)

        def select() -> list[str]:
            path = [root.id]
            current = root
            while current.children and current.depth < req.depth:
                kids = [nodes[c] for c in current.children]
                current = max(kids, key=lambda n: ucb(n, current.visits or 1))
                path.append(current.id)
            return path

        def expand(path: list[str]) -> str:
            leaf = nodes[path[-1]]
            if leaf.depth >= req.depth:
                return leaf.id
            # Expand top unused lenses.
            used = {nodes[c].lens for c in leaf.children}
            available = [ln for ln, _h in _LENSES if ln not in used]
            if not available:
                return leaf.id
            lens, hint = next((ln, h) for ln, h in _LENSES if ln == available[0])
            nid = f"n_{uuid.uuid4().hex[:8]}"
            thought = _expand(req.task, leaf.thought, lens, hint, rng)
            child = _Node(
                id=nid, thought=thought, lens=lens, parent=leaf.id,
                prior=score_thought(req.task, thought), depth=leaf.depth + 1,
            )
            nodes[nid] = child
            leaf.children.append(nid)
            return nid

        def rollout(nid: str) -> float:
            node = nodes[nid]
            # One-step heuristic rollout: score the thought plus a tiny random probe.
            probe = _expand(req.task, node.thought, node.lens or "constructive", "rollout", rng)
            return 0.65 * node.prior + 0.35 * score_thought(req.task, probe)

        def backup(path: list[str], value: float) -> None:
            for pid in path:
                n = nodes[pid]
                n.visits += 1
                n.value += value

        for _ in range(req.simulations):
            path = select()
            new_id = expand(path)
            if new_id not in path:
                path.append(new_id)
            backup(path, rollout(path[-1]))

        # Best path = greedy mean from root.
        best: list[str] = [root.id]
        cur = root
        while cur.children:
            cur = max((nodes[c] for c in cur.children), key=lambda n: (n.mean, n.visits))
            best.append(cur.id)

        with self._lock:
            self._runs += 1

        briefing = " → ".join(
            f"{nodes[i].lens}: {nodes[i].thought[:90]}" for i in best if nodes[i].lens != "root"
        )
        return {
            "task": req.task,
            "simulations": req.simulations,
            "nodes": [n.to_dict() for n in nodes.values()],
            "best_path": [nodes[i].to_dict() for i in best],
            "best_thought": nodes[best[-1]].thought if len(best) > 1 else req.task,
            "briefing": briefing,
            "confidence": round(nodes[best[-1]].mean if best else 0.0, 4),
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {"runs": self._runs}


_engine: TreeOfThought | None = None


def get_tot() -> TreeOfThought:
    global _engine
    if _engine is None:
        _engine = TreeOfThought()
    return _engine


__all__ = ["TreeOfThought", "ToTRequest", "score_thought", "get_tot"]

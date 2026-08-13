"""Causal world model — intervene, simulate, counterfactual.

A small structural causal model: variables, signed weighted edges,
``do(X=x)`` interventions, and a one-step counterfactual
("had we set X, what happens to Y holding the rest"). Seeded with an
Aetheris-internal causal map so it is useful on a cold start.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


class VariableIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    value: float = Field(default=0.5, ge=0.0, le=1.0)
    description: str = Field(default="", max_length=400)


class CausalEdgeIn(BaseModel):
    source: str = Field(..., min_length=1, max_length=80)
    target: str = Field(..., min_length=1, max_length=80)
    weight: float = Field(default=0.4, ge=-1.0, le=1.0)
    mechanism: str = Field(default="", max_length=200)


class InterveneRequest(BaseModel):
    do: dict[str, float] = Field(..., min_length=1)
    steps: int = Field(default=4, ge=1, le=12)


class CounterfactualRequest(BaseModel):
    fact: dict[str, float] = Field(default_factory=dict)
    do: dict[str, float] = Field(..., min_length=1)
    query: str = Field(..., min_length=1, max_length=80)


@dataclass
class _Var:
    name: str
    value: float
    description: str

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "value": round(self.value, 4), "description": self.description}


@dataclass
class _Edge:
    id: str
    source: str
    target: str
    weight: float
    mechanism: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "source": self.source, "target": self.target,
            "weight": self.weight, "mechanism": self.mechanism,
        }


class WorldModel:
    def __init__(self) -> None:
        self._lock = Lock()
        self._vars: dict[str, _Var] = {}
        self._edges: dict[str, _Edge] = {}
        self._out: dict[str, list[str]] = defaultdict(list)
        self._interventions = 0
        self._seed()

    def _seed(self) -> None:
        defaults = {
            "grounding": (0.6, "How well the answer is sourced."),
            "tool_success": (0.7, "Fraction of tool calls that succeed."),
            "honesty": (0.75, "Calibrated uncertainty, no fabrication."),
            "helpfulness": (0.65, "Actionability of the answer."),
            "latency": (0.4, "User-perceived wait (higher = slower)."),
            "safety": (0.85, "Constitution / refusal floor."),
            "reward": (0.55, "Meta-learner reward."),
            "user_trust": (0.6, "Willingness to rely on the next answer."),
        }
        for name, (val, desc) in defaults.items():
            self._vars[name] = _Var(name, val, desc)
        links = [
            ("grounding", "honesty", 0.45, "sourced claims stay honest"),
            ("grounding", "helpfulness", 0.25, "citations make answers usable"),
            ("tool_success", "helpfulness", 0.4, "working tools raise usefulness"),
            ("tool_success", "reward", 0.35, "successful acts get reinforced"),
            ("honesty", "user_trust", 0.5, "honest hedges build trust"),
            ("helpfulness", "reward", 0.4, "useful answers get thumbs-up"),
            ("helpfulness", "user_trust", 0.3, "usefulness compounds trust"),
            ("safety", "user_trust", 0.2, "refusals protect long-run trust"),
            ("safety", "helpfulness", -0.15, "hard refusals can feel unhelpful"),
            ("latency", "user_trust", -0.25, "slow answers erode trust"),
            ("latency", "reward", -0.1, "slow traces get lower implicit reward"),
            ("reward", "tool_success", 0.15, "learning improves tool choice"),
        ]
        for src, dst, w, mech in links:
            self._add_edge_unlocked(src, dst, w, mech)

    def _add_edge_unlocked(self, src: str, dst: str, weight: float, mechanism: str) -> _Edge:
        eid = f"ce_{uuid.uuid4().hex[:8]}"
        edge = _Edge(eid, src, dst, weight, mechanism)
        self._edges[eid] = edge
        self._out[src].append(eid)
        return edge

    def upsert(self, body: VariableIn) -> _Var:
        with self._lock:
            v = self._vars.get(body.name)
            if v:
                v.value = body.value
                if body.description:
                    v.description = body.description
                return v
            v = _Var(body.name, body.value, body.description)
            self._vars[body.name] = v
            return v

    def link(self, body: CausalEdgeIn) -> _Edge:
        with self._lock:
            if body.source not in self._vars:
                self._vars[body.source] = _Var(body.source, 0.5, "")
            if body.target not in self._vars:
                self._vars[body.target] = _Var(body.target, 0.5, "")
            return self._add_edge_unlocked(body.source, body.target, body.weight, body.mechanism)

    def snapshot(self) -> dict[str, float]:
        with self._lock:
            return {n: v.value for n, v in self._vars.items()}

    def _propagate(
        self,
        start: dict[str, float],
        clamps: dict[str, float],
        steps: int,
    ) -> tuple[dict[str, float], list[dict[str, Any]]]:
        """Roll the DAG forward. Clamped variables stay pinned every step."""
        state = dict(start)
        for k, v in clamps.items():
            state[k] = v
        trace: list[dict[str, Any]] = []
        for step in range(steps):
            nxt = dict(state)
            for edge in self._edges.values():
                if edge.source not in state or edge.target in clamps:
                    continue
                delta = edge.weight * (state[edge.source] - 0.5)
                nxt[edge.target] = max(0.0, min(1.0, nxt[edge.target] + 0.35 * delta))
            changed = {
                k: round(nxt[k] - state[k], 4)
                for k in nxt
                if abs(nxt[k] - state[k]) > 1e-6
            }
            state = nxt
            trace.append({"step": step + 1, "delta": changed})
        return state, trace

    def intervene(self, do: dict[str, float], *, steps: int = 4) -> dict[str, Any]:
        """Clamp intervened variables and propagate along causal edges.

        ``effects`` are *causal*: intervened-after minus the same rollout
        with no clamps. Background drift therefore does not masquerade as
        an intervention effect.
        """
        with self._lock:
            before = {n: v.value for n, v in self._vars.items()}
            clamps = {k: max(0.0, min(1.0, float(v))) for k, v in do.items() if k in self._vars}
            if not clamps:
                raise KeyError(f"unknown variables: {sorted(do)}")
            baseline, _ = self._propagate(before, {}, steps)
            state, trace = self._propagate(before, clamps, steps)
            self._interventions += 1
            effects = {
                k: round(state[k] - baseline[k], 4)
                for k in state
                if abs(state[k] - baseline[k]) > 1e-4
            }
            return {
                "do": clamps,
                "before": {k: round(v, 4) for k, v in before.items()},
                "after": {k: round(v, 4) for k, v in state.items()},
                "baseline": {k: round(v, 4) for k, v in baseline.items()},
                "effects": effects,
                "trace": trace,
            }

    def counterfactual(self, fact: dict[str, float], do: dict[str, float], query: str) -> dict[str, Any]:
        """Abduction-lite: pin factual values, then intervene, then read query.

        ``delta`` is the causal contrast (counterfactual − factual rollout),
        not the change from the cold snapshot — so background drift cannot
        flip the sign of a real intervention.
        """
        with self._lock:
            original = {n: v.value for n, v in self._vars.items()}
            pinned = dict(original)
            for k, v in fact.items():
                if k in self._vars:
                    pinned[k] = max(0.0, min(1.0, float(v)))
            clamps = {k: max(0.0, min(1.0, float(v))) for k, v in do.items() if k in self._vars}
            if not clamps:
                raise KeyError(f"unknown variables: {sorted(do)}")
            factual, _ = self._propagate(pinned, {}, steps=4)
            counter, _ = self._propagate(pinned, clamps, steps=4)
            self._interventions += 1
        q = query.strip()
        if q not in counter:
            raise KeyError(q)
        return {
            "query": q,
            "factual": round(factual[q], 4),
            "counterfactual": round(counter[q], 4),
            "delta": round(counter[q] - factual[q], 4),
            "world": {
                "do": clamps,
                "before": {k: round(v, 4) for k, v in pinned.items()},
                "after": {k: round(v, 4) for k, v in counter.items()},
                "baseline": {k: round(v, 4) for k, v in factual.items()},
                "effects": {
                    k: round(counter[k] - factual[k], 4)
                    for k in counter
                    if abs(counter[k] - factual[k]) > 1e-4
                },
            },
        }

    def parents(self, name: str) -> list[dict[str, Any]]:
        with self._lock:
            return [e.to_dict() for e in self._edges.values() if e.target == name]

    def list_variables(self) -> list[dict[str, Any]]:
        with self._lock:
            return [v.to_dict() for v in self._vars.values()]

    def list_edges(self) -> list[dict[str, Any]]:
        with self._lock:
            return [e.to_dict() for e in self._edges.values()]

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "variables": len(self._vars),
                "edges": len(self._edges),
                "interventions": self._interventions,
            }


_model: WorldModel | None = None


def get_world_model() -> WorldModel:
    global _model
    if _model is None:
        _model = WorldModel()
    return _model


__all__ = [
    "WorldModel", "VariableIn", "CausalEdgeIn", "InterveneRequest",
    "CounterfactualRequest", "get_world_model",
]

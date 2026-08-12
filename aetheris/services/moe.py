"""Ætheris NOVA — Sparse Mixture-of-Experts Router.

Even when backed by a single upstream LLM, routing the *prompt* through a
specialist system prompt (and optionally a higher tier) per-request gives us
the observable behaviour of a MoE model: different queries activate different
capabilities, and the top-k experts collaborate when the query is hybrid.

This router is deterministic given a (prompt, temperature) pair so results are
replayable. It scores experts by:

* trigger-token overlap (fast lexical path),
* trigram-signature similarity (semantic-ish, no embeddings needed),
* a small temperature-controlled softmax,
* and a load-balancing term that prefers under-used experts within a session.
"""

from __future__ import annotations

import math
import random
import re
import time
from collections import Counter
from dataclasses import dataclass, field

from ..core.nova import EXPERTS, Expert

_WORD_RE = re.compile(r"[A-Za-z0-9_]+")


def _tokens(text: str) -> list[str]:
    return [t.lower() for t in _WORD_RE.findall(text or "")]


def _sign(text: str) -> Counter[str]:
    s = (text or "").lower()
    out: Counter[str] = Counter()
    for i in range(0, len(s) - 2):
        out[s[i : i + 3]] += 1
    return out


def _cosine(a: Counter[str], b: Counter[str]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(min(a[t], b[t]) for t in a.keys() & b.keys())
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / max(na * nb, 1e-9)


@dataclass
class RoutedExpert:
    expert: Expert
    weight: float
    signals: dict[str, float] = field(default_factory=dict)


class MoERouter:
    def __init__(self, experts: list[Expert] | None = None, top_k: int = 2, temperature: float = 0.7):
        self.experts = experts or list(EXPERTS)
        self.top_k = max(1, min(top_k, len(self.experts)))
        self.temperature = max(0.05, temperature)
        self._load: Counter[str] = Counter()
        self._sign_cache: dict[str, Counter[str]] = {}
        for e in self.experts:
            # trigger tokens + specialisation text are part of the expert signature
            self._sign_cache[e.id] = _sign(
                e.specialisation + " " + e.system_prompt_seed + " " + " ".join(e.triggers)
            )

    def score(self, text: str) -> list[RoutedExpert]:
        toks = set(_tokens(text))
        sig = _sign(text)
        scores: list[tuple[Expert, float, dict[str, float]]] = []
        for e in self.experts:
            signals: dict[str, float] = {}
            # 1. Trigger overlap (strong signal)
            trig_hits = sum(1 for t in e.triggers if t.lower() in toks or t.lower() in text.lower())
            signals["trigger"] = min(1.0, trig_hits / max(1, min(5, len(e.triggers))))
            # 2. Trigram similarity
            signals["signature"] = _cosine(sig, self._sign_cache[e.id])
            # 3. Tier boost? (not used for scoring here; informational)
            signals["load_balance"] = 1.0 / (1.0 + self._load[e.id])
            raw = (
                1.4 * signals["trigger"]
                + 1.0 * signals["signature"]
                + 0.1 * signals["load_balance"]
            )
            scores.append((e, raw, signals))
        # softmax
        exps = [math.exp(s / self.temperature) for _, s, _ in scores]
        Z = sum(exps)
        routed = []
        for (e, _, sig), ex in sorted(zip(scores, exps), key=lambda x: -x[1]):
            routed.append(RoutedExpert(expert=e, weight=ex / Z if Z > 0 else 1.0 / len(scores), signals=sig))
        return routed

    def route(self, text: str, *, top_k: int | None = None, seed: int | None = None) -> list[RoutedExpert]:
        k = top_k or self.top_k
        rng = random.Random(seed if seed is not None else _text_seed(text))
        ranked = self.score(text)
        # Greedy top-k with a tiny random tiebreaker for near-ties.
        chosen: list[RoutedExpert] = []
        for r in ranked:
            if len(chosen) >= k:
                break
            if not chosen or r.weight > 0.05 or rng.random() < 0.2:
                chosen.append(r)
        if not chosen and ranked:
            chosen = [ranked[0]]
        # normalize weights across chosen set
        s = sum(r.weight for r in chosen) or 1.0
        for r in chosen:
            r.weight = r.weight / s
            self._load[r.expert.id] += 1
        return chosen

    def compose_system_prompt(self, text: str, *, top_k: int | None = None) -> tuple[str, list[dict]]:
        routed = self.route(text, top_k=top_k)
        expert_lines = []
        report = []
        for r in routed:
            e = r.expert
            expert_lines.append(
                f"[Expert: {e.name} | weight={r.weight:.2f}] {e.system_prompt_seed}\n"
                f"Specialisation: {e.specialisation}"
            )
            report.append({"id": e.id, "name": e.name, "weight": round(r.weight, 3), "signals": r.signals})
        header = (
            "You are Ætheris Nova, routing this request through a weighted mixture of specialists. "
            "Let the highest-weighted expert lead; integrate insight from the others as needed.\n\n"
            + "\n\n".join(expert_lines)
        )
        return header, report

    def stats(self) -> dict:
        total = sum(self._load.values()) or 1
        return {
            "experts": [e.id for e in self.experts],
            "top_k": self.top_k,
            "temperature": self.temperature,
            "utilization": {eid: round(c / total, 3) for eid, c in self._load.items()},
            "total_routed": total,
        }

    def reset_load(self) -> None:
        self._load.clear()


def _text_seed(text: str) -> int:
    return sum(ord(c) * (i + 1) for i, c in enumerate((text or "")[:256])) & 0xFFFF_FFFF


_router: MoERouter | None = None


def get_router() -> MoERouter:
    global _router
    if _router is None:
        _router = MoERouter()
    return _router


__all__ = ["MoERouter", "RoutedExpert", "get_router"]

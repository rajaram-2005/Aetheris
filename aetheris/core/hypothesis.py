"""Bayesian hypothesis engine.

Given a question and a bag of evidence snippets, generate competing
hypotheses, score P(E|H) from token overlap, update posteriors, and
propose a falsifier for the leader. Offline and deterministic.
"""

from __future__ import annotations

import math
import re
import time
from dataclasses import dataclass
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field

_TOKEN = re.compile(r"[A-Za-z0-9_]+")
_STOP = frozenset(
    "the a an of to is are and or in on for with this that it be by as at from "
    "how why what when where who which can will should would could do does did".split()
)


class HypothesisRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=8_000)
    evidence: list[str] = Field(default_factory=list)
    priors: dict[str, float] = Field(default_factory=dict)


def _toks(text: str) -> set[str]:
    return {t.lower() for t in _TOKEN.findall(text or "") if t.lower() not in _STOP and len(t) > 2}


def _likelihood(hypothesis: str, evidence: list[str]) -> float:
    ht = _toks(hypothesis)
    if not ht:
        return 0.15
    if not evidence:
        return 0.35
    scores = []
    for ev in evidence:
        et = _toks(ev)
        if not et:
            continue
        scores.append(len(ht & et) / max(len(ht | et), 1))
    if not scores:
        return 0.3
    # Softmax-ish squash into (0.05, 0.95)
    mean = sum(scores) / len(scores)
    return 0.05 + 0.9 * mean


def generate_hypotheses(question: str) -> list[str]:
    q = question.strip().rstrip("?")
    lowered = q.lower()
    hyps = [
        f"{q} is primarily a capability / design question.",
        f"{q} is explained by a single dominant mechanism.",
        f"{q} is a trade-off, not a binary.",
    ]
    if re.search(r"\bwhy\b", lowered):
        hyps.append(f"The cause of “{q}” is structural (incentives / architecture), not accidental.")
        hyps.append(f"The cause of “{q}” is a missing invariant or check.")
    if re.search(r"\b(fail|bug|error|break)\b", lowered):
        hyps.append("A boundary condition is unhandled.")
        hyps.append("A dependency returned an unexpected shape.")
    if re.search(r"\b(better|vs|versus|or)\b", lowered):
        hyps.append("Option A wins on latency; option B wins on correctness.")
    # Dedup while preserving order.
    seen: set[str] = set()
    out: list[str] = []
    for h in hyps:
        if h not in seen:
            seen.add(h)
            out.append(h)
    return out[:6]


class HypothesisEngine:
    def __init__(self) -> None:
        self._lock = Lock()
        self._runs = 0

    def infer(self, req: HypothesisRequest) -> dict[str, Any]:
        started = time.perf_counter()
        hyps = generate_hypotheses(req.question)
        if req.priors:
            extra = [h for h in req.priors if h not in hyps]
            hyps = extra + hyps
        n = max(len(hyps), 1)
        uniform = 1.0 / n
        rows: list[dict[str, Any]] = []
        unnorm: list[float] = []
        for h in hyps:
            prior = float(req.priors.get(h, uniform))
            prior = max(1e-6, min(1.0, prior))
            like = _likelihood(h, req.evidence)
            unnorm.append(prior * like)
            rows.append({"hypothesis": h, "prior": round(prior, 4), "likelihood": round(like, 4)})
        z = sum(unnorm) or 1.0
        raw = [mass / z for mass in unnorm]
        # Round to 4 d.p. but keep a simplex: leftover mass goes to the mode.
        rounded = [round(p, 4) for p in raw]
        if rounded:
            mode = max(range(len(raw)), key=lambda i: raw[i])
            rounded[mode] = 0.0
            rounded[mode] = round(1.0 - sum(rounded), 4)
        for row, p in zip(rows, rounded):
            row["posterior"] = p
        rows.sort(key=lambda r: -r["posterior"])
        leader = rows[0] if rows else None
        falsifier = ""
        if leader:
            falsifier = (
                f"Observe a case where “{leader['hypothesis'][:80]}” predicts X "
                f"but the world produces not-X. One clean counterexample kills it."
            )
        with self._lock:
            self._runs += 1
        return {
            "question": req.question,
            "hypotheses": rows,
            "leader": leader,
            "falsifier": falsifier,
            "entropy": round(-sum(r["posterior"] * math.log(r["posterior"] + 1e-12) for r in rows), 4),
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {"runs": self._runs}


_eng: HypothesisEngine | None = None


def get_hypothesis_engine() -> HypothesisEngine:
    global _eng
    if _eng is None:
        _eng = HypothesisEngine()
    return _eng


__all__ = ["HypothesisEngine", "HypothesisRequest", "generate_hypotheses", "get_hypothesis_engine"]

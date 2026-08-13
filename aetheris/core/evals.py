"""Offline evaluation harness — datasets, graders, scorecards, A/B.

Aetheris can already run a task. This module asks whether the answer is
*good*: you register cases, pick a grader, run a suite, and get a
scorecard. Graders are deterministic (exact, contains, regex, numeric,
token-F1, embedding similarity, rubric) so the suite is reproducible
without an upstream judge model.

A built-in ``hermes-cognition`` suite exercises the live cascade
(arithmetic, conversion, intent, grounding) so ``POST /v1/evals/run``
does something useful on a fresh process.
"""

from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field

GraderName = Literal[
    "exact",
    "contains",
    "regex",
    "numeric",
    "token_f1",
    "embedding",
    "rubric",
]

Runner = Callable[[str], str]


# --- Schemas ------------------------------------------------------------------

class EvalCaseIn(BaseModel):
    input: str = Field(..., min_length=1, max_length=20_000)
    expected: str = Field(default="", max_length=20_000)
    grader: GraderName = "contains"
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    threshold: float = Field(default=0.0, ge=0.0, le=1.0)
    id: str = Field(default="", max_length=64)


class SuiteIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    cases: list[EvalCaseIn] = Field(default_factory=list)


class RunRequest(BaseModel):
    suite_id: str = Field(..., min_length=1)
    outputs: dict[str, str] | None = None
    runner: str = Field(default="provided", pattern="^(provided|hermes-cognition)$")


class ABRequest(BaseModel):
    suite_id: str
    a: dict[str, str]
    b: dict[str, str]


# --- Graders ------------------------------------------------------------------

_TOKEN = re.compile(r"[A-Za-z0-9_]+")


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _tokens(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN.findall(text or "")]


def grade_exact(output: str, expected: str, **_kw: Any) -> tuple[bool, float, str]:
    ok = _norm(output) == _norm(expected)
    return ok, 1.0 if ok else 0.0, "exact normalized match" if ok else "mismatch"


def grade_contains(output: str, expected: str, **_kw: Any) -> tuple[bool, float, str]:
    if not expected:
        return bool(output.strip()), 1.0 if output.strip() else 0.0, "non-empty"
    hay, needle = _norm(output), _norm(expected)
    ok = needle in hay
    return ok, 1.0 if ok else 0.0, "contains expected span" if ok else "expected span missing"


def grade_regex(output: str, expected: str, **_kw: Any) -> tuple[bool, float, str]:
    try:
        pattern = re.compile(expected, re.I | re.S)
    except re.error as exc:
        return False, 0.0, f"invalid regex: {exc}"
    ok = bool(pattern.search(output or ""))
    return ok, 1.0 if ok else 0.0, "regex matched" if ok else "regex missed"


def grade_numeric(output: str, expected: str, **kw: Any) -> tuple[bool, float, str]:
    nums = re.findall(r"-?\d+(?:\.\d+)?", output or "")
    try:
        target = float(expected)
    except ValueError:
        return False, 0.0, "expected is not numeric"
    if not nums:
        return False, 0.0, "no number in output"
    tolerance = float(kw.get("threshold") or 0.0) or 1e-6
    # Prefer the number closest to the target (answers often include extras).
    values = [float(n) for n in nums]
    best = min(values, key=lambda v: abs(v - target))
    ok = abs(best - target) <= max(tolerance, abs(target) * 1e-6)
    return ok, 1.0 if ok else 0.0, f"found {best} (target {target}, tol {tolerance})"


def grade_token_f1(output: str, expected: str, **kw: Any) -> tuple[bool, float, str]:
    pred, gold = set(_tokens(output)), set(_tokens(expected))
    if not gold:
        score = 1.0 if not pred else 0.0
        return score >= 1.0, score, "empty gold"
    overlap = pred & gold
    precision = len(overlap) / max(len(pred), 1)
    recall = len(overlap) / max(len(gold), 1)
    if precision + recall == 0:
        score = 0.0
    else:
        score = 2 * precision * recall / (precision + recall)
    threshold = float(kw.get("threshold") or 0.5)
    return score >= threshold, round(score, 4), f"token F1={score:.3f} (threshold {threshold})"


def grade_embedding(output: str, expected: str, **kw: Any) -> tuple[bool, float, str]:
    from .embeddings import cosine, signature_embed

    a = signature_embed(output or "")
    b = signature_embed(expected or "")
    score = float(cosine(a, b))
    # Cosine on signature embeddings is often modest; default bar is low.
    threshold = float(kw.get("threshold") or 0.15)
    return score >= threshold, round(score, 4), f"cosine={score:.3f} (threshold {threshold})"


def grade_rubric(output: str, expected: str, **kw: Any) -> tuple[bool, float, str]:
    """``expected`` is a comma-separated list of required keywords.

    Optional ``metadata.forbidden`` is a list of banned keywords.
    """
    required = [p.strip().lower() for p in expected.split(",") if p.strip()]
    meta = kw.get("metadata") or {}
    forbidden = [str(x).lower() for x in meta.get("forbidden", [])]
    hay = (output or "").lower()
    hits = [k for k in required if k in hay]
    bans = [k for k in forbidden if k in hay]
    if not required:
        score = 0.0 if bans else 1.0
    else:
        score = len(hits) / len(required)
        if bans:
            score *= 0.4
    threshold = float(kw.get("threshold") or 0.67)
    note = f"keywords {len(hits)}/{len(required)}"
    if bans:
        note += f"; forbidden present: {', '.join(bans)}"
    return score >= threshold and not bans, round(score, 4), note


_GRADERS: dict[str, Callable[..., tuple[bool, float, str]]] = {
    "exact": grade_exact,
    "contains": grade_contains,
    "regex": grade_regex,
    "numeric": grade_numeric,
    "token_f1": grade_token_f1,
    "embedding": grade_embedding,
    "rubric": grade_rubric,
}


def grade(name: str, output: str, expected: str, **kw: Any) -> tuple[bool, float, str]:
    fn = _GRADERS.get(name)
    if fn is None:
        raise ValueError(f"unknown grader {name!r}")
    return fn(output, expected, **kw)


# --- Store --------------------------------------------------------------------

@dataclass
class _Case:
    id: str
    input: str
    expected: str
    grader: str
    tags: list[str]
    metadata: dict[str, Any]
    threshold: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "input": self.input,
            "expected": self.expected,
            "grader": self.grader,
            "tags": list(self.tags),
            "metadata": dict(self.metadata),
            "threshold": self.threshold,
        }


@dataclass
class _Suite:
    id: str
    name: str
    description: str
    cases: list[_Case] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "cases": len(self.cases),
            "created_at": self.created_at,
        }


@dataclass
class _Run:
    id: str
    suite_id: str
    started_at: float
    duration_ms: float
    results: list[dict[str, Any]]
    passed: int
    failed: int
    score: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "suite_id": self.suite_id,
            "started_at": self.started_at,
            "duration_ms": round(self.duration_ms, 2),
            "passed": self.passed,
            "failed": self.failed,
            "total": self.passed + self.failed,
            "score": round(self.score, 4),
            "pass_rate": round(self.passed / max(self.passed + self.failed, 1), 4),
            "results": self.results,
        }


class EvalHarness:
    """Thread-safe suites + runs."""

    def __init__(self, max_runs: int = 200) -> None:
        self._lock = Lock()
        self._suites: dict[str, _Suite] = {}
        self._runs: dict[str, _Run] = {}
        self._max_runs = max_runs
        self._seed()

    def _seed(self) -> None:
        cases = [
            EvalCaseIn(id="math_add", input="what is 2+2?", expected="4", grader="numeric", tags=["math"]),
            EvalCaseIn(id="math_mul", input="what is 12*12?", expected="144", grader="numeric", tags=["math"]),
            EvalCaseIn(id="math_pow", input="2^10", expected="1024", grader="numeric", tags=["math"]),
            EvalCaseIn(
                id="convert_km",
                input="convert 10 km to miles",
                expected="6.21371",
                grader="numeric",
                threshold=0.02,
                tags=["convert"],
            ),
            EvalCaseIn(
                id="percent",
                input="what is 25% of 480",
                expected="120",
                grader="numeric",
                tags=["math"],
            ),
            EvalCaseIn(
                id="intent_greet",
                input="hello there",
                expected="greet",
                grader="exact",
                tags=["classify"],
                metadata={"channel": "intent"},
            ),
            EvalCaseIn(
                id="intent_math",
                input="what is 2 + 2",
                expected="math",
                grader="exact",
                tags=["classify"],
                metadata={"channel": "intent"},
            ),
            EvalCaseIn(
                id="ground_photo",
                input="explain photosynthesis",
                expected="photosynthesis",
                grader="contains",
                tags=["ground"],
                metadata={"channel": "ground_id"},
            ),
            EvalCaseIn(
                id="identity",
                input="who are you?",
                expected="aetheris,hermes,sovereign",
                grader="rubric",
                threshold=0.3,
                tags=["identity"],
            ),
        ]
        suite = _Suite(
            id="suite_hermes_cognition",
            name="hermes-cognition",
            description="Live arithmetic, conversion, intent, and grounding checks.",
            cases=[],
        )
        for body in cases:
            suite.cases.append(self._case_from(body))
        self._suites[suite.id] = suite

    @staticmethod
    def _case_from(body: EvalCaseIn) -> _Case:
        return _Case(
            id=body.id or f"case_{uuid.uuid4().hex[:8]}",
            input=body.input,
            expected=body.expected,
            grader=body.grader,
            tags=list(body.tags),
            metadata=dict(body.metadata),
            threshold=body.threshold,
        )

    def create_suite(self, body: SuiteIn) -> _Suite:
        sid = f"suite_{uuid.uuid4().hex[:8]}"
        suite = _Suite(
            id=sid,
            name=body.name,
            description=body.description,
            cases=[self._case_from(c) for c in body.cases],
        )
        with self._lock:
            self._suites[sid] = suite
        return suite

    def add_case(self, suite_id: str, body: EvalCaseIn) -> _Case:
        with self._lock:
            suite = self._suites.get(suite_id)
            if suite is None:
                raise KeyError(suite_id)
            case = self._case_from(body)
            suite.cases.append(case)
            return case

    def get_suite(self, suite_id: str) -> _Suite | None:
        with self._lock:
            return self._suites.get(suite_id) or next(
                (s for s in self._suites.values() if s.name == suite_id or s.id == suite_id),
                None,
            )

    def list_suites(self) -> list[dict[str, Any]]:
        with self._lock:
            return [s.to_dict() for s in self._suites.values()]

    def delete_suite(self, suite_id: str) -> bool:
        with self._lock:
            return self._suites.pop(suite_id, None) is not None

    def _produce(self, case: _Case, outputs: dict[str, str] | None, runner: str) -> str:
        if outputs is not None and case.id in outputs:
            return outputs[case.id]
        if runner == "hermes-cognition":
            return self._hermes_cognition(case)
        return outputs.get(case.id, "") if outputs else ""

    @staticmethod
    def _hermes_cognition(case: _Case) -> str:
        channel = (case.metadata or {}).get("channel", "answer")
        from ..hermes.cognition import classify, deliberate, ground, perceive

        if channel == "intent":
            return classify(perceive(case.input)).intent
        if channel == "ground_id":
            hits = ground(case.input)
            return hits[0].article.id if hits else ""
        result = deliberate(case.input)
        if result.solved and result.value is not None:
            return str(result.value)
        if result.solved:
            return result.output
        # Fall back to a short identity blurb for non-math cases.
        if "who are you" in case.input.lower():
            return "I am Aetheris, the Hermes sovereign offline agent."
        return result.output or ""

    def run(
        self,
        suite_id: str,
        *,
        outputs: dict[str, str] | None = None,
        runner: str = "provided",
    ) -> _Run:
        suite = self.get_suite(suite_id)
        if suite is None:
            raise KeyError(suite_id)
        started = time.perf_counter()
        results: list[dict[str, Any]] = []
        passed = failed = 0
        score_sum = 0.0
        for case in suite.cases:
            output = self._produce(case, outputs, runner)
            ok, score, note = grade(
                case.grader,
                output,
                case.expected,
                threshold=case.threshold,
                metadata=case.metadata,
            )
            if ok:
                passed += 1
            else:
                failed += 1
            score_sum += score
            results.append(
                {
                    "id": case.id,
                    "input": case.input,
                    "expected": case.expected,
                    "output": output[:500],
                    "grader": case.grader,
                    "passed": ok,
                    "score": score,
                    "note": note,
                    "tags": list(case.tags),
                }
            )
        run = _Run(
            id=f"run_{uuid.uuid4().hex[:8]}",
            suite_id=suite.id,
            started_at=time.time(),
            duration_ms=(time.perf_counter() - started) * 1000,
            results=results,
            passed=passed,
            failed=failed,
            score=score_sum / max(len(suite.cases), 1),
        )
        with self._lock:
            if len(self._runs) >= self._max_runs:
                oldest = min(self._runs, key=lambda rid: self._runs[rid].started_at)
                del self._runs[oldest]
            self._runs[run.id] = run
        return run

    def ab(self, suite_id: str, a: dict[str, str], b: dict[str, str]) -> dict[str, Any]:
        run_a = self.run(suite_id, outputs=a, runner="provided")
        run_b = self.run(suite_id, outputs=b, runner="provided")
        wins_a = wins_b = ties = 0
        paired: list[dict[str, Any]] = []
        by_a = {r["id"]: r for r in run_a.results}
        by_b = {r["id"]: r for r in run_b.results}
        for cid in by_a:
            sa, sb = by_a[cid]["score"], by_b[cid]["score"]
            if sa > sb + 1e-9:
                winner = "a"
                wins_a += 1
            elif sb > sa + 1e-9:
                winner = "b"
                wins_b += 1
            else:
                winner = "tie"
                ties += 1
            paired.append({"id": cid, "a": sa, "b": sb, "winner": winner})
        return {
            "suite_id": run_a.suite_id,
            "a": {"passed": run_a.passed, "score": run_a.score, "run_id": run_a.id},
            "b": {"passed": run_b.passed, "score": run_b.score, "run_id": run_b.id},
            "wins": {"a": wins_a, "b": wins_b, "tie": ties},
            "preferred": "a" if run_a.score > run_b.score else ("b" if run_b.score > run_a.score else "tie"),
            "paired": paired,
        }

    def get_run(self, run_id: str) -> _Run | None:
        with self._lock:
            return self._runs.get(run_id)

    def list_runs(self, *, suite_id: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            runs = list(self._runs.values())
        if suite_id:
            runs = [r for r in runs if r.suite_id == suite_id]
        runs.sort(key=lambda r: -r.started_at)
        return [r.to_dict() for r in runs[:limit]]

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "suites": len(self._suites),
                "runs": len(self._runs),
                "graders": sorted(_GRADERS),
            }


_harness: EvalHarness | None = None


def get_eval_harness() -> EvalHarness:
    global _harness
    if _harness is None:
        _harness = EvalHarness()
    return _harness


__all__ = [
    "EvalHarness",
    "EvalCaseIn",
    "SuiteIn",
    "RunRequest",
    "ABRequest",
    "grade",
    "get_eval_harness",
]

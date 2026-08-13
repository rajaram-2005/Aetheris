"""Tiny natural-deduction proof kernel.

Aetheris already *talks* about proofs. This module *checks* them.
Supported rules: `assume`, `given`, `mp` (modus ponens), `and_i`,
`and_e`, `or_i`, `impl_i`, `not_e` (explosion from P and ¬P), `conclude`.

Formulas are strings. Implication is written ``P -> Q``. Conjunction
``P & Q``. Negation ``~P``. The checker is syntactic — it will not
invent lemmas, only verify the ones you wrote.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from threading import Lock
from typing import Any, Literal

from pydantic import BaseModel, Field

Rule = Literal["assume", "given", "mp", "and_i", "and_e", "or_i", "impl_i", "not_e", "conclude"]


class ProofStepIn(BaseModel):
    rule: Rule
    formula: str = Field(..., min_length=1, max_length=400)
    cites: list[int] = Field(default_factory=list, description="1-based step indices.")
    note: str = Field(default="", max_length=200)


class ProofIn(BaseModel):
    goal: str = Field(..., min_length=1, max_length=400)
    steps: list[ProofStepIn] = Field(..., min_length=1, max_length=80)


def _norm(f: str) -> str:
    f = re.sub(r"\s+", " ", (f or "").strip())
    f = f.replace("→", "->").replace("∧", "&").replace("∨", "|").replace("¬", "~")
    return f


def _split_impl(f: str) -> tuple[str, str] | None:
    f = _norm(f)
    depth = 0
    for i, ch in enumerate(f):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif depth == 0 and f[i : i + 2] == "->":
            return _norm(f[:i]), _norm(f[i + 2 :])
    return None


def _split_and(f: str) -> tuple[str, str] | None:
    f = _norm(f)
    depth = 0
    for i, ch in enumerate(f):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif depth == 0 and ch == "&":
            return _norm(f[:i]), _norm(f[i + 1 :])
    return None


@dataclass
class _Line:
    index: int
    rule: str
    formula: str
    discharged: bool = False


class ProofKernel:
    def __init__(self) -> None:
        self._lock = Lock()
        self._checks = 0
        self._valid = 0

    def check(self, proof: ProofIn) -> dict[str, Any]:
        lines: list[_Line] = []
        errors: list[str] = []
        open_assumptions: list[int] = []

        def cite(i: int) -> _Line | None:
            if i < 1 or i > len(lines):
                errors.append(f"step {len(lines)+1}: cite {i} is out of range")
                return None
            return lines[i - 1]

        for raw in proof.steps:
            formula = _norm(raw.formula)
            idx = len(lines) + 1
            if raw.rule == "assume":
                open_assumptions.append(idx)
                lines.append(_Line(idx, "assume", formula))
                continue
            if raw.rule == "given":
                lines.append(_Line(idx, "given", formula))
                continue
            if raw.rule == "mp":
                if len(raw.cites) != 2:
                    errors.append(f"step {idx}: mp needs two cites (implication, antecedent)")
                    lines.append(_Line(idx, "mp", formula))
                    continue
                impl, ant = cite(raw.cites[0]), cite(raw.cites[1])
                parts = _split_impl(impl.formula) if impl else None
                if not impl or not ant or parts is None or _norm(parts[0]) != _norm(ant.formula) or _norm(parts[1]) != formula:
                    errors.append(f"step {idx}: modus ponens does not yield {formula!r}")
                lines.append(_Line(idx, "mp", formula))
                continue
            if raw.rule == "and_i":
                if len(raw.cites) != 2:
                    errors.append(f"step {idx}: and_i needs two cites")
                else:
                    a, b = cite(raw.cites[0]), cite(raw.cites[1])
                    expected = _norm(f"{a.formula} & {b.formula}") if a and b else ""
                    if expected != formula:
                        errors.append(f"step {idx}: and_i expected {expected!r}")
                lines.append(_Line(idx, "and_i", formula))
                continue
            if raw.rule == "and_e":
                if len(raw.cites) != 1:
                    errors.append(f"step {idx}: and_e needs one cite")
                else:
                    src = cite(raw.cites[0])
                    parts = _split_and(src.formula) if src else None
                    if not parts or formula not in parts:
                        errors.append(f"step {idx}: and_e cannot extract {formula!r}")
                lines.append(_Line(idx, "and_e", formula))
                continue
            if raw.rule == "or_i":
                if len(raw.cites) != 1:
                    errors.append(f"step {idx}: or_i needs one cite")
                else:
                    src = cite(raw.cites[0])
                    if src and src.formula not in {_norm(p) for p in formula.split("|")}:
                        # allow ``P | Q`` from P
                        if src.formula not in formula:
                            errors.append(f"step {idx}: or_i must keep the cited disjunct")
                lines.append(_Line(idx, "or_i", formula))
                continue
            if raw.rule == "impl_i":
                if not open_assumptions:
                    errors.append(f"step {idx}: impl_i with no open assumption")
                else:
                    opened = open_assumptions.pop()
                    src = lines[opened - 1]
                    expected_impl = _norm(f"{src.formula} -> {formula.split('->')[-1].strip()}") if "->" in formula else ""
                    parts = _split_impl(formula)
                    if not parts or parts[0] != src.formula:
                        errors.append(f"step {idx}: impl_i must discharge {src.formula!r}")
                    src.discharged = True
                lines.append(_Line(idx, "impl_i", formula))
                continue
            if raw.rule == "not_e":
                if len(raw.cites) != 2:
                    errors.append(f"step {idx}: not_e needs P and ~P")
                else:
                    a, b = cite(raw.cites[0]), cite(raw.cites[1])
                    pair = {_norm(a.formula) if a else "", _norm(b.formula) if b else ""}
                    if not any(p.startswith("~") and p[1:].strip() in pair for p in pair):
                        errors.append(f"step {idx}: not_e requires a formula and its negation")
                lines.append(_Line(idx, "not_e", formula))
                continue
            if raw.rule == "conclude":
                lines.append(_Line(idx, "conclude", formula))
                continue
            errors.append(f"step {idx}: unknown rule {raw.rule}")
            lines.append(_Line(idx, raw.rule, formula))

        goal = _norm(proof.goal)
        last = lines[-1].formula if lines else ""
        if last != goal:
            errors.append(f"goal {goal!r} is not the last line ({last!r})")
        if open_assumptions:
            errors.append(f"undischarged assumptions: {open_assumptions}")

        ok = not errors
        with self._lock:
            self._checks += 1
            if ok:
                self._valid += 1
        return {
            "ok": ok,
            "goal": goal,
            "steps": [{"index": l.index, "rule": l.rule, "formula": l.formula} for l in lines],
            "errors": errors,
        }

    def modus_ponens_demo(self) -> dict[str, Any]:
        """A built-in valid proof: from P and P->Q infer Q."""
        return self.check(ProofIn(
            goal="Q",
            steps=[
                ProofStepIn(rule="given", formula="P"),
                ProofStepIn(rule="given", formula="P -> Q"),
                ProofStepIn(rule="mp", formula="Q", cites=[2, 1]),
            ],
        ))

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {"checks": self._checks, "valid": self._valid}


_kernel: ProofKernel | None = None


def get_proof_kernel() -> ProofKernel:
    global _kernel
    if _kernel is None:
        _kernel = ProofKernel()
    return _kernel


__all__ = ["ProofKernel", "ProofIn", "ProofStepIn", "get_proof_kernel"]

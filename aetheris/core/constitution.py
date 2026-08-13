"""Constitutional policy engine — critique, revise, decide.

Aetheris already has a content filter (PII / injection) and Hermes polish
(safety gate + vendor-voice strip). This module is the next layer: a named
set of principles the system can **score an answer against**, **repair**
when a principle is broken, and **refuse** when a must-rule is violated.

It is not an LLM-as-judge. Each principle is a deterministic checker
(regex / heuristic) plus an optional repair transform. The trace is
machine-readable so a UI can show *why* a draft was rewritten.
"""

from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field

Severity = Literal["must", "should", "prefer"]
Verdict = Literal["allow", "revise", "refuse"]

_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_CARD = re.compile(r"\b(?:\d[ -]*?){13,19}\b")
_VENDOR = re.compile(
    r"\b(?:as an ai(?: language model)?|i am (?:chatgpt|gpt-?\d|claude|gemini|bard)|"
    r"as of my last (?:training|update)|based on my training data)\b",
    re.I,
)
_FAKE_CITE = re.compile(
    r"\((?:Smith|Doe|et al\.)\s*,?\s*\d{4}\)|\bdoi:\s*10\.\d{4,}/fake",
    re.I,
)
_HEDGE_ABSENT = re.compile(
    r"\b(?:always|never|guaranteed|certainly|definitely|undeniably|without (?:a )?doubt)\b",
    re.I,
)
_SYCOPHANT = re.compile(
    r"\b(?:you're absolutely right|you are (?:completely )?correct|great question!?|"
    r"i completely agree)\b",
    re.I,
)
_WEAPONS = re.compile(
    r"how\s+(?:to\s+)?(?:make|build|create|manufacture)\s+(?:a\s+)?(?:bomb|explosive|weapon|firearm)",
    re.I,
)
_SELF_HARM = re.compile(
    r"(?:methods?|ways?|how)\s+(?:to\s+)?(?:die|suicide|end\s+(?:it|my\s+life))|kill\s+myself",
    re.I,
)
_UNSTRUCTURED_STEPS = re.compile(r"\b(?:first|then|next|finally|step\s+\d)\b", re.I)


# --- Schemas ------------------------------------------------------------------

class PrincipleIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    statement: str = Field(..., min_length=1, max_length=2_000)
    severity: Severity = "should"
    cues: list[str] = Field(default_factory=list, description="Regexes that fire a violation.")
    repair_hint: str = Field(default="", max_length=500)
    enabled: bool = True


class CritiqueRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=80_000)
    request: str = Field(default="", max_length=20_000)
    grounded: bool = False
    constitution_id: str | None = None


class ReviseRequest(CritiqueRequest):
    max_passes: int = Field(default=2, ge=1, le=4)


# --- Internals ----------------------------------------------------------------

CheckFn = Callable[[str, str, bool], list[str]]
RepairFn = Callable[[str, list[str]], str]


def _check_cues(cues: list[re.Pattern[str]]) -> CheckFn:
    def _fn(text: str, _request: str, _grounded: bool) -> list[str]:
        hits: list[str] = []
        for cue in cues:
            match = cue.search(text)
            if match:
                hits.append(f"matched {cue.pattern!r} at {match.group(0)!r}")
        return hits
    return _fn


def _check_pii(text: str, _request: str, _grounded: bool) -> list[str]:
    hits: list[str] = []
    if _EMAIL.search(text):
        hits.append("email address echoed in the answer")
    if _SSN.search(text):
        hits.append("SSN-like number present")
    if _CARD.search(text) and re.search(r"\b(?:card|visa|mastercard|amex)\b", text, re.I):
        hits.append("payment-card number present")
    return hits


def _check_fabrication(text: str, _request: str, grounded: bool) -> list[str]:
    if _FAKE_CITE.search(text) and not grounded:
        return ["unverified academic-style citation without grounding"]
    return []


def _check_overconfident(text: str, _request: str, grounded: bool) -> list[str]:
    if grounded:
        return []
    hits = [f"absolute claim {m.group(0)!r} without grounding" for m in _HEDGE_ABSENT.finditer(text)]
    return hits[:3]


def _check_weapons(text: str, request: str, _grounded: bool) -> list[str]:
    hay = f"{request}\n{text}"
    if _WEAPONS.search(hay):
        return ["weapons-manufacturing uplift"]
    return []


def _check_self_harm(text: str, request: str, _grounded: bool) -> list[str]:
    if _SELF_HARM.search(f"{request}\n{text}"):
        return ["self-harm methods"]
    return []


def _check_sycophancy(text: str, _request: str, _grounded: bool) -> list[str]:
    if _SYCOPHANT.search(text):
        return ["unearned agreement / sycophantic opener"]
    return []


def _check_structure(text: str, request: str, _grounded: bool) -> list[str]:
    if not re.search(r"\b(?:steps?|how to|procedure|plan)\b", request, re.I):
        return []
    if _UNSTRUCTURED_STEPS.search(request) or re.search(r"\bhow to\b", request, re.I):
        if not re.search(r"(?:^|\n)\s*(?:[-*]|\d+[.)])\s+", text):
            return ["multi-step request answered without a list"]
    return []


def _redact_pii(text: str, _hits: list[str]) -> str:
    text = _EMAIL.sub("[redacted-email]", text)
    text = _SSN.sub("[redacted-ssn]", text)
    return text


def _strip_vendor(text: str, _hits: list[str]) -> str:
    cleaned = _VENDOR.sub("", text)
    return re.sub(r"[ \t]{2,}", " ", cleaned).strip()


def _soften_absolutes(text: str, _hits: list[str]) -> str:
    replacements = {
        r"\balways\b": "typically",
        r"\bnever\b": "rarely",
        r"\bguaranteed\b": "likely",
        r"\bcertainly\b": "very likely",
        r"\bdefinitely\b": "very likely",
        r"\bundeniably\b": "strongly",
        r"\bwithout (?:a )?doubt\b": "with high confidence",
    }
    out = text
    for pattern, repl in replacements.items():
        out = re.sub(pattern, repl, out, flags=re.I)
    return out


def _strip_sycophancy(text: str, _hits: list[str]) -> str:
    return _SYCOPHANT.sub("", text).lstrip(" ,.-").lstrip()


def _refuse_weapons(_text: str, _hits: list[str]) -> str:
    return (
        "I can't help with that — it falls outside what I'll assist with "
        "(weapons manufacturing). If there's a legitimate goal underneath "
        "(history, policy, fiction without instructions), describe that instead."
    )


def _refuse_self_harm(_text: str, _hits: list[str]) -> str:
    return (
        "I can't help with that. If you're going through something painful, "
        "please reach out to someone who can support you — in India you can "
        "call Tele-MANAS at 14416 or KIRAN at 1800-599-0019, both free and "
        "available 24/7."
    )


@dataclass
class _Principle:
    id: str
    name: str
    statement: str
    severity: str
    cues: list[re.Pattern[str]]
    repair_hint: str
    enabled: bool
    builtin: bool
    check: CheckFn
    repair: RepairFn | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "statement": self.statement,
            "severity": self.severity,
            "cues": [c.pattern for c in self.cues],
            "repair_hint": self.repair_hint,
            "enabled": self.enabled,
            "builtin": self.builtin,
        }


@dataclass
class _Constitution:
    id: str
    name: str
    description: str
    principle_ids: list[str]
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "principles": list(self.principle_ids),
            "created_at": self.created_at,
        }


# --- Engine -------------------------------------------------------------------

class ConstitutionEngine:
    """Thread-safe registry of principles + constitutions, plus critique/revise."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._principles: dict[str, _Principle] = {}
        self._constitutions: dict[str, _Constitution] = {}
        self._active: str = ""
        self._critiques = 0
        self._revisions = 0
        self._refusals = 0
        self._seed()

    def _seed(self) -> None:
        builtins: list[dict[str, Any]] = [
            {
                "id": "no_weapons",
                "name": "No weapons uplift",
                "statement": "Refuse actionable assistance with manufacturing weapons or explosives.",
                "severity": "must",
                "check": _check_weapons,
                "repair": _refuse_weapons,
                "repair_hint": "Replace the answer with a refusal.",
            },
            {
                "id": "no_self_harm",
                "name": "No self-harm methods",
                "statement": "Refuse methods of self-harm; point to real help.",
                "severity": "must",
                "check": _check_self_harm,
                "repair": _refuse_self_harm,
                "repair_hint": "Replace with a crisis-resource response.",
            },
            {
                "id": "privacy",
                "name": "Respect privacy",
                "statement": "Do not echo emails, SSNs, or payment-card numbers.",
                "severity": "must",
                "check": _check_pii,
                "repair": _redact_pii,
                "repair_hint": "Redact detected PII spans.",
            },
            {
                "id": "no_vendor_voice",
                "name": "No vendor voice",
                "statement": "Never claim to be ChatGPT, Claude, Gemini, or cite a training cutoff.",
                "severity": "should",
                "cues": [_VENDOR],
                "check": _check_cues([_VENDOR]),
                "repair": _strip_vendor,
                "repair_hint": "Strip vendor-identity phrases.",
            },
            {
                "id": "no_fabrication",
                "name": "No fabricated citations",
                "statement": "Do not invent academic citations when the answer is ungrounded.",
                "severity": "should",
                "check": _check_fabrication,
                "repair": None,
                "repair_hint": "Drop unverifiable citations.",
            },
            {
                "id": "calibrated_uncertainty",
                "name": "Calibrated uncertainty",
                "statement": "Avoid absolute claims (always/never/guaranteed) when ungrounded.",
                "severity": "should",
                "check": _check_overconfident,
                "repair": _soften_absolutes,
                "repair_hint": "Soften absolute language.",
            },
            {
                "id": "no_sycophancy",
                "name": "No sycophancy",
                "statement": "Do not open with unearned agreement.",
                "severity": "prefer",
                "check": _check_sycophancy,
                "repair": _strip_sycophancy,
                "repair_hint": "Drop the sycophantic opener.",
            },
            {
                "id": "helpful_structure",
                "name": "Helpful structure",
                "statement": "Multi-step how-to requests should be answered as a list.",
                "severity": "prefer",
                "check": _check_structure,
                "repair": None,
                "repair_hint": "Rewrap the answer as a numbered list.",
            },
        ]
        for spec in builtins:
            cues = spec.get("cues") or []
            p = _Principle(
                id=spec["id"],
                name=spec["name"],
                statement=spec["statement"],
                severity=spec["severity"],
                cues=list(cues),
                repair_hint=spec.get("repair_hint", ""),
                enabled=True,
                builtin=True,
                check=spec["check"],
                repair=spec.get("repair"),
            )
            self._principles[p.id] = p
        constitution = _Constitution(
            id="const_aetheris",
            name="Aetheris Constitution",
            description="Default live principles for the offline Hermes runtime.",
            principle_ids=[p["id"] for p in builtins],
        )
        self._constitutions[constitution.id] = constitution
        self._active = constitution.id

    # -- registry -------------------------------------------------------------

    def add_principle(self, body: PrincipleIn) -> _Principle:
        cues: list[re.Pattern[str]] = []
        for raw in body.cues:
            try:
                cues.append(re.compile(raw, re.I))
            except re.error as exc:
                raise ValueError(f"invalid cue regex {raw!r}: {exc}") from exc
        pid = f"pr_{uuid.uuid4().hex[:8]}"
        principle = _Principle(
            id=pid,
            name=body.name,
            statement=body.statement,
            severity=body.severity,
            cues=cues,
            repair_hint=body.repair_hint,
            enabled=body.enabled,
            builtin=False,
            check=_check_cues(cues) if cues else (lambda *_a: []),
            repair=None,
        )
        with self._lock:
            self._principles[pid] = principle
            active = self._constitutions.get(self._active)
            if active is not None:
                active.principle_ids.append(pid)
        return principle

    def list_principles(self, *, enabled: bool | None = None) -> list[dict[str, Any]]:
        with self._lock:
            items = list(self._principles.values())
        if enabled is not None:
            items = [p for p in items if p.enabled is enabled]
        return [p.to_dict() for p in items]

    def toggle(self, principle_id: str, enabled: bool) -> _Principle | None:
        with self._lock:
            p = self._principles.get(principle_id)
            if p is None:
                return None
            p.enabled = enabled
            return p

    def list_constitutions(self) -> list[dict[str, Any]]:
        with self._lock:
            return [c.to_dict() | {"active": c.id == self._active} for c in self._constitutions.values()]

    def set_active(self, constitution_id: str) -> _Constitution:
        with self._lock:
            c = self._constitutions.get(constitution_id)
            if c is None:
                raise ValueError(f"no constitution {constitution_id!r}")
            self._active = constitution_id
            return c

    def _active_principles(self, constitution_id: str | None = None) -> list[_Principle]:
        cid = constitution_id or self._active
        c = self._constitutions.get(cid)
        if c is None:
            return [p for p in self._principles.values() if p.enabled]
        return [self._principles[pid] for pid in c.principle_ids if pid in self._principles and self._principles[pid].enabled]

    # -- critique / revise / decide -------------------------------------------

    def critique(self, text: str, *, request: str = "", grounded: bool = False, constitution_id: str | None = None) -> dict[str, Any]:
        with self._lock:
            principles = self._active_principles(constitution_id)
            self._critiques += 1
        violations: list[dict[str, Any]] = []
        for p in principles:
            try:
                hits = p.check(text, request, grounded) or []
            except Exception as exc:  # pragma: no cover - a broken checker must not abort
                hits = [f"checker error: {exc}"]
            if hits:
                violations.append(
                    {
                        "principle_id": p.id,
                        "name": p.name,
                        "severity": p.severity,
                        "hits": hits,
                        "repair_hint": p.repair_hint,
                        "repairable": p.repair is not None,
                    }
                )
        must = [v for v in violations if v["severity"] == "must"]
        should = [v for v in violations if v["severity"] == "should"]
        if any(v["principle_id"] in {"no_weapons", "no_self_harm"} for v in must):
            verdict: Verdict = "refuse"
        elif must or should:
            verdict = "revise"
        else:
            verdict = "allow"
        score = 1.0
        for v in violations:
            score -= {"must": 0.45, "should": 0.18, "prefer": 0.06}[v["severity"]]
        return {
            "verdict": verdict,
            "score": round(max(0.0, score), 3),
            "violations": violations,
            "principles_checked": len(principles),
        }

    def revise(
        self,
        text: str,
        *,
        request: str = "",
        grounded: bool = False,
        constitution_id: str | None = None,
        max_passes: int = 2,
    ) -> dict[str, Any]:
        current = text
        applied: list[dict[str, Any]] = []
        last = self.critique(current, request=request, grounded=grounded, constitution_id=constitution_id)
        for _ in range(max_passes):
            if last["verdict"] == "allow":
                break
            changed = False
            with self._lock:
                by_id = dict(self._principles)
            for violation in last["violations"]:
                p = by_id.get(violation["principle_id"])
                if p is None or p.repair is None:
                    continue
                nxt = p.repair(current, violation["hits"])
                if nxt != current:
                    applied.append({"principle_id": p.id, "name": p.name, "severity": p.severity})
                    current = nxt
                    changed = True
                    if p.severity == "must" and p.id in {"no_weapons", "no_self_harm"}:
                        break
            if not changed:
                break
            last = self.critique(current, request=request, grounded=grounded, constitution_id=constitution_id)
        with self._lock:
            self._revisions += 1
            if last["verdict"] == "refuse":
                self._refusals += 1
        return {
            "original": text,
            "revised": current,
            "changed": current != text,
            "applied": applied,
            "critique": last,
        }

    def decide(self, text: str, **kwargs: Any) -> dict[str, Any]:
        """Critique then, if needed, revise. Returns the final text + verdict."""
        first = self.critique(text, **{k: kwargs[k] for k in ("request", "grounded", "constitution_id") if k in kwargs})
        if first["verdict"] == "allow":
            return {"text": text, "action": "allow", "critique": first, "applied": []}
        revised = self.revise(text, **kwargs)
        action = revised["critique"]["verdict"]
        if action == "revise" and not revised["changed"]:
            action = "allow"
        return {
            "text": revised["revised"],
            "action": action,
            "critique": revised["critique"],
            "applied": revised["applied"],
        }

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "principles": len(self._principles),
                "constitutions": len(self._constitutions),
                "active": self._active,
                "critiques": self._critiques,
                "revisions": self._revisions,
                "refusals": self._refusals,
            }


_engine: ConstitutionEngine | None = None


def get_constitution_engine() -> ConstitutionEngine:
    global _engine
    if _engine is None:
        _engine = ConstitutionEngine()
    return _engine


__all__ = [
    "ConstitutionEngine",
    "PrincipleIn",
    "CritiqueRequest",
    "ReviseRequest",
    "get_constitution_engine",
]

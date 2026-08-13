"""God Mode — the meta-controller that fuses the ultra engines.

A single ``run(task)`` classifies the request and fires the right
arsenal: Tree-of-Thought, causal world model, Bayesian hypotheses,
proof kernel, red-team, forecasts. The briefing is a structured
fusion, not a pile of disconnected JSON.
"""

from __future__ import annotations

import re
import time
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field

ENGINES = ("tot", "causal", "hypothesis", "proof", "redteam", "forecast")


class GodRunRequest(BaseModel):
    task: str = Field(..., min_length=1, max_length=20_000)
    arsenal: list[str] = Field(default_factory=list)
    simulations: int = Field(default=16, ge=4, le=64)


def route_arsenal(task: str) -> list[str]:
    """Pick engines from lexical cues. Always includes hypothesis."""
    t = task.lower()
    picked: list[str] = ["hypothesis"]
    if re.search(r"\b(prove|proof|therefore|implies|modus)\b", t):
        picked.append("proof")
    if re.search(r"\b(why|cause|interven|counterfactual|what if|do\()\b", t):
        picked.append("causal")
    if re.search(r"\b(search|consider|options?|trade-?off|design|architect)\b", t):
        picked.append("tot")
    if re.search(r"\b(jailbreak|red ?team|probe|robust|unsafe)\b", t):
        picked.append("redteam")
    if re.search(r"\b(forecast|will|probability|odds|predict)\b", t):
        picked.append("forecast")
    if "tot" not in picked and len(task) > 80:
        picked.append("tot")
    # unique, stable order
    order = [e for e in ENGINES if e in picked]
    return order or ["hypothesis"]


class GodMode:
    def __init__(self) -> None:
        self._lock = Lock()
        self._runs = 0

    def run(self, req: GodRunRequest) -> dict[str, Any]:
        started = time.perf_counter()
        arsenal = [e for e in (req.arsenal or route_arsenal(req.task)) if e in ENGINES]
        if not arsenal:
            arsenal = route_arsenal(req.task)
        payload: dict[str, Any] = {}
        notes: list[str] = []

        if "tot" in arsenal:
            from .tot import ToTRequest, get_tot

            tot = get_tot().search(ToTRequest(task=req.task, simulations=req.simulations))
            payload["tot"] = {
                "confidence": tot["confidence"],
                "briefing": tot["briefing"],
                "best_thought": tot["best_thought"],
                "nodes": len(tot["nodes"]),
            }
            notes.append(f"ToT searched {tot['simulations']} plies, confidence {tot['confidence']}.")

        if "causal" in arsenal:
            from .world_model import get_world_model

            wm = get_world_model()
            # Interpret "more grounding" / "faster" as interventions.
            do: dict[str, float] = {}
            tl = req.task.lower()
            if "ground" in tl:
                do["grounding"] = 0.9
            if re.search(r"\b(fast|latency|slow)\b", tl):
                do["latency"] = 0.2 if "fast" in tl else 0.8
            if "safe" in tl or "refus" in tl:
                do["safety"] = 0.95
            if not do:
                do = {"grounding": 0.85}
            try:
                world = wm.intervene(do, steps=4)
                payload["causal"] = {"do": world["do"], "effects": world["effects"]}
                notes.append("Causal intervention: " + ", ".join(f"{k}→{v:+.2f}" for k, v in world["effects"].items()))
            except KeyError as exc:
                payload["causal"] = {"error": str(exc)}

        if "hypothesis" in arsenal:
            from .hypothesis import HypothesisRequest, get_hypothesis_engine

            hyp = get_hypothesis_engine().infer(HypothesisRequest(question=req.task))
            payload["hypothesis"] = {
                "leader": hyp["leader"],
                "falsifier": hyp["falsifier"],
                "entropy": hyp["entropy"],
                "n": len(hyp["hypotheses"]),
            }
            if hyp["leader"]:
                notes.append(f"Leading hypothesis ({hyp['leader']['posterior']:.0%}): {hyp['leader']['hypothesis']}")

        if "proof" in arsenal:
            from .proof import get_proof_kernel

            demo = get_proof_kernel().modus_ponens_demo()
            payload["proof"] = {"demo_ok": demo["ok"], "goal": demo["goal"], "hint": "Submit a ProofIn to /v1/god/proof to check your own sequent."}
            notes.append("Proof kernel is live (modus ponens demo " + ("holds" if demo["ok"] else "failed") + ").")

        if "redteam" in arsenal:
            from .redteam import get_redteam

            rt = get_redteam().run()
            payload["redteam"] = {"score": rt["score"], "passed": rt["passed"], "total": rt["total"]}
            notes.append(f"Red-team score {rt['score']:.0%} ({rt['passed']}/{rt['total']}).")

        if "forecast" in arsenal:
            from .forecast import ForecastIn, get_forecast_book

            book = get_forecast_book()
            rec = book.file(ForecastIn(
                statement=req.task[:240],
                probability=0.55,
                tags=["god"],
            ))
            payload["forecast"] = rec.to_dict()
            notes.append(f"Logged an open forecast {rec.id} at p=0.55 — resolve it later.")

        with self._lock:
            self._runs += 1

        return {
            "codename": "GOD",
            "task": req.task,
            "arsenal": arsenal,
            "notes": notes,
            "engines": payload,
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {"runs": self._runs, "engines": list(ENGINES)}


_god: GodMode | None = None


def get_god_mode() -> GodMode:
    global _god
    if _god is None:
        _god = GodMode()
    return _god


__all__ = ["GodMode", "GodRunRequest", "route_arsenal", "get_god_mode", "ENGINES"]

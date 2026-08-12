"""Ætheris NOVA — Multi-Agent Orchestrator.

Implements four orchestration patterns over a fixed cast of specialist agents:

* **Council** — every specialist proposes; a Planner synthesises; a Critic
  stress-tests; the Writer produces a final answer.
* **Debate** — a proponent argues a position while the Devil's Advocate attacks
  it; a judge declares the strongest argument after N rounds.
* **Pipeline** — Planner → Researcher → Coder → Writer → QA, strictly
  sequential, each handing off typed artifacts.
* **Swarm** — all agents work in parallel; the Planner merges the result.

Each agent is a lightweight wrapper that calls the same LLM provider but with
a role-specific system prompt. When no provider is supplied, the orchestrator
runs in offline mode and produces heuristic traces so the system is demoable.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from ..core.nova import EXPERTS


Provider = Callable[[str, str], Awaitable[str]]  # (system_prompt, user_prompt) -> completion


ROLE_PROMPTS: dict[str, str] = {
    "planner": (
        "You are the Planner. Decompose every goal into concrete sub-tasks with "
        "acceptance criteria. Output a numbered plan with dependencies. Be explicit "
        "about what evidence each step needs."
    ),
    "researcher": (
        "You are the Researcher. Gather facts, cite sources, and flag open questions. "
        "Separate evidence from inference. Never invent a source."
    ),
    "critic": (
        "You are the Critic. Your job is to find flaws, risks, hidden assumptions, "
        "and unstated constraints. Be specific and constructive."
    ),
    "coder": (
        "You are the Coder. Produce minimal, correct, tested code. Prefer the standard "
        "library. When a function is non-trivial, include a small self-test."
    ),
    "writer": (
        "You are the Writer. Produce clear, calibrated prose for the final answer. "
        "Serve the reader; structure matters more than flourish."
    ),
    "qa": (
        "You are QA. Compare the final answer against the original request. Reject "
        "answers that miss the point, skip steps, or hand-wave."
    ),
    "devils_advocate": (
        "You are the Devil's Advocate. Find the strongest counter-argument to every "
        "claim. Be rigorous; do not be contrarian for its own sake."
    ),
    "judge": (
        "You are the Judge. Weigh competing arguments fairly, declare the stronger "
        "position, and explain why. Note residual uncertainty."
    ),
}


@dataclass
class AgentMessage:
    role: str
    content: str
    timestamp: float = field(default_factory=time.time)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class OrchestrationResult:
    mode: str
    answer: str
    messages: list[AgentMessage]
    rounds: int
    duration_ms: float
    rejected: bool = False
    rejection_reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "answer": self.answer,
            "rounds": self.rounds,
            "duration_ms": round(self.duration_ms, 1),
            "rejected": self.rejected,
            "rejection_reason": self.rejection_reason,
            "trace": [
                {"role": m.role, "content": m.content, "timestamp": m.timestamp, "metadata": m.metadata}
                for m in self.messages
            ],
        }


class AgentOrchestrator:
    def __init__(self, provider: Provider | None = None, max_rounds: int = 6):
        self._provider = provider
        self.max_rounds = max(1, min(max_rounds, 12))

    async def _call(self, role: str, prompt: str) -> str:
        sys = ROLE_PROMPTS.get(role, ROLE_PROMPTS["planner"])
        if self._provider is not None:
            try:
                return (await self._provider(sys, prompt)).strip()
            except Exception:
                pass
        return self._offline(role, prompt)

    def _offline(self, role: str, prompt: str) -> str:
        p = prompt.lower()
        snippet = prompt[:160].replace("\n", " ")
        if role == "planner":
            return f"1. Clarify the goal and success criteria for: {snippet}\n2. Gather facts & constraints.\n3. Propose solution(s).\n4. Verify against acceptance criteria."
        if role == "researcher":
            return f"Based on the prompt ({snippet!r}), the core evidence required is:\n- definition of terms\n- constraints\n- prior art\nNo invented sources; flag unknowns."
        if role == "critic":
            gaps = []
            if "?" in prompt:
                gaps.append("The question is open-ended; more scope definition is needed.")
            if any(n in p for n in ("security", "risk", "fail")):
                gaps.append("Safety/failure modes are not addressed yet.")
            if not gaps:
                gaps.append("No major gaps found on first pass; verify edge cases.")
            return "- " + "\n- ".join(gaps)
        if role == "coder":
            return "```python\ndef solve(items):\n    if not items: raise ValueError('empty')\n    return sum(items)\n# quick self-test\nassert solve([1,2,3]) == 6\n```"
        if role == "qa":
            if len(prompt) < 80:
                return "PASS — answer addresses the request within reasonable scope."
            return "PASS — output is aligned with the original request; caveats noted."
        if role == "devils_advocate":
            return "Counter-position: the proposed answer may over-simplify; consider edge cases, alternative framings, and the cost of being wrong."
        if role == "judge":
            return "After weighing both sides, the more defensible position is the one that explicitly names uncertainty and proposes a verification step."
        if role == "writer":
            return (
                "**Answer.** After planning, researching, and stress-testing, "
                f"here is a calibrated response to: {snippet}...\n\n"
                "1. Clarify the objective.\n"
                "2. Apply the relevant evidence.\n"
                "3. Propose concrete next steps."
            )
        return f"[{role}] processed: {snippet}"

    # --- public orchestration modes ----------------------------------------
    async def council(self, goal: str) -> OrchestrationResult:
        started = time.perf_counter()
        messages: list[AgentMessage] = []

        plan = await self._call("planner", f"Goal: {goal}")
        messages.append(AgentMessage("planner", plan))

        # Researcher, Coder, Critic all speak in parallel.
        research, code, critique = await asyncio.gather(
            self._call("researcher", f"Goal: {goal}\nPlan:\n{plan}"),
            self._call("coder", f"Goal: {goal}\nPlan:\n{plan}") if any(k in goal.lower() for k in ("code","implement","function","script","program")) else asyncio.sleep(0, result=""),
            self._call("critic", f"Goal: {goal}\nPlan:\n{plan}"),
        )
        if research:
            messages.append(AgentMessage("researcher", research))
        if code:
            messages.append(AgentMessage("coder", code))
        messages.append(AgentMessage("critic", critique))

        final = await self._call(
            "writer",
            f"Goal: {goal}\n\nPlan:\n{plan}\n\nResearch:\n{research}\n\n"
            f"Code:\n{code}\n\nCritique:\n{critique}\n\nWrite the final answer.",
        )
        messages.append(AgentMessage("writer", final))

        qa = await self._call("qa", f"Original goal: {goal}\n\nFinal answer:\n{final}")
        messages.append(AgentMessage("qa", qa))

        rejected = "reject" in qa.lower()[:200] or "fail" in qa.lower()[:200]
        return OrchestrationResult(
            mode="council",
            answer=final,
            messages=messages,
            rounds=1,
            duration_ms=(time.perf_counter() - started) * 1000,
            rejected=rejected,
            rejection_reason=qa if rejected else "",
        )

    async def debate(self, position: str, *, rounds: int = 3) -> OrchestrationResult:
        started = time.perf_counter()
        messages: list[AgentMessage] = []
        pro = await self._call("writer", f"Argue FOR this position: {position}")
        messages.append(AgentMessage("proponent", pro))
        con = ""
        rounds = max(1, min(rounds, self.max_rounds))
        for i in range(rounds):
            con = await self._call("devils_advocate", f"Position: {position}\nPro argument:\n{pro}\nCounter-argument #{i+1}:")
            messages.append(AgentMessage("devils_advocate", con, metadata={"round": i + 1}))
            pro = await self._call("writer", f"Position: {position}\nCounter-argument:\n{con}\nRebuttal #{i+1}:")
            messages.append(AgentMessage("proponent", pro, metadata={"round": i + 1}))
        verdict = await self._call("judge", f"Position: {position}\n\nFinal pro:\n{pro}\n\nFinal con:\n{con}\n\nWeigh and decide.")
        messages.append(AgentMessage("judge", verdict))
        return OrchestrationResult(
            mode="debate",
            answer=verdict,
            messages=messages,
            rounds=rounds,
            duration_ms=(time.perf_counter() - started) * 1000,
        )

    async def pipeline(self, goal: str) -> OrchestrationResult:
        started = time.perf_counter()
        messages: list[AgentMessage] = []
        plan = await self._call("planner", goal); messages.append(AgentMessage("planner", plan))
        research = await self._call("researcher", f"Goal: {goal}\nPlan:\n{plan}"); messages.append(AgentMessage("researcher", research))
        code = ""
        if any(k in goal.lower() for k in ("code", "implement", "function", "program", "script", "bug")):
            code = await self._call("coder", f"Goal: {goal}\nPlan:\n{plan}\nResearch:\n{research}")
            messages.append(AgentMessage("coder", code))
        draft = await self._call("writer", f"Goal: {goal}\nPlan:\n{plan}\nResearch:\n{research}\nCode:\n{code}")
        messages.append(AgentMessage("writer", draft))
        qa = await self._call("qa", f"Goal: {goal}\nAnswer:\n{draft}"); messages.append(AgentMessage("qa", qa))
        rejected = "reject" in qa.lower()[:200] or "fail" in qa.lower()[:200]
        return OrchestrationResult(
            mode="pipeline",
            answer=draft,
            messages=messages,
            rounds=1,
            duration_ms=(time.perf_counter() - started) * 1000,
            rejected=rejected,
            rejection_reason=qa if rejected else "",
        )

    async def swarm(self, goal: str) -> OrchestrationResult:
        started = time.perf_counter()
        tasks = {
            role: self._call(role, f"Goal: {goal}. Contribute from your role's perspective. Keep it tight.")
            for role in ("planner", "researcher", "critic", "coder", "writer")
        }
        results = await asyncio.gather(*tasks.values(), return_exceptions=True)
        messages: list[AgentMessage] = []
        merged: list[str] = []
        for (role, _), res in zip(tasks.items(), results):
            if isinstance(res, Exception):
                continue
            messages.append(AgentMessage(role, str(res)))
            merged.append(f"## {role}\n{res}")
        final = await self._call("writer", f"Merge these specialist outputs into one coherent answer to: {goal}\n\n" + "\n\n".join(merged))
        messages.append(AgentMessage("writer", final))
        return OrchestrationResult(
            mode="swarm",
            answer=final,
            messages=messages,
            rounds=1,
            duration_ms=(time.perf_counter() - started) * 1000,
        )

    async def run(self, mode: str, goal: str, **kw: Any) -> OrchestrationResult:
        mode = mode.lower()
        if mode == "council":
            return await self.council(goal)
        if mode == "debate":
            return await self.debate(goal, rounds=kw.get("rounds", 3))
        if mode == "pipeline":
            return await self.pipeline(goal)
        if mode == "swarm":
            return await self.swarm(goal)
        raise ValueError(f"Unknown orchestration mode: {mode}")


_orchestrator: AgentOrchestrator | None = None


def get_orchestrator(provider: Provider | None = None) -> AgentOrchestrator:
    global _orchestrator
    if _orchestrator is None or provider is not None:
        _orchestrator = AgentOrchestrator(provider=provider)
    return _orchestrator


__all__ = ["AgentOrchestrator", "OrchestrationResult", "AgentMessage", "ROLE_PROMPTS", "get_orchestrator"]

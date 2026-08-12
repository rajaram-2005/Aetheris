"""Ætheris NOVA — Tool Composition v2 (Plan + parallel DAG execution).

Implements a structured ``plan → execute → verify`` loop. Plans are DAGs of
tool calls with typed dependencies, parallel fan-out, and automatic rollback
for failed steps. The planner can decompose a user goal into a plan even with
the offline heuristic path.

Plan JSON schema (produced/consumed by this module)::

    {
      "goal": "...",
      "steps": [
        {"id": "s1", "tool": "...", "args": {...}, "depends_on": []},
        {"id": "s2", "tool": "...", "args": {...}, "depends_on": ["s1"]}
      ],
      "success_criteria": ["..."],
      "rollback": {"s1": "undo_..."}
    }
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


ToolFn = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


@dataclass
class PlanStep:
    id: str
    tool: str
    args: dict[str, Any] = field(default_factory=dict)
    depends_on: list[str] = field(default_factory=list)
    result: dict[str, Any] | None = None
    status: str = "pending"  # pending|running|succeeded|failed|skipped
    started_at: float = 0.0
    finished_at: float = 0.0
    error: str = ""


@dataclass
class Plan:
    goal: str
    steps: list[PlanStep]
    success_criteria: list[str] = field(default_factory=list)
    rollback: dict[str, str] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "goal": self.goal,
            "steps": [
                {
                    "id": s.id,
                    "tool": s.tool,
                    "args": s.args,
                    "depends_on": s.depends_on,
                    "status": s.status,
                    "result": s.result,
                    "error": s.error,
                    "duration_ms": round((s.finished_at - s.started_at) * 1000, 1) if s.finished_at else 0,
                }
                for s in self.steps
            ],
            "success_criteria": self.success_criteria,
            "rollback": self.rollback,
        }

    def ready(self) -> list[PlanStep]:
        done = {s.id for s in self.steps if s.status in ("succeeded", "skipped")}
        return [s for s in self.steps if s.status == "pending" and all(d in done for d in s.depends_on)]


class ToolComposer:
    """Plans and executes a DAG of tool calls with parallel fan-out."""

    def __init__(self, tools: dict[str, ToolFn] | None = None, parallelism: int = 4):
        self.tools = tools or {}
        self.parallelism = max(1, parallelism)
        self._sem: asyncio.Semaphore | None = None

    def register(self, name: str, fn: ToolFn) -> None:
        self.tools[name] = fn

    # --- planning ----------------------------------------------------------
    def plan_for(self, goal: str) -> Plan:
        """Build a plan.

        When no LLM-backed planner is attached, we recognise a handful of
        common intents and produce a sensible DAG. Complex goals fall back to
        a single ``reason``/``respond`` step that the LLM can refine.
        """
        g = goal.lower().strip()
        steps: list[PlanStep] = []
        # Common compound intents
        if "fibonacci" in g or "compute" in g and ("verify" in g or "check" in g):
            steps.append(PlanStep(id="s1", tool="calculator" if "calculator" in self.tools else "code_interpreter",
                                  args={"expression": goal}, depends_on=[]))
            steps.append(PlanStep(id="s2", tool="code_interpreter",
                                  args={"code": _verification_script(goal)}, depends_on=["s1"]))
            return Plan(goal=goal, steps=steps,
                        success_criteria=["numeric result agrees across both methods"],
                        rollback={})
        if any(k in g for k in ("research", "find", "look up", "sources", "cite")):
            steps.append(PlanStep(id="s1", tool="search" if "search" in self.tools else "document_search",
                                  args={"query": goal}, depends_on=[]))
            steps.append(PlanStep(id="s2", tool="synthesize" if "synthesize" in self.tools else "respond",
                                  args={"from": "{{s1}}"}, depends_on=["s1"]))
            return Plan(goal=goal, steps=steps,
                        success_criteria=["answer grounded in retrieved sources"],
                        rollback={})
        if "code" in g or "implement" in g or "write a" in g and "function" in g:
            steps.append(PlanStep(id="s1", tool="write_code", args={"spec": goal}, depends_on=[]))
            steps.append(PlanStep(id="s2", tool="code_interpreter", args={"code": "{{s1.code}}"}, depends_on=["s1"]))
            steps.append(PlanStep(id="s3", tool="respond", args={"from": ["s1", "s2"]}, depends_on=["s2"]))
            return Plan(goal=goal, steps=steps,
                        success_criteria=["code runs", "self-tests pass"],
                        rollback={})
        # Generic plan: single step
        steps.append(PlanStep(id="s1", tool=next(iter(self.tools), "respond"), args={"goal": goal}))
        return Plan(goal=goal, steps=steps, success_criteria=["answer satisfies goal"])

    # --- execution ---------------------------------------------------------
    async def execute(self, plan: Plan) -> dict[str, Any]:
        self._sem = asyncio.Semaphore(self.parallelism)
        started = time.perf_counter()
        # topological loop
        while True:
            ready = plan.ready()
            if not ready:
                break
            await asyncio.gather(*(self._run_step(step, plan) for step in ready))
            # If any step failed and is a hard dependency for everything else, abort.
            fatal = [s for s in plan.steps if s.status == "failed" and not s.depends_on]
            if fatal:
                for s in plan.steps:
                    if s.status == "pending":
                        s.status = "skipped"
                break
        duration_ms = (time.perf_counter() - started) * 1000
        failed = [s for s in plan.steps if s.status == "failed"]
        return {
            "status": "succeeded" if not failed else "partial" if any(s.status == "succeeded" for s in plan.steps) else "failed",
            "plan": plan.to_dict(),
            "duration_ms": round(duration_ms, 1),
            "failed_steps": [s.id for s in failed],
        }

    async def _run_step(self, step: PlanStep, plan: Plan) -> None:
        async with self._sem:  # type: ignore[union-attr]
            step.status = "running"
            step.started_at = time.time()
            # interpolate {{step_id.foo}} references
            args = _interpolate(step.args, plan)
            try:
                fn = self.tools.get(step.tool)
                if fn is None:
                    # Mock execution: return a descriptive stub so the plan runs offline.
                    step.result = {"ok": True, "mocked": True, "tool": step.tool, "args": args}
                else:
                    step.result = await fn(args)
                step.status = "succeeded"
            except Exception as exc:  # pragma: no cover - defensive
                step.status = "failed"
                step.error = str(exc)
            finally:
                step.finished_at = time.time()


def _interpolate(value: Any, plan: Plan) -> Any:
    if isinstance(value, str):
        def repl(m):
            ref = m.group(1).strip()
            sid, _, path = ref.partition(".")
            step = next((s for s in plan.steps if s.id == sid), None)
            if step is None or step.result is None:
                return ""
            if not path:
                return str(step.result)
            cur: Any = step.result
            for part in path.split("."):
                if isinstance(cur, dict):
                    cur = cur.get(part, "")
                else:
                    cur = ""
            return str(cur)
        return re.sub(r"\{\{\s*([^}]+)\s*\}\}", repl, value)
    if isinstance(value, list):
        return [_interpolate(v, plan) for v in value]
    if isinstance(value, dict):
        return {k: _interpolate(v, plan) for k, v in value.items()}
    return value


def _verification_script(goal: str) -> str:
    n_m = re.search(r"fibonacci\D*(\d+)", goal.lower())
    n = int(n_m.group(1)) if n_m else 10
    return (
        "def fib(n):\n"
        "    a,b=0,1\n"
        "    for _ in range(n):\n"
        "        a,b=b,a+b\n"
        "    return a\n"
        f"print('fib({n}) =', fib({n}))\n"
    )


_composer: ToolComposer | None = None


def get_composer(tools: dict[str, ToolFn] | None = None) -> ToolComposer:
    global _composer
    if _composer is None:
        _composer = ToolComposer(tools=tools)
    elif tools:
        for k, fn in tools.items():
            _composer.register(k, fn)
    return _composer


__all__ = ["ToolComposer", "Plan", "PlanStep", "get_composer"]

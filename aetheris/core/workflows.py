"""Workflow automation engine for Aetheris.

A **workflow** is a named, multi-step automation pipeline. Each step can:
* Call an external API via a registered connection
* Execute an Aetheris tool (code_interpreter, web_fetch, etc.)
* Apply a data transformation (JSON path extraction, template rendering)
* Run a conditional branch or parallel fan-out
* Trigger another workflow

Workflows are triggered by:
* Manual invocation (API call)
* Event matching (from the internal event bus)
* Cron schedule (from the scheduler)
* Webhook receipt

The engine executes steps sequentially by default, with support for
parallel branches and conditional logic. Every execution is fully traced
and its results are queryable.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Literal

from pydantic import BaseModel, Field

logger = logging.getLogger("aetheris.workflows")

# --- Step types ---------------------------------------------------------------

StepType = Literal["connection", "tool", "transform", "condition", "parallel", "loop", "workflow"]


class WorkflowStep(BaseModel):
    """A single step in a workflow."""

    id: str = Field(default_factory=lambda: f"step_{uuid.uuid4().hex[:8]}")
    name: str = Field(default="", max_length=256)
    type: StepType = Field(..., description="Step type.")
    # Connection step config
    connection_id: str = Field(default="", description="Connection ID for 'connection' steps.")
    method: str = Field(default="GET", description="HTTP method for connection steps.")
    path: str = Field(default="", description="URL path (appended to connection base_url).")
    body_template: dict[str, Any] | None = Field(default=None, description="JSON body template with {{var}} placeholders.")
    query_params: dict[str, str] = Field(default_factory=dict)
    headers: dict[str, str] = Field(default_factory=dict)
    # Tool step config
    tool_name: str = Field(default="", description="Aetheris tool name for 'tool' steps.")
    tool_arguments: dict[str, Any] = Field(default_factory=dict)
    # Transform step config
    transform_expr: str = Field(default="", description="JMESPath-like expression or jq-style transform.")
    # Condition step config
    condition_expr: str = Field(default="", description="Expression to evaluate (e.g. 'result.status_code == 200').")
    then_steps: list["WorkflowStep"] = Field(default_factory=list, description="Steps to run if condition is true.")
    else_steps: list["WorkflowStep"] = Field(default_factory=list, description="Steps to run if condition is false.")
    # Parallel step config
    parallel_steps: list["WorkflowStep"] = Field(default_factory=list, description="Steps to run in parallel.")
    # Loop step config
    loop_over: str = Field(default="", description="Variable name containing the list to iterate.")
    loop_steps: list["WorkflowStep"] = Field(default_factory=list)
    max_iterations: int = Field(default=100, ge=1, le=1000)
    # Retry config (all step types)
    retry_count: int = Field(default=0, ge=0, le=5, description="Number of retries on failure.")
    retry_delay_seconds: float = Field(default=1.0, ge=0, le=60)
    # Output mapping
    output_key: str = Field(default="", description="Store the result under this key in the context.")
    timeout_seconds: float = Field(default=30.0, gt=0, le=300)


class TriggerConfig(BaseModel):
    """Workflow trigger configuration."""

    type: Literal["manual", "event", "cron", "webhook"] = Field(default="manual")
    event_pattern: str = Field(default="", description="Event name pattern for 'event' triggers.")
    cron_expression: str = Field(default="", description="Cron expression for 'cron' triggers.")
    webhook_path: str = Field(default="", description="Custom webhook path for 'webhook' triggers.")


class WorkflowCreate(BaseModel):
    """Request to create a new workflow."""

    name: str = Field(..., min_length=1, max_length=128)
    description: str = Field(default="", max_length=1000)
    steps: list[WorkflowStep] = Field(..., min_length=1)
    trigger: TriggerConfig = Field(default_factory=TriggerConfig)
    input_schema: dict[str, Any] = Field(default_factory=dict, description="Expected input variables.")
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkflowInfo(BaseModel):
    """Public view of a workflow."""

    id: str
    name: str
    description: str
    step_count: int
    trigger: TriggerConfig
    created_at: float
    last_run_at: float | None
    run_count: int
    metadata: dict[str, Any]


class StepResult(BaseModel):
    """Result of a single workflow step execution."""

    step_id: str
    step_name: str
    step_type: StepType
    ok: bool
    output: Any = None
    error: str | None = None
    duration_ms: int = 0
    retries: int = 0


class WorkflowRunResult(BaseModel):
    """Result of a complete workflow execution."""

    id: str
    workflow_id: str
    ok: bool
    steps: list[StepResult] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)
    duration_ms: int = 0
    started_at: float = 0.0
    completed_at: float = 0.0
    error: str | None = None


# --- Template rendering -------------------------------------------------------

def _render_template(template: Any, context: dict[str, Any]) -> Any:
    """Simple {{var}} template rendering for dicts, lists, and strings."""
    if isinstance(template, str):
        for key, value in context.items():
            placeholder = "{{" + key + "}}"
            if placeholder in template:
                template = template.replace(placeholder, str(value))
        return template
    if isinstance(template, dict):
        return {k: _render_template(v, context) for k, v in template.items()}
    if isinstance(template, list):
        return [_render_template(item, context) for item in template]
    return template


def _evaluate_condition(expr: str, context: dict[str, Any]) -> bool:
    """Safely evaluate a simple condition expression against context.

    Supports simple comparisons: result.ok == True, result.status_code == 200, etc.
    Uses a restricted eval with only the context available.
    """
    if not expr:
        return True
    # Provide 'result' as the previous step result if available
    safe_globals = {"__builtins__": {}}
    safe_globals.update({"True": True, "False": False, "None": None})
    safe_locals = dict(context)
    try:
        return bool(eval(expr, safe_globals, safe_locals))  # noqa: S307
    except Exception:
        return False


def _apply_transform(expr: str, data: Any) -> Any:
    """Apply a simple transform expression to data.

    Supports dot-path access: result.body.items, data[0].name, etc.
    Also supports basic JMESPath-like syntax.
    """
    if not expr or data is None:
        return data
    try:
        # Simple dot-path traversal
        parts = expr.replace("[", ".").replace("]", "").split(".")
        current = data
        for part in parts:
            if not part:
                continue
            if isinstance(current, dict):
                current = current.get(part)
            elif isinstance(current, (list, tuple)):
                try:
                    idx = int(part)
                    current = current[idx]
                except (ValueError, IndexError):
                    return None
            else:
                return None
        return current
    except Exception:
        return None


# --- Workflow storage ---------------------------------------------------------

@dataclass
class _Workflow:
    id: str
    name: str
    description: str
    steps: list[WorkflowStep]
    trigger: TriggerConfig
    input_schema: dict[str, Any]
    metadata: dict[str, Any]
    created_at: float
    last_run_at: float | None = None
    run_count: int = 0

    def to_info(self) -> WorkflowInfo:
        return WorkflowInfo(
            id=self.id, name=self.name, description=self.description,
            step_count=len(self.steps), trigger=self.trigger,
            created_at=self.created_at, last_run_at=self.last_run_at,
            run_count=self.run_count, metadata=self.metadata,
        )


# --- Engine -------------------------------------------------------------------

class WorkflowEngine:
    """Workflow automation engine with execution, tracing, and scheduling."""

    def __init__(self, max_workflows: int = 200, max_history: int = 5000) -> None:
        self._workflows: dict[str, _Workflow] = {}
        self._history: deque[WorkflowRunResult] = deque(maxlen=max_history)
        self._lock = Lock()
        self._max_workflows = max_workflows

    def create(self, body: WorkflowCreate) -> _Workflow:
        with self._lock:
            if len(self._workflows) >= self._max_workflows:
                raise ValueError(f"Maximum of {self._max_workflows} workflows reached.")
            wf = _Workflow(
                id=f"wf_{uuid.uuid4().hex[:12]}",
                name=body.name, description=body.description,
                steps=body.steps, trigger=body.trigger,
                input_schema=body.input_schema, metadata=body.metadata,
                created_at=time.time(),
            )
            self._workflows[wf.id] = wf
        logger.info("Workflow created: %s (%d steps, trigger=%s)", wf.name, len(wf.steps), wf.trigger.type)
        return wf

    def get(self, wf_id: str) -> _Workflow | None:
        with self._lock:
            return self._workflows.get(wf_id)

    def delete(self, wf_id: str) -> bool:
        with self._lock:
            return self._workflows.pop(wf_id, None) is not None

    def list_workflows(self) -> list[_Workflow]:
        with self._lock:
            return list(self._workflows.values())

    async def execute(self, wf_id: str, inputs: dict[str, Any] | None = None) -> WorkflowRunResult:
        """Execute a workflow with the given inputs."""
        wf = self.get(wf_id)
        if wf is None:
            return WorkflowRunResult(
                id=f"run_{uuid.uuid4().hex[:12]}", workflow_id=wf_id,
                ok=False, error=f"Workflow '{wf_id}' not found.",
                started_at=time.time(), completed_at=time.time(),
            )

        run_id = f"run_{uuid.uuid4().hex[:12]}"
        started = time.time()
        context: dict[str, Any] = dict(inputs or {})
        context["inputs"] = inputs or {}
        step_results: list[StepResult] = []

        with self._lock:
            wf.run_count += 1
            wf.last_run_at = started

        try:
            for step in wf.steps:
                result = await self._execute_step(step, context)
                step_results.append(result)
                if step.output_key:
                    context[step.output_key] = result.output
                context["result"] = result.output
                context["result_ok"] = result.ok
                if not result.ok and result.step_type not in ("condition", "parallel"):
                    # Non-recoverable step failure
                    break

            ok = all(r.ok for r in step_results)
            duration = int((time.time() - started) * 1000)
            result = WorkflowRunResult(
                id=run_id, workflow_id=wf_id, ok=ok,
                steps=step_results, context=context,
                duration_ms=duration, started_at=started, completed_at=time.time(),
            )
        except Exception as exc:
            duration = int((time.time() - started) * 1000)
            result = WorkflowRunResult(
                id=run_id, workflow_id=wf_id, ok=False,
                steps=step_results, context=context,
                duration_ms=duration, started_at=started, completed_at=time.time(),
                error=str(exc),
            )

        with self._lock:
            self._history.append(result)
        return result

    async def _execute_step(self, step: WorkflowStep, context: dict[str, Any]) -> StepResult:
        """Execute a single workflow step with retries."""
        started = time.time()
        last_error: str | None = None

        for attempt in range(step.retry_count + 1):
            if attempt > 0:
                await asyncio.sleep(step.retry_delay_seconds)

            try:
                output = await asyncio.wait_for(
                    self._run_step_inner(step, context),
                    timeout=step.timeout_seconds,
                )
                duration = int((time.time() - started) * 1000)
                sr = StepResult(
                    step_id=step.id, step_name=step.name, step_type=step.type,
                    ok=True, output=output, duration_ms=duration, retries=attempt,
                )
                return sr
            except asyncio.TimeoutError:
                last_error = f"Step timed out after {step.timeout_seconds}s"
            except Exception as exc:
                last_error = str(exc)

        duration = int((time.time() - started) * 1000)
        return StepResult(
            step_id=step.id, step_name=step.name, step_type=step.type,
            ok=False, error=last_error, duration_ms=duration, retries=step.retry_count,
        )

    async def _run_step_inner(self, step: WorkflowStep, context: dict[str, Any]) -> Any:
        """Execute the actual step logic."""
        if step.type == "connection":
            return await self._run_connection_step(step, context)
        elif step.type == "tool":
            return await self._run_tool_step(step, context)
        elif step.type == "transform":
            return self._run_transform_step(step, context)
        elif step.type == "condition":
            return await self._run_condition_step(step, context)
        elif step.type == "parallel":
            return await self._run_parallel_step(step, context)
        elif step.type == "loop":
            return await self._run_loop_step(step, context)
        else:
            raise ValueError(f"Unknown step type: {step.type}")

    async def _run_connection_step(self, step: WorkflowStep, context: dict[str, Any]) -> Any:
        from .connections import get_connection_registry
        registry = get_connection_registry()
        body = _render_template(step.body_template, context) if step.body_template else None
        params = _render_template(step.query_params, context) if step.query_params else None
        headers = _render_template(step.headers, context) if step.headers else None
        path = _render_template(step.path, context)
        return await registry.request(
            step.connection_id, method=step.method, path=path,
            json_body=body, query_params=params, extra_headers=headers,
            timeout=step.timeout_seconds,
        )

    async def _run_tool_step(self, step: WorkflowStep, context: dict[str, Any]) -> Any:
        from ..tools import registry
        args = _render_template(step.tool_arguments, context)
        result = await registry.execute(step.tool_name, args)
        return {"ok": result.ok, "output": result.output, "error": result.error, "duration_ms": result.duration_ms}

    def _run_transform_step(self, step: WorkflowStep, context: dict[str, Any]) -> Any:
        data = context.get("result")
        return _apply_transform(step.transform_expr, data)

    async def _run_condition_step(self, step: WorkflowStep, context: dict[str, Any]) -> Any:
        if _evaluate_condition(step.condition_expr, context):
            results = []
            for sub in step.then_steps:
                r = await self._execute_step(sub, context)
                results.append(r)
                if r.ok and r.output is not None:
                    context["result"] = r.output
            return {"branch": "then", "results": [r.model_dump() for r in results]}
        else:
            results = []
            for sub in step.else_steps:
                r = await self._execute_step(sub, context)
                results.append(r)
                if r.ok and r.output is not None:
                    context["result"] = r.output
            return {"branch": "else", "results": [r.model_dump() for r in results]}

    async def _run_parallel_step(self, step: WorkflowStep, context: dict[str, Any]) -> Any:
        tasks = [self._execute_step(sub, dict(context)) for sub in step.parallel_steps]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        output = []
        for r in results:
            if isinstance(r, Exception):
                output.append({"ok": False, "error": str(r)})
            else:
                output.append(r.model_dump())
        return output

    async def _run_loop_step(self, step: WorkflowStep, context: dict[str, Any]) -> Any:
        items = context.get(step.loop_over, [])
        if not isinstance(items, (list, tuple)):
            items = []
        results = []
        for i, item in enumerate(items[:step.max_iterations]):
            loop_ctx = dict(context)
            loop_ctx["item"] = item
            loop_ctx["index"] = i
            for sub in step.loop_steps:
                r = await self._execute_step(sub, loop_ctx)
                results.append(r.model_dump())
                if r.ok and r.output is not None:
                    loop_ctx["result"] = r.output
        return results

    def run_history(self, *, workflow_id: str | None = None, limit: int = 50) -> list[WorkflowRunResult]:
        with self._lock:
            runs = list(self._history)
        if workflow_id:
            runs = [r for r in runs if r.workflow_id == workflow_id]
        return list(reversed(runs))[:limit]

    def stats(self) -> dict[str, Any]:
        with self._lock:
            total = len(self._workflows)
            by_trigger: dict[str, int] = {}
            for wf in self._workflows.values():
                by_trigger[wf.trigger.type] = by_trigger.get(wf.trigger.type, 0) + 1
            return {
                "total_workflows": total,
                "by_trigger": by_trigger,
                "total_runs": len(self._history),
                "successful_runs": sum(1 for r in self._history if r.ok),
                "failed_runs": sum(1 for r in self._history if not r.ok),
            }


_engine: WorkflowEngine | None = None


def get_workflow_engine() -> WorkflowEngine:
    global _engine
    if _engine is None:
        _engine = WorkflowEngine()
    return _engine


__all__ = [
    "WorkflowStep", "TriggerConfig", "WorkflowCreate", "WorkflowInfo",
    "StepResult", "WorkflowRunResult", "WorkflowEngine", "get_workflow_engine",
]

"""The Aetheris tool registry.

A *tool* is a named, JSON-schema-described async callable the model can invoke.
The registry is the single place tools are declared, so every surface — the
agent loop, the ``/v1/tools`` endpoint, the CLI, and the browser playground —
sees exactly the same toolbelt.

Tools are exported in the OpenAI ``tools`` array shape, which means Aetheris can
hand them to any OpenAI-compatible upstream unchanged, and can also execute them
itself when the upstream (or the mock provider) asks for a call.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from ..core.config import settings
from ..schemas.chat import ToolInvocation

ToolHandler = Callable[..., Awaitable[str] | str]


class ToolError(RuntimeError):
    """Raised when a tool fails in a way the model should see and recover from."""


@dataclass(frozen=True)
class Tool:
    """A single executable capability exposed to the model."""

    name: str
    description: str
    parameters: dict[str, Any]
    handler: ToolHandler
    # Tools flagged unsafe require an explicit opt-in setting to be enabled.
    requires_optin: bool = False
    optin_setting: str | None = None
    tags: tuple[str, ...] = field(default_factory=tuple)

    def to_openai(self) -> dict[str, Any]:
        """Render this tool in the OpenAI ``tools`` array shape."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    @property
    def enabled(self) -> bool:
        """Whether this tool is currently permitted by configuration."""
        if not self.requires_optin:
            return True
        if not self.optin_setting:
            return True
        return bool(getattr(settings, self.optin_setting, False))


_REGISTRY: dict[str, Tool] = {}


def register(
    name: str,
    description: str,
    parameters: dict[str, Any],
    *,
    requires_optin: bool = False,
    optin_setting: str | None = None,
    tags: tuple[str, ...] = (),
) -> Callable[[ToolHandler], ToolHandler]:
    """Decorator registering a function as an Aetheris tool."""

    def decorator(handler: ToolHandler) -> ToolHandler:
        _REGISTRY[name] = Tool(
            name=name,
            description=description,
            parameters=parameters,
            handler=handler,
            requires_optin=requires_optin,
            optin_setting=optin_setting,
            tags=tags,
        )
        return handler

    return decorator


def get_tool(name: str) -> Tool:
    """Look up a registered tool by name."""
    _ensure_loaded()
    if name not in _REGISTRY:
        known = ", ".join(sorted(_REGISTRY)) or "(none)"
        raise ToolError(f"Unknown tool '{name}'. Available tools: {known}")
    return _REGISTRY[name]


def all_tools(*, include_disabled: bool = False) -> list[Tool]:
    """Every registered tool, in registration order."""
    _ensure_loaded()
    tools = list(_REGISTRY.values())
    if include_disabled:
        return tools
    return [t for t in tools if t.enabled]


def toolbelt_schema(*, include_disabled: bool = False) -> list[dict[str, Any]]:
    """The toolbelt in the OpenAI ``tools`` array shape."""
    return [t.to_openai() for t in all_tools(include_disabled=include_disabled)]


async def execute(name: str, arguments: dict[str, Any] | str, *, step: int = 1) -> ToolInvocation:
    """Execute a tool by name and capture the result as a ``ToolInvocation``.

    Failures are captured, not raised: the agent loop feeds the error text back
    to the model so it can self-correct, which is the whole point of the loop.
    """
    started = time.perf_counter()

    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments) if arguments.strip() else {}
        except json.JSONDecodeError as exc:
            return ToolInvocation(
                step=step,
                tool=name,
                arguments={},
                ok=False,
                output="",
                error=f"Arguments were not valid JSON: {exc}",
                duration_ms=_elapsed_ms(started),
            )
    if not isinstance(arguments, dict):
        arguments = {}

    try:
        tool = get_tool(name)
    except ToolError as exc:
        return ToolInvocation(
            step=step, tool=name, arguments=arguments, ok=False,
            output="", error=str(exc), duration_ms=_elapsed_ms(started),
        )

    if not tool.enabled:
        return ToolInvocation(
            step=step, tool=name, arguments=arguments, ok=False, output="",
            error=(
                f"Tool '{name}' is disabled by configuration. Enable it with "
                f"AETHERIS_{(tool.optin_setting or '').upper()}=true."
            ),
            duration_ms=_elapsed_ms(started),
        )

    filtered = _filter_arguments(tool.handler, arguments)
    try:
        result = tool.handler(**filtered)
        if inspect.isawaitable(result):
            result = await result
        output = result if isinstance(result, str) else json.dumps(result, default=str)
        return ToolInvocation(
            step=step, tool=name, arguments=arguments, ok=True,
            output=output, duration_ms=_elapsed_ms(started),
        )
    except ToolError as exc:
        return ToolInvocation(
            step=step, tool=name, arguments=arguments, ok=False, output="",
            error=str(exc), duration_ms=_elapsed_ms(started),
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # defensive: a tool must never kill the request
        return ToolInvocation(
            step=step, tool=name, arguments=arguments, ok=False, output="",
            error=f"{type(exc).__name__}: {exc}", duration_ms=_elapsed_ms(started),
        )


def _filter_arguments(handler: ToolHandler, arguments: dict[str, Any]) -> dict[str, Any]:
    """Drop arguments the handler does not accept (models hallucinate kwargs)."""
    try:
        sig = inspect.signature(handler)
    except (TypeError, ValueError):  # pragma: no cover - builtins
        return arguments
    if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
        return arguments
    accepted = {
        name for name, p in sig.parameters.items()
        if p.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
    }
    return {k: v for k, v in arguments.items() if k in accepted}


def _elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


_loaded = False


def _ensure_loaded() -> None:
    """Import the built-in tool modules exactly once (registration by import)."""
    global _loaded
    if _loaded:
        return
    _loaded = True
    from . import builtins as _builtins  # noqa: F401
    from . import retrieval as _retrieval  # noqa: F401
    from . import sandbox as _sandbox  # noqa: F401
    from . import web as _web  # noqa: F401


__all__ = [
    "Tool",
    "ToolError",
    "register",
    "get_tool",
    "all_tools",
    "toolbelt_schema",
    "execute",
]

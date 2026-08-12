"""Command palette for Aetheris.

A registry of named commands — parameterised, reusable actions that can be
triggered via the API or keyboard shortcuts. Commands encapsulate common
workflows into single invocations.

Example commands:
* ``new-chat`` — Create a new conversation with a given mode
* ``run-workflow`` — Execute a workflow by name with inputs
* ``load-preset`` — Apply a preset to the current session
* ``clear-cache`` — Clear the response cache
* ``export-all`` — Export all data as a bundle
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


class CommandCreate(BaseModel):
    """Register a new command."""
    name: str = Field(..., min_length=1, max_length=64, description="Command name (unique).")
    description: str = Field(default="", max_length=500)
    category: str = Field(default="general", max_length=64, description="Category for grouping.")
    shortcut: str = Field(default="", max_length=32, description="Keyboard shortcut (e.g. 'ctrl+shift+n').")
    parameters: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Parameter definitions: [{name: 'mode', type: 'string', default: 'general', required: true}].",
    )
    action_type: str = Field(default="internal", description="Action type: internal, workflow, api_call.")
    action_ref: str = Field(default="", max_length=256, description="Reference: function name, workflow ID, or API path.")
    icon: str = Field(default="", max_length=64, description="Icon identifier for UI.")


class CommandInfo(BaseModel):
    id: str
    name: str
    description: str
    category: str
    shortcut: str
    parameters: list[dict[str, Any]]
    action_type: str
    action_ref: str
    icon: str
    created_at: float
    invocation_count: int
    is_builtin: bool


class CommandInvoke(BaseModel):
    """Invoke a command."""
    params: dict[str, Any] = Field(default_factory=dict, description="Parameter values.")


class CommandResult(BaseModel):
    command_id: str
    command_name: str
    status: str
    result: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    duration_ms: float = 0.0


# --- Internal -----------------------------------------------------------------

@dataclass
class _Command:
    id: str
    name: str
    description: str
    category: str
    shortcut: str
    parameters: list[dict[str, Any]]
    action_type: str
    action_ref: str
    icon: str
    created_at: float
    invocation_count: int = 0
    is_builtin: bool = False

    def to_info(self) -> CommandInfo:
        return CommandInfo(
            id=self.id, name=self.name, description=self.description,
            category=self.category, shortcut=self.shortcut,
            parameters=self.parameters, action_type=self.action_type,
            action_ref=self.action_ref, icon=self.icon,
            created_at=self.created_at, invocation_count=self.invocation_count,
            is_builtin=self.is_builtin,
        )


# --- Built-in executors -------------------------------------------------------

def _exec_new_chat(params: dict[str, Any]) -> dict[str, Any]:
    from .conversations import get_conversation_store, ConversationCreate
    store = get_conversation_store()
    conv = store.create(ConversationCreate(
        title=params.get("title", ""), mode=params.get("mode", "general"),
        model=params.get("model", ""),
    ))
    return {"id": conv.id, "title": conv.title, "mode": conv.mode}


def _exec_clear_cache(params: dict[str, Any]) -> dict[str, Any]:
    from .caching import get_response_cache
    cache = get_response_cache()
    count = cache.clear()
    return {"cleared_entries": count}


def _exec_load_defaults(params: dict[str, Any]) -> dict[str, Any]:
    from .prompts_library import get_prompt_library
    lib = get_prompt_library()
    count = lib.load_defaults()
    return {"loaded": count}


def _exec_export_all(params: dict[str, Any]) -> dict[str, Any]:
    from .export_import import export_bundle, ExportRequest
    result = export_bundle(ExportRequest(include_workflows=True, include_prompts=True))
    return {"export_id": result.id, "components": result.components}


_EXECUTORS = {
    "new-chat": _exec_new_chat,
    "clear-cache": _exec_clear_cache,
    "load-defaults": _exec_load_defaults,
    "export-all": _exec_export_all,
}


# --- Manager ------------------------------------------------------------------

class CommandManager:
    """Thread-safe command palette manager."""

    def __init__(self, max_commands: int = 200) -> None:
        self._commands: dict[str, _Command] = {}
        self._lock = Lock()
        self._max = max_commands

    def create(self, body: CommandCreate) -> _Command:
        with self._lock:
            if len(self._commands) >= self._max:
                raise ValueError(f"Maximum of {self._max} commands reached.")
            for c in self._commands.values():
                if c.name == body.name and not c.is_builtin:
                    raise ValueError(f"Command '{body.name}' already exists.")
            cmd = _Command(
                id=f"cmd_{uuid.uuid4().hex[:8]}",
                name=body.name, description=body.description,
                category=body.category, shortcut=body.shortcut,
                parameters=body.parameters, action_type=body.action_type,
                action_ref=body.action_ref, icon=body.icon,
                created_at=time.time(),
            )
            self._commands[cmd.id] = cmd
        return cmd

    def get(self, cmd_id: str) -> _Command | None:
        with self._lock:
            return self._commands.get(cmd_id)

    def get_by_name(self, name: str) -> _Command | None:
        with self._lock:
            for c in self._commands.values():
                if c.name == name:
                    return c
        return None

    def delete(self, cmd_id: str) -> bool:
        with self._lock:
            c = self._commands.get(cmd_id)
            if c is None:
                return False
            if c.is_builtin:
                raise ValueError("Cannot delete built-in commands.")
            del self._commands[cmd_id]
            return True

    def list_commands(self, *, category: str | None = None) -> list[_Command]:
        with self._lock:
            cmds = list(self._commands.values())
        if category:
            cmds = [c for c in cmds if c.category == category]
        return sorted(cmds, key=lambda c: (c.category, c.name))

    def invoke(self, cmd_id: str, params: dict[str, Any] | None = None) -> CommandResult:
        """Invoke a command by ID."""
        cmd = self.get(cmd_id)
        if cmd is None:
            return CommandResult(command_id=cmd_id, command_name="", status="error", error="Command not found.")
        start = time.time()
        executor = _EXECUTORS.get(cmd.name)
        if executor is None:
            return CommandResult(command_id=cmd_id, command_name=cmd.name, status="error", error=f"No executor for command '{cmd.name}'.")
        try:
            result = executor(params or {})
            duration = (time.time() - start) * 1000
            with self._lock:
                cmd.invocation_count += 1
            return CommandResult(command_id=cmd_id, command_name=cmd.name, status="success", result=result, duration_ms=round(duration, 2))
        except Exception as exc:
            duration = (time.time() - start) * 1000
            return CommandResult(command_id=cmd_id, command_name=cmd.name, status="error", error=str(exc)[:500], duration_ms=round(duration, 2))

    def load_defaults(self) -> int:
        """Load built-in default commands."""
        defaults = [
            CommandCreate(name="new-chat", description="Create a new conversation.", category="chat", shortcut="ctrl+n", action_type="internal", icon="plus"),
            CommandCreate(name="clear-cache", description="Clear the response cache.", category="system", shortcut="ctrl+shift+c", action_type="internal", icon="trash"),
            CommandCreate(name="load-defaults", description="Load default prompt templates.", category="prompts", action_type="internal", icon="download"),
            CommandCreate(name="export-all", description="Export all data.", category="system", shortcut="ctrl+shift+e", action_type="internal", icon="upload"),
        ]
        count = 0
        with self._lock:
            existing = {c.name for c in self._commands.values() if c.is_builtin}
        for d in defaults:
            if d.name not in existing:
                now = time.time()
                cmd = _Command(
                    id=f"cmd_builtin_{d.name}", name=d.name, description=d.description,
                    category=d.category, shortcut=d.shortcut, parameters=d.parameters,
                    action_type=d.action_type, action_ref=d.action_ref, icon=d.icon,
                    created_at=now, is_builtin=True,
                )
                with self._lock:
                    self._commands[cmd.id] = cmd
                count += 1
        return count

    def stats(self) -> dict[str, Any]:
        with self._lock:
            by_category: dict[str, int] = {}
            for c in self._commands.values():
                by_category[c.category] = by_category.get(c.category, 0) + 1
            return {
                "total": len(self._commands),
                "builtin": sum(1 for c in self._commands.values() if c.is_builtin),
                "by_category": by_category,
            }


_manager: CommandManager | None = None


def get_command_manager() -> CommandManager:
    global _manager
    if _manager is None:
        _manager = CommandManager()
    return _manager


__all__ = ["CommandManager", "CommandCreate", "CommandInfo", "CommandInvoke", "CommandResult", "get_command_manager"]

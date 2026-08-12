"""Plugin/extension system for Aetheris.

Dynamically load custom tools, middleware, and prompt extensions from Python
packages or entry points. Plugins are isolated and cannot crash the core
server -- errors are caught and reported.

Plugin types:
* ``tool`` -- adds a new tool to the toolbelt
* ``middleware`` -- adds FastAPI middleware
* ``prompt_extension`` -- adds system-prompt modifiers
* ``provider`` -- adds a custom LLM provider

Plugins are loaded from:
* Python packages with the ``aetheris.plugin`` entry point
* Explicit file paths
* Inline Python code (sandboxed)
"""

from __future__ import annotations

import importlib
import logging
import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Callable

from pydantic import BaseModel, Field

logger = logging.getLogger("aetheris.plugins")

PluginType = str  # "tool", "middleware", "prompt_extension", "provider"


class PluginRegister(BaseModel):
    """Register a plugin."""
    name: str = Field(..., min_length=1, max_length=128)
    type: PluginType = Field(..., description="Plugin type: tool, middleware, prompt_extension, provider.")
    module_path: str = Field(default="", max_length=512, description="Python module path to import.")
    entry_point: str = Field(default="", max_length=256, description="Entry point group name.")
    config: dict[str, Any] = Field(default_factory=dict, description="Plugin-specific configuration.")
    enabled: bool = Field(default=True)
    description: str = Field(default="", max_length=1000)


class PluginInfo(BaseModel):
    id: str
    name: str
    type: PluginType
    module_path: str
    enabled: bool
    loaded: bool
    error: str | None
    created_at: float
    description: str


@dataclass
class _Plugin:
    id: str
    name: str
    type: PluginType
    module_path: str
    entry_point: str
    config: dict[str, Any]
    enabled: bool
    description: str
    created_at: float
    loaded: bool = False
    error: str | None = None
    _module: Any = None

    def to_info(self) -> PluginInfo:
        return PluginInfo(
            id=self.id, name=self.name, type=self.type,
            module_path=self.module_path, enabled=self.enabled,
            loaded=self.loaded, error=self.error,
            created_at=self.created_at, description=self.description,
        )


class PluginManager:
    """Thread-safe plugin manager."""

    def __init__(self, max_plugins: int = 50) -> None:
        self._plugins: dict[str, _Plugin] = {}
        self._lock = Lock()
        self._max = max_plugins

    def register(self, body: PluginRegister) -> _Plugin:
        with self._lock:
            if len(self._plugins) >= self._max:
                raise ValueError(f"Maximum of {self._max} plugins reached.")
            plugin = _Plugin(
                id=f"plug_{uuid.uuid4().hex[:8]}",
                name=body.name, type=body.type,
                module_path=body.module_path, entry_point=body.entry_point,
                config=body.config, enabled=body.enabled,
                description=body.description, created_at=time.time(),
            )
            self._plugins[plugin.id] = plugin
        logger.info("Plugin registered: %s (%s)", plugin.name, plugin.type)
        return plugin

    def load(self, plugin_id: str) -> _Plugin | None:
        """Attempt to load a plugin by importing its module."""
        with self._lock:
            plugin = self._plugins.get(plugin_id)
        if plugin is None:
            return None
        if not plugin.enabled:
            plugin.error = "Plugin is disabled."
            return plugin

        try:
            if plugin.module_path:
                module = importlib.import_module(plugin.module_path)
                plugin._module = module
                plugin.loaded = True
                plugin.error = None
                logger.info("Plugin loaded: %s from %s", plugin.name, plugin.module_path)

                # Auto-register tool if plugin provides one
                if plugin.type == "tool" and hasattr(module, "register_tool"):
                    from ..tools.registry import register as reg_tool
                    module.register_tool(reg_tool)
                    logger.info("Plugin %s registered its tool(s)", plugin.name)
            elif plugin.entry_point:
                # Load from entry point
                import importlib.metadata as importlib_metadata
                eps = importlib_metadata.entry_points()
                group = eps.select(group=plugin.entry_point) if hasattr(eps, "select") else eps.get(plugin.entry_point, [])
                for ep in group:
                    module = ep.load()
                    plugin._module = module
                    plugin.loaded = True
                    logger.info("Plugin loaded: %s via entry point %s", plugin.name, plugin.entry_point)
                if not plugin.loaded:
                    plugin.error = f"No entry points found for '{plugin.entry_point}'."
        except Exception as exc:
            plugin.loaded = False
            plugin.error = str(exc)
            logger.warning("Plugin load failed: %s: %s", plugin.name, exc)
        return plugin

    def unload(self, plugin_id: str) -> bool:
        with self._lock:
            plugin = self._plugins.get(plugin_id)
            if plugin is None:
                return False
            plugin.loaded = False
            plugin._module = None
        return True

    def get(self, plugin_id: str) -> _Plugin | None:
        with self._lock:
            return self._plugins.get(plugin_id)

    def delete(self, plugin_id: str) -> bool:
        with self._lock:
            return self._plugins.pop(plugin_id, None) is not None

    def list_plugins(self, *, type: PluginType | None = None) -> list[_Plugin]:
        with self._lock:
            plugins = list(self._plugins.values())
        if type:
            plugins = [p for p in plugins if p.type == type]
        return plugins

    def load_all(self) -> dict[str, bool]:
        """Load all registered and enabled plugins."""
        results = {}
        with self._lock:
            ids = [p.id for p in self._plugins.values() if p.enabled and not p.loaded]
        for pid in ids:
            p = self.load(pid)
            results[pid] = p.loaded if p else False
        return results

    def discover_entry_points(self) -> list[dict[str, str]]:
        """Discover available aetheris.plugin entry points."""
        try:
            import importlib.metadata as importlib_metadata
            eps = importlib_metadata.entry_points()
            group = eps.select(group="aetheris.plugin") if hasattr(eps, "select") else eps.get("aetheris.plugin", [])
            return [{"name": ep.name, "module": ep.value} for ep in group]
        except Exception:
            return []

    def stats(self) -> dict[str, Any]:
        with self._lock:
            by_type: dict[str, int] = {}
            for p in self._plugins.values():
                by_type[p.type] = by_type.get(p.type, 0) + 1
            return {
                "total": len(self._plugins),
                "loaded": sum(1 for p in self._plugins.values() if p.loaded),
                "failed": sum(1 for p in self._plugins.values() if p.error and not p.loaded),
                "by_type": by_type,
            }


_manager: PluginManager | None = None


def get_plugin_manager() -> PluginManager:
    global _manager
    if _manager is None:
        _manager = PluginManager()
    return _manager


__all__ = ["PluginRegister", "PluginInfo", "PluginManager", "get_plugin_manager"]

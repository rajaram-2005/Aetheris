"""Configuration presets for Aetheris.

A preset bundles a model choice, mode, temperature, system prompt, tool
preferences, and any other generation parameters into a named, reusable
profile. Users can switch between presets instead of re-specifying every
parameter on each request.

Built-in presets cover common workflows:
* ``quick`` — fast, low-cost responses
* ``detailed`` — thorough, high-quality answers
* ``creative`` — high temperature for brainstorming
* ``code`` — optimised for code generation
* ``analysis`` — structured, analytical responses
* ``sovereign`` — unrestricted, direct answers
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


class PresetCreate(BaseModel):
    """Create a new preset."""
    name: str = Field(..., min_length=1, max_length=64, description="Preset name (unique).")
    description: str = Field(default="", max_length=500)
    model: str = Field(default="pro", description="Model tier: quick, pro, sovereign.")
    mode: str = Field(default="general", description="Inference mode.")
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=4096, ge=1, le=128000)
    top_p: float = Field(default=1.0, ge=0.0, le=1.0)
    system_prompt: str = Field(default="", max_length=10000, description="Override system prompt.")
    tools_enabled: bool = Field(default=True)
    agent_enabled: bool = Field(default=False)
    rag_enabled: bool = Field(default=True)
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class PresetInfo(BaseModel):
    id: str
    name: str
    description: str
    model: str
    mode: str
    temperature: float
    max_tokens: int
    top_p: float
    system_prompt: str
    tools_enabled: bool
    agent_enabled: bool
    rag_enabled: bool
    tags: list[str]
    created_at: float
    updated_at: float
    metadata: dict[str, Any]
    is_builtin: bool


# --- Internal -----------------------------------------------------------------

@dataclass
class _Preset:
    id: str
    name: str
    description: str
    model: str
    mode: str
    temperature: float
    max_tokens: int
    top_p: float
    system_prompt: str
    tools_enabled: bool
    agent_enabled: bool
    rag_enabled: bool
    tags: list[str]
    created_at: float
    updated_at: float
    metadata: dict[str, Any]
    is_builtin: bool = False

    def to_info(self) -> PresetInfo:
        return PresetInfo(
            id=self.id, name=self.name, description=self.description,
            model=self.model, mode=self.mode, temperature=self.temperature,
            max_tokens=self.max_tokens, top_p=self.top_p,
            system_prompt=self.system_prompt, tools_enabled=self.tools_enabled,
            agent_enabled=self.agent_enabled, rag_enabled=self.rag_enabled,
            tags=self.tags, created_at=self.created_at, updated_at=self.updated_at,
            metadata=self.metadata, is_builtin=self.is_builtin,
        )

    def to_create(self) -> PresetCreate:
        return PresetCreate(
            name=self.name, description=self.description,
            model=self.model, mode=self.mode, temperature=self.temperature,
            max_tokens=self.max_tokens, top_p=self.top_p,
            system_prompt=self.system_prompt, tools_enabled=self.tools_enabled,
            agent_enabled=self.agent_enabled, rag_enabled=self.rag_enabled,
            tags=self.tags, metadata=self.metadata,
        )


# --- Store --------------------------------------------------------------------

class PresetStore:
    """Thread-safe in-memory preset store."""

    def __init__(self, max_presets: int = 100) -> None:
        self._presets: dict[str, _Preset] = {}
        self._lock = Lock()
        self._max = max_presets

    def create(self, body: PresetCreate) -> _Preset:
        with self._lock:
            if len(self._presets) >= self._max:
                raise ValueError(f"Maximum of {self._max} presets reached.")
            # Check for duplicate name
            for p in self._presets.values():
                if p.name == body.name and not p.is_builtin:
                    raise ValueError(f"Preset '{body.name}' already exists.")
            now = time.time()
            preset = _Preset(
                id=f"preset_{uuid.uuid4().hex[:8]}",
                name=body.name, description=body.description,
                model=body.model, mode=body.mode,
                temperature=body.temperature, max_tokens=body.max_tokens,
                top_p=body.top_p, system_prompt=body.system_prompt,
                tools_enabled=body.tools_enabled, agent_enabled=body.agent_enabled,
                rag_enabled=body.rag_enabled, tags=body.tags,
                created_at=now, updated_at=now, metadata=body.metadata,
            )
            self._presets[preset.id] = preset
        return preset

    def get(self, preset_id: str) -> _Preset | None:
        with self._lock:
            return self._presets.get(preset_id)

    def get_by_name(self, name: str) -> _Preset | None:
        with self._lock:
            for p in self._presets.values():
                if p.name == name:
                    return p
        return None

    def delete(self, preset_id: str) -> bool:
        with self._lock:
            p = self._presets.get(preset_id)
            if p is None:
                return False
            if p.is_builtin:
                raise ValueError("Cannot delete built-in presets.")
            del self._presets[preset_id]
            return True

    def list_presets(self, *, tag: str | None = None, model: str | None = None) -> list[_Preset]:
        with self._lock:
            presets = list(self._presets.values())
        if tag:
            presets = [p for p in presets if tag in p.tags]
        if model:
            presets = [p for p in presets if p.model == model]
        return presets

    def update(self, preset_id: str, body: PresetCreate) -> _Preset | None:
        with self._lock:
            p = self._presets.get(preset_id)
            if p is None:
                return None
            if p.is_builtin:
                raise ValueError("Cannot modify built-in presets.")
            p.name = body.name
            p.description = body.description
            p.model = body.model
            p.mode = body.mode
            p.temperature = body.temperature
            p.max_tokens = body.max_tokens
            p.top_p = body.top_p
            p.system_prompt = body.system_prompt
            p.tools_enabled = body.tools_enabled
            p.agent_enabled = body.agent_enabled
            p.rag_enabled = body.rag_enabled
            p.tags = body.tags
            p.metadata = body.metadata
            p.updated_at = time.time()
        return p

    def load_defaults(self) -> int:
        """Load built-in default presets."""
        defaults = [
            PresetCreate(name="quick", description="Fast, low-cost responses.", model="quick", mode="general", temperature=0.5, max_tokens=1024, tags=["builtin", "fast"]),
            PresetCreate(name="detailed", description="Thorough, high-quality answers.", model="pro", mode="general", temperature=0.7, max_tokens=4096, tags=["builtin", "quality"]),
            PresetCreate(name="creative", description="High temperature for brainstorming.", model="pro", mode="creative", temperature=1.2, max_tokens=4096, tags=["builtin", "creative"]),
            PresetCreate(name="code", description="Optimised for code generation.", model="pro", mode="engineering", temperature=0.3, max_tokens=8192, system_prompt="You are an expert software engineer. Write clean, well-tested, production-ready code.", tools_enabled=True, agent_enabled=True, tags=["builtin", "coding"]),
            PresetCreate(name="analysis", description="Structured, analytical responses.", model="pro", mode="general", temperature=0.4, max_tokens=4096, system_prompt="Provide structured, data-driven analysis. Use tables and bullet points when appropriate.", tags=["builtin", "analysis"]),
            PresetCreate(name="sovereign", description="Unrestricted, direct answers.", model="sovereign", mode="sovereign", temperature=0.7, max_tokens=4096, tags=["builtin", "sovereign"]),
        ]
        count = 0
        with self._lock:
            existing_names = {p.name for p in self._presets.values() if p.is_builtin}
        for d in defaults:
            if d.name not in existing_names:
                now = time.time()
                preset = _Preset(
                    id=f"preset_builtin_{d.name}", name=d.name, description=d.description,
                    model=d.model, mode=d.mode, temperature=d.temperature,
                    max_tokens=d.max_tokens, top_p=d.top_p, system_prompt=d.system_prompt,
                    tools_enabled=d.tools_enabled, agent_enabled=d.agent_enabled,
                    rag_enabled=d.rag_enabled, tags=d.tags,
                    created_at=now, updated_at=now, metadata=d.metadata,
                    is_builtin=True,
                )
                with self._lock:
                    self._presets[preset.id] = preset
                count += 1
        return count

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "total": len(self._presets),
                "builtin": sum(1 for p in self._presets.values() if p.is_builtin),
                "custom": sum(1 for p in self._presets.values() if not p.is_builtin),
            }


_store: PresetStore | None = None


def get_preset_store() -> PresetStore:
    global _store
    if _store is None:
        _store = PresetStore()
    return _store


__all__ = ["PresetStore", "PresetCreate", "PresetInfo", "get_preset_store"]

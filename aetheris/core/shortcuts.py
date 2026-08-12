"""Keyboard shortcut registry and custom keybinding profiles.

Aetheris ships a default command palette (see ``commands.py``). This module
manages the keyboard accelerators that trigger those commands. Users can
create named binding profiles (e.g. "vim", "emacs", "default") that override
defaults on a per-client basis.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


# --- Schemas -----------------------------------------------------------------

class ShortcutBinding(BaseModel):
    command: str = Field(default="", max_length=128, description="Command name to invoke (empty = no-op / context key).")
    keys: str = Field(..., min_length=1, max_length=64, description="Key combo e.g. 'ctrl+k'.")
    when: str = Field(default="always", max_length=64, description="Context: always|editor|chat|canvas.")
    description: str = Field(default="", max_length=300)


class ProfileCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    description: str = Field(default="", max_length=300)
    bindings: list[ShortcutBinding] = Field(default_factory=list)
    is_builtin: bool = False


class ProfileInfo(BaseModel):
    id: str
    name: str
    description: str
    binding_count: int
    is_builtin: bool
    created_at: float


class ProfileDetail(ProfileInfo):
    bindings: list[ShortcutBinding]


class ShortcutResolveResult(BaseModel):
    command: str | None = None
    description: str = ""
    profile: str = ""
    keys: str = ""
    found: bool = False


# --- Internal dataclass ------------------------------------------------------

@dataclass
class _Profile:
    id: str
    name: str
    description: str
    is_builtin: bool
    created_at: float
    bindings: dict[str, ShortcutBinding] = field(default_factory=dict)  # keyed by keys


# --- Manager -----------------------------------------------------------------

class ShortcutManager:
    """Thread-safe shortcut registry with profiles."""

    _DEFAULT_BINDINGS: list[tuple[str, str, str, str]] = [
        ("new-chat", "ctrl+n", "always", "Start a new conversation."),
        ("toggle-theme", "ctrl+shift+l", "always", "Toggle light/dark theme."),
        ("command-palette", "ctrl+k", "always", "Open command palette."),
        ("search", "ctrl+/", "always", "Global search."),
        ("clear-cache", "ctrl+shift+c", "always", "Clear response cache."),
        ("export-all", "ctrl+shift+e", "always", "Export all data."),
        ("focus-chat", "ctrl+shift+p", "chat", "Focus chat input."),
        ("send-message", "ctrl+enter", "editor", "Send message (in editor)."),
        ("new-line", "shift+enter", "editor", "Insert newline."),
        ("undo", "ctrl+z", "editor", "Undo last edit."),
        ("redo", "ctrl+shift+z", "editor", "Redo last edit."),
        ("save-draft", "ctrl+s", "editor", "Save current draft."),
        ("toggle-canvas", "ctrl+shift+o", "canvas", "Toggle canvas panel."),
    ]

    def __init__(self, max_profiles: int = 50) -> None:
        self._lock = Lock()
        self._profiles: dict[str, _Profile] = {}
        self._active_profile: str = ""
        self._max = max_profiles
        self._create_builtin_defaults()

    def _create_builtin_defaults(self) -> None:
        now = time.time()
        default = _Profile(id="profile_default", name="default", description="Aetheris default keybindings.",
                           is_builtin=True, created_at=now)
        for cmd, keys, when, desc in self._DEFAULT_BINDINGS:
            default.bindings[keys] = ShortcutBinding(command=cmd, keys=keys, when=when, description=desc)
        self._profiles[default.id] = default
        self._active_profile = default.id

        # vim-lite profile
        vim = _Profile(id="profile_vim", name="vim", description="Vim-inspired keybindings.",
                       is_builtin=True, created_at=now)
        for cmd, keys, when, desc in self._DEFAULT_BINDINGS:
            if keys in ("ctrl+z", "ctrl+shift+z"):
                continue
            vim.bindings[keys] = ShortcutBinding(command=cmd, keys=keys, when=when, description=desc)
        vim.bindings[":"] = ShortcutBinding(command="command-palette", keys=":", when="always", description="Open command palette (vim colon).")
        vim.bindings["i"] = ShortcutBinding(command="focus-chat", keys="i", when="always", description="Enter insert mode / focus chat.")
        vim.bindings["esc"] = ShortcutBinding(command="", keys="esc", when="editor", description="Exit insert mode.")
        self._profiles[vim.id] = vim

    # --- profiles -----------------------------------------------------------
    def create_profile(self, body: ProfileCreate) -> _Profile:
        with self._lock:
            if len(self._profiles) >= self._max:
                raise ValueError(f"Maximum of {self._max} profiles reached.")
            for p in self._profiles.values():
                if p.name == body.name:
                    raise ValueError(f"Profile '{body.name}' already exists.")
            pid = f"profile_{uuid.uuid4().hex[:8]}"
            prof = _Profile(id=pid, name=body.name, description=body.description,
                            is_builtin=body.is_builtin, created_at=time.time())
            for b in body.bindings:
                prof.bindings[b.keys] = b
            self._profiles[pid] = prof
            return prof

    def get(self, pid: str) -> _Profile | None:
        with self._lock:
            return self._profiles.get(pid)

    def get_by_name(self, name: str) -> _Profile | None:
        with self._lock:
            for p in self._profiles.values():
                if p.name == name:
                    return p
        return None

    def delete_profile(self, pid: str) -> bool:
        with self._lock:
            p = self._profiles.get(pid)
            if p is None:
                return False
            if p.is_builtin:
                raise ValueError("Cannot delete builtin profiles.")
            del self._profiles[pid]
            if self._active_profile == pid:
                self._active_profile = "profile_default"
            return True

    def set_active(self, pid_or_name: str) -> _Profile:
        with self._lock:
            p = self._profiles.get(pid_or_name)
            if p is None:
                for q in self._profiles.values():
                    if q.name == pid_or_name:
                        p = q
                        break
            if p is None:
                raise ValueError(f"No profile '{pid_or_name}'.")
            self._active_profile = p.id
            return p

    def list_profiles(self) -> list[_Profile]:
        with self._lock:
            return sorted(self._profiles.values(), key=lambda p: (not p.is_builtin, p.name))

    # --- bindings -----------------------------------------------------------
    def bind(self, pid: str, binding: ShortcutBinding) -> _Profile:
        with self._lock:
            p = self._profiles.get(pid)
            if p is None:
                raise ValueError(f"No profile '{pid}'.")
            if p.is_builtin:
                raise ValueError("Cannot modify builtin profiles. Clone them first.")
            p.bindings[binding.keys] = binding
            return p

    def unbind(self, pid: str, keys: str) -> bool:
        with self._lock:
            p = self._profiles.get(pid)
            if p is None:
                return False
            if p.is_builtin:
                raise ValueError("Cannot modify builtin profiles.")
            return p.bindings.pop(keys, None) is not None

    def resolve(self, keys: str, *, when: str = "always", profile: str | None = None) -> ShortcutResolveResult:
        with self._lock:
            pid = profile or self._active_profile
            p = self._profiles.get(pid) or self._profiles.get(self._active_profile)
            if p is None:
                return ShortcutResolveResult()
            b = p.bindings.get(keys)
            if b is None:
                return ShortcutResolveResult(found=False, profile=p.name, keys=keys)
            if b.when != "always" and b.when != when:
                return ShortcutResolveResult(found=False, profile=p.name, keys=keys)
            return ShortcutResolveResult(
                command=b.command, description=b.description,
                profile=p.name, keys=keys, found=bool(b.command),
            )

    def clone(self, source_pid: str, new_name: str) -> _Profile:
        with self._lock:
            src = self._profiles.get(source_pid)
            if src is None:
                raise ValueError(f"No profile '{source_pid}'.")
        return self.create_profile(ProfileCreate(
            name=new_name, description=f"Clone of {src.name}",
            bindings=list(src.bindings.values()), is_builtin=False,
        ))

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "profiles": len(self._profiles),
                "active_profile": self._active_profile,
                "total_bindings": sum(len(p.bindings) for p in self._profiles.values()),
                "builtin": sum(1 for p in self._profiles.values() if p.is_builtin),
            }


def _profile_info(p: _Profile) -> ProfileInfo:
    return ProfileInfo(
        id=p.id, name=p.name, description=p.description,
        binding_count=len(p.bindings), is_builtin=p.is_builtin, created_at=p.created_at,
    )


def _profile_detail(p: _Profile) -> ProfileDetail:
    return ProfileDetail(
        id=p.id, name=p.name, description=p.description,
        binding_count=len(p.bindings), is_builtin=p.is_builtin, created_at=p.created_at,
        bindings=list(p.bindings.values()),
    )


_manager: ShortcutManager | None = None


def get_shortcut_manager() -> ShortcutManager:
    global _manager
    if _manager is None:
        _manager = ShortcutManager()
    return _manager


__all__ = [
    "ShortcutManager", "ShortcutBinding", "ProfileCreate", "ProfileInfo", "ProfileDetail",
    "ShortcutResolveResult", "get_shortcut_manager", "_profile_info", "_profile_detail",
]

"""Version snapshots with diff and rollback for Aetheris.

Allows users to create snapshots (checkpoints) of conversations and prompt
templates at any point. Snapshots capture the full state and can be compared
with a diff view or rolled back to restore a previous state.

This is useful for:
* Saving a good prompt version before iterating
* Checkpointing a conversation before a risky tool call
* Comparing what changed between two points
* Reverting accidental edits
"""

from __future__ import annotations

import copy
import difflib
import time
import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Any, Literal

from pydantic import BaseModel, Field

SnapshotTarget = Literal["conversation", "prompt"]


class SnapshotCreate(BaseModel):
    """Create a snapshot."""
    target_type: SnapshotTarget = Field(..., description="Type of entity to snapshot.")
    target_id: str = Field(..., min_length=1, description="ID of the entity.")
    label: str = Field(default="", max_length=128, description="Optional label for this snapshot.")
    description: str = Field(default="", max_length=500)


class SnapshotInfo(BaseModel):
    id: str
    target_type: str
    target_id: str
    label: str
    description: str
    created_at: float
    state_size: int = Field(description="Size of the captured state (number of items).")


class SnapshotDiff(BaseModel):
    """Diff between two snapshots."""
    snapshot_a_id: str
    snapshot_b_id: str
    target_type: str
    target_id: str
    added: list[str] = Field(description="Lines/content added in B vs A.")
    removed: list[str] = Field(description="Lines/content removed in B vs A.")
    summary: str = Field(description="Human-readable summary.")


# --- Internal -----------------------------------------------------------------

@dataclass
class _Snapshot:
    id: str
    target_type: str
    target_id: str
    label: str
    description: str
    created_at: float
    state: Any  # The captured state

    def to_info(self) -> SnapshotInfo:
        # Estimate state size
        if isinstance(self.state, dict):
            size = len(self.state)
        elif isinstance(self.state, list):
            size = len(self.state)
        else:
            size = 1
        return SnapshotInfo(
            id=self.id, target_type=self.target_type, target_id=self.target_id,
            label=self.label, description=self.description,
            created_at=self.created_at, state_size=size,
        )


def _capture_conversation_state(target_id: str) -> dict[str, Any] | None:
    """Capture the current state of a conversation."""
    from .conversations import get_conversation_store
    store = get_conversation_store()
    conv = store.get(target_id)
    if conv is None:
        return None
    return {
        "title": conv.title,
        "mode": conv.mode,
        "tags": list(conv.tags),
        "metadata": dict(conv.metadata),
        "messages": [
            {"role": m.role, "content": m.content, "timestamp": m.timestamp}
            for m in conv.messages
        ],
    }


def _capture_prompt_state(target_id: str) -> dict[str, Any] | None:
    """Capture the current state of a prompt template."""
    from .prompts_library import get_prompt_library
    lib = get_prompt_library()
    tpl = lib.get(target_id)
    if tpl is None:
        return None
    return {
        "name": tpl.name,
        "category": tpl.category,
        "template": tpl.template,
        "variables": list(tpl.variables),
        "description": tpl.description,
        "tags": list(tpl.tags),
        "version": tpl.version,
        "metadata": dict(tpl.metadata),
    }


def _restore_conversation_state(target_id: str, state: dict[str, Any]) -> bool:
    """Restore a conversation from a captured state."""
    from .conversations import get_conversation_store
    store = get_conversation_store()
    conv = store.get(target_id)
    if conv is None:
        return False
    conv.title = state.get("title", conv.title)
    conv.mode = state.get("mode", conv.mode)
    conv.tags = state.get("tags", conv.tags)
    conv.metadata = state.get("metadata", conv.metadata)
    # Restore messages
    from .conversations import MessageIn
    conv.messages.clear()
    for m in state.get("messages", []):
        store.append(target_id, MessageIn(role=m["role"], content=m["content"]))
    return True


def _restore_prompt_state(target_id: str, state: dict[str, Any]) -> bool:
    """Restore a prompt template from a captured state."""
    from .prompts_library import get_prompt_library
    lib = get_prompt_library()
    tpl = lib.get(target_id)
    if tpl is None:
        return False
    tpl.name = state.get("name", tpl.name)
    tpl.category = state.get("category", tpl.category)
    tpl.template = state.get("template", tpl.template)
    tpl.variables = state.get("variables", tpl.variables)
    tpl.description = state.get("description", tpl.description)
    tpl.tags = state.get("tags", tpl.tags)
    tpl.version = state.get("version", tpl.version)
    tpl.metadata = state.get("metadata", tpl.metadata)
    return True


_CAPTURERS = {
    "conversation": _capture_conversation_state,
    "prompt": _capture_prompt_state,
}

_RESTORERS = {
    "conversation": _restore_conversation_state,
    "prompt": _restore_prompt_state,
}


# --- Manager ------------------------------------------------------------------

class SnapshotManager:
    """Thread-safe snapshot manager."""

    def __init__(self, max_snapshots: int = 500) -> None:
        self._snapshots: dict[str, _Snapshot] = {}
        self._lock = Lock()
        self._max = max_snapshots

    def create(self, body: SnapshotCreate) -> _Snapshot:
        """Create a snapshot of the current state."""
        capturer = _CAPTURERS.get(body.target_type)
        if capturer is None:
            raise ValueError(f"Unsupported target type: {body.target_type}")
        state = capturer(body.target_id)
        if state is None:
            raise ValueError(f"Target {body.target_type} '{body.target_id}' not found.")
        with self._lock:
            if len(self._snapshots) >= self._max:
                raise ValueError(f"Maximum of {self._max} snapshots reached.")
            snap = _Snapshot(
                id=f"snap_{uuid.uuid4().hex[:8]}",
                target_type=body.target_type, target_id=body.target_id,
                label=body.label or f"Snapshot {time.strftime('%Y-%m-%d %H:%M')}",
                description=body.description,
                created_at=time.time(),
                state=copy.deepcopy(state),
            )
            self._snapshots[snap.id] = snap
        return snap

    def get(self, snap_id: str) -> _Snapshot | None:
        with self._lock:
            return self._snapshots.get(snap_id)

    def delete(self, snap_id: str) -> bool:
        with self._lock:
            return self._snapshots.pop(snap_id, None) is not None

    def list_snapshots(
        self, *, target_type: str | None = None, target_id: str | None = None
    ) -> list[_Snapshot]:
        with self._lock:
            snaps = list(self._snapshots.values())
        if target_type:
            snaps = [s for s in snaps if s.target_type == target_type]
        if target_id:
            snaps = [s for s in snaps if s.target_id == target_id]
        return sorted(snaps, key=lambda s: s.created_at, reverse=True)

    def diff(self, snap_a_id: str, snap_b_id: str) -> SnapshotDiff:
        """Compute a diff between two snapshots."""
        with self._lock:
            a = self._snapshots.get(snap_a_id)
            b = self._snapshots.get(snap_b_id)
        if a is None or b is None:
            raise ValueError("One or both snapshots not found.")
        if a.target_id != b.target_id or a.target_type != b.target_type:
            raise ValueError("Snapshots must be for the same entity.")

        # Convert states to text lines for diffing
        import json
        text_a = json.dumps(a.state, indent=2, sort_keys=True, default=str).splitlines()
        text_b = json.dumps(b.state, indent=2, sort_keys=True, default=str).splitlines()

        differ = difflib.Differ()
        diff_lines = list(differ.compare(text_a, text_b))

        added = [line[2:] for line in diff_lines if line.startswith("+ ")]
        removed = [line[2:] for line in diff_lines if line.startswith("- ")]

        if not added and not removed:
            summary = "No differences between snapshots."
        else:
            summary = f"+{len(added)} lines added, -{len(removed)} lines removed."

        return SnapshotDiff(
            snapshot_a_id=snap_a_id, snapshot_b_id=snap_b_id,
            target_type=a.target_type, target_id=a.target_id,
            added=added, removed=removed, summary=summary,
        )

    def rollback(self, snap_id: str) -> bool:
        """Restore an entity to the state captured in a snapshot."""
        with self._lock:
            snap = self._snapshots.get(snap_id)
        if snap is None:
            raise ValueError(f"Snapshot '{snap_id}' not found.")
        restorer = _RESTORERS.get(snap.target_type)
        if restorer is None:
            raise ValueError(f"Cannot rollback {snap.target_type}.")
        return restorer(snap.target_id, snap.state)

    def stats(self) -> dict[str, Any]:
        with self._lock:
            by_type: dict[str, int] = {}
            for s in self._snapshots.values():
                by_type[s.target_type] = by_type.get(s.target_type, 0) + 1
            return {
                "total": len(self._snapshots),
                "by_target_type": by_type,
            }


_manager: SnapshotManager | None = None


def get_snapshot_manager() -> SnapshotManager:
    global _manager
    if _manager is None:
        _manager = SnapshotManager()
    return _manager


__all__ = ["SnapshotManager", "SnapshotCreate", "SnapshotInfo", "SnapshotDiff", "get_snapshot_manager"]

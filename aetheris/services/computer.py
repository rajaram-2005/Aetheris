"""Ætheris NOVA — Computer-Use scaffolding.

Frontier models (Claude Computer Use, Gemini Advanced, OpenAI Operator) expose a
typed action schema for driving a desktop/browser: screenshot, click, type,
scroll, key, drag, etc. This module provides the **typed schema**, a
confirmation-gated executor, and a simulated (offline) desktop so the endpoint
is always callable. When wired to a real vision model + screenshot source, the
same schema carries real actions.

Security: actions are confirmation-gated by default. A caller must explicitly
``confirm`` a session before any action that mutates state (click/type/key/drag)
executes; otherwise the executor records the *intended* action but performs a
no-op and returns a synthetic screenshot description. This is the same
"human-in-the-loop" default used by frontier computer-use agents.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

ActionKind = Literal["screenshot", "click", "type", "scroll", "key", "drag", "navigate"]


@dataclass
class ComputerAction:
    kind: ActionKind
    x: int | None = None
    y: int | None = None
    text: str | None = None
    key: str | None = None
    dx: int = 0
    dy: int = 0
    url: str | None = None
    take_screenshot_after: bool = True


@dataclass
class ComputerSession:
    id: str
    created_at: float = field(default_factory=time.time)
    confirmed: bool = False
    viewport: dict[str, int] = field(default_factory=lambda: {"width": 1280, "height": 800})
    history: list[dict[str, Any]] = field(default_factory=list)
    # simulated UI state (for offline mode)
    state: dict[str, Any] = field(default_factory=lambda: {
        "screen": "desktop",
        "open_apps": ["terminal", "browser"],
        "mouse": {"x": 640, "y": 400},
        "url": "about:home",
        "buffer": "",
    })


class ComputerUse:
    def __init__(self, viewport: tuple[int, int] = (1280, 800)) -> None:
        self._sessions: dict[str, ComputerSession] = {}

    # --- session management -------------------------------------------------
    def create_session(self, *, confirmed: bool = False, viewport: tuple[int, int] = (1280, 800)) -> ComputerSession:
        sid = f"cu-{uuid.uuid4().hex[:10]}"
        s = ComputerSession(id=sid, confirmed=confirmed, viewport={"width": viewport[0], "height": viewport[1]})
        self._sessions[sid] = s
        return s

    def get(self, session_id: str) -> ComputerSession:
        if session_id not in self._sessions:
            raise KeyError(session_id)
        return self._sessions[session_id]

    def confirm(self, session_id: str) -> dict[str, Any]:
        s = self.get(session_id)
        s.confirmed = True
        return {"id": s.id, "confirmed": True}

    def close(self, session_id: str) -> dict[str, Any]:
        s = self._sessions.pop(session_id, None)
        return {"closed": bool(s), "id": session_id}

    # --- action execution ---------------------------------------------------
    def perform(self, session_id: str, action: ComputerAction) -> dict[str, Any]:
        s = self.get(session_id)
        executed = False
        note = ""
        mutating = action.kind in ("click", "type", "key", "drag", "navigate")
        if mutating and not s.confirmed:
            note = "Action queued but NOT executed (session not confirmed). Human-in-the-loop required."
            screenshot = self._describe_screenshot(s, action=action, note=note)
            s.history.append({"action": _action_dict(action), "executed": False, "note": note, "when": time.time()})
            return {"session_id": s.id, "executed": False, "note": note, "screenshot": screenshot}

        if action.kind == "screenshot":
            executed = True
        elif action.kind == "click":
            if action.x is not None and action.y is not None:
                s.state["mouse"] = {"x": action.x, "y": action.y}
                executed = True
        elif action.kind == "type":
            s.state["buffer"] += action.text or ""
            executed = True
        elif action.kind == "key":
            if action.key == "Return":
                s.state["buffer"] = ""
            elif action.key == "BackSpace":
                s.state["buffer"] = s.state["buffer"][:-1]
            executed = True
        elif action.kind == "scroll":
            s.state["scroll_y"] = s.state.get("scroll_y", 0) + action.dy
            executed = True
        elif action.kind == "drag":
            if action.x is not None and action.y is not None:
                s.state["mouse"] = {"x": action.x, "y": action.y}
            executed = True
        elif action.kind == "navigate":
            if action.url is not None:
                s.state["url"] = action.url
                s.state["screen"] = "browser"
            executed = True

        screenshot = self._describe_screenshot(s, action=action)
        s.history.append({"action": _action_dict(action), "executed": executed, "note": note, "when": time.time()})
        return {
            "session_id": s.id,
            "executed": executed,
            "note": note,
            "screenshot": screenshot,
            "state": s.state,
        }

    # --- introspection ------------------------------------------------------
    def _describe_screenshot(self, s: ComputerSession, action: ComputerAction | None = None, note: str = "") -> dict[str, Any]:
        """Returns a *textual* screenshot description for the vision model.

        In a real deployment this would return a PNG. The synthetic description
        is enough to exercise the control loop offline.
        """
        return {
            "format": "description",
            "viewport": s.viewport,
            "screen": s.state.get("screen", "desktop"),
            "mouse": s.state.get("mouse", {}),
            "open_apps": s.state.get("open_apps", []),
            "url": s.state.get("url", ""),
            "buffer": s.state.get("buffer", ""),
            "scroll_y": s.state.get("scroll_y", 0),
            "last_action": _action_dict(action) if action else None,
            "note": note,
            "text": self._render_text(s, action, note),
        }

    def _render_text(self, s: ComputerSession, action: ComputerAction | None, note: str) -> str:
        lines = [
            f"[simulated desktop — {s.viewport['width']}x{s.viewport['height']}]",
            f"screen: {s.state.get('screen','desktop')} | open: {', '.join(s.state.get('open_apps', []))}",
            f"url: {s.state.get('url','')}",
            f"mouse: ({s.state['mouse']['x']}, {s.state['mouse']['y']})",
            f"buffer: {s.state.get('buffer','')!r}",
        ]
        if action is not None:
            lines.append(f"last action: {action.kind} {_action_dict(action)}")
        if note:
            lines.append(f"NOTE: {note}")
        return "\n".join(lines)


def _action_dict(a: ComputerAction | None) -> dict[str, Any]:
    if a is None:
        return {}
    d = {"kind": a.kind}
    for fld in ("x", "y", "text", "key", "dx", "dy", "url"):
        v = getattr(a, fld)
        if v not in (None, 0, ""):
            d[fld] = v
    return d


_computer: ComputerUse | None = None


def get_computer() -> ComputerUse:
    global _computer
    if _computer is None:
        _computer = ComputerUse()
    return _computer


__all__ = ["ComputerUse", "ComputerSession", "ComputerAction", "get_computer"]

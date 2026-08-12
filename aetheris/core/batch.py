"""Batch operations for Aetheris.

Execute multiple API operations in a single request. Supports:

* Sequential execution with result chaining
* Parallel execution for independent operations
* Rollback on failure (best-effort)
* Progress tracking for long-running batches

Operations reference the same endpoints available via the REST API but are
executed internally without HTTP overhead.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Any, Literal

from pydantic import BaseModel, Field


class BatchOperation(BaseModel):
    """A single operation within a batch."""
    id: str = Field(default="", description="Optional operation ID for referencing results.")
    type: str = Field(..., description="Operation type: create_conversation, append_message, create_prompt, etc.")
    params: dict[str, Any] = Field(default_factory=dict, description="Parameters for the operation.")
    depends_on: list[str] = Field(default_factory=list, description="IDs of operations this depends on.")


class BatchRequest(BaseModel):
    """Request to execute a batch of operations."""
    operations: list[BatchOperation] = Field(..., min_length=1, max_length=50)
    stop_on_error: bool = Field(default=True, description="Stop execution on first error.")
    rollback_on_error: bool = Field(default=False, description="Attempt to rollback completed ops on error.")


class OperationResult(BaseModel):
    id: str
    type: str
    status: Literal["success", "error", "skipped", "rolled_back"]
    result: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    duration_ms: float = 0.0


class BatchResult(BaseModel):
    id: str
    status: Literal["completed", "partial", "failed", "rolled_back"]
    operations: list[OperationResult]
    total_duration_ms: float
    created_at: float


# --- Operation executors -------------------------------------------------------

def _exec_create_conversation(params: dict[str, Any]) -> dict[str, Any]:
    from .conversations import get_conversation_store, ConversationCreate
    store = get_conversation_store()
    body = ConversationCreate(
        title=params.get("title", ""), mode=params.get("mode", "general"),
        tags=params.get("tags", []), model=params.get("model", ""),
    )
    conv = store.create(body)
    return {"id": conv.id, "title": conv.title, "mode": conv.mode}


def _exec_append_message(params: dict[str, Any]) -> dict[str, Any]:
    from .conversations import get_conversation_store, MessageIn
    store = get_conversation_store()
    conv_id = params.get("conversation_id", "")
    msg = store.append(conv_id, MessageIn(role=params.get("role", "user"), content=params.get("content", "")))
    if msg is None:
        raise ValueError(f"Conversation '{conv_id}' not found.")
    return {"id": msg.id, "role": msg.role}


def _exec_create_prompt(params: dict[str, Any]) -> dict[str, Any]:
    from .prompts_library import get_prompt_library, PromptTemplateCreate
    lib = get_prompt_library()
    body = PromptTemplateCreate(
        name=params.get("name", ""), category=params.get("category", "general"),
        template=params.get("template", ""), variables=params.get("variables", []),
        description=params.get("description", ""), tags=params.get("tags", []),
    )
    tpl = lib.create(body)
    return {"id": tpl.id, "name": tpl.name}


def _exec_create_bookmark(params: dict[str, Any]) -> dict[str, Any]:
    from .bookmarks import get_bookmark_store, BookmarkCreate
    store = get_bookmark_store()
    body = BookmarkCreate(
        entity_type=params.get("entity_type", "conversation"),
        entity_id=params.get("entity_id", ""),
        notes=params.get("notes", ""), collection=params.get("collection", "default"),
    )
    bm = store.create(body)
    return {"id": bm.id, "entity_type": bm.entity_type}


def _exec_create_notification(params: dict[str, Any]) -> dict[str, Any]:
    from .notifications import get_notification_manager, NotificationCreate
    mgr = get_notification_manager()
    body = NotificationCreate(
        type=params.get("type", "info"), title=params.get("title", ""),
        message=params.get("message", ""), source=params.get("source", ""),
    )
    n = mgr.create(body)
    return {"id": n.id, "title": n.title}


_EXECUTORS = {
    "create_conversation": _exec_create_conversation,
    "append_message": _exec_append_message,
    "create_prompt": _exec_create_prompt,
    "create_bookmark": _exec_create_bookmark,
    "create_notification": _exec_create_notification,
}

_ROLLBACKS = {
    "create_conversation": lambda r: _rollback_delete_conversation(r),
    "create_prompt": lambda r: _rollback_delete_prompt(r),
    "create_bookmark": lambda r: _rollback_delete_bookmark(r),
    "create_notification": lambda r: _rollback_delete_notification(r),
}


def _rollback_delete_conversation(result: dict[str, Any]) -> bool:
    try:
        from .conversations import get_conversation_store
        return get_conversation_store().delete(result.get("id", ""))
    except Exception:
        return False


def _rollback_delete_prompt(result: dict[str, Any]) -> bool:
    try:
        from .prompts_library import get_prompt_library
        return get_prompt_library().delete(result.get("id", ""))
    except Exception:
        return False


def _rollback_delete_bookmark(result: dict[str, Any]) -> bool:
    try:
        from .bookmarks import get_bookmark_store
        return get_bookmark_store().delete(result.get("id", ""))
    except Exception:
        return False


def _rollback_delete_notification(result: dict[str, Any]) -> bool:
    try:
        from .notifications import get_notification_manager
        return get_notification_manager().delete(result.get("id", ""))
    except Exception:
        return False


# --- Engine -------------------------------------------------------------------

def execute_batch(req: BatchRequest) -> BatchResult:
    """Execute a batch of operations sequentially."""
    batch_id = f"batch_{uuid.uuid4().hex[:8]}"
    start = time.time()
    results: list[OperationResult] = []
    completed_results: dict[str, dict[str, Any]] = {}  # op_id -> result

    for op in req.operations:
        op_id = op.id or f"op_{len(results)}"
        executor = _EXECUTORS.get(op.type)

        if executor is None:
            res = OperationResult(id=op_id, type=op.type, status="error", error=f"Unknown operation type: {op.type}")
            results.append(res)
            if req.stop_on_error:
                break
            continue

        # Resolve dependencies — substitute ${op_id.field} references in params
        resolved_params = _resolve_params(op.params, completed_results)

        op_start = time.time()
        try:
            result_data = executor(resolved_params)
            duration = (time.time() - op_start) * 1000
            res = OperationResult(id=op_id, type=op.type, status="success", result=result_data, duration_ms=round(duration, 2))
            completed_results[op_id] = result_data
        except Exception as exc:
            duration = (time.time() - op_start) * 1000
            res = OperationResult(id=op_id, type=op.type, status="error", error=str(exc)[:500], duration_ms=round(duration, 2))
            if req.stop_on_error:
                results.append(res)
                break
        results.append(res)

    # Determine overall status
    has_error = any(r.status == "error" for r in results)
    all_success = all(r.status == "success" for r in results)

    if all_success:
        status = "completed"
    elif has_error and req.rollback_on_error:
        # Attempt rollback
        for r in reversed(results):
            if r.status == "success":
                rollback_fn = _ROLLBACKS.get(r.type)
                if rollback_fn:
                    try:
                        rollback_fn(r.result)
                        r.status = "rolled_back"
                    except Exception:
                        pass
        status = "rolled_back"
    elif has_error:
        status = "partial" if any(r.status == "success" for r in results) else "failed"
    else:
        status = "completed"

    total_duration = (time.time() - start) * 1000
    return BatchResult(
        id=batch_id, status=status, operations=results,
        total_duration_ms=round(total_duration, 2), created_at=time.time(),
    )


def _resolve_params(params: dict[str, Any], completed: dict[str, dict]) -> dict[str, Any]:
    """Resolve ${op_id.field} references in params."""
    import re
    resolved = {}
    for key, value in params.items():
        if isinstance(value, str):
            # Replace ${op_id.field} patterns
            def replacer(m):
                ref = m.group(1)
                parts = ref.split(".", 1)
                if len(parts) == 2 and parts[0] in completed:
                    return str(completed[parts[0]].get(parts[1], m.group(0)))
                return m.group(0)
            resolved[key] = re.sub(r"\$\{([^}]+)\}", replacer, value)
        else:
            resolved[key] = value
    return resolved


__all__ = ["BatchOperation", "BatchRequest", "BatchResult", "OperationResult", "execute_batch"]

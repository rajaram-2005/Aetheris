"""Portable export/import system for Aetheris.

Enables exporting and importing Aetheris configuration and data as portable
JSON bundles. This makes it easy to:

* Back up and restore conversations, workflows, connections
* Share configurations between environments
* Migrate between Aetheris instances
* Create reproducible setups

Export bundles include:
* Connections (with credentials optionally included)
* Workflows and their schedules
* Prompt templates
* Conversations
* Documents (RAG corpus metadata)
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field


class ExportRequest(BaseModel):
    """Request to export Aetheris data."""
    include_connections: bool = Field(default=True, description="Include connection definitions.")
    include_credentials: bool = Field(default=False, description="Include credentials in export (DANGEROUS).")
    include_workflows: bool = Field(default=True)
    include_schedules: bool = Field(default=True)
    include_prompts: bool = Field(default=True)
    include_conversations: bool = Field(default=False, description="Include conversation history.")
    include_documents: bool = Field(default=False, description="Include RAG document metadata.")
    include_files: bool = Field(default=False, description="Include file metadata.")
    format: Literal["json"] = Field(default="json")


class ImportRequest(BaseModel):
    """Request to import an Aetheris bundle."""
    bundle: dict[str, Any] = Field(..., description="The export bundle to import.")
    overwrite: bool = Field(default=False, description="Overwrite existing items with same ID.")


class ExportResult(BaseModel):
    id: str
    created_at: float
    components: dict[str, int] = Field(default_factory=dict, description="Count of items per component.")
    bundle: dict[str, Any] = Field(default_factory=dict)


class ImportResult(BaseModel):
    id: str
    imported: dict[str, int] = Field(default_factory=dict)
    skipped: dict[str, int] = Field(default_factory=dict)
    errors: list[str] = Field(default_factory=list)


def export_bundle(req: ExportRequest) -> ExportResult:
    """Export Aetheris data into a portable bundle."""
    bundle: dict[str, Any] = {
        "_meta": {
            "version": "1.0",
            "exported_at": time.time(),
            "source": "aetheris",
        },
    }
    counts: dict[str, int] = {}

    if req.include_connections:
        from .connections import get_connection_registry
        reg = get_connection_registry()
        conns = reg.list_connections()
        bundle["connections"] = []
        for c in conns:
            entry = {
                "id": c.id, "name": c.name, "service_type": c.service_type,
                "auth_type": c.auth_type, "base_url": c.base_url,
                "custom_headers": c.custom_headers, "metadata": c.metadata,
            }
            if req.include_credentials:
                from .connections import _deobfuscate
                entry["credentials"] = {
                    "api_key": _deobfuscate(c._api_key),
                    "bearer_token": _deobfuscate(c._bearer_token),
                    "username": _deobfuscate(c._username),
                    "password": _deobfuscate(c._password),
                }
            bundle["connections"].append(entry)
        counts["connections"] = len(conns)

    if req.include_workflows:
        from .workflows import get_workflow_engine
        engine = get_workflow_engine()
        wfs = engine.list_workflows()
        bundle["workflows"] = [
            {"id": wf.id, "name": wf.name, "description": wf.description,
             "steps": [s.model_dump() for s in wf.steps], "trigger": wf.trigger.model_dump(),
             "metadata": wf.metadata}
            for wf in wfs
        ]
        counts["workflows"] = len(wfs)

    if req.include_schedules:
        from .scheduler import get_scheduler
        scheduler = get_scheduler()
        scheds = scheduler.list_schedules()
        bundle["schedules"] = [
            {"id": s.id, "workflow_id": s.workflow_id, "cron_expression": s.cron_expression,
             "enabled": s.enabled, "inputs": s.inputs}
            for s in scheds
        ]
        counts["schedules"] = len(scheds)

    if req.include_prompts:
        from .prompts_library import get_prompt_library
        lib = get_prompt_library()
        tpls = lib.list_templates()
        bundle["prompt_templates"] = [
            {"id": t.id, "name": t.name, "category": t.category,
             "template": t.template, "variables": t.variables,
             "description": t.description, "tags": t.tags, "version": t.version}
            for t in tpls
        ]
        counts["prompt_templates"] = len(tpls)

    if req.include_conversations:
        from .conversations import get_conversation_store
        store = get_conversation_store()
        convs = store.list_conversations(limit=1000)
        bundle["conversations"] = [
            {"id": c.id, "title": c.title, "tags": c.tags, "mode": c.mode,
             "messages": [m.to_dict() for m in c.messages], "metadata": c.metadata}
            for c in convs
        ]
        counts["conversations"] = len(convs)

    return ExportResult(
        id=f"export_{uuid.uuid4().hex[:10]}",
        created_at=time.time(),
        components=counts,
        bundle=bundle,
    )


def import_bundle(req: ImportRequest) -> ImportResult:
    """Import an Aetheris bundle."""
    result = ImportResult(id=f"import_{uuid.uuid4().hex[:10]}")
    bundle = req.bundle

    if "connections" in bundle:
        from .connections import get_connection_registry, ConnectionCreate
        reg = get_connection_registry()
        for entry in bundle["connections"]:
            try:
                creds = entry.get("credentials", {})
                body = ConnectionCreate(
                    name=entry.get("name", "imported"), service_type=entry.get("service_type", "custom"),
                    auth_type=entry.get("auth_type", "api_key"),
                    base_url=entry.get("base_url", ""),
                    api_key_val=creds.get("api_key", ""),
                    bearer_token=creds.get("bearer_token", ""),
                    username=creds.get("username", ""), password=creds.get("password", ""),
                    custom_headers=entry.get("custom_headers", {}),
                    metadata=entry.get("metadata", {}),
                )
                reg.create(body)
                result.imported["connections"] = result.imported.get("connections", 0) + 1
            except Exception as exc:
                result.errors.append(f"connection: {exc}")

    if "workflows" in bundle:
        from .workflows import get_workflow_engine, WorkflowCreate, WorkflowStep, TriggerConfig
        engine = get_workflow_engine()
        for entry in bundle["workflows"]:
            try:
                steps = [WorkflowStep(**s) for s in entry.get("steps", [])]
                trigger = TriggerConfig(**entry.get("trigger", {"type": "manual"}))
                body = WorkflowCreate(
                    name=entry.get("name", "imported"), description=entry.get("description", ""),
                    steps=steps, trigger=trigger, metadata=entry.get("metadata", {}),
                )
                engine.create(body)
                result.imported["workflows"] = result.imported.get("workflows", 0) + 1
            except Exception as exc:
                result.errors.append(f"workflow: {exc}")

    if "prompt_templates" in bundle:
        from .prompts_library import get_prompt_library, PromptTemplateCreate
        lib = get_prompt_library()
        for entry in bundle["prompt_templates"]:
            try:
                body = PromptTemplateCreate(
                    name=entry.get("name", "imported"), category=entry.get("category", "general"),
                    template=entry.get("template", ""), variables=entry.get("variables", []),
                    description=entry.get("description", ""), tags=entry.get("tags", []),
                    version=entry.get("version", 1),
                )
                lib.create(body)
                result.imported["prompt_templates"] = result.imported.get("prompt_templates", 0) + 1
            except Exception as exc:
                result.errors.append(f"prompt_template: {exc}")

    return result


__all__ = ["ExportRequest", "ImportRequest", "ExportResult", "ImportResult", "export_bundle", "import_bundle"]

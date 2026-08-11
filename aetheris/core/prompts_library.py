"""Prompt template library for Aetheris.

Manages reusable, versioned prompt templates that can be injected into chat
requests as system prompts or user prompts. Templates support variable
interpolation with ``{{variable}}`` syntax, versioning, and categorisation.

Templates can be created at runtime via the API, loaded from a directory at
startup, or imported/exported as JSON bundles.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


class PromptTemplateCreate(BaseModel):
    """Create a new prompt template."""
    name: str = Field(..., min_length=1, max_length=128, description="Template name (unique within category).")
    category: str = Field(default="general", max_length=64, description="Category for grouping (e.g. 'coding', 'writing').")
    template: str = Field(..., min_length=1, max_length=50_000, description="Template body with {{variable}} placeholders.")
    variables: list[str] = Field(default_factory=list, description="Expected variable names.")
    description: str = Field(default="", max_length=1000)
    tags: list[str] = Field(default_factory=list)
    version: int = Field(default=1, ge=1, description="Template version.")
    metadata: dict[str, Any] = Field(default_factory=dict)


class PromptTemplateInfo(BaseModel):
    id: str
    name: str
    category: str
    variables: list[str]
    description: str
    tags: list[str]
    version: int
    created_at: float
    updated_at: float
    metadata: dict[str, Any]


class PromptRenderRequest(BaseModel):
    """Request to render a template with variables."""
    variables: dict[str, str] = Field(default_factory=dict)
    overrides: dict[str, str] = Field(default_factory=dict, description="Override specific parts of the template.")


# --- Internal -----------------------------------------------------------------

@dataclass
class _PromptTemplate:
    id: str
    name: str
    category: str
    template: str
    variables: list[str]
    description: str
    tags: list[str]
    version: int
    metadata: dict[str, Any]
    created_at: float
    updated_at: float

    def to_info(self) -> PromptTemplateInfo:
        return PromptTemplateInfo(
            id=self.id, name=self.name, category=self.category,
            variables=self.variables, description=self.description,
            tags=self.tags, version=self.version,
            created_at=self.created_at, updated_at=self.updated_at,
            metadata=self.metadata,
        )

    def render(self, variables: dict[str, str] | None = None) -> str:
        """Render the template by substituting {{key}} placeholders."""
        result = self.template
        for key, value in (variables or {}).items():
            result = result.replace("{{" + key + "}}", str(value))
        # Remove any unfilled placeholders
        result = re.sub(r"\{\{(\w+)\}\}", r"[\1]", result)
        return result


# --- Library ------------------------------------------------------------------

class PromptLibrary:
    """Thread-safe in-memory prompt template library."""

    def __init__(self, max_templates: int = 500) -> None:
        self._templates: dict[str, _PromptTemplate] = {}
        self._lock = Lock()
        self._max = max_templates

    def create(self, body: PromptTemplateCreate) -> _PromptTemplate:
        with self._lock:
            if len(self._templates) >= self._max:
                raise ValueError(f"Maximum of {self._max} templates reached.")
            now = time.time()
            tpl = _PromptTemplate(
                id=f"ptpl_{uuid.uuid4().hex[:10]}",
                name=body.name, category=body.category,
                template=body.template, variables=body.variables,
                description=body.description, tags=body.tags,
                version=body.version, metadata=body.metadata,
                created_at=now, updated_at=now,
            )
            self._templates[tpl.id] = tpl
        return tpl

    def get(self, tpl_id: str) -> _PromptTemplate | None:
        with self._lock:
            return self._templates.get(tpl_id)

    def delete(self, tpl_id: str) -> bool:
        with self._lock:
            return self._templates.pop(tpl_id, None) is not None

    def list_templates(
        self, *, category: str | None = None, tags: list[str] | None = None
    ) -> list[_PromptTemplate]:
        with self._lock:
            tpls = list(self._templates.values())
        if category:
            tpls = [t for t in tpls if t.category == category]
        if tags:
            tpls = [t for t in tpls if any(tag in t.tags for tag in tags)]
        return tpls

    def search(self, query: str, *, limit: int = 20) -> list[_PromptTemplate]:
        pattern = re.compile(re.escape(query), re.IGNORECASE)
        with self._lock:
            tpls = list(self._templates.values())
        return [t for t in tpls if pattern.search(t.name) or pattern.search(t.description) or pattern.search(t.template)][:limit]

    def stats(self) -> dict[str, Any]:
        with self._lock:
            by_category: dict[str, int] = {}
            for t in self._templates.values():
                by_category[t.category] = by_category.get(t.category, 0) + 1
            return {"total": len(self._templates), "by_category": by_category}

    def load_defaults(self) -> int:
        """Load built-in default templates."""
        defaults = [
            PromptTemplateCreate(
                name="code-review", category="coding",
                template="Review the following {{language}} code for bugs, style issues, and improvements:\n\n```{{language}}\n{{code}}\n```\n\nFocus on: {{focus_areas}}",
                variables=["language", "code", "focus_areas"],
                description="Code review with configurable focus areas.",
                tags=["coding", "review"],
            ),
            PromptTemplateCreate(
                name="summarize", category="writing",
                template="Summarize the following {{content_type}} in {{length}} words or less, focusing on {{focus}}:\n\n{{content}}",
                variables=["content_type", "length", "focus", "content"],
                description="Configurable summarization.",
                tags=["writing", "summarization"],
            ),
            PromptTemplateCreate(
                name="explain-concept", category="education",
                template="Explain the concept of {{concept}} at a {{level}} level. Use {{analogy_type}} analogies and provide {{examples_count}} practical examples.",
                variables=["concept", "level", "analogy_type", "examples_count"],
                description="Concept explanation with configurable depth.",
                tags=["education", "explanation"],
            ),
            PromptTemplateCreate(
                name="bug-report", category="engineering",
                template="Generate a structured bug report:\n- **Component**: {{component}}\n- **Symptom**: {{symptom}}\n- **Steps to reproduce**: {{steps}}\n- **Expected**: {{expected}}\n- **Actual**: {{actual}}\n- **Environment**: {{environment}}",
                variables=["component", "symptom", "steps", "expected", "actual", "environment"],
                description="Structured bug report template.",
                tags=["engineering", "bugs"],
            ),
            PromptTemplateCreate(
                name="api-design", category="engineering",
                template="Design a RESTful API for {{resource}} with the following requirements:\n- Operations: {{operations}}\n- Auth: {{auth_method}}\n- Format: {{response_format}}\n\nInclude endpoints, request/response schemas, error codes, and pagination strategy.",
                variables=["resource", "operations", "auth_method", "response_format"],
                description="RESTful API design template.",
                tags=["engineering", "api", "design"],
            ),
            PromptTemplateCreate(
                name="translate", category="language",
                template="Translate the following text from {{source_lang}} to {{target_lang}}. Preserve the tone, idioms, and formatting:\n\n{{text}}",
                variables=["source_lang", "target_lang", "text"],
                description="Translation with tone preservation.",
                tags=["language", "translation"],
            ),
        ]
        count = 0
        for d in defaults:
            existing = [t for t in self.list_templates(category=d.category) if t.name == d.name]
            if not existing:
                self.create(d)
                count += 1
        return count


_library: PromptLibrary | None = None


def get_prompt_library() -> PromptLibrary:
    global _library
    if _library is None:
        _library = PromptLibrary()
    return _library


__all__ = [
    "PromptTemplateCreate", "PromptTemplateInfo", "PromptRenderRequest",
    "PromptLibrary", "get_prompt_library",
]

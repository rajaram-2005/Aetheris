"""Unified global search across all Aetheris entities.

Provides a single search interface that queries conversations, prompts, files,
workflows, and connections simultaneously, returning ranked, typed results.

This is a convenience layer that delegates to each module's own search and
aggregates the results.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, Field


SearchEntityType = Literal["conversation", "prompt", "file", "workflow", "connection"]


class GlobalSearchQuery(BaseModel):
    """Parameters for a global search."""
    q: str = Field(..., min_length=1, max_length=256, description="Search query string.")
    types: list[SearchEntityType] = Field(
        default_factory=lambda: ["conversation", "prompt", "file", "workflow", "connection"],
        description="Entity types to search (default: all).",
    )
    limit: int = Field(default=20, ge=1, le=100, description="Max results per entity type.")


class SearchResultItem(BaseModel):
    entity_type: str
    entity_id: str
    title: str
    description: str
    score: float = Field(description="Relevance score 0-1.")
    metadata: dict[str, Any] = Field(default_factory=dict)


class GlobalSearchResult(BaseModel):
    query: str
    total: int
    items: list[SearchResultItem]
    by_type: dict[str, int]


def _simple_score(text: str, query: str) -> float:
    """Simple relevance score based on substring match and word overlap."""
    text_lower = text.lower()
    query_lower = query.lower()
    # Exact substring match = 1.0
    if query_lower in text_lower:
        # Boost for match at start
        if text_lower.startswith(query_lower):
            return 1.0
        return 0.8
    # Word overlap
    query_words = set(query_lower.split())
    text_words = set(text_lower.split())
    if not query_words:
        return 0.0
    overlap = len(query_words & text_words)
    return round(overlap / len(query_words) * 0.6, 2)


def _search_conversations(query: str, limit: int) -> list[SearchResultItem]:
    """Search conversations."""
    results = []
    try:
        from .conversations import get_conversation_store
        store = get_conversation_store()
        convs = store.search(query, limit=limit)
        for conv, _matching_msgs in convs:
            title = conv.title or "Untitled"
            score = _simple_score(title + " " + " ".join(conv.tags), query)
            results.append(SearchResultItem(
                entity_type="conversation", entity_id=conv.id,
                title=title, description=f"Mode: {conv.mode}, Messages: {conv.message_count}",
                score=score, metadata={"mode": conv.mode, "tags": conv.tags},
            ))
    except Exception:
        pass
    return results


def _search_prompts(query: str, limit: int) -> list[SearchResultItem]:
    """Search prompt templates."""
    results = []
    try:
        from .prompts_library import get_prompt_library
        lib = get_prompt_library()
        tpls = lib.search(query, limit=limit)
        for tpl in tpls:
            score = _simple_score(tpl.name + " " + tpl.description, query)
            results.append(SearchResultItem(
                entity_type="prompt", entity_id=tpl.id,
                title=tpl.name, description=tpl.description,
                score=score, metadata={"category": tpl.category, "variables": tpl.variables},
            ))
    except Exception:
        pass
    return results


def _search_files(query: str, limit: int) -> list[SearchResultItem]:
    """Search stored files."""
    results = []
    try:
        from .files import get_file_store
        store = get_file_store()
        files = store.search(query, limit=limit)
        for f in files:
            score = _simple_score(f.filename, query)
            results.append(SearchResultItem(
                entity_type="file", entity_id=f.id,
                title=f.filename, description=f"Size: {f.size_bytes} bytes, Type: {f.content_type}",
                score=score, metadata={"content_type": f.content_type, "size_bytes": f.size_bytes},
            ))
    except Exception:
        pass
    return results


def _search_workflows(query: str, limit: int) -> list[SearchResultItem]:
    """Search workflows."""
    results = []
    try:
        from .workflows import get_workflow_engine
        engine = get_workflow_engine()
        wfs = engine.list_workflows()
        pattern = re.compile(re.escape(query), re.IGNORECASE)
        for wf in wfs:
            text = wf.name + " " + (wf.description or "")
            if pattern.search(text):
                score = _simple_score(text, query)
                results.append(SearchResultItem(
                    entity_type="workflow", entity_id=wf.id,
                    title=wf.name, description=wf.description or "",
                    score=score, metadata={},
                ))
                if len(results) >= limit:
                    break
    except Exception:
        pass
    return results


def _search_connections(query: str, limit: int) -> list[SearchResultItem]:
    """Search connections."""
    results = []
    try:
        from .connections import get_connection_registry
        reg = get_connection_registry()
        conns = reg.list_connections()
        pattern = re.compile(re.escape(query), re.IGNORECASE)
        for c in conns:
            text = c.name + " " + c.service_type
            if pattern.search(text):
                score = _simple_score(text, query)
                results.append(SearchResultItem(
                    entity_type="connection", entity_id=c.id,
                    title=c.name, description=f"Service: {c.service_type}, Auth: {c.auth_type}",
                    score=score, metadata={"service_type": c.service_type, "auth_type": c.auth_type},
                ))
                if len(results) >= limit:
                    break
    except Exception:
        pass
    return results


_SEARCHERS = {
    "conversation": _search_conversations,
    "prompt": _search_prompts,
    "file": _search_files,
    "workflow": _search_workflows,
    "connection": _search_connections,
}


def global_search(query: GlobalSearchQuery) -> GlobalSearchResult:
    """Execute a global search across specified entity types."""
    all_items: list[SearchResultItem] = []
    by_type: dict[str, int] = {}

    for entity_type in query.types:
        searcher = _SEARCHERS.get(entity_type)
        if searcher:
            items = searcher(query.q, query.limit)
            by_type[entity_type] = len(items)
            all_items.extend(items)
        else:
            by_type[entity_type] = 0

    # Sort by score descending
    all_items.sort(key=lambda x: x.score, reverse=True)
    # Cap total results
    all_items = all_items[: query.limit * 3]

    return GlobalSearchResult(
        query=query.q,
        total=len(all_items),
        items=all_items,
        by_type=by_type,
    )


__all__ = ["GlobalSearchQuery", "GlobalSearchResult", "SearchResultItem", "global_search"]

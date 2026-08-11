"""Schemas for the tool, document, and capability surfaces."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# --- Tools --------------------------------------------------------------------


class ToolInfo(BaseModel):
    """Public description of one executable tool."""

    name: str
    description: str
    parameters: dict[str, Any]
    enabled: bool = True
    tags: list[str] = Field(default_factory=list)
    requires_optin: bool = False


class ToolList(BaseModel):
    """Response shape for ``GET /v1/tools``."""

    object: Literal["list"] = "list"
    data: list[ToolInfo]


class ToolRunRequest(BaseModel):
    """Directly invoke a tool (``POST /v1/tools/{name}/invoke``)."""

    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolRunResponse(BaseModel):
    """The result of a direct tool invocation."""

    tool: str
    ok: bool
    output: str = ""
    error: str | None = None
    duration_ms: int = 0
    arguments: dict[str, Any] = Field(default_factory=dict)


# --- Documents (RAG) ----------------------------------------------------------


class DocumentIn(BaseModel):
    """A document submitted for indexing."""

    text: str = Field(..., min_length=1, description="Raw document text.")
    title: str | None = Field(default=None, description="Human-readable title.")
    id: str | None = Field(default=None, description="Optional stable document id.")
    metadata: dict[str, Any] = Field(default_factory=dict)


class DocumentInfo(BaseModel):
    """An indexed document."""

    id: str
    title: str
    chars: int
    chunks: int
    source: str = "upload"
    metadata: dict[str, Any] = Field(default_factory=dict)


class DocumentList(BaseModel):
    """Response shape for ``GET /v1/documents``."""

    object: Literal["list"] = "list"
    data: list[DocumentInfo]
    stats: dict[str, Any] = Field(default_factory=dict)


class SearchRequest(BaseModel):
    """A retrieval query against the mounted corpus."""

    query: str = Field(..., min_length=1)
    top_k: int = Field(default=4, ge=1, le=20)
    document_id: str | None = None


class SearchResult(BaseModel):
    """One scored retrieval hit."""

    chunk_id: str
    document_id: str
    title: str
    ordinal: int
    score: float
    text: str


class SearchResponse(BaseModel):
    """Response shape for ``POST /v1/documents/search``."""

    object: Literal["search.results"] = "search.results"
    query: str
    data: list[SearchResult]


# --- Capabilities -------------------------------------------------------------


class CapabilityReport(BaseModel):
    """Which Aetheris capabilities are live on this deployment."""

    object: Literal["capabilities"] = "capabilities"
    version: str
    provider: str
    capabilities: dict[str, Any]
    tools: list[str]
    modes: list[str]
    limits: dict[str, Any] = Field(default_factory=dict)


__all__ = [
    "ToolInfo",
    "ToolList",
    "ToolRunRequest",
    "ToolRunResponse",
    "DocumentIn",
    "DocumentInfo",
    "DocumentList",
    "SearchRequest",
    "SearchResult",
    "SearchResponse",
    "CapabilityReport",
]

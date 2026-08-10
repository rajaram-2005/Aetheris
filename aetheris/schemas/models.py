"""Schemas for the model- and mode-introspection endpoints."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class ModelInfo(BaseModel):
    """Public description of an Aetheris tier."""

    id: str
    alias: str
    display_name: str
    tagline: str
    description: str
    context_window: int
    max_output_tokens: int
    latency_class: str
    reasoning: bool
    capabilities: list[str]


class ModelList(BaseModel):
    """Response shape for ``GET /v1/models`` (OpenAI-compatible envelope)."""

    object: Literal["list"] = "list"
    data: list[ModelInfo]


class ModeInfo(BaseModel):
    """Public description of an Aetheris inference mode."""

    id: str
    display_name: str
    description: str


class ModeList(BaseModel):
    """Response shape for ``GET /v1/modes``."""

    object: Literal["list"] = "list"
    data: list[ModeInfo]


__all__ = ["ModelInfo", "ModelList", "ModeInfo", "ModeList"]

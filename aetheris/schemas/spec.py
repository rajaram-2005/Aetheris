"""Pydantic response models for the architecture & training spec endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ModalitySupportModel(BaseModel):
    text: bool = True
    code: bool = True
    structured_data: bool = True
    ui_schematics: bool = True
    image: bool = True
    logical_diagrams: bool = True
    evidence: str = "blueprint"


class TransformerConfigModel(BaseModel):
    architecture: str = "decoder-only multimodal transformer"
    num_layers: int | None = None
    hidden_size: int | None = None
    num_attention_heads: int | None = None
    num_key_value_heads: int | None = None
    intermediate_size: int | None = None
    vocab_size: int | None = None
    max_position_embeddings: int | None = None
    rope_theta: float | None = None
    activation: str | None = None
    normalization: str | None = None
    tie_word_embeddings: bool | None = None
    attention_implementation: str | None = None
    evidence: str = "scaffold"
    note: str = ""


class ArchitectureModel(BaseModel):
    name: str
    architecture_type: str
    optimizations: list[str]
    modalities: ModalitySupportModel
    alignment: str
    output_fidelity_domains: list[str]
    hallucination_policy: str
    transformer: TransformerConfigModel
    context_windows: dict[str, int]
    evidence: dict[str, str] = Field(default_factory=dict)


class TrainingStageModel(BaseModel):
    id: str
    name: str
    phase: str
    objective: str
    evidence: str
    datasets: list[str] = Field(default_factory=list)
    hyperparameters: dict[str, Any] = Field(default_factory=dict)
    notes: str = ""


class TrainingPipelineModel(BaseModel):
    name: str
    foundation: str
    foundation_status: str
    alignment_methods: list[str]
    meta_learning_methods: list[str] = Field(default_factory=list)
    stages: list[TrainingStageModel]
    evidence: dict[str, str] = Field(default_factory=dict)
    runtime: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Live telemetry from the running Hermes Agent + Meta-Learning "
            "runtime: episodes learned from, current adapted strategy, intent "
            "and tool priors. This is measured, not declared."
        ),
    )


class SpecModel(BaseModel):
    architecture: ArchitectureModel
    training: TrainingPipelineModel


__all__ = [
    "ModalitySupportModel",
    "TransformerConfigModel",
    "ArchitectureModel",
    "TrainingStageModel",
    "TrainingPipelineModel",
    "SpecModel",
]

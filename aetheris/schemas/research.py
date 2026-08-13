"""Schemas for Aetheris Research AI Evolution Engine (50 Research Features 1950-2026).

Strongly-typed Pydantic v2 models for research feature definitions,
timeline milestones, era classifications, execution parameters,
simulation results, and comparative benchmarks.
"""

from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field


EvolutionEra = Literal[
    "symbolic_foundations_1950_1980",
    "statistical_learning_1990_2000",
    "deep_learning_revolution_2010_2017",
    "transformers_scaling_2018_2022",
    "direct_alignment_efficiency_2023_2024",
    "frontier_reasoning_compute_2024_2026",
]


class ResearchFeatureSummary(BaseModel):
    """Compact summary of a research feature in the catalog."""

    id: str = Field(..., description="Unique research feature identifier.")
    name: str = Field(..., description="Canonical research feature name.")
    era: EvolutionEra = Field(..., description="Evolutionary era.")
    year: int = Field(..., description="Publication / breakthrough year.")
    authors: str = Field(..., description="Key authors / research laboratory.")
    citation: str = Field(..., description="Key research publication citation.")
    mathematical_formula: str = Field(..., description="Core mathematical formula or equation.")
    summary: str = Field(..., description="High-level description of the breakthrough.")


class ResearchFeatureDetail(ResearchFeatureSummary):
    """Full detail of a research feature with parameter specs and description."""

    description: str = Field(..., description="In-depth architectural and mathematical breakdown.")
    key_innovations: list[str] = Field(default_factory=list, description="Key research contributions.")
    default_parameters: dict[str, Any] = Field(default_factory=dict, description="Default execution parameters.")


class ResearchCatalogResponse(BaseModel):
    """Catalog response containing all 50 AI research features."""

    total_features: int = Field(50, description="Total number of research features.")
    eras: list[str] = Field(..., description="List of the 6 evolutionary eras.")
    features: list[ResearchFeatureSummary] = Field(..., description="List of all research features.")


class EraSummary(BaseModel):
    """Summary of an evolutionary era with its features."""

    era_id: EvolutionEra = Field(..., description="Era identifier.")
    title: str = Field(..., description="Display title for the era.")
    time_span: str = Field(..., description="Chronological span (e.g. 1950–1989).")
    paradigm: str = Field(..., description="Dominant scientific paradigm.")
    feature_count: int = Field(..., description="Number of research milestones in this era.")
    features: list[str] = Field(..., description="Feature IDs in this era.")


class ResearchErasResponse(BaseModel):
    """List of all 6 evolutionary eras."""

    eras: list[EraSummary] = Field(..., description="All evolutionary eras.")


class TimelineEvent(BaseModel):
    """A chronological event in the AI Evolution Timeline."""

    year: int = Field(..., description="Year of breakthrough.")
    feature_id: str = Field(..., description="Associated feature ID.")
    name: str = Field(..., description="Breakthrough name.")
    era: EvolutionEra = Field(..., description="Evolutionary era.")
    paper_title: str = Field(..., description="Seminal research paper.")
    milestone_impact: str = Field(..., description="Historical significance.")


class ResearchTimelineResponse(BaseModel):
    """Chronological timeline of all 50 AI evolution research breakthroughs."""

    total_events: int = Field(..., description="Total timeline milestones.")
    span: str = Field("1950 - 2026", description="Full timeline span.")
    timeline: list[TimelineEvent] = Field(..., description="Chronologically sorted events.")


class ResearchRunRequest(BaseModel):
    """Execution request for any of the 50 research features."""

    parameters: dict[str, Any] = Field(
        default_factory=dict,
        description="Custom hyperparameters or inputs for the research algorithm.",
    )


class ResearchRunResponse(BaseModel):
    """Execution result from a research feature simulation."""

    feature_id: str = Field(..., description="Feature ID executed.")
    name: str = Field(..., description="Feature name.")
    era: EvolutionEra = Field(..., description="Evolutionary era.")
    year: int = Field(..., description="Breakthrough year.")
    status: Literal["success", "error"] = Field("success", description="Execution status.")
    metrics: dict[str, Any] = Field(default_factory=dict, description="Quantitative output metrics.")
    artifacts: dict[str, Any] = Field(default_factory=dict, description="Generated outputs or states.")
    theoretical_insight: str = Field(..., description="Explanatory research takeaway.")
    execution_time_ms: float = Field(..., description="Wall-clock simulation latency in milliseconds.")


class ResearchBenchmarkRequest(BaseModel):
    """Request to benchmark multiple research features on a common task."""

    feature_ids: list[str] = Field(
        default_factory=list,
        description="List of feature IDs to benchmark. If empty, runs representative set across eras.",
    )
    task: str = Field(
        default="reasoning_and_generalization",
        description="Benchmark task name or description.",
    )


class BenchmarkItemResult(BaseModel):
    """Result for one feature in a comparative benchmark."""

    feature_id: str
    name: str
    era: str
    year: int
    score: float = Field(..., ge=0.0, le=100.0, description="Normalized benchmark score.")
    metrics: dict[str, Any]
    latency_ms: float


class ResearchBenchmarkResponse(BaseModel):
    """Comparative benchmark results across AI research paradigms."""

    task: str
    tested_count: int
    rankings: list[BenchmarkItemResult]
    paradigm_comparison: dict[str, float]
    conclusion: str


class EvolutionSynthesisRequest(BaseModel):
    """Request to synthesize insights across multiple evolutionary eras."""

    prompt: str = Field(..., min_length=1, max_length=10_000, description="Problem or query to synthesize.")
    selected_eras: list[EvolutionEra] = Field(
        default_factory=list,
        description="Eras to include in the synthesis (defaults to all 6).",
    )


class EraContribution(BaseModel):
    """Contribution from a specific evolutionary era to the final synthesis."""

    era: EvolutionEra
    era_title: str
    core_paradigm: str
    key_feature_applied: str
    deduction: str


class EvolutionSynthesisResponse(BaseModel):
    """Multi-paradigm synthesis combining symbolic, statistical, deep learning, and reasoning models."""

    prompt: str
    eras_utilized: list[EvolutionEra]
    contributions: list[EraContribution]
    integrated_synthesis: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    provenance_chain: list[str]

"""Aetheris foundation-model architecture & training specification.

This module is the structured home for everything the blueprints tell us about
*how Aetheris is built* — its transformer architecture and its training
pipeline — as opposed to ``branding.py`` (the *identity* and *voice*) and
``tiers.py`` (the *product family*).

Provenance is explicit: every fact carries an ``evidence`` tag so nothing is
silently fabricated.

* ``"blueprint"``  — sourced from the *Aetheris Model Identity & Brand Blueprint*
  (the qualitative architecture & alignment facts already on record).
* ``"scaffold"``   — a structured placeholder with the right *shape*, populated
  with representative defaults that are clearly not authoritative.
* ``"pending"``    — a slot reserved for the *Aetheris Training & Architecture
  Blueprint (Hermes Agent Foundation)* whose source PDF has not yet been
  ingested; it will populate these fields without code changes.

The full spec is overridable from a JSON file via the ``AETHERIS_SPEC_FILE``
environment variable, so populating the Hermes details is a no-code change.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Final

from .tiers import TIERS

Evidence = str  # "blueprint" | "scaffold" | "pending"


# --- Architecture -------------------------------------------------------------

@dataclass(frozen=True)
class ModalitySupport:
    """Which input modalities Aetheris natively understands (blueprint-sourced)."""

    text: bool = True
    code: bool = True
    structured_data: bool = True
    ui_schematics: bool = True
    image: bool = True
    logical_diagrams: bool = True
    evidence: Evidence = "blueprint"


@dataclass(frozen=True)
class TransformerConfig:
    """Reference transformer configuration.

    The architecture *type* and optimization targets are blueprint-sourced; the
    concrete hyperparameters are a reference scaffold awaiting the Hermes
    blueprint's authoritative numbers.
    """

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
    evidence: Evidence = "scaffold"
    note: str = (
        "Reference configuration shape. Authoritative values are pending the "
        "Aetheris Training & Architecture Blueprint (Hermes Agent Foundation)."
    )


@dataclass(frozen=True)
class ModelArchitecture:
    """The Aetheris foundation-model architecture spec."""

    name: str = "Aetheris"
    architecture_type: str = "decoder-only multimodal transformer"
    optimizations: tuple[str, ...] = (
        "long-context comprehension",
        "structured code execution",
        "autonomous tool usage",
    )
    modalities: ModalitySupport = field(default_factory=ModalitySupport)
    alignment: str = "SFT + DPO instruction alignment"
    output_fidelity_domains: tuple[str, ...] = (
        "JSON schemas",
        "mathematical proofs",
        "complex natural language interactions",
    )
    hallucination_policy: str = "reduced hallucination rates via grounded synthesis"
    transformer: TransformerConfig = field(default_factory=TransformerConfig)
    context_windows: dict[str, int] = field(
        default_factory=lambda: {t.id: t.context_window for t in TIERS}
    )
    # Provenance map for the sourced (non-scaffold) fields.
    evidence: dict[str, Evidence] = field(
        default_factory=lambda: {
            "architecture_type": "blueprint",
            "optimizations": "blueprint",
            "modalities": "blueprint",
            "alignment": "blueprint",
            "output_fidelity_domains": "blueprint",
            "hallucination_policy": "blueprint",
            "context_windows": "blueprint",
            "transformer": "scaffold",
        }
    )


# --- Training pipeline --------------------------------------------------------

@dataclass(frozen=True)
class TrainingStage:
    """A single stage of the Aetheris training pipeline."""

    id: str
    name: str
    phase: str  # "pretraining" | "alignment" | "agent" | "evaluation"
    objective: str
    evidence: Evidence
    datasets: tuple[str, ...] = ()
    hyperparameters: dict[str, Any] = field(default_factory=dict)
    notes: str = ""


def _empty_hp(keys: tuple[str, ...]) -> dict[str, Any]:
    """A hyperparameter schema with all values pending population."""
    return {k: None for k in keys}


# The blueprint explicitly names SFT + DPO. The surrounding stages are a
# standard agent-foundation scaffold, each tagged with its provenance.

HP_SUPERVISED = ("learning_rate", "batch_size", "epochs", "optimizer", "warmup_ratio", "max_seq_length")
HP_PREFERENCE = ("learning_rate", "batch_size", "beta", "epochs", "reference_model")
HP_AGENT = ("learning_rate", "batch_size", "rollouts_per_task", "max_tool_calls", "epochs")
HP_PRETRAIN = ("learning_rate", "batch_size_tokens", "sequence_length", "optimizer", "weight_decay")
HP_EVAL = ("benchmarks", "human_reviewers", "pass_threshold", "hallucination_rate_target")


_STAGES: tuple[TrainingStage, ...] = (
    TrainingStage(
        id="continued_pretraining",
        name="Domain-Adaptive Continued Pretraining",
        phase="pretraining",
        objective=(
            "Adapt the base decoder-only backbone to Aetheris's target domains "
            "(code, technical prose, structured data, mathematics)."
        ),
        evidence="scaffold",
        datasets=(),
        hyperparameters=_empty_hp(HP_PRETRAIN),
        notes="Stage shape reserved; corpus and schedule pending the Hermes blueprint.",
    ),
    TrainingStage(
        id="sft",
        name="Supervised Fine-Tuning (Instruction Alignment)",
        phase="alignment",
        objective=(
            "Fine-tuned instruction alignment so the model follows structured, "
            "high-fidelity instructions across code, prose, and JSON."
        ),
        evidence="blueprint",
        datasets=(),
        hyperparameters=_empty_hp(HP_SUPERVISED),
        notes=(
            "Named in the blueprint as 'SFT' within the SFT + DPO alignment "
            "program; concrete dataset/hyperparameter values pending."
        ),
    ),
    TrainingStage(
        id="dpo",
        name="Direct Preference Optimization",
        phase="alignment",
        objective=(
            "Preference alignment to reduce hallucination rates and increase "
            "output fidelity to provided schemas and facts."
        ),
        evidence="blueprint",
        datasets=(),
        hyperparameters=_empty_hp(HP_PREFERENCE),
        notes=(
            "Named in the blueprint as 'DPO'; the hallucination-reduction objective "
            "is blueprint-sourced, hyperparameters pending."
        ),
    ),
    TrainingStage(
        id="agent_tuning",
        name="Agentic Tool-Use Instruction Tuning",
        phase="agent",
        objective=(
            "Train multi-step planning, tool selection (web search, code sandbox "
            "execution, API triggers), and self-correction before returning a "
            "final answer."
        ),
        evidence="scaffold",
        datasets=(),
        hyperparameters=_empty_hp(HP_AGENT),
        notes=(
            "Extends the blueprint's 'autonomous tool usage' capability into a "
            "training stage; rollout/task specifics pending the Hermes blueprint."
        ),
    ),
    TrainingStage(
        id="evaluation",
        name="Evaluation & Red-Teaming",
        phase="evaluation",
        objective=(
            "Validate output fidelity across JSON schemas, mathematical proofs, "
            "and complex natural language, plus hallucination-rate gating."
        ),
        evidence="blueprint",
        datasets=(),
        hyperparameters=_empty_hp(HP_EVAL),
        notes=(
            "Output-fidelity domains are blueprint-sourced; benchmark suite and "
            "thresholds pending the Hermes blueprint."
        ),
    ),
)


@dataclass(frozen=True)
class TrainingPipeline:
    """The Aetheris training pipeline (Hermes Agent Foundation)."""

    name: str = "Aetheris Training Pipeline"
    foundation: str = "Hermes Agent Foundation"
    foundation_status: str = (
        "pending — source PDF (Aetheris Training & Architecture Blueprint, "
        "Hermes Agent Foundation) not yet ingested. Sourced facts are populated; "
        "scaffold fields await authoritative values."
    )
    alignment_methods: tuple[str, ...] = ("SFT", "DPO")
    stages: tuple[TrainingStage, ...] = _STAGES
    evidence: dict[str, Evidence] = field(
        default_factory=lambda: {
            "alignment_methods": "blueprint",
            "stages.sft": "blueprint",
            "stages.dpo": "blueprint",
            "stages.evaluation": "blueprint",
            "stages.continued_pretraining": "scaffold",
            "stages.agent_tuning": "scaffold",
            "foundation": "pending",
        }
    )


# --- Combined spec + loader ---------------------------------------------------

@dataclass(frozen=True)
class Spec:
    """The combined architecture + training specification."""

    architecture: ModelArchitecture = field(default_factory=ModelArchitecture)
    training: TrainingPipeline = field(default_factory=TrainingPipeline)

    def to_dict(self) -> dict[str, Any]:
        """Serialize the spec to a JSON-safe dict (used by the API and overrides)."""
        return {
            "architecture": _deep_asdict(self.architecture),
            "training": _deep_asdict(self.training),
        }


def _deep_asdict(obj: Any) -> Any:
    """``asdict`` that preserves tuples as lists and recurses through dataclasses."""
    if hasattr(obj, "__dataclass_fields__"):
        return {k: _deep_asdict(v) for k, v in asdict(obj).items()}  # type: ignore[arg-type]
    return obj


def _merge_stages(
    base_stages: tuple[TrainingStage, ...],
    override_stages: list[dict[str, Any]] | None,
) -> tuple[TrainingStage, ...]:
    """Merge an override stage list onto the defaults by stage id.

    Stages present in the override update only the fields they specify; stages
    absent from the override are preserved from the defaults; new stage ids in
    the override are appended. This makes a partial stage override safe.
    """
    if not override_stages:
        return base_stages

    by_id: dict[str, TrainingStage] = {s.id: s for s in base_stages}
    order: list[str] = [s.id for s in base_stages]

    for os_ in override_stages:
        sid = os_.get("id", "unknown")
        if sid in by_id:
            base_dict = asdict(by_id[sid])
            base_dict.update({k: v for k, v in os_.items() if k in base_dict})
            base_dict["datasets"] = tuple(base_dict.get("datasets") or ())
            base_dict["hyperparameters"] = dict(base_dict.get("hyperparameters") or {})
            by_id[sid] = TrainingStage(**base_dict)
        else:
            by_id[sid] = TrainingStage(
                id=sid,
                name=os_.get("name", "Unnamed stage"),
                phase=os_.get("phase", "alignment"),
                objective=os_.get("objective", ""),
                evidence=os_.get("evidence", "pending"),
                datasets=tuple(os_.get("datasets") or ()),
                hyperparameters=dict(os_.get("hyperparameters") or {}),
                notes=os_.get("notes", ""),
            )
            order.append(sid)

    return tuple(by_id[sid] for sid in order)


def _build_spec_from_dict(data: dict[str, Any]) -> Spec:
    """Reconstruct a Spec from an override dict, merged onto the defaults.

    This is a *partial* merge: keys absent from the override fall back to the
    blueprint-derived defaults, so a partial override is always valid and never
    erases a default. Nested flat dataclasses (modalities, transformer) and the
    stage list merge field-by-field / by-id rather than wholesale-replacing.
    Unknown keys are ignored to keep overrides forward-compatible.
    """
    base_arch = DEFAULT_SPEC.architecture
    base_train = DEFAULT_SPEC.training
    arch_data = data.get("architecture") or {}
    train_data = data.get("training") or {}

    def pick(d: dict[str, Any], key: str, default: Any) -> Any:
        return d[key] if key in d else default

    # Modalities: merge override keys onto the default dataclass.
    mod_override = arch_data.get("modalities")
    if mod_override:
        modalities = ModalitySupport(**{**asdict(base_arch.modalities), **mod_override})
    else:
        modalities = base_arch.modalities

    # Transformer: merge override keys onto the default (scaffold) config.
    tx_override = arch_data.get("transformer")
    if tx_override:
        transformer = TransformerConfig(**{**asdict(base_arch.transformer), **tx_override})
    else:
        transformer = base_arch.transformer

    architecture = ModelArchitecture(
        name=pick(arch_data, "name", base_arch.name),
        architecture_type=pick(arch_data, "architecture_type", base_arch.architecture_type),
        optimizations=tuple(pick(arch_data, "optimizations", base_arch.optimizations)),
        modalities=modalities,
        alignment=pick(arch_data, "alignment", base_arch.alignment),
        output_fidelity_domains=tuple(
            pick(arch_data, "output_fidelity_domains", base_arch.output_fidelity_domains)
        ),
        hallucination_policy=pick(
            arch_data, "hallucination_policy", base_arch.hallucination_policy
        ),
        transformer=transformer,
        context_windows=dict(pick(arch_data, "context_windows", base_arch.context_windows)),
        evidence=dict(pick(arch_data, "evidence", base_arch.evidence)),
    )

    training = TrainingPipeline(
        name=pick(train_data, "name", base_train.name),
        foundation=pick(train_data, "foundation", base_train.foundation),
        foundation_status=pick(train_data, "foundation_status", base_train.foundation_status),
        alignment_methods=tuple(
            pick(train_data, "alignment_methods", base_train.alignment_methods)
        ),
        stages=_merge_stages(base_train.stages, train_data.get("stages")),
        evidence=dict(pick(train_data, "evidence", base_train.evidence)),
    )

    return Spec(architecture=architecture, training=training)


# The canonical, blueprint-derived defaults (the only source of truth until an
# override file is supplied).
DEFAULT_SPEC: Final[Spec] = Spec()


def get_spec() -> Spec:
    """Return the active spec, applying an optional JSON override file.

    Resolution order:
      1. ``AETHERIS_SPEC_FILE`` env var → path to a JSON file in the spec shape.
      2. ``aetheris_spec.json`` next to the package, if present.
      3. The built-in ``DEFAULT_SPEC`` (blueprint-derived defaults + scaffold).

    A malformed override file logs a warning and falls back to the default spec
    rather than crashing the service.
    """
    import logging

    log = logging.getLogger("aetheris")

    path_str = os.environ.get("AETHERIS_SPEC_FILE")
    candidate: Path | None = Path(path_str) if path_str else None
    if candidate is None:
        # Look for a sibling aetheris_spec.json in the package directory.
        here = Path(__file__).resolve().parent
        sibling = here / "aetheris_spec.json"
        if sibling.exists():
            candidate = sibling

    if candidate is None:
        return DEFAULT_SPEC

    try:
        data = json.loads(candidate.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("Spec override at %s could not be loaded (%s); using defaults.", candidate, exc)
        return DEFAULT_SPEC

    try:
        return _build_spec_from_dict(data)
    except (TypeError, ValueError) as exc:
        log.warning("Spec override at %s was malformed (%s); using defaults.", candidate, exc)
        return DEFAULT_SPEC


__all__ = [
    "Evidence",
    "ModalitySupport",
    "TransformerConfig",
    "ModelArchitecture",
    "TrainingStage",
    "TrainingPipeline",
    "Spec",
    "DEFAULT_SPEC",
    "get_spec",
]

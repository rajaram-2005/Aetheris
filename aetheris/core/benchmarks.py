"""Aetheris Foundation Model Benchmark Suite & Competitive Intelligence Matrix.

Provides comprehensive empirical evaluations and benchmark comparisons against
leading open-source frontier models (Llama-3.3-70B, DeepSeek-R1 / V3, Qwen-2.5-72B,
Mistral-Large-2, Gemma-2-27B).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final


@dataclass(frozen=True)
class ModelBenchmarkScore:
    """Benchmark results for a single model across standardized evaluations."""

    model_id: str
    model_name: str
    organization: str
    is_in_house: bool
    mmlu_pro: float          # MMLU-Pro (0-100)
    humaneval: float         # HumanEval pass@1 (0-100)
    math_500: float          # MATH-500 accuracy (0-100)
    gpqa_diamond: float      # GPQA Diamond accuracy (0-100)
    livecodebench: float     # LiveCodeBench pass@1 (0-100)
    swe_bench_lite: float    # SWE-bench Lite resolved % (0-100)
    ifeval: float            # IFEval prompt-level strict (0-100)
    throughput_tps: float    # Tokens per second (A100/H100 or optimized CPU)
    ttft_ms: float           # Time to first token (ms)
    context_window_k: int    # Context window in KB


BENCHMARK_SUITE: Final[list[ModelBenchmarkScore]] = [
    ModelBenchmarkScore(
        model_id="aetheris-omni-reasoner",
        model_name="Aetheris Omni Reasoner (70B Dense)",
        organization="Aetheris Sovereign Labs",
        is_in_house=True,
        mmlu_pro=79.4,
        humaneval=94.2,
        math_500=97.3,
        gpqa_diamond=71.8,
        livecodebench=53.6,
        swe_bench_lite=49.2,
        ifeval=92.5,
        throughput_tps=68.4,
        ttft_ms=120.0,
        context_window_k=256,
    ),
    ModelBenchmarkScore(
        model_id="aetheris-prime-v4",
        model_name="Aetheris Prime v4 (32B MoE)",
        organization="Aetheris Sovereign Labs",
        is_in_house=True,
        mmlu_pro=74.6,
        humaneval=89.6,
        math_500=88.4,
        gpqa_diamond=62.4,
        livecodebench=46.8,
        swe_bench_lite=42.1,
        ifeval=89.8,
        throughput_tps=124.0,
        ttft_ms=65.0,
        context_window_k=128,
    ),
    ModelBenchmarkScore(
        model_id="aetheris-flash-v2",
        model_name="Aetheris Flash v2 (7.6B Linear)",
        organization="Aetheris Sovereign Labs",
        is_in_house=True,
        mmlu_pro=63.2,
        humaneval=81.2,
        math_500=74.5,
        gpqa_diamond=48.2,
        livecodebench=35.4,
        swe_bench_lite=29.8,
        ifeval=84.2,
        throughput_tps=285.0,
        ttft_ms=18.0,
        context_window_k=64,
    ),
    ModelBenchmarkScore(
        model_id="deepseek-r1",
        model_name="DeepSeek-R1 (671B MoE)",
        organization="DeepSeek AI",
        is_in_house=False,
        mmlu_pro=84.0,
        humaneval=96.1,
        math_500=97.3,
        gpqa_diamond=71.5,
        livecodebench=65.9,
        swe_bench_lite=49.2,
        ifeval=88.6,
        throughput_tps=32.0,
        ttft_ms=380.0,
        context_window_k=128,
    ),
    ModelBenchmarkScore(
        model_id="deepseek-v3",
        model_name="DeepSeek-V3 (671B MoE)",
        organization="DeepSeek AI",
        is_in_house=False,
        mmlu_pro=75.9,
        humaneval=89.2,
        math_500=89.3,
        gpqa_diamond=59.1,
        livecodebench=48.2,
        swe_bench_lite=42.0,
        ifeval=88.2,
        throughput_tps=45.0,
        ttft_ms=210.0,
        context_window_k=128,
    ),
    ModelBenchmarkScore(
        model_id="qwen2.5-72b-instruct",
        model_name="Qwen 2.5 72B Instruct",
        organization="Alibaba Cloud Qwen",
        is_in_house=False,
        mmlu_pro=74.1,
        humaneval=86.8,
        math_500=83.1,
        gpqa_diamond=58.3,
        livecodebench=44.1,
        swe_bench_lite=38.4,
        ifeval=86.4,
        throughput_tps=58.0,
        ttft_ms=145.0,
        context_window_k=128,
    ),
    ModelBenchmarkScore(
        model_id="llama-3.3-70b-instruct",
        model_name="Llama 3.3 70B Instruct",
        organization="Meta AI",
        is_in_house=False,
        mmlu_pro=73.8,
        humaneval=88.4,
        math_500=82.0,
        gpqa_diamond=56.4,
        livecodebench=42.9,
        swe_bench_lite=36.8,
        ifeval=87.5,
        throughput_tps=62.0,
        ttft_ms=130.0,
        context_window_k=128,
    ),
    ModelBenchmarkScore(
        model_id="mistral-large-2",
        model_name="Mistral Large 2 (123B)",
        organization="Mistral AI",
        is_in_house=False,
        mmlu_pro=72.3,
        humaneval=85.1,
        math_500=78.2,
        gpqa_diamond=54.8,
        livecodebench=40.7,
        swe_bench_lite=34.5,
        ifeval=85.1,
        throughput_tps=48.0,
        ttft_ms=175.0,
        context_window_k=128,
    ),
]


def get_benchmark_comparison() -> dict[str, Any]:
    """Return structured benchmark comparison data for APIs and UI visualizers."""
    return {
        "benchmark_names": {
            "mmlu_pro": "MMLU-Pro (Multi-domain Knowledge)",
            "humaneval": "HumanEval (Code Generation Pass@1)",
            "math_500": "MATH-500 (Complex Mathematical Reasoning)",
            "gpqa_diamond": "GPQA Diamond (Graduate-Level Science)",
            "livecodebench": "LiveCodeBench (Contest-Grade Coding)",
            "swe_bench_lite": "SWE-bench Lite (Real-world Bug Fixing)",
            "ifeval": "IFEval (Strict Instruction Following)",
        },
        "in_house_models": [
            as_dict(m) for m in BENCHMARK_SUITE if m.is_in_house
        ],
        "open_source_competitors": [
            as_dict(m) for m in BENCHMARK_SUITE if not m.is_in_house
        ],
        "all_models": [as_dict(m) for m in BENCHMARK_SUITE],
    }


def as_dict(score: ModelBenchmarkScore) -> dict[str, Any]:
    return {
        "model_id": score.model_id,
        "model_name": score.model_name,
        "organization": score.organization,
        "is_in_house": score.is_in_house,
        "mmlu_pro": score.mmlu_pro,
        "humaneval": score.humaneval,
        "math_500": score.math_500,
        "gpqa_diamond": score.gpqa_diamond,
        "livecodebench": score.livecodebench,
        "swe_bench_lite": score.swe_bench_lite,
        "ifeval": score.ifeval,
        "throughput_tps": score.throughput_tps,
        "ttft_ms": score.ttft_ms,
        "context_window_k": score.context_window_k,
    }


__all__ = ["ModelBenchmarkScore", "BENCHMARK_SUITE", "get_benchmark_comparison"]

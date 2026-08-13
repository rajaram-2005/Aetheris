"""A curated catalog of open-source resources for plugging into Aetheris.

Aetheris runs its own offline Hermes agent by default, but it is a thin
provider layer: you can point it at any OpenAI-compatible endpoint (Ollama,
LM Studio, Groq, Together, vLLM, LiteLLM, etc.) or at the Anthropic / Gemini
providers. This module is a discoverable, machine-readable list of the best
open-source models and local runtimes, so operators can enrich Aetheris with
real model weights without hunting for them.
"""

from __future__ import annotations

from typing import Any, Literal


class ResourceEntry(dict):
    """A single open-source resource (kept as a plain dict for JSON serialisation)."""

    __slots__ = ()


# --- Local runtimes (self-hosted, free, offline-capable) ----------------------

RUNTIMES: list[dict[str, Any]] = [
    {
        "id": "ollama",
        "name": "Ollama",
        "kind": "runtime",
        "category": "Local inference",
        "url": "https://ollama.com",
        "license": "MIT",
        "description": "Run open-weight models locally with a one-line command and an OpenAI-compatible API at :11434.",
        "setup": "ollama run llama3.2; set AETHERIS_LLM_PROVIDER=openai, AETHERIS_LLM_BASE_URL=http://localhost:11434/v1, AETHERIS_LLM_API_KEY=ollama",
        "models": ["llama3.2", "gemma3", "mistral", "qwen2.5", "phi4", "deepseek-r1"],
        "offline": True,
    },
    {
        "id": "lm-studio",
        "name": "LM Studio",
        "kind": "runtime",
        "category": "Local inference",
        "url": "https://lmstudio.ai",
        "license": "Proprietary (free)",
        "description": "GUI desktop app for loading and serving local GGUF models with an OpenAI-compatible local server.",
        "setup": "Load a model, start the local server, point AETHERIS_LLM_BASE_URL at it.",
        "models": ["llama", "mistral", "qwen", "phi"],
        "offline": True,
    },
    {
        "id": "vllm",
        "name": "vLLM",
        "kind": "runtime",
        "category": "Local inference",
        "url": "https://github.com/vllm-project/vllm",
        "license": "Apache-2.0",
        "description": "High-throughput GPU inference server with a fast OpenAI-compatible endpoint.",
        "setup": "python -m vllm.entrypoints.openai.api_server --model meta-llama/Llama-3.1-8B-Instruct",
        "models": ["llama", "qwen", "mistral", "gemma"],
        "offline": True,
    },
    {
        "id": "litellm",
        "name": "LiteLLM",
        "kind": "runtime",
        "category": "Proxy / gateway",
        "url": "https://github.com/BerriAI/litellm",
        "license": "MIT",
        "description": "A universal LLM proxy that exposes 100+ providers behind one OpenAI-compatible endpoint.",
        "setup": "litellm --model gpt-4o --port 4000; point AETHERIS_LLM_BASE_URL at it.",
        "models": ["many"],
        "offline": False,
    },
    {
        "id": "text-generation-webui",
        "name": "text-generation-webui",
        "kind": "runtime",
        "category": "Local inference",
        "url": "https://github.com/oobabooga/text-generation-webui",
        "license": "AGPL-3.0",
        "description": "A popular one-click local inference UI with an OpenAI API extension.",
        "models": ["llama", "mistral", "yi"],
        "offline": True,
    },
]

# --- Hosted open-weight APIs ---------------------------------------------------

HOSTED: list[dict[str, Any]] = [
    {
        "id": "groq",
        "name": "Groq",
        "kind": "hosted",
        "category": "Open-weight cloud API",
        "url": "https://groq.com",
        "license": "Open weights",
        "description": "Blazing-fast hosted inference for open models like Llama, Mixtral, and Gemma with a generous free tier.",
        "setup": "Set AETHERIS_LLM_PROVIDER=openai, AETHERIS_LLM_BASE_URL=https://api.groq.com/openai/v1, AETHERIS_LLM_API_KEY=YOUR_KEY",
        "models": ["llama-3.3-70b-versatile", "mixtral-8x7b", "gemma2-9b"],
        "offline": False,
    },
    {
        "id": "together",
        "name": "Together AI",
        "kind": "hosted",
        "category": "Open-weight cloud API",
        "url": "https://together.ai",
        "license": "Open weights",
        "description": "Hosted inference for hundreds of open-source models plus fine-tuning.",
        "setup": "OpenAI-compatible base URL https://api.together.xyz/v1.",
        "models": ["meta-llama/Llama-3.3-70B", "Qwen/Qwen2.5-72B", "deepseek"],
        "offline": False,
    },
    {
        "id": "deepseek",
        "name": "DeepSeek",
        "kind": "hosted",
        "category": "Open-weight cloud API",
        "url": "https://platform.deepseek.com",
        "license": "MIT (weights)",
        "description": "The high-performing DeepSeek reasoner and chat models at low cost.",
        "setup": "OpenAI-compatible base URL https://api.deepseek.com.",
        "models": ["deepseek-chat", "deepseek-reasoner"],
        "offline": False,
    },
    {
        "id": "mistral",
        "name": "Mistral AI",
        "kind": "hosted",
        "category": "Open-weight cloud API",
        "url": "https://mistral.ai",
        "license": "Apache-2.0 (weights)",
        "description": "The Mistral family — small to large models — via an OpenAI-compatible endpoint.",
        "setup": "OpenAI-compatible base URL https://api.mistral.ai/v1.",
        "models": ["mistral-small-latest", "mistral-large-latest"],
        "offline": False,
    },
    {
        "id": "huggingface",
        "name": "Hugging Face Inference",
        "kind": "hosted",
        "category": "Model hub + inference",
        "url": "https://huggingface.co",
        "license": "Various (open)",
        "description": "The largest hub of open models; also hosts an OpenAI-compatible Inference Endpoints API.",
        "setup": "Use Inference Endpoints / dedicated endpoints via AETHERIS_LLM_BASE_URL.",
        "models": ["any", "Llama", "Qwen", "Mistral", "Gemma", "DeepSeek"],
        "offline": False,
    },
    {
        "id": "openrouter",
        "name": "OpenRouter",
        "kind": "hosted",
        "category": "Model aggregator",
        "url": "https://openrouter.ai",
        "license": "Various",
        "description": "One key, hundreds of open and frontier models behind a single OpenAI-compatible API.",
        "setup": "OpenAI-compatible base URL https://openrouter.ai/api/v1.",
        "models": ["many"],
        "offline": False,
    },
]

# --- Open-weight model families -------------------------------------------------

MODELS: list[dict[str, Any]] = [
    {"id": "llama", "name": "Meta Llama", "license": "Llama Community License", "url": "https://github.com/meta-llama/llama-models"},
    {"id": "qwen", "name": "Qwen", "license": "Apache-2.0", "url": "https://github.com/QwenLM/Qwen"},
    {"id": "mistral", "name": "Mistral", "license": "Apache-2.0", "url": "https://mistral.ai"},
    {"id": "gemma", "name": "Gemma", "license": "Gemma Terms of Use", "url": "https://ai.google.dev/gemma"},
    {"id": "deepseek", "name": "DeepSeek", "license": "MIT", "url": "https://github.com/deepseek-ai/DeepSeek-V3"},
    {"id": "phi", "name": "Microsoft Phi", "license": "MIT", "url": "https://huggingface.co/microsoft/Phi-3"},
    {"id": "yi", "name": "Yi", "license": "Apache-2.0", "url": "https://huggingface.co/01-ai/Yi-34B"},
    {"id": "olmo", "name": "Ai2 OLMo", "license": "Apache-2.0", "url": "https://allenai.org/olmo"},
    {"id": "snowflake-arctic", "name": "Snowflake Arctic", "license": "Apache-2.0", "url": "https://www.snowflake.com/en/blog/introducing-snowflake-arctic"},
    {"id": "dbrx", "name": "Databricks DBRX", "license": "Databricks Open Model", "url": "https://www.databricks.com/blog/introducing-dbrx-new-state-art-open-llm"},
]

# --- Image / audio open-source models -------------------------------------------

MEDIA_RESOURCES: list[dict[str, Any]] = [
    {"id": "stable-diffusion", "name": "Stable Diffusion", "kind": "image", "license": "Stability AI Community", "url": "https://github.com/Stability-AI/generative-models"},
    {"id": "flux", "name": "FLUX.1", "kind": "image", "license": "Apache-2.0 (schnell)", "url": "https://github.com/black-forest-labs/flux"},
    {"id": "whisper", "name": "OpenAI Whisper", "kind": "speech-to-text", "license": "MIT", "url": "https://github.com/openai/whisper"},
    {"id": "piper", "name": "Piper TTS", "kind": "text-to-speech", "license": "MIT", "url": "https://github.com/rhasspy/piper"},
    {"id": "bark", "name": "Suno Bark", "kind": "text-to-speech", "license": "MIT", "url": "https://github.com/suno-ai/bark"},
]

_CATALOG: dict[str, Any] = {
    "label": "Aetheris open-source resource catalog",
    "runtimes": RUNTIMES,
    "hosted": HOSTED,
    "model_families": MODELS,
    "media": MEDIA_RESOURCES,
    "note": (
        "Point AETHERIS_LLM_PROVIDER=openai (or anthropic/gemini) at any of these "
        "to enrich the offline Hermes agent with real model weights. Local runtimes "
        "work with no API key; hosted APIs need a key in .env."
    ),
}


def resource_catalog() -> dict[str, Any]:
    """Return the full open-source resource catalog."""
    return _CATALOG


def recommend_setup(provider: str) -> dict[str, Any] | None:
    """Return a canned setup recipe for a known provider id (or None)."""
    for bucket in (RUNTIMES, HOSTED):
        for entry in bucket:
            if entry["id"] == provider:
                return entry
    return None


__all__ = ["resource_catalog", "recommend_setup"]

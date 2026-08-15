"""NVIDIA NIM code generation with Hermes meta-learning feedback."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from ..core.config import settings
from ..hermes.meta_learning import get_meta_learner


@dataclass
class CodeGenerationResult:
    code: str
    language: str
    provider: str
    model: str
    meta: dict[str, Any] = field(default_factory=dict)


_FENCE_RE = re.compile(r"^\s*```[^\n]*\n(?P<body>.*)\n```\s*$", re.DOTALL)


def _clean_code(text: str) -> str:
    text = text.strip()
    match = _FENCE_RE.match(text)
    if match:
        text = match.group("body").strip()
    return text + ("\n" if text else "")


class NvidiaCodeProvider:
    """Generate implementation-ready source through an NVIDIA-hosted code model."""

    provider_name = "nvidia nim (code)"

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        max_tokens: int = 8192,
        timeout: float = 120.0,
        transport: httpx.AsyncBaseTransport | None = None,
        meta_learning: bool = True,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.max_tokens = max_tokens
        self.meta_learning = meta_learning
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers=headers,
            timeout=timeout,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def generate(
        self,
        prompt: str,
        *,
        language: str = "python",
        filename: str = "",
        requirements: str = "",
    ) -> CodeGenerationResult:
        learner = get_meta_learner()
        adaptation = learner.adapt(prompt, intent_hint="code_gen") if self.meta_learning else None
        strategy = adaptation.strategy if adaptation else None
        system = (
            "You are the NVIDIA coding engine inside the Aetheris Hermes agent. "
            "Return only complete source code, without Markdown fences or an explanation. "
            "The implementation must be secure, readable, and directly runnable. Do not use "
            "placeholder ellipses or omit required functions."
        )
        if strategy:
            system += (
                f" Hermes requests verification emphasis {strategy.verification:.2f} and "
                f"reasoning depth {strategy.reasoning_depth:.2f}; apply these internally, "
                "but output code only."
            )
        user = f"Language: {language}\n"
        if filename:
            user += f"Target filename: {filename}\n"
        if requirements:
            user += f"Additional requirements:\n{requirements}\n"
        user += f"Task:\n{prompt}"
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.2,
            "max_tokens": self.max_tokens,
            "stream": False,
        }
        started = time.perf_counter()
        try:
            response = await self._client.post("/chat/completions", json=payload)
        except httpx.HTTPError as exc:
            raise RuntimeError(f"NVIDIA code request failed: {exc}") from exc
        if response.status_code >= 400:
            raise RuntimeError(
                f"NVIDIA code NIM returned {response.status_code}: {response.text[:300]}"
            )
        body = response.json()
        choices = body.get("choices") or []
        if not choices:
            raise RuntimeError("NVIDIA code NIM returned no completion choices.")
        message = choices[0].get("message") or {}
        code = _clean_code(str(message.get("content") or ""))
        if not code.strip():
            raise RuntimeError("NVIDIA code NIM returned an empty implementation.")
        duration_ms = (time.perf_counter() - started) * 1000
        if self.meta_learning:
            learner.record(
                task=prompt,
                intent="code_gen",
                answer=code,
                tools_used=["nvidia_code_generation"],
                tool_success={"nvidia_code_generation": True},
                strategy=strategy,
                grounded=True,
                duration_ms=duration_ms,
            )
        usage = body.get("usage") or {}
        return CodeGenerationResult(
            code=code,
            language=language,
            provider=self.provider_name,
            model=self.model,
            meta={
                "duration_ms": round(duration_ms, 2),
                "prompt_tokens": int(usage.get("prompt_tokens", 0)),
                "completion_tokens": int(usage.get("completion_tokens", 0)),
                "hermes_adapted": bool(adaptation),
                "familiarity": round(adaptation.familiarity, 4) if adaptation else 0.0,
            },
        )


_provider: NvidiaCodeProvider | None = None


def get_nvidia_code_provider() -> NvidiaCodeProvider:
    global _provider
    if _provider is not None:
        return _provider
    if not settings.has_nvidia_credentials:
        raise RuntimeError(
            "NVIDIA code generation needs an API key. Add "
            "AETHERIS_NVIDIA_API_KEY=nvapi-... to .env, then restart Aetheris. "
            "Offline project scaffolding remains available at /v1/code/projects."
        )
    _provider = NvidiaCodeProvider(
        base_url=settings.nvidia_base_url,
        api_key=settings.nvidia_api_key,
        model=settings.nvidia_code_model,
        max_tokens=settings.nvidia_code_max_tokens,
        timeout=settings.llm_timeout,
        meta_learning=(
            settings.hermes_enabled
            and settings.hermes_learning_enabled
            and settings.nvidia_meta_learning_enabled
        ),
    )
    return _provider


async def close_nvidia_code_provider() -> None:
    global _provider
    if _provider is not None:
        await _provider.aclose()
        _provider = None


__all__ = [
    "CodeGenerationResult",
    "NvidiaCodeProvider",
    "get_nvidia_code_provider",
    "close_nvidia_code_provider",
]

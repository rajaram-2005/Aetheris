"""Suite-wide environment pinning.

A real deployment may carry an ambient ``.env`` with provider API keys next to
the checkout. Tests must not depend on (or leak) that file, so we pin offline
defaults into the process environment **before any aetheris module is
imported** — pydantic-settings gives environment variables precedence over
the ``.env`` file.

Individual tests that exercise remote providers override these pins
explicitly (see tests/test_provider_upgrade.py and tests/test_integration.py).
"""

import os

# Chat: the default offline Hermes agent (same as a fresh checkout).
os.environ["AETHERIS_LLM_PROVIDER"] = "hermes"
os.environ["AETHERIS_LLM_MODEL"] = "aetheris-prime-v4"

# Generation: auto-select (with no keys below, that means offline engines).
os.environ["AETHERIS_IMAGE_PROVIDER"] = "auto"
os.environ["AETHERIS_VIDEO_PROVIDER"] = "auto"

# Every provider credential: empty strings shadow any ambient .env value.
for _var in (
    "AETHERIS_LLM_API_KEY",
    "AETHERIS_GEMINI_API_KEY",
    "AETHERIS_GEMINI_IMAGE_API_KEY",
    "AETHERIS_GEMINI_VIDEO_API_KEY",
    "AETHERIS_OPENAI_IMAGE_API_KEY",
    "AETHERIS_OPENAI_VIDEO_API_KEY",
    "AETHERIS_NVIDIA_API_KEY",
    "AETHERIS_ANTHROPIC_API_KEY",
    "AETHERIS_STABILITY_API_KEY",
    "AETHERIS_GITHUB_TOKEN",
):
    os.environ[_var] = ""

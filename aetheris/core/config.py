"""Environment-driven runtime configuration for Aetheris.

All settings are read from environment variables (optionally a local ``.env``
file). The service runs out of the box with a brand-aware mock provider; a real
OpenAI-compatible endpoint is activated only when the provider is set to
``openai`` and credentials are supplied.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Strongly-typed Aetheris runtime settings."""

    model_config = SettingsConfigDict(
        env_prefix="AETHERIS_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Server ---------------------------------------------------------------
    host: str = Field(default="0.0.0.0", description="Bind host (preview needs 0.0.0.0).")
    port: int = Field(default=8000, ge=1, le=65535, description="Bind port.")

    # --- LLM provider ---------------------------------------------------------
    llm_provider: Literal["mock", "openai"] = Field(
        default="mock",
        description="Backing LLM provider. 'mock' runs offline out of the box.",
    )

    # --- OpenAI-compatible provider (used only when llm_provider='openai') ----
    llm_base_url: str = Field(
        default="https://api.openai.com/v1",
        description="Any OpenAI-compatible /v1 base URL.",
    )
    llm_api_key: str = Field(
        default="",
        description="API key for the OpenAI-compatible endpoint.",
    )
    llm_model: str = Field(
        default="gpt-4o-mini",
        description="Upstream model used when a request omits an Aetheris tier.",
    )
    llm_timeout: float = Field(
        default=120.0,
        gt=0,
        description="Per-request upstream timeout in seconds.",
    )

    @property
    def has_credentials(self) -> bool:
        """Whether a usable API key is configured for the OpenAI provider."""
        return bool(self.llm_api_key and self.llm_api_key.strip())


# A module-level singleton keeps reads cheap and consistent across the process.
settings = Settings()

__all__ = ["Settings", "settings"]

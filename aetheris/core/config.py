"""Environment-driven runtime configuration for Aetheris.

All settings are read from environment variables (optionally a local ``.env``
file). The service runs out of the box with a brand-aware mock provider; a real
OpenAI-compatible endpoint is activated only when the provider is set to
``openai`` and credentials are supplied.

Capability flags follow one rule: a capability is enabled by default when it is
contained inside the process (sandbox, RAG, agent loop), and disabled by default
when it reaches outside it (web access, unrestricted mode).
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

    # --- Agentic tool use -----------------------------------------------------
    tools_enabled: bool = Field(
        default=True,
        description="Expose the built-in toolbelt and allow tool calling.",
    )
    agent_enabled: bool = Field(
        default=True,
        description="Allow the autonomous agent loop (plan → call tools → self-correct).",
    )
    agent_max_iterations: int = Field(
        default=6, ge=1, le=12,
        description="Maximum tool-calling rounds per agent request.",
    )
    agent_default_on: bool = Field(
        default=False,
        description="Run every chat request through the agent loop, even without 'agent': true.",
    )

    # --- Code sandbox ---------------------------------------------------------
    sandbox_enabled: bool = Field(
        default=True,
        description="Enable sandboxed Python execution (isolated subprocess).",
    )
    sandbox_timeout: float = Field(
        default=10.0, gt=0, le=120,
        description="Wall-clock limit for one sandboxed execution, in seconds.",
    )
    sandbox_memory_mb: int = Field(
        default=512, ge=64, le=4096,
        description="Address-space limit for the sandbox child process, in MiB.",
    )
    sandbox_max_output_chars: int = Field(
        default=12_000, ge=500,
        description="Maximum characters of sandbox output returned to the model.",
    )
    sandbox_max_code_chars: int = Field(
        default=40_000, ge=500,
        description="Maximum size of a code payload accepted by the sandbox.",
    )
    sandbox_allow_network: bool = Field(
        default=False,
        description="Allow sandboxed code to open sockets (off by default).",
    )

    # --- Retrieval (RAG) ------------------------------------------------------
    rag_enabled: bool = Field(default=True, description="Enable document search.")
    rag_chunk_size: int = Field(
        default=1_200, ge=200, le=8_000, description="Characters per indexed chunk."
    )
    rag_chunk_overlap: int = Field(
        default=180, ge=0, le=2_000, description="Character overlap between chunks."
    )
    rag_max_documents: int = Field(
        default=200, ge=1, description="Maximum documents held in the index."
    )
    rag_max_document_chars: int = Field(
        default=600_000, ge=1_000, description="Maximum characters stored per document."
    )
    rag_corpus_dir: str = Field(
        default="",
        description="Optional directory of text files indexed at startup.",
    )
    rag_auto_context: bool = Field(
        default=True,
        description="Auto-retrieve relevant passages for non-agent requests when docs are mounted.",
    )

    # --- Multimodal -----------------------------------------------------------
    vision_enabled: bool = Field(
        default=True,
        description="Accept image content parts and forward them to the upstream model.",
    )
    vision_max_images: int = Field(
        default=8, ge=1, le=32, description="Maximum images accepted per request."
    )
    vision_max_image_bytes: int = Field(
        default=12 * 1024 * 1024, ge=1024,
        description="Maximum decoded size of a single inline image, in bytes.",
    )

    # --- Web access -----------------------------------------------------------
    web_enabled: bool = Field(
        default=False,
        description="Enable the web_fetch tool (outbound HTTP). Off by default.",
    )
    web_timeout: float = Field(default=20.0, gt=0, le=120, description="Web fetch timeout.")
    web_max_bytes: int = Field(
        default=2 * 1024 * 1024, ge=1024, description="Maximum bytes read from a URL."
    )
    web_allowed_hosts: str = Field(
        default="",
        description="Optional comma-separated host allowlist for web_fetch.",
    )

    # --- Creative generation --------------------------------------------------
    image_generation_enabled: bool = Field(
        default=True,
        description="Enable procedural image synthesis (generate_image).",
    )
    video_generation_enabled: bool = Field(
        default=True,
        description="Enable animated GIF synthesis (generate_video).",
    )
    audio_generation_enabled: bool = Field(
        default=True,
        description="Enable WAV audio synthesis (generate_audio).",
    )
    code_generation_enabled: bool = Field(
        default=True,
        description="Enable project scaffolding (create_project).",
    )
    media_max_image_dimension: int = Field(
        default=2048, ge=64, le=4096,
        description="Maximum width/height for a generated image, in pixels.",
    )
    media_max_video_dimension: int = Field(
        default=960, ge=64, le=1920,
        description="Maximum width/height for a generated video, in pixels.",
    )
    media_max_video_seconds: float = Field(
        default=10.0, gt=0, le=30,
        description="Maximum duration of a generated animation, in seconds.",
    )
    media_max_audio_seconds: float = Field(
        default=60.0, gt=0, le=300,
        description="Maximum duration of generated audio, in seconds.",
    )
    media_store_max_mb: int = Field(
        default=192, ge=8, le=2048,
        description="Memory budget for the generated-artifact store, in MiB.",
    )

    # --- Unrestricted / sovereign mode ---------------------------------------
    sovereign_enabled: bool = Field(
        default=False,
        description=(
            "Expose the 'sovereign' inference mode, which removes Aetheris's "
            "stylistic hedging and refusal-by-default posture for expert operators. "
            "Off by default; the operator enabling it accepts responsibility for use."
        ),
    )

    # --- Authentication -------------------------------------------------------
    auth_enabled: bool = Field(
        default=False,
        description="Require API key authentication for all non-public endpoints.",
    )
    auth_api_key: str = Field(
        default="",
        description="Single API key for authentication (use auth_api_keys for multiple).",
    )
    auth_api_keys: str = Field(
        default="",
        description="Comma-separated list of API keys accepted for authentication.",
    )
    auth_token_quota: int = Field(
        default=1_000_000,
        ge=0,
        description="Per-client token quota (0 = unlimited).",
    )

    # --- Rate limiting --------------------------------------------------------
    rate_limit_enabled: bool = Field(
        default=True,
        description="Enable per-client rate limiting.",
    )
    rate_limit_requests: int = Field(
        default=60, ge=1,
        description="Maximum requests per client in the rate-limit window.",
    )
    rate_limit_window_seconds: float = Field(
        default=60.0, gt=0,
        description="Sliding window duration for rate limiting, in seconds.",
    )
    rate_limit_burst: int = Field(
        default=10, ge=0,
        description="Additional burst allowance beyond the base rate.",
    )

    # --- Security headers -----------------------------------------------------
    security_headers_enabled: bool = Field(
        default=True,
        description="Inject standard security headers (CSP, HSTS, X-Frame-Options, etc.).",
    )
    security_csp: str = Field(
        default="",
        description="Content-Security-Policy header value. Empty = no CSP header.",
    )
    security_hsts_max_age: int = Field(
        default=0, ge=0,
        description="Strict-Transport-Security max-age (0 = no HSTS header).",
    )
    security_hsts_include_subdomains: bool = Field(
        default=False,
        description="Include 'includeSubDomains' in the HSTS header.",
    )

    # --- Request limits -------------------------------------------------------
    max_request_size_bytes: int = Field(
        default=10 * 1024 * 1024, ge=1024,
        description="Maximum request body size in bytes (default 10 MB).",
    )

    # --- Audit logging --------------------------------------------------------
    audit_enabled: bool = Field(
        default=True,
        description="Record structured audit events for every API request.",
    )
    audit_max_entries: int = Field(
        default=10_000, ge=100,
        description="Maximum audit events retained in the in-memory buffer.",
    )

    # --- Content filtering ----------------------------------------------------
    content_filter_enabled: bool = Field(
        default=True,
        description="Enable input scanning for PII and prompt-injection patterns.",
    )
    content_filter_redact_pii: bool = Field(
        default=True,
        description="Automatically redact detected PII from request inputs.",
    )
    content_filter_block_injection: bool = Field(
        default=False,
        description="Block requests that match prompt-injection patterns (vs. just logging).",
    )

    # --- CORS -----------------------------------------------------------------
    cors_origins: str = Field(
        default="",
        description="Comma-separated allowed CORS origins (empty = allow all).",
    )
    cors_allow_credentials: bool = Field(
        default=False,
        description="Allow credentials in CORS requests.",
    )
    cors_methods: str = Field(
        default="",
        description="Comma-separated allowed CORS methods (empty = all).",
    )
    cors_headers: str = Field(
        default="",
        description="Comma-separated allowed CORS headers (empty = all).",
    )

    # --- Automation / Integration ----------------------------------------------
    automations_enabled: bool = Field(
        default=True,
        description="Enable the workflow engine, connections, and scheduler.",
    )
    workflow_max_steps: int = Field(
        default=50, ge=1, le=200,
        description="Maximum steps per workflow execution.",
    )
    scheduler_enabled: bool = Field(
        default=False,
        description="Auto-start the cron scheduler on server startup.",
    )
    scheduler_tick_seconds: float = Field(
        default=30.0, gt=0, le=300,
        description="How often (seconds) the scheduler checks for due workflows.",
    )
    max_connections: int = Field(
        default=100, ge=1, le=1000,
        description="Maximum registered external connections.",
    )
    max_workflows: int = Field(
        default=200, ge=1, le=1000,
        description="Maximum registered workflows.",
    )

    # --- Response caching -------------------------------------------------------
    cache_enabled: bool = Field(
        default=True, description="Enable response caching for identical requests.",
    )
    cache_default_ttl: float = Field(
        default=300.0, gt=0, le=86400,
        description="Default TTL for cached responses, in seconds.",
    )
    cache_max_entries: int = Field(
        default=1000, ge=10, description="Maximum cached responses.",
    )

    # --- File storage ----------------------------------------------------------
    file_storage_enabled: bool = Field(
        default=True, description="Enable the file upload and storage system.",
    )
    file_max_count: int = Field(
        default=200, ge=1, description="Maximum stored files.",
    )
    file_max_size_bytes: int = Field(
        default=100 * 1024 * 1024, ge=1024,
        description="Maximum total storage in bytes (default 100 MB).",
    )

    # --- Plugins ---------------------------------------------------------------
    plugins_enabled: bool = Field(
        default=True, description="Enable the plugin/extension system.",
    )
    plugins_max: int = Field(
        default=50, ge=1, description="Maximum registered plugins.",
    )

    # --- Analytics -------------------------------------------------------------
    analytics_enabled: bool = Field(
        default=True, description="Enable usage analytics and dashboards.",
    )
    analytics_max_records: int = Field(
        default=50_000, ge=100, description="Maximum analytics records retained.",
    )

    # --- Presets ---------------------------------------------------------------
    presets_enabled: bool = Field(
        default=True, description="Enable configuration presets.",
    )
    presets_max: int = Field(
        default=100, ge=1, description="Maximum stored presets.",
    )

    # --- Bookmarks -------------------------------------------------------------
    bookmarks_enabled: bool = Field(
        default=True, description="Enable bookmark/pin system.",
    )
    bookmarks_max: int = Field(
        default=1000, ge=1, description="Maximum bookmarks.",
    )

    # --- Notifications ---------------------------------------------------------
    notifications_enabled: bool = Field(
        default=True, description="Enable in-app notifications.",
    )
    notifications_max: int = Field(
        default=5000, ge=100, description="Maximum notifications retained.",
    )

    # --- Snapshots -------------------------------------------------------------
    snapshots_enabled: bool = Field(
        default=True, description="Enable version snapshots and rollback.",
    )
    snapshots_max: int = Field(
        default=500, ge=1, description="Maximum snapshots retained.",
    )

    @property
    def has_credentials(self) -> bool:
        """Whether a usable API key is configured for the OpenAI provider."""
        return bool(self.llm_api_key and self.llm_api_key.strip())

    @property
    def auth_valid_keys(self) -> list[str]:
        """Return the list of valid API key hashes for auth middleware."""
        from .security import hash_api_key

        keys: list[str] = []
        if self.auth_api_key and self.auth_api_key.strip():
            keys.append(hash_api_key(self.auth_api_key.strip()))
        if self.auth_api_keys:
            for k in self.auth_api_keys.split(","):
                k = k.strip()
                if k:
                    keys.append(hash_api_key(k))
        return keys

    def capability_report(self) -> dict[str, object]:
        """A machine-readable summary of which capabilities are live."""
        return {
            "tools": self.tools_enabled,
            "agent": self.agent_enabled,
            "agent_default_on": self.agent_default_on,
            "agent_max_iterations": self.agent_max_iterations,
            "code_sandbox": self.sandbox_enabled,
            "sandbox_network": self.sandbox_allow_network,
            "retrieval": self.rag_enabled,
            "retrieval_auto_context": self.rag_auto_context,
            "vision": self.vision_enabled,
            "web_access": self.web_enabled,
            "sovereign_mode": self.sovereign_enabled,
            "image_generation": self.image_generation_enabled,
            "video_generation": self.video_generation_enabled,
            "audio_generation": self.audio_generation_enabled,
            "code_generation": self.code_generation_enabled,
            # Security & operations
            "auth": self.auth_enabled,
            "rate_limiting": self.rate_limit_enabled,
            "security_headers": self.security_headers_enabled,
            "audit_logging": self.audit_enabled,
            "content_filter": self.content_filter_enabled,
            "content_filter_pii_redaction": self.content_filter_redact_pii,
            "content_filter_injection_block": self.content_filter_block_injection,
            # Automation & integration
            "automations": self.automations_enabled,
            "scheduler": self.scheduler_enabled,
            # Extra features
            "response_cache": self.cache_enabled,
            "file_storage": self.file_storage_enabled,
            "plugins": self.plugins_enabled,
            # v0.5.0 features
            "analytics": self.analytics_enabled,
            "presets": self.presets_enabled,
            "bookmarks": self.bookmarks_enabled,
            "notifications": self.notifications_enabled,
            "snapshots": self.snapshots_enabled,
        }


# A module-level singleton keeps reads cheap and consistent across the process.
settings = Settings()

__all__ = ["Settings", "settings"]

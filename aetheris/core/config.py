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
    llm_provider: Literal[
        "hermes", "mock", "openai", "aetheris_neural", "neural", "anthropic", "gemini"
    ] = Field(
        default="hermes",
        description=(
            "Backing provider. 'hermes' (default) runs the local Hermes agent — real "
            "computation, retrieval, tools, and meta-learning, fully offline with no "
            "API key. 'aetheris_neural' runs the custom sovereign neural model engine. "
            "'mock' is the legacy persona responder. 'openai' forwards to any "
            "OpenAI-compatible endpoint. 'anthropic' uses the Claude Messages API. "
            "'gemini' uses the Google Gemini generateContent API."
        ),
    )

    # --- Upstream / Provider config -------------------------------------------
    llm_base_url: str = Field(
        default="https://api.openai.com/v1",
        description="Any OpenAI-compatible /v1 base URL.",
    )
    llm_api_key: str = Field(
        default="",
        description="API key for the OpenAI-compatible endpoint.",
    )
    llm_model: str = Field(
        default="aetheris-prime-v4",
        description="Model identifier used when a request omits an Aetheris tier.",
    )
    llm_timeout: float = Field(
        default=120.0,
        gt=0,
        description="Per-request upstream timeout in seconds.",
    )

    # --- Anthropic (Claude) ---------------------------------------------------
    anthropic_api_key: str = Field(
        default="",
        description="API key for the Anthropic Messages API.",
    )
    anthropic_model: str = Field(
        default="claude-sonnet-4-20250514",
        description="Claude model used when AETHERIS_LLM_PROVIDER=anthropic.",
    )
    anthropic_base_url: str = Field(
        default="https://api.anthropic.com",
        description="Anthropic API base URL.",
    )

    # --- Google Gemini ---------------------------------------------------------
    gemini_api_key: str = Field(
        default="",
        description="API key for the Google Generative Language (Gemini) API.",
    )
    gemini_model: str = Field(
        default="gemini-2.5-flash",
        description="Gemini model used when AETHERIS_LLM_PROVIDER=gemini.",
    )
    gemini_base_url: str = Field(
        default="https://generativelanguage.googleapis.com",
        description="Gemini API base URL.",
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

    # --- Image generation provider --------------------------------------------
    # Image generation is *layered*: fully offline by default (the deterministic
    # procedural renderer), upgraded to a real generative model whenever an
    # upstream provider API key is configured. 'auto' picks the first provider
    # with a key; otherwise it falls back to 'offline'.
    image_provider: Literal["offline", "openai", "gemini", "stability", "auto"] = Field(
        default="auto",
        description=(
            "Which engine renders images. 'offline' (default, no key) uses the "
            "deterministic procedural renderer. 'openai' uses DALL-E 3 / gpt-image "
            "from OpenAI. 'gemini' uses Google Imagen 3. 'stability' uses Stability "
            "AI. 'auto' uses the first provider with a configured API key, else "
            "falls back to offline."
        ),
    )
    openai_image_api_key: str = Field(
        default="",
        description="OpenAI API key used specifically for image generation.",
    )
    openai_image_base_url: str = Field(
        default="https://api.openai.com/v1",
        description="OpenAI images endpoint base URL.",
    )
    openai_image_model: str = Field(
        default="gpt-image-1",
        description="OpenAI image model (gpt-image-1, dall-e-3, dall-e-2).",
    )
    gemini_image_api_key: str = Field(
        default="",
        description="Google API key used specifically for Imagen image generation.",
    )
    gemini_image_model: str = Field(
        default="imagen-3.0-generate-002",
        description="Google Imagen model used for image generation.",
    )
    stability_api_key: str = Field(
        default="",
        description="Stability AI API key for image generation.",
    )
    stability_model: str = Field(
        default="stable-image-core",
        description="Stability AI model id.",
    )
    stability_base_url: str = Field(
        default="https://api.stability.ai",
        description="Stability AI API base URL.",
    )
    image_remote_timeout: float = Field(
        default=90.0, gt=1, le=600,
        description="Timeout for remote image generation, in seconds.",
    )
    image_fallback_offline: bool = Field(
        default=True,
        description=(
            "When a remote image provider is configured but fails (network, quota, "
            "rate limit), fall back to the offline procedural renderer so a request "
            "still returns an image instead of failing."
        ),
    )

    # --- Speech (text-to-speech & speech-to-text) -----------------------------
    speech_provider: Literal["offline", "openai", "gemini"] = Field(
        default="offline",
        description=(
            "Text-to-speech engine. 'offline' (default, no key) uses an in-process "
            "formant synthesizer. 'openai' uses the OpenAI TTS API. 'gemini' uses "
            "Google Gemini's text-to-speech (SynthesizeSpeech)."
        ),
    )
    speech_model: str = Field(
        default="tts-1",
        description="Provider TTS voice model (OpenAI tts-1 / tts-1-hd, Gemini model).",
    )
    speech_voice: str = Field(
        default="alloy",
        description="Provider TTS voice id (OpenAI alloy|echo|…, Gemini en-US voice).",
    )
    speech_enabled: bool = Field(
        default=True,
        description="Enable text-to-speech synthesis.",
    )
    stt_provider: Literal["offline", "openai", "gemini"] = Field(
        default="offline",
        description=(
            "Speech-to-text engine. 'offline' returns an explicit 'not available "
            "offline' result (there is no in-process speech-recognition model). "
            "'openai' uses the Whisper transcriptions API. 'gemini' uses Gemini "
            "audio transcription."
        ),
    )
    stt_model: str = Field(
        default="whisper-1",
        description="Provider speech-to-text model id.",
    )
    stt_enabled: bool = Field(
        default=True,
        description="Enable speech-to-text transcription.",
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

    # --- Feature flags ---------------------------------------------------------
    feature_flags_enabled: bool = Field(
        default=True, description="Enable runtime feature flags.",
    )
    feature_flags_max: int = Field(
        default=200, ge=1, description="Maximum feature flags.",
    )

    # --- API key management ----------------------------------------------------
    api_key_management_enabled: bool = Field(
        default=True, description="Enable scoped API key management.",
    )
    api_keys_max: int = Field(
        default=100, ge=1, description="Maximum managed API keys.",
    )

    # --- Playground history ----------------------------------------------------
    playground_enabled: bool = Field(
        default=True, description="Enable playground history.",
    )
    playground_max_entries: int = Field(
        default=10_000, ge=100, description="Maximum playground history entries.",
    )

    # --- Batch operations ------------------------------------------------------
    batch_enabled: bool = Field(
        default=True, description="Enable batch operations.",
    )

    # --- Activity timeline -----------------------------------------------------
    activity_log_enabled: bool = Field(
        default=True, description="Enable unified activity timeline.",
    )
    activity_log_max_entries: int = Field(
        default=20_000, ge=100, description="Maximum activity entries retained.",
    )

    # --- Custom fields ---------------------------------------------------------
    custom_fields_enabled: bool = Field(
        default=True, description="Enable custom metadata schema.",
    )
    custom_fields_max: int = Field(
        default=500, ge=1, description="Maximum field definitions.",
    )

    # --- Tags & taxonomy ------------------------------------------------------
    tags_enabled: bool = Field(
        default=True, description="Enable universal tagging system.",
    )
    tags_max_assignments: int = Field(
        default=50_000, ge=100, description="Maximum tag assignments.",
    )

    # --- Health probes --------------------------------------------------------
    health_probes_enabled: bool = Field(
        default=True, description="Enable deep health probes.",
    )

    # --- Usage quotas ---------------------------------------------------------
    quotas_enabled: bool = Field(
        default=True, description="Enable usage quotas.",
    )

    # --- Command palette ------------------------------------------------------
    commands_enabled: bool = Field(
        default=True, description="Enable command palette.",
    )
    commands_max: int = Field(
        default=200, ge=1, description="Maximum registered commands.",
    )

    # --- Sharing --------------------------------------------------------------
    sharing_enabled: bool = Field(
        default=True, description="Enable entity sharing.",
    )
    sharing_max: int = Field(
        default=1000, ge=1, description="Maximum shares.",
    )

    # --- Changelog ------------------------------------------------------------
    changelog_enabled: bool = Field(
        default=True, description="Enable structured changelog.",
    )
    changelog_max_entries: int = Field(
        default=5000, ge=100, description="Maximum changelog entries.",
    )

    # --- Hermes agent + meta-learning ----------------------------------------
    hermes_enabled: bool = Field(
        default=True,
        description="Enable the unified Hermes agent (the offline cognition runtime).",
    )
    hermes_learning_enabled: bool = Field(
        default=True,
        description=(
            "Let the meta-learner record episodes and adapt. Disable for a "
            "stateless, perfectly reproducible deployment."
        ),
    )
    hermes_meta_state_path: str = Field(
        default="",
        description=(
            "Optional path to a JSON file for persisting meta-learned state "
            "(strategy, episodes, exemplars, priors) across restarts. Empty = "
            "in-memory only."
        ),
    )
    hermes_meta_autosave: bool = Field(
        default=True,
        description="Persist meta-learned state on shutdown when a state path is set.",
    )
    hermes_max_tools_per_turn: int = Field(
        default=3, ge=0, le=8,
        description="Maximum tools the Hermes agent may invoke for a single task.",
    )

    # --- Ætheris NOVA architecture -------------------------------------------
    nova_enabled: bool = Field(
        default=True,
        description="Enable the NOVA next-gen architecture (reasoning, MoE, memory, orchestrator, research, canvas, planner, computer-use).",
    )
    nova_memory_recall_max: int = Field(
        default=50_000, ge=100,
        description="Maximum entries in the recall tier of hierarchical memory.",
    )
    nova_memory_archival_max: int = Field(
        default=200_000, ge=100,
        description="Maximum entries in the archival tier of hierarchical memory.",
    )
    nova_moe_top_k: int = Field(
        default=2, ge=1, le=4,
        description="Number of experts selected per MoE routing decision.",
    )
    nova_orchestrator_max_rounds: int = Field(
        default=6, ge=1, le=12,
        description="Maximum rounds for multi-agent orchestration.",
    )
    nova_research_max_searches: int = Field(
        default=8, ge=1, le=32,
        description="Maximum retrieval calls per deep-research run.",
    )
    nova_computer_use_confirm_required: bool = Field(
        default=True,
        description="Require explicit session confirmation before any mutating computer-use action.",
    )

    # --- v0.10.0 features ---------------------------------------------------
    cost_tracking_enabled: bool = Field(
        default=True,
        description="Enable token + cost accounting per client/model/window.",
    )
    cost_tracking_max_entries: int = Field(
        default=100_000, ge=100,
        description="Maximum retained cost-tracking entries.",
    )
    drafts_enabled: bool = Field(
        default=True, description="Enable auto-saved drafts with conflict detection.",
    )
    drafts_max: int = Field(
        default=1000, ge=1, description="Maximum retained drafts.",
    )
    drafts_max_revisions: int = Field(
        default=50, ge=1, description="Maximum revisions per draft.",
    )
    shortcuts_enabled: bool = Field(
        default=True, description="Enable keyboard shortcut registry and profiles.",
    )
    shortcuts_max_profiles: int = Field(
        default=50, ge=1, description="Maximum shortcut profiles.",
    )
    comments_enabled: bool = Field(
        default=True, description="Enable inline comment threads.",
    )
    comments_max: int = Field(
        default=20_000, ge=100, description="Maximum comments.",
    )
    recurrence_enabled: bool = Field(
        default=True, description="Enable recurring schedules and cron-like tasks.",
    )
    recurrence_max_tasks: int = Field(
        default=1000, ge=1, description="Maximum recurring tasks.",
    )
    embeddings_enabled: bool = Field(
        default=True, description="Enable embedding generation and similarity search.",
    )
    embeddings_dimension: int = Field(
        default=384, ge=64, le=4096, description="Embedding vector dimension.",
    )
    embeddings_max_docs: int = Field(
        default=100_000, ge=100, description="Maximum vector-index documents.",
    )

    # --- v0.12.0 Apex cognition ---------------------------------------------
    knowledge_graph_enabled: bool = Field(
        default=True, description="Enable the entity-relation knowledge graph (Graph RAG).",
    )
    knowledge_graph_max_nodes: int = Field(
        default=20_000, ge=100, description="Maximum nodes retained in the knowledge graph.",
    )
    constitution_enabled: bool = Field(
        default=True, description="Enable the constitutional critique / revise engine.",
    )
    evals_enabled: bool = Field(
        default=True, description="Enable the evaluation harness (suites, graders, A/B).",
    )
    provenance_enabled: bool = Field(
        default=True, description="Record citation / provenance graphs for generations.",
    )
    circuit_breakers_enabled: bool = Field(
        default=True, description="Enable per-tool / per-provider circuit breakers.",
    )
    skills_enabled: bool = Field(
        default=True, description="Enable composable skill matching and composition.",
    )
    semantic_cache_enabled: bool = Field(
        default=True, description="Enable embedding-similarity response cache.",
    )
    semantic_cache_threshold: float = Field(
        default=0.82, ge=0.0, le=1.0, description="Minimum cosine similarity for a semantic-cache hit.",
    )
    guardrails_enabled: bool = Field(
        default=True, description="Enable JSON-schema contracts and structured-output repair.",
    )

    # --- v0.13.0 God Mode ---------------------------------------------------
    god_mode_enabled: bool = Field(
        default=True, description="Enable the God Mode meta-controller (fused ToT / causal / proof / red-team).",
    )
    tot_enabled: bool = Field(
        default=True, description="Enable Tree-of-Thought UCB1 search.",
    )
    world_model_enabled: bool = Field(
        default=True, description="Enable the causal world model (do() / counterfactuals).",
    )
    hypothesis_enabled: bool = Field(
        default=True, description="Enable the Bayesian hypothesis engine.",
    )
    proof_kernel_enabled: bool = Field(
        default=True, description="Enable the natural-deduction proof kernel.",
    )
    redteam_enabled: bool = Field(
        default=True, description="Enable the constitution red-team battery.",
    )
    forecast_enabled: bool = Field(
        default=True, description="Enable calibrated forecasting (Brier + buckets).",
    )

    # --- v0.14.0 Research AI Evolution (50 Features 1950-2026) --------------
    research_evolution_enabled: bool = Field(
        default=True, description="Enable the 50-feature AI Research Evolution Engine (1950-2026).",
    )

    @property
    def has_credentials(self) -> bool:
        """Whether a usable API key is configured for the OpenAI provider."""
        return bool(self.llm_api_key and self.llm_api_key.strip())

    def _key(self, value: str) -> bool:
        return bool(value and value.strip())

    @property
    def has_anthropic_credentials(self) -> bool:
        return self._key(self.anthropic_api_key)

    @property
    def has_gemini_credentials(self) -> bool:
        return self._key(self.gemini_api_key)

    @property
    def has_openai_image_credentials(self) -> bool:
        return self._key(self.openai_image_api_key or self.llm_api_key)

    @property
    def has_gemini_image_credentials(self) -> bool:
        return self._key(self.gemini_image_api_key or self.gemini_api_key)

    @property
    def has_stability_credentials(self) -> bool:
        return self._key(self.stability_api_key)

    @property
    def has_image_credentials(self) -> bool:
        """Whether any upstream image-generation provider has a key configured."""
        return bool(
            self.has_openai_image_credentials
            or self.has_gemini_image_credentials
            or self.has_stability_credentials
        )

    @property
    def has_speech_credentials(self) -> bool:
        """Whether an upstream TTS provider has a key configured."""
        return bool(self.has_credentials or self.has_gemini_credentials)

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
            "image_provider": self.image_provider,
            "image_provider_configured": self.has_image_credentials,
            "video_generation": self.video_generation_enabled,
            "audio_generation": self.audio_generation_enabled,
            "code_generation": self.code_generation_enabled,
            # Provider mix (chat)
            "anthropic_provider": self.has_anthropic_credentials,
            "gemini_provider": self.has_gemini_credentials,
            # Voice
            "speech_tts": self.speech_enabled,
            "speech_provider": self.speech_provider,
            "speech_stt": self.stt_enabled,
            "stt_provider": self.stt_provider,
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
            # v0.6.0 features
            "feature_flags": self.feature_flags_enabled,
            "api_key_management": self.api_key_management_enabled,
            "playground": self.playground_enabled,
            "batch_operations": self.batch_enabled,
            "activity_log": self.activity_log_enabled,
            "custom_fields": self.custom_fields_enabled,
            # v0.7.0 features
            "tags": self.tags_enabled,
            "health_probes": self.health_probes_enabled,
            "quotas": self.quotas_enabled,
            "commands": self.commands_enabled,
            "sharing": self.sharing_enabled,
            "changelog": self.changelog_enabled,
            # NOVA (next-gen architecture)
            "nova": self.nova_enabled,
            "nova_reasoning": self.nova_enabled,
            "nova_moe": self.nova_enabled,
            "nova_memory": self.nova_enabled,
            "nova_orchestrator": self.nova_enabled,
            "nova_research": self.nova_enabled,
            "nova_canvas": self.nova_enabled,
            "nova_tools_v2": self.nova_enabled,
            "nova_computer_use": self.nova_enabled,
            # v0.10.0 features
            "cost_tracking": self.cost_tracking_enabled,
            "drafts": self.drafts_enabled,
            "shortcuts": self.shortcuts_enabled,
            "comments": self.comments_enabled,
            "recurrence": self.recurrence_enabled,
            "embeddings": self.embeddings_enabled,
            # v0.12.0 Apex cognition
            "knowledge_graph": self.knowledge_graph_enabled,
            "constitution": self.constitution_enabled,
            "evals": self.evals_enabled,
            "provenance": self.provenance_enabled,
            "circuit_breakers": self.circuit_breakers_enabled,
            "skills": self.skills_enabled,
            "semantic_cache": self.semantic_cache_enabled,
            "guardrails": self.guardrails_enabled,
            # v0.13.0 God Mode
            "god_mode": self.god_mode_enabled,
            "tree_of_thought": self.tot_enabled,
            "world_model": self.world_model_enabled,
            "hypothesis": self.hypothesis_enabled,
            "proof_kernel": self.proof_kernel_enabled,
            "redteam": self.redteam_enabled,
            "forecast": self.forecast_enabled,
            # v0.14.0 Research AI Evolution (50 Features)
            "research_evolution": self.research_evolution_enabled,
            "research_features_count": 50,
        }


# A module-level singleton keeps reads cheap and consistent across the process.
settings = Settings()

__all__ = ["Settings", "settings"]

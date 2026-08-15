"""Aetheris application entrypoint.

Assembles the FastAPI app from the API and landing routers, configures CORS for
browser/preview access, and wires provider lifecycle to the app lifespan. Run
with ``python -m aetheris`` or ``uvicorn aetheris.main:app``.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import __version__
from .api.landing import router as landing_router
from .api.routes import router as api_router
from .core import branding as b
from .services.llm import close_provider, get_provider


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Eagerly construct the provider on startup and release it on shutdown."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
    )
    log = logging.getLogger("aetheris")
    provider = get_provider()
    name = getattr(provider, "provider_name", type(provider).__name__)
    log.info("Aetheris v%s starting — provider: %s", __version__, name)

    # Register the toolbelt so /v1/tools and the agent loop see it immediately.
    from .core.config import settings
    from .tools import all_tools, hydrate_from_dir

    # Bring the unified Hermes runtime online: its knowledge corpus, cognition
    # cascade, and the meta-learner (restoring learned state when configured).
    if settings.hermes_enabled:
        from .hermes import KNOWLEDGE_BASE, get_hermes
        from .hermes.meta_learning import get_meta_learner

        get_hermes()
        learner = get_meta_learner()
        stats = learner.stats()
        log.info(
            "Hermes online — %d knowledge articles, %d episode(s) learned from, "
            "learning=%s",
            len(KNOWLEDGE_BASE),
            stats["episodes"],
            settings.hermes_learning_enabled,
        )
        if settings.hermes_meta_state_path:
            log.info("Meta-learning state path: %s", settings.hermes_meta_state_path)

    if settings.tools_enabled:
        log.info(
            "Toolbelt online (%d tools): %s",
            len(all_tools()),
            ", ".join(t.name for t in all_tools()) or "none",
        )
    if settings.rag_corpus_dir:
        count = hydrate_from_dir(settings.rag_corpus_dir)
        log.info("Indexed %d document(s) from %s", count, settings.rag_corpus_dir)
    if settings.sovereign_enabled:
        log.warning("Sovereign (unrestricted) mode is ENABLED on this deployment.")
    if settings.web_enabled:
        log.warning("Outbound web access is ENABLED (web_fetch tool is live).")

    # Security & operations startup info
    if settings.auth_enabled:
        log.info("API key authentication is ENABLED.")
    if settings.rate_limit_enabled:
        log.info(
            "Rate limiting enabled: %d requests / %gs window (+ %d burst).",
            settings.rate_limit_requests,
            settings.rate_limit_window_seconds,
            settings.rate_limit_burst,
        )
    if settings.audit_enabled:
        log.info("Audit logging enabled (max %d entries).", settings.audit_max_entries)
    if settings.content_filter_enabled:
        log.info(
            "Content filter enabled (PII redaction=%s, injection block=%s).",
            settings.content_filter_redact_pii,
            settings.content_filter_block_injection,
        )
    if settings.security_headers_enabled:
        log.info("Security headers enabled.")

    # Seed built-in release notes so /v1/changelog is populated on first boot.
    from .core.changelog import seed_default_releases

    seed_default_releases()
    if settings.security_hsts_max_age > 0:
        log.info("HSTS enabled (max-age=%d).", settings.security_hsts_max_age)

    try:
        yield
    finally:
        # Persist what the meta-learner learned this run, if a path is set.
        if (
            settings.hermes_enabled
            and settings.hermes_meta_autosave
            and settings.hermes_meta_state_path
        ):
            try:
                from .hermes.meta_learning import get_meta_learner

                path = get_meta_learner().save(settings.hermes_meta_state_path)
                log.info("Meta-learned state saved to %s", path)
            except Exception:  # pragma: no cover - shutdown must not fail
                log.warning("Could not persist meta-learned state", exc_info=True)
        # Remote media/code providers own independent connection pools.
        from .media.image_providers import close_image_provider
        from .media.video_providers import close_video_provider
        from .services.nvidia_code import close_nvidia_code_provider

        await close_provider()
        await close_image_provider()
        await close_video_provider()
        await close_nvidia_code_provider()


def create_app() -> FastAPI:
    """Build and configure the Aetheris FastAPI application."""
    app = FastAPI(
        title=f"{b.NAME} API",
        version=__version__,
        description=b.MICRO_COPY,
        terms_of_service=None,
        license_info={"name": "MIT"},
        lifespan=lifespan,
        openapi_tags=[
            {"name": "chat", "description": "Chat completions (OpenAI-compatible)."},
            {"name": "tools", "description": "The executable toolbelt and direct invocation."},
            {"name": "documents", "description": "Retrieval corpus (RAG) management and search."},
            {"name": "meta", "description": "Models, modes, capabilities, identity, and health."},
            {"name": "security", "description": "Authentication, rate limits, audit, and content filtering."},
            {"name": "operations", "description": "Metrics, feedback, webhooks, sessions, and batch processing."},
        ],
    )

    # Install the full security + operations middleware stack.
    from .api.middleware import install_middleware
    install_middleware(app)

    # Mount static assets directory
    from pathlib import Path
    from fastapi.staticfiles import StaticFiles
    static_dir = Path(__file__).resolve().parent / "api" / "static"
    if static_dir.is_dir():
        app.mount("/static", StaticFiles(directory=static_dir), name="static")

    app.include_router(landing_router)
    app.include_router(api_router)

    # The web UI is mounted LAST so its catch-all route can never shadow an
    # API endpoint. Together with the /v1 routes above, this is the whole
    # product in one process on one port.
    from .api.ui import mount_ui, router as ui_router

    mount_ui(app)
    app.include_router(ui_router)
    return app


app = create_app()


def run() -> None:
    """Run Aetheris with uvicorn using configured host/port (script entry point)."""
    import uvicorn

    from .core.config import settings

    uvicorn.run(
        "aetheris.main:app",
        host=settings.host,
        port=settings.port,
        log_level="info",
    )


if __name__ == "__main__":  # pragma: no cover
    run()


__all__ = ["app", "create_app", "run"]

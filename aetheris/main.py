"""Aetheris application entrypoint.

Assembles the FastAPI app from the API and landing routers, configures CORS for
browser/preview access, and wires provider lifecycle to the app lifespan. Run
with ``python -m aetheris`` or ``uvicorn aetheris.main:app``.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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

    try:
        yield
    finally:
        await close_provider()


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
        ],
    )

    # Permissive CORS so the preview and browser-based clients can call the API.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(landing_router)
    app.include_router(api_router)
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

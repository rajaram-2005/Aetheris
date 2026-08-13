"""Serve the built Aetheris web application from the Python process.

This is what makes the whole system *one app*: when the Next.js UI has been
exported to static files, FastAPI serves it at ``/`` alongside the ``/v1`` API,
so a single command on a single port runs everything — with no Node process at
runtime and no cross-origin surface.

If the UI has not been built, ``/`` falls back to the original branded landing
page, so the service is never broken by a missing build artifact.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger("aetheris.ui")

router = APIRouter()

# The Next.js static export, relative to the repository root.
_UI_DIR = Path(__file__).resolve().parents[2] / "aurion" / "out"

_BUILD_HINT = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Aetheris — UI not built</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: #0a0e1a; color: #e8eaf0;
      font: 15px/1.7 ui-sans-serif, system-ui, -apple-system, sans-serif;
    }
    main { max-width: 40rem; padding: 2.5rem; }
    h1 { font-size: 1.6rem; margin: 0 0 .5rem; color: #3dffc2; }
    p { color: #98a2b3; }
    pre {
      background: #0f1629; border: 1px solid #1e2a44; border-radius: .6rem;
      padding: 1rem; overflow-x: auto; color: #e8eaf0;
    }
    a { color: #3dffc2; }
  </style>
</head>
<body>
  <main>
    <h1>Aetheris is running</h1>
    <p>The API is live, but the web UI has not been built yet. Build it once:</p>
    <pre>cd aurion &amp;&amp; npm install &amp;&amp; npm run build</pre>
    <p>Then restart the server and reload this page.</p>
    <p>
      Meanwhile: <a href="/docs">API docs</a> ·
      <a href="/v1/hermes">Hermes manifest</a> ·
      <a href="/v1/health">health</a>
    </p>
  </main>
</body>
</html>
"""


def ui_available() -> bool:
    """Whether a built UI export is present on disk."""
    return (_UI_DIR / "index.html").is_file()


def ui_dir() -> Path:
    """The directory holding the built UI."""
    return _UI_DIR


def mount_ui(app: FastAPI) -> bool:
    """Mount the built UI at ``/``. Returns whether it was actually mounted.

    The Next static export keeps its assets under ``_next/``; those are mounted
    as a real static directory, and everything else resolves through the
    catch-all below so client-side routes still work on a hard refresh.
    """
    if not ui_available():
        logger.info(
            "Web UI not built (%s missing) — serving the landing page at '/'. "
            "Run `cd aurion && npm run build` to enable it.",
            _UI_DIR / "index.html",
        )
        return False

    next_assets = _UI_DIR / "_next"
    if next_assets.is_dir():
        app.mount("/_next", StaticFiles(directory=next_assets), name="next-assets")

    logger.info("Web UI mounted from %s", _UI_DIR)
    return True


@router.get("/", include_in_schema=False)
async def ui_index() -> HTMLResponse:
    """Serve the application shell, or the landing page if the UI isn't built."""
    index = _UI_DIR / "index.html"
    if index.is_file():
        return HTMLResponse(content=index.read_text(encoding="utf-8"))

    # Graceful fallback: the branded landing page still renders the product,
    # with a build hint only if that is somehow unavailable too.
    try:
        from .landing import render_landing

        return HTMLResponse(content=render_landing())
    except Exception:  # pragma: no cover - defensive
        logger.debug("Landing fallback failed", exc_info=True)
        return HTMLResponse(content=_BUILD_HINT)


@router.api_route("/{asset_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def ui_asset(asset_path: str) -> FileResponse:
    """Serve any other static file from the export (favicon, svgs, routes).

    Registered last so it never shadows an API route. Path traversal is blocked
    by resolving the candidate and requiring it to stay inside the export dir.
    """
    if not ui_available():
        raise HTTPException(status_code=404, detail="Not found")

    candidate = (_UI_DIR / asset_path).resolve()
    try:
        candidate.relative_to(_UI_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found") from None

    if candidate.is_file():
        return FileResponse(candidate)

    # Directory-style route (trailingSlash: true) → its index.html.
    nested_index = candidate / "index.html"
    if nested_index.is_file():
        return FileResponse(nested_index)

    # Unknown path: hand back the shell so client-side routing can resolve it.
    index = _UI_DIR / "index.html"
    if index.is_file():
        return FileResponse(index)
    raise HTTPException(status_code=404, detail="Not found")


__all__ = ["router", "mount_ui", "ui_available", "ui_dir"]

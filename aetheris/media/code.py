"""Code generation, verification, and project scaffolding.

Aetheris already *writes* code through the engineering mode prompt. This module
adds the part that makes generated code trustworthy: it can **run** what it
wrote in the sandbox, capture the result, and iterate until the code executes
cleanly — and it can emit whole multi-file projects as downloadable archives.

Two capabilities live here:

* :func:`write_and_verify` — generate-then-execute for Python. The snippet is
  run in the sandbox; if it raises, the traceback is returned as structured
  feedback the model can act on rather than a wall of text.
* :func:`scaffold_project` — produce a complete, runnable project tree (FastAPI
  service, CLI tool, Python package, or static site) as a real ZIP artifact.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field
from typing import Any

# --- Verified code execution --------------------------------------------------


@dataclass
class VerificationResult:
    """The outcome of running a generated snippet."""

    ok: bool
    language: str
    code: str
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0
    timed_out: bool = False
    duration_ms: int = 0
    diagnosis: str = ""

    def render(self) -> str:
        """Format the outcome as the observation handed back to the model."""
        lines = [f"language: {self.language}", f"verified: {'yes' if self.ok else 'no'}"]
        if self.timed_out:
            lines.append("result: TIMED OUT — the code did not finish in the time limit.")
        elif self.ok:
            lines.append("result: executed successfully")
        else:
            lines.append(f"result: FAILED (exit code {self.exit_code})")
        if self.stdout.strip():
            lines.append("\nstdout:\n" + self.stdout.rstrip())
        if self.stderr.strip():
            lines.append("\nstderr:\n" + self.stderr.rstrip())
        if self.diagnosis:
            lines.append("\ndiagnosis: " + self.diagnosis)
        return "\n".join(lines)


def _diagnose(stderr: str) -> str:
    """Turn a Python traceback into one actionable sentence."""
    if not stderr.strip():
        return ""
    last = [line for line in stderr.strip().splitlines() if line.strip()][-1]
    hints = {
        "SyntaxError": "The code is not valid Python — check brackets, colons, and indentation.",
        "IndentationError": "Indentation is inconsistent; use four spaces uniformly.",
        "NameError": "A name is used before assignment — check for typos or a missing import.",
        "ImportError": "A module could not be imported. The sandbox has the standard library only.",
        "ModuleNotFoundError": (
            "That package is unavailable: the sandbox provides the standard library only, "
            "so rewrite using stdlib modules."
        ),
        "TypeError": "An operation received the wrong type — check the argument types.",
        "ValueError": "A value was the right type but out of range or malformed.",
        "IndexError": "A sequence index is out of range — check loop bounds.",
        "KeyError": "A dictionary key is missing — verify the key exists before access.",
        "ZeroDivisionError": "A division by zero occurred — guard the denominator.",
        "AttributeError": "An attribute does not exist on that object — check the API.",
        "RecursionError": "Recursion ran too deep — add a base case or use iteration.",
    }
    for name, hint in hints.items():
        if name in last:
            return f"{last.strip()} — {hint}"
    return last.strip()


async def write_and_verify(code: str, language: str = "python", stdin: str = "") -> VerificationResult:
    """Execute a snippet in the sandbox and report a structured result.

    Only Python is executable — the sandbox is a Python interpreter. Snippets in
    other languages are returned unverified with an explicit note, which is more
    honest than silently claiming success.
    """
    language = (language or "python").strip().lower()
    if language in ("py", "python3"):
        language = "python"

    if language != "python":
        return VerificationResult(
            ok=False,
            language=language,
            code=code,
            diagnosis=(
                f"Aetheris can execute Python only; {language} code was generated but not run. "
                "Review it manually or translate it to Python to verify behaviour."
            ),
        )

    from ..tools.sandbox import run_python

    result = await run_python(code, stdin=stdin)
    return VerificationResult(
        ok=result.ok,
        language="python",
        code=code,
        stdout=result.stdout,
        stderr=result.stderr,
        exit_code=result.exit_code,
        timed_out=result.timed_out,
        duration_ms=result.duration_ms,
        diagnosis="" if result.ok else _diagnose(result.stderr),
    )


# --- Project scaffolding ------------------------------------------------------


@dataclass
class Project:
    """A generated multi-file project."""

    name: str
    kind: str
    files: dict[str, str] = field(default_factory=dict)

    def to_zip(self) -> bytes:
        """Package the project as a ZIP archive."""
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for path, content in sorted(self.files.items()):
                archive.writestr(f"{self.name}/{path}", content)
        return buffer.getvalue()

    def tree(self) -> str:
        """An ASCII listing of the project layout."""
        lines = [f"{self.name}/"]
        for path in sorted(self.files):
            lines.append(f"  {path}")
        return "\n".join(lines)

    def summary(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "kind": self.kind,
            "files": sorted(self.files),
            "file_count": len(self.files),
            "total_bytes": sum(len(c.encode()) for c in self.files.values()),
        }


def _slug(name: str) -> str:
    """Normalise a project name into a filesystem/package-safe slug."""
    cleaned = "".join(c if c.isalnum() or c in "-_ " else "" for c in name).strip()
    slug = "-".join(cleaned.split()).lower()[:40]
    return slug or "aetheris-project"


def _python_package(name: str, description: str) -> dict[str, str]:
    module = _slug(name).replace("-", "_")
    return {
        "README.md": (
            f"# {name}\n\n{description}\n\n"
            "## Install\n\n```bash\npython -m venv .venv\n"
            f".venv/bin/pip install -e \".[dev]\"\n```\n\n"
            f"## Use\n\n```python\nfrom {module} import greet\n\nprint(greet(\"world\"))\n```\n\n"
            "## Test\n\n```bash\n.venv/bin/pytest\n```\n"
        ),
        "pyproject.toml": (
            '[build-system]\nrequires = ["setuptools>=68", "wheel"]\n'
            'build-backend = "setuptools.build_meta"\n\n'
            f'[project]\nname = "{_slug(name)}"\nversion = "0.1.0"\n'
            f'description = "{description}"\nrequires-python = ">=3.11"\n'
            "dependencies = []\n\n"
            '[project.optional-dependencies]\ndev = ["pytest"]\n\n'
            "[tool.setuptools.packages.find]\n"
            f'include = ["{module}*"]\n'
        ),
        f"{module}/__init__.py": (
            f'"""{description}"""\n\nfrom __future__ import annotations\n\n'
            '__version__ = "0.1.0"\n\n\n'
            "def greet(name: str) -> str:\n"
            '    """Return a friendly greeting.\n\n'
            "    Args:\n        name: Who to greet.\n\n"
            "    Returns:\n        The greeting text.\n\n"
            "    Raises:\n        ValueError: If ``name`` is empty.\n"
            '    """\n'
            "    if not name or not name.strip():\n"
            '        raise ValueError("name must not be empty")\n'
            "    return f\"Hello, {name.strip()}!\"\n\n\n"
            '__all__ = ["greet", "__version__"]\n'
        ),
        "tests/test_basic.py": (
            "from __future__ import annotations\n\nimport pytest\n\n"
            f"from {module} import greet\n\n\n"
            "def test_greet_returns_greeting():\n"
            '    assert greet("world") == "Hello, world!"\n\n\n'
            "def test_greet_strips_whitespace():\n"
            '    assert greet("  ada  ") == "Hello, ada!"\n\n\n'
            "def test_greet_rejects_empty():\n"
            "    with pytest.raises(ValueError):\n"
            '        greet("   ")\n'
        ),
        ".gitignore": "__pycache__/\n*.py[cod]\n.venv/\n*.egg-info/\n.pytest_cache/\ndist/\nbuild/\n",
    }


def _fastapi_service(name: str, description: str) -> dict[str, str]:
    return {
        "README.md": (
            f"# {name}\n\n{description}\n\n"
            "## Run\n\n```bash\npython -m venv .venv\n"
            ".venv/bin/pip install -r requirements.txt\n"
            ".venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload\n```\n\n"
            "Then open http://localhost:8000/docs\n"
        ),
        "requirements.txt": "fastapi>=0.110\nuvicorn[standard]>=0.27\npydantic>=2.6\n",
        "app/__init__.py": '"""Application package."""\n',
        "app/main.py": (
            '"""FastAPI application entrypoint."""\n\n'
            "from __future__ import annotations\n\n"
            "from fastapi import FastAPI\n\n"
            "from .routes import router\n\n"
            f'app = FastAPI(title="{name}", description="{description}", version="0.1.0")\n'
            "app.include_router(router)\n\n\n"
            '@app.get("/health", tags=["meta"])\n'
            "async def health() -> dict:\n"
            '    """Liveness probe."""\n'
            '    return {"status": "ok"}\n'
        ),
        "app/routes.py": (
            '"""API routes."""\n\n'
            "from __future__ import annotations\n\n"
            "from fastapi import APIRouter, HTTPException\n\n"
            "from .models import Item, ItemCreate\n\n"
            'router = APIRouter(prefix="/items", tags=["items"])\n\n'
            "# In-memory store; swap for a real database in production.\n"
            "_ITEMS: dict[int, Item] = {}\n"
            "_NEXT_ID = 1\n\n\n"
            '@router.get("", response_model=list[Item])\n'
            "async def list_items() -> list[Item]:\n"
            '    """Return every stored item."""\n'
            "    return list(_ITEMS.values())\n\n\n"
            '@router.post("", response_model=Item, status_code=201)\n'
            "async def create_item(payload: ItemCreate) -> Item:\n"
            '    """Create a new item."""\n'
            "    global _NEXT_ID\n"
            "    item = Item(id=_NEXT_ID, **payload.model_dump())\n"
            "    _ITEMS[_NEXT_ID] = item\n"
            "    _NEXT_ID += 1\n"
            "    return item\n\n\n"
            '@router.get("/{item_id}", response_model=Item)\n'
            "async def get_item(item_id: int) -> Item:\n"
            '    """Fetch one item by id."""\n'
            "    if item_id not in _ITEMS:\n"
            '        raise HTTPException(status_code=404, detail="Item not found")\n'
            "    return _ITEMS[item_id]\n"
        ),
        "app/models.py": (
            '"""Pydantic schemas."""\n\n'
            "from __future__ import annotations\n\n"
            "from pydantic import BaseModel, Field\n\n\n"
            "class ItemCreate(BaseModel):\n"
            '    """Fields accepted when creating an item."""\n\n'
            "    name: str = Field(..., min_length=1, max_length=120)\n"
            "    description: str = \"\"\n"
            "    price: float = Field(default=0.0, ge=0)\n\n\n"
            "class Item(ItemCreate):\n"
            '    """A stored item."""\n\n'
            "    id: int\n"
        ),
        "tests/test_api.py": (
            "from __future__ import annotations\n\n"
            "from fastapi.testclient import TestClient\n\n"
            "from app.main import app\n\n"
            "client = TestClient(app)\n\n\n"
            "def test_health():\n"
            '    assert client.get("/health").json()["status"] == "ok"\n\n\n'
            "def test_create_and_fetch_item():\n"
            '    created = client.post("/items", json={"name": "widget", "price": 9.5})\n'
            "    assert created.status_code == 201\n"
            '    item_id = created.json()["id"]\n'
            '    fetched = client.get(f"/items/{item_id}")\n'
            '    assert fetched.json()["name"] == "widget"\n'
        ),
        ".gitignore": "__pycache__/\n*.py[cod]\n.venv/\n.pytest_cache/\n",
    }


def _cli_tool(name: str, description: str) -> dict[str, str]:
    module = _slug(name).replace("-", "_")
    return {
        "README.md": (
            f"# {name}\n\n{description}\n\n"
            f"## Install\n\n```bash\npip install -e .\n{_slug(name)} --help\n```\n"
        ),
        "pyproject.toml": (
            '[build-system]\nrequires = ["setuptools>=68", "wheel"]\n'
            'build-backend = "setuptools.build_meta"\n\n'
            f'[project]\nname = "{_slug(name)}"\nversion = "0.1.0"\n'
            f'description = "{description}"\nrequires-python = ">=3.11"\n\n'
            f'[project.scripts]\n{_slug(name)} = "{module}.cli:main"\n\n'
            f'[tool.setuptools.packages.find]\ninclude = ["{module}*"]\n'
        ),
        f"{module}/__init__.py": f'"""{description}"""\n\n__version__ = "0.1.0"\n',
        f"{module}/cli.py": (
            f'"""Command-line interface for {name}."""\n\n'
            "from __future__ import annotations\n\n"
            "import argparse\nimport sys\n\nfrom . import __version__\n\n\n"
            "def build_parser() -> argparse.ArgumentParser:\n"
            '    """Construct the argument parser."""\n'
            "    parser = argparse.ArgumentParser(\n"
            f'        prog="{_slug(name)}", description="{description}"\n'
            "    )\n"
            '    parser.add_argument("--version", action="version", version=__version__)\n'
            '    sub = parser.add_subparsers(dest="command", required=True)\n\n'
            '    run = sub.add_parser("run", help="run the main task")\n'
            '    run.add_argument("target", help="what to operate on")\n'
            '    run.add_argument("-v", "--verbose", action="store_true")\n'
            "    return parser\n\n\n"
            "def main(argv: list[str] | None = None) -> int:\n"
            '    """Entry point. Returns a process exit code."""\n'
            "    args = build_parser().parse_args(argv)\n"
            '    if args.command == "run":\n'
            "        if args.verbose:\n"
            '            print(f"processing {args.target}...", file=sys.stderr)\n'
            '        print(f"done: {args.target}")\n'
            "        return 0\n"
            "    return 1\n\n\n"
            'if __name__ == "__main__":\n'
            "    raise SystemExit(main())\n"
        ),
        "tests/test_cli.py": (
            "from __future__ import annotations\n\n"
            f"from {module}.cli import main\n\n\n"
            "def test_run_succeeds(capsys):\n"
            '    assert main(["run", "widget"]) == 0\n'
            '    assert "done: widget" in capsys.readouterr().out\n'
        ),
        ".gitignore": "__pycache__/\n*.py[cod]\n.venv/\n*.egg-info/\n",
    }


def _static_site(name: str, description: str) -> dict[str, str]:
    return {
        "README.md": (
            f"# {name}\n\n{description}\n\n"
            "## Run\n\n```bash\npython -m http.server 8000\n```\n"
        ),
        "index.html": (
            "<!DOCTYPE html>\n"
            '<html lang="en">\n<head>\n  <meta charset="utf-8">\n'
            '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
            f"  <title>{name}</title>\n"
            f'  <meta name="description" content="{description}">\n'
            '  <link rel="stylesheet" href="styles.css">\n'
            "</head>\n<body>\n"
            '  <header class="site-header">\n'
            f"    <h1>{name}</h1>\n"
            f"    <p>{description}</p>\n"
            "  </header>\n"
            '  <main id="app">\n'
            '    <section class="card">\n'
            "      <h2>Getting started</h2>\n"
            "      <p>Edit <code>index.html</code> to begin.</p>\n"
            '      <button id="action" type="button">Click me</button>\n'
            '      <p id="output" aria-live="polite"></p>\n'
            "    </section>\n"
            "  </main>\n"
            '  <script src="app.js"></script>\n'
            "</body>\n</html>\n"
        ),
        "styles.css": (
            ":root {\n  --bg: #0b132b;\n  --surface: #131c38;\n  --accent: #00b4d8;\n"
            "  --text: #f8f9fa;\n  --muted: #9fb0d0;\n}\n\n"
            "* { box-sizing: border-box; }\n\n"
            "body {\n  margin: 0;\n  min-height: 100vh;\n  padding: 48px 24px;\n"
            "  background: var(--bg);\n  color: var(--text);\n"
            "  font: 400 16px/1.6 system-ui, -apple-system, sans-serif;\n}\n\n"
            ".site-header { max-width: 720px; margin: 0 auto 32px; }\n"
            ".site-header h1 { margin: 0 0 8px; font-size: 40px; letter-spacing: -.02em; }\n"
            ".site-header p { margin: 0; color: var(--muted); }\n\n"
            ".card {\n  max-width: 720px;\n  margin: 0 auto;\n  padding: 28px;\n"
            "  background: var(--surface);\n  border: 1px solid rgba(255,255,255,.08);\n"
            "  border-radius: 14px;\n}\n\n"
            "button {\n  padding: 10px 18px;\n  border: 0;\n  border-radius: 8px;\n"
            "  background: var(--accent);\n  color: #04121b;\n  font-weight: 600;\n"
            "  cursor: pointer;\n}\n"
            "button:hover { filter: brightness(1.1); }\n"
        ),
        "app.js": (
            '"use strict";\n\n'
            "// Wire up the demo interaction once the DOM is ready.\n"
            'document.addEventListener("DOMContentLoaded", () => {\n'
            '  const button = document.getElementById("action");\n'
            '  const output = document.getElementById("output");\n'
            "  let clicks = 0;\n\n"
            '  button.addEventListener("click", () => {\n'
            "    clicks += 1;\n"
            '    output.textContent = `Clicked ${clicks} time${clicks === 1 ? "" : "s"}.`;\n'
            "  });\n"
            "});\n"
        ),
    }


_SCAFFOLDS = {
    "python-package": _python_package,
    "fastapi-service": _fastapi_service,
    "cli-tool": _cli_tool,
    "static-site": _static_site,
}

PROJECT_KINDS: tuple[str, ...] = tuple(sorted(_SCAFFOLDS))


def scaffold_project(kind: str, name: str, description: str = "") -> Project:
    """Build a complete, runnable project of the given kind."""
    key = (kind or "").strip().lower()
    if key not in _SCAFFOLDS:
        raise ValueError(
            f"Unknown project kind '{kind}'. Choose one of: {', '.join(PROJECT_KINDS)}."
        )
    name = (name or "").strip() or "aetheris-project"
    description = (description or f"A {key} generated by Aetheris.").strip()
    return Project(name=_slug(name), kind=key, files=_SCAFFOLDS[key](name, description))


__all__ = [
    "VerificationResult",
    "write_and_verify",
    "Project",
    "PROJECT_KINDS",
    "scaffold_project",
]

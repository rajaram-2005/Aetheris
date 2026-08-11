"""The Aetheris toolbelt — the executable capabilities behind agentic reasoning.

Importing this package registers every built-in tool:

* ``code_interpreter``  — sandboxed Python execution (``sandbox.py``)
* ``document_search`` / ``list_documents`` — BM25 RAG over mounted docs (``retrieval.py``)
* ``calculator`` / ``current_time`` / ``validate_json`` / ``think`` (``builtins.py``)
* ``web_fetch``         — SSRF-guarded HTTP retrieval (``web.py``)
"""

from __future__ import annotations

from .registry import (
    Tool,
    ToolError,
    all_tools,
    execute,
    get_tool,
    register,
    toolbelt_schema,
)
from .retrieval import DocumentIndex, get_index, hydrate_from_dir

__all__ = [
    "Tool",
    "ToolError",
    "register",
    "get_tool",
    "all_tools",
    "toolbelt_schema",
    "execute",
    "DocumentIndex",
    "get_index",
    "hydrate_from_dir",
]

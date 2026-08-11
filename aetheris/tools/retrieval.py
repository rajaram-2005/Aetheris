"""Deep document search (RAG) for Aetheris.

The blueprint advertises "deep document search (RAG)"; this module is the real
implementation. It is deliberately dependency-free — no vector database, no
embedding service — so retrieval works offline and in any deployment:

* documents are chunked with overlap so answers are not split across boundaries;
* chunks are indexed with an in-memory **BM25** ranking function (the classic
  probabilistic relevance model), which is strong for keyword-and-phrase queries
  over modest corpora;
* the index is process-wide and thread-safe for the FastAPI event loop, and can
  be hydrated from a directory at startup via ``AETHERIS_RAG_CORPUS_DIR``.

The same index backs the ``document_search`` tool, the ``/v1/documents`` REST
surface, and the playground's context-mounting panel, so a file attached in the
browser is genuinely searchable by the model rather than merely pasted in.
"""

from __future__ import annotations

import math
import re
import uuid
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..core.config import settings
from .registry import ToolError, register

_TOKEN_RE = re.compile(r"[a-z0-9_]+")

# Common English function words carry no discriminative signal for BM25.
_STOPWORDS = frozenset(
    """a an and are as at be but by for from has have how i if in into is it its of on or
    that the their then there these they this to was were what when where which who will
    with you your do does did not no can could should would about over under""".split()
)


def _tokenize(text: str) -> list[str]:
    """Lowercase word tokens with stopwords removed."""
    return [t for t in _TOKEN_RE.findall(text.lower()) if t not in _STOPWORDS and len(t) > 1]


@dataclass
class Chunk:
    """One retrievable passage of a document."""

    id: str
    doc_id: str
    doc_title: str
    ordinal: int
    text: str
    tokens: list[str] = field(default_factory=list)
    term_freqs: Counter = field(default_factory=Counter)

    def __post_init__(self) -> None:
        if not self.tokens:
            self.tokens = _tokenize(self.text)
        if not self.term_freqs:
            self.term_freqs = Counter(self.tokens)

    @property
    def length(self) -> int:
        return len(self.tokens)


@dataclass
class Document:
    """An indexed source document."""

    id: str
    title: str
    text: str
    source: str = "upload"
    metadata: dict[str, Any] = field(default_factory=dict)
    chunk_ids: list[str] = field(default_factory=list)

    @property
    def char_count(self) -> int:
        return len(self.text)


@dataclass
class SearchHit:
    """A scored retrieval result."""

    chunk: Chunk
    score: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "chunk_id": self.chunk.id,
            "document_id": self.chunk.doc_id,
            "title": self.chunk.doc_title,
            "ordinal": self.chunk.ordinal,
            "score": round(self.score, 4),
            "text": self.chunk.text,
        }


def chunk_text(text: str, size: int, overlap: int) -> list[str]:
    """Split ``text`` into overlapping windows, preferring paragraph breaks.

    Overlap keeps a fact that straddles a boundary retrievable from either side.
    """
    text = text.strip()
    if not text:
        return []
    if len(text) <= size:
        return [text]

    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        window = text[start:end]
        if end < len(text):
            # Prefer to break on a paragraph, then a sentence, then a space.
            for sep in ("\n\n", "\n", ". ", " "):
                cut = window.rfind(sep)
                if cut > size * 0.5:
                    window = window[: cut + len(sep)]
                    end = start + cut + len(sep)
                    break
        piece = window.strip()
        if piece:
            chunks.append(piece)
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return chunks


class DocumentIndex:
    """An in-memory BM25 index over chunked documents."""

    # BM25 free parameters; k1 damps term-frequency saturation, b controls
    # length normalization. These are the standard, well-behaved defaults.
    K1 = 1.5
    B = 0.75

    def __init__(self) -> None:
        self._documents: dict[str, Document] = {}
        self._chunks: dict[str, Chunk] = {}
        self._doc_freq: Counter = Counter()
        self._total_length = 0

    # --- Mutation -------------------------------------------------------------

    def add(
        self,
        text: str,
        *,
        title: str | None = None,
        doc_id: str | None = None,
        source: str = "upload",
        metadata: dict[str, Any] | None = None,
    ) -> Document:
        """Chunk, index, and store a document. Re-adding an id replaces it."""
        if not text or not text.strip():
            raise ToolError("Cannot index an empty document.")
        if len(text) > settings.rag_max_document_chars:
            text = text[: settings.rag_max_document_chars]

        doc_id = doc_id or f"doc_{uuid.uuid4().hex[:12]}"
        if doc_id in self._documents:
            self.remove(doc_id)
        if len(self._documents) >= settings.rag_max_documents:
            oldest = next(iter(self._documents))
            self.remove(oldest)

        document = Document(
            id=doc_id,
            title=(title or doc_id).strip()[:160],
            text=text,
            source=source,
            metadata=metadata or {},
        )
        pieces = chunk_text(text, settings.rag_chunk_size, settings.rag_chunk_overlap)
        for ordinal, piece in enumerate(pieces):
            chunk = Chunk(
                id=f"{doc_id}:{ordinal}",
                doc_id=doc_id,
                doc_title=document.title,
                ordinal=ordinal,
                text=piece,
            )
            self._chunks[chunk.id] = chunk
            document.chunk_ids.append(chunk.id)
            self._total_length += chunk.length
            for term in set(chunk.tokens):
                self._doc_freq[term] += 1

        self._documents[doc_id] = document
        return document

    def remove(self, doc_id: str) -> bool:
        """Remove a document and its chunks from the index."""
        document = self._documents.pop(doc_id, None)
        if document is None:
            return False
        for chunk_id in document.chunk_ids:
            chunk = self._chunks.pop(chunk_id, None)
            if chunk is None:
                continue
            self._total_length -= chunk.length
            for term in set(chunk.tokens):
                self._doc_freq[term] -= 1
                if self._doc_freq[term] <= 0:
                    del self._doc_freq[term]
        return True

    def clear(self) -> int:
        """Drop the entire index; returns how many documents were removed."""
        count = len(self._documents)
        self._documents.clear()
        self._chunks.clear()
        self._doc_freq.clear()
        self._total_length = 0
        return count

    # --- Query ----------------------------------------------------------------

    @property
    def documents(self) -> list[Document]:
        return list(self._documents.values())

    def get(self, doc_id: str) -> Document | None:
        return self._documents.get(doc_id)

    @property
    def chunk_count(self) -> int:
        return len(self._chunks)

    @property
    def _avg_length(self) -> float:
        return (self._total_length / len(self._chunks)) if self._chunks else 0.0

    def search(self, query: str, *, top_k: int = 4, doc_id: str | None = None) -> list[SearchHit]:
        """Rank chunks against ``query`` with BM25, best first."""
        terms = _tokenize(query)
        if not terms or not self._chunks:
            return []

        candidates = (
            [self._chunks[c] for c in self._documents[doc_id].chunk_ids]
            if doc_id and doc_id in self._documents
            else list(self._chunks.values())
        )
        n = max(1, len(self._chunks))
        avg = self._avg_length or 1.0

        scored: list[SearchHit] = []
        for chunk in candidates:
            score = 0.0
            for term in terms:
                tf = chunk.term_freqs.get(term, 0)
                if not tf:
                    continue
                df = self._doc_freq.get(term, 0) or 1
                # BM25 IDF with the +1 smoothing that keeps scores non-negative.
                idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
                denom = tf + self.K1 * (1 - self.B + self.B * chunk.length / avg)
                score += idf * (tf * (self.K1 + 1)) / (denom or 1.0)
            if score > 0:
                scored.append(SearchHit(chunk=chunk, score=score))

        scored.sort(key=lambda hit: hit.score, reverse=True)
        return scored[: max(1, top_k)]

    def stats(self) -> dict[str, Any]:
        return {
            "documents": len(self._documents),
            "chunks": len(self._chunks),
            "vocabulary": len(self._doc_freq),
            "avg_chunk_tokens": round(self._avg_length, 1),
            "chunk_size": settings.rag_chunk_size,
            "chunk_overlap": settings.rag_chunk_overlap,
            "ranking": "BM25",
        }


# Process-wide index shared by the tool, the REST surface, and the playground.
_INDEX = DocumentIndex()


def get_index() -> DocumentIndex:
    """Return the process-wide document index."""
    return _INDEX


_TEXT_SUFFIXES = {
    ".txt", ".md", ".markdown", ".rst", ".json", ".jsonl", ".csv", ".tsv",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".py", ".js", ".ts", ".tsx",
    ".jsx", ".html", ".css", ".sql", ".sh", ".go", ".rs", ".java", ".rb",
}


def hydrate_from_dir(directory: str | Path) -> int:
    """Index every readable text file in ``directory`` (recursively).

    Returns the number of documents indexed. Unreadable or binary files are
    skipped rather than aborting startup.
    """
    root = Path(directory).expanduser()
    if not root.is_dir():
        return 0
    indexed = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in _TEXT_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if not text.strip():
            continue
        try:
            _INDEX.add(
                text,
                title=str(path.relative_to(root)),
                source="corpus",
                metadata={"path": str(path)},
            )
            indexed += 1
        except ToolError:
            continue
        if indexed >= settings.rag_max_documents:
            break
    return indexed


# --- Tool registration --------------------------------------------------------

@register(
    "document_search",
    (
        "Search the documents the user has mounted into this session (RAG). Returns "
        "the most relevant passages with their document title and a relevance score. "
        "Use this before answering any question about attached files, uploaded "
        "documents, or 'my notes/spec/report' — never guess at their contents. "
        "Quote or cite the returned passages in your answer."
    ),
    {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query — use distinctive keywords from the question.",
            },
            "top_k": {
                "type": "integer",
                "description": "How many passages to return (1-10, default 4).",
                "minimum": 1,
                "maximum": 10,
            },
            "document_id": {
                "type": "string",
                "description": "Optional: restrict the search to a single document id.",
            },
        },
        "required": ["query"],
    },
    tags=("retrieval", "rag"),
)
async def document_search(query: str, top_k: int = 4, document_id: str | None = None) -> str:
    """Retrieve the most relevant indexed passages for ``query``."""
    index = get_index()
    if not index.documents:
        return (
            "No documents are mounted in this session. Ask the user to attach a file "
            "in the playground, or POST it to /v1/documents, then search again."
        )
    hits = index.search(query, top_k=top_k, doc_id=document_id)
    if not hits:
        titles = ", ".join(d.title for d in index.documents[:10])
        return (
            f"No passage matched '{query}'. Indexed documents: {titles}. "
            "Try different or broader keywords."
        )
    blocks = [
        f"[{i}] {hit.chunk.doc_title} (chunk {hit.chunk.ordinal}, "
        f"score {hit.score:.2f}, id {hit.chunk.id})\n{hit.chunk.text}"
        for i, hit in enumerate(hits, start=1)
    ]
    return f"{len(hits)} passage(s) retrieved for '{query}':\n\n" + "\n\n---\n\n".join(blocks)


@register(
    "list_documents",
    (
        "List every document currently mounted in this session, with its id, title, "
        "and size. Use it to discover what is available before searching."
    ),
    {"type": "object", "properties": {}},
    tags=("retrieval", "rag"),
)
async def list_documents() -> str:
    """Enumerate the mounted corpus."""
    index = get_index()
    documents = index.documents
    if not documents:
        return "No documents are mounted in this session."
    lines = [
        f"- {d.title} (id: {d.id}, {d.char_count:,} chars, "
        f"{len(d.chunk_ids)} chunks, source: {d.source})"
        for d in documents
    ]
    return f"{len(documents)} document(s) mounted:\n" + "\n".join(lines)


__all__ = [
    "Chunk",
    "Document",
    "SearchHit",
    "DocumentIndex",
    "get_index",
    "hydrate_from_dir",
    "chunk_text",
    "document_search",
    "list_documents",
]

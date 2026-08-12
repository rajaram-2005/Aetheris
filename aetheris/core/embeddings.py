"""Embedding generation and similarity search.

Aetheris doesn't require an external embedding provider to run. This module
ships a deterministic, dependency-free **byte-pair-free signature embedder**
built on a small learned-ish hash projection: it tokenizes text, maps rare
tokens to a high-dimensional bag-of-ngrams, hashes them into a fixed-dimension
unsigned-16 vector, and applies a simple TF-IDF style reweighting. It's not a
foundation-model embedding, but it is:

* Fast (no torch/transformers needed).
* Deterministic (same text → same vector on any machine).
* Bounded (fixed 384-dim uint8 footprint, L2-normalizable).
* Good enough for local cosine similarity over small-to-medium corpora.

Operators who wire up a real provider (OpenAI, Cohere, local sentence-transformers)
can replace ``embed_text`` via ``set_provider(fn)`` without changing callers.
"""

from __future__ import annotations

import hashlib
import math
import re
import struct
import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Callable

from pydantic import BaseModel, Field

_TOKEN_RE = re.compile(r"[A-Za-z0-9_]+")
_DIM = 384
_STOPWORDS = frozenset(
    """a an the of to is are and or in on for with this that it be by as at from
    these those was were have has had i you your we our their its can will would
    should could do does did not but if then than so just about into over under
    what when where who how why which""".split()
)


# --- Schemas -----------------------------------------------------------------

class EmbedRequest(BaseModel):
    input: str | list[str] = Field(..., description="Text or list of texts to embed.")
    model: str = Field(default="aetheris-signature", max_length=128)
    normalize: bool = Field(default=True)


class EmbeddingResult(BaseModel):
    object: str = "list"
    data: list[dict[str, Any]]
    model: str
    usage: dict[str, int]


class IndexedDocument(BaseModel):
    id: str = Field(default="", max_length=128)
    text: str = Field(..., min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class VectorSearchQuery(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int = Field(default=5, ge=1, le=100)
    threshold: float = Field(default=0.0, ge=-1.0, le=1.0)


class VectorSearchHit(BaseModel):
    id: str
    score: float
    text_preview: str
    metadata: dict[str, Any]


class VectorSearchResult(BaseModel):
    query: str
    hits: list[VectorSearchHit]
    count: int


# --- Core embedding algorithm ------------------------------------------------

def _tokens(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN_RE.findall(text or "") if t.lower() not in _STOPWORDS]


def _ngrams(tokens: list[str], n: int = 3) -> list[str]:
    out: list[str] = []
    for i in range(len(tokens) - n + 1):
        out.append("\x00".join(tokens[i : i + n]))
    return out


def _hash_dim(token: str, dim: int = _DIM) -> int:
    # Stable hash -> dimension; use two hash projections for signed weighting.
    h = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
    (v,) = struct.unpack("<Q", h)
    return v % dim


def _hash_weight(token: str) -> float:
    h = hashlib.blake2b((token + "\x00w").encode("utf-8"), digest_size=8).digest()
    (v,) = struct.unpack("<Q", h)
    # Map to (-1, 1)
    return (v / (1 << 64)) * 2 - 1


def signature_embed(text: str, *, dim: int = _DIM, normalize: bool = True) -> list[float]:
    """Deterministic signature embedding.

    Works like a random-projection bag-of-ngrams: each token/ngram contributes
    a signed weight to a hashed dimension. This produces stable vectors that
    are meaningfully comparable via cosine similarity for short-to-medium
    texts. It is NOT a semantic LM embedding.
    """
    toks = _tokens(text)
    vec = [0.0] * dim
    if not toks:
        return vec
    # unigrams + trigrams for local + phrase signal
    terms: list[str] = list(toks) + _ngrams(toks, 2) + _ngrams(toks, 3)
    # local IDF-lite: down-weight very frequent terms within the doc.
    tf: dict[str, int] = {}
    for t in terms:
        tf[t] = tf.get(t, 0) + 1
    for t, c in tf.items():
        w = _hash_weight(t) / math.sqrt(c)  # sqrt damp
        vec[_hash_dim(t, dim)] += w
    if normalize:
        n = math.sqrt(sum(v * v for v in vec)) or 1.0
        vec = [v / n for v in vec]
    return vec


def cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        raise ValueError("vectors have different dimensions")
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / max(na * nb, 1e-12)


_Provider = Callable[[str], list[float]]


# --- Vector index & manager --------------------------------------------------

@dataclass
class _Doc:
    id: str
    text: str
    metadata: dict[str, Any]
    vec: list[float]
    added_at: float


class EmbeddingManager:
    def __init__(self, dim: int = _DIM, max_docs: int = 100_000) -> None:
        self._lock = Lock()
        self.dim = dim
        self._provider: _Provider | None = None
        self._docs: dict[str, _Doc] = {}
        self._max = max_docs

    # --- provider override -------------------------------------------------
    def set_provider(self, fn: _Provider) -> None:
        with self._lock:
            self._provider = fn

    # --- embed -------------------------------------------------------------
    def embed(self, text: str, *, normalize: bool = True) -> list[float]:
        with self._lock:
            fn = self._provider
        if fn is not None:
            v = fn(text)
            if normalize:
                n = math.sqrt(sum(x * x for x in v)) or 1.0
                v = [x / n for x in v]
            return v
        return signature_embed(text, dim=self.dim, normalize=normalize)

    def embed_many(self, texts: list[str], *, normalize: bool = True) -> list[list[float]]:
        return [self.embed(t, normalize=normalize) for t in texts]

    # --- vector index ------------------------------------------------------
    def index_document(self, doc: IndexedDocument) -> _Doc:
        with self._lock:
            if len(self._docs) >= self._max:
                oldest = min(self._docs.values(), key=lambda d: d.added_at)
                self._docs.pop(oldest.id, None)
            did = doc.id or f"vec_{uuid.uuid4().hex[:10]}"
            v = self.embed(doc.text)
            d = _Doc(id=did, text=doc.text, metadata=dict(doc.metadata), vec=v, added_at=time.time())
            self._docs[did] = d
            return d

    def get(self, did: str) -> _Doc | None:
        with self._lock:
            return self._docs.get(did)

    def delete(self, did: str) -> bool:
        with self._lock:
            return self._docs.pop(did, None) is not None

    def search(self, q: VectorSearchQuery) -> VectorSearchResult:
        qv = self.embed(q.query)
        with self._lock:
            scored: list[tuple[float, _Doc]] = []
            for d in self._docs.values():
                s = cosine(qv, d.vec)
                if s >= q.threshold:
                    scored.append((s, d))
        scored.sort(key=lambda x: -x[0])
        hits = [
            VectorSearchHit(id=d.id, score=round(s, 4), text_preview=d.text[:240], metadata=dict(d.metadata))
            for s, d in scored[: q.top_k]
        ]
        return VectorSearchResult(query=q.query, hits=hits, count=len(hits))

    def list_documents(self, *, limit: int = 100) -> list[dict[str, Any]]:
        with self._lock:
            docs = sorted(self._docs.values(), key=lambda d: -d.added_at)[:limit]
            return [{"id": d.id, "text_preview": d.text[:160], "metadata": d.metadata, "added_at": d.added_at} for d in docs]

    def clear(self) -> int:
        with self._lock:
            n = len(self._docs)
            self._docs.clear()
            return n

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "indexed": len(self._docs),
                "dimension": self.dim,
                "model": "custom" if self._provider else "aetheris-signature",
                "capacity": self._max,
            }


_mgr: EmbeddingManager | None = None


def get_embedding_manager() -> EmbeddingManager:
    global _mgr
    if _mgr is None:
        _mgr = EmbeddingManager()
    return _mgr


__all__ = [
    "EmbeddingManager", "EmbedRequest", "EmbeddingResult",
    "IndexedDocument", "VectorSearchQuery", "VectorSearchHit", "VectorSearchResult",
    "signature_embed", "cosine", "get_embedding_manager",
]

"""Provenance and citation graphs.

Every answer Aetheris produces can cite *where it came from*: a corpus
hit, a mounted document, a tool observation, a memory snippet, or a
knowledge-graph path. This module records those sources, then attributes
each sentence of the final answer to the sources it overlaps with.

It does not invent citations. A sentence with no overlapping source is
marked ``ungrounded`` rather than assigned a decorative footnote.
"""

from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Literal

from pydantic import BaseModel, Field

SourceKind = Literal["document", "corpus", "tool", "memory", "graph", "user", "computation"]

_SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")
_TOKEN = re.compile(r"[A-Za-z0-9_]{3,}")


class SourceIn(BaseModel):
    kind: SourceKind
    ref: str = Field(default="", max_length=256)
    title: str = Field(default="", max_length=256)
    snippet: str = Field(default="", max_length=4_000)
    score: float = Field(default=0.0)


class ProvenanceRecordIn(BaseModel):
    query: str = Field(default="", max_length=20_000)
    answer: str = Field(..., min_length=1, max_length=80_000)
    sources: list[SourceIn] = Field(default_factory=list)
    generation_id: str = Field(default="", max_length=64)
    metadata: dict[str, Any] = Field(default_factory=dict)


def _tokens(text: str) -> set[str]:
    return {t.lower() for t in _TOKEN.findall(text or "")}


def attribute(answer: str, sources: list[SourceIn] | list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Assign each sentence to the sources whose tokens it overlaps."""
    pieces = [p.strip() for p in _SENTENCE.split(answer) if p and p.strip()]
    prepared: list[tuple[int, set[str], Any]] = []
    for i, src in enumerate(sources):
        snippet = src.snippet if hasattr(src, "snippet") else src.get("snippet", "")
        prepared.append((i, _tokens(snippet), src))

    citations: list[dict[str, Any]] = []
    for sentence in pieces:
        stoks = _tokens(sentence)
        if not stoks:
            continue
        scored: list[tuple[float, int]] = []
        for idx, toks, _src in prepared:
            if not toks:
                continue
            overlap = stoks & toks
            if not overlap:
                continue
            # Jaccard against the *sentence* — a long source shouldn't dominate.
            score = len(overlap) / max(len(stoks), 1)
            if score >= 0.18:
                scored.append((score, idx))
        scored.sort(reverse=True)
        top = scored[:3]
        citations.append(
            {
                "sentence": sentence[:400],
                "grounded": bool(top),
                "sources": [
                    {
                        "index": idx,
                        "overlap": round(score, 3),
                    }
                    for score, idx in top
                ],
            }
        )
    return citations


@dataclass
class _Record:
    id: str
    generation_id: str
    query: str
    answer: str
    sources: list[dict[str, Any]]
    citations: list[dict[str, Any]]
    metadata: dict[str, Any]
    created_at: float
    grounded_ratio: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "generation_id": self.generation_id,
            "query": self.query,
            "answer_preview": self.answer[:240],
            "sources": self.sources,
            "citations": self.citations,
            "grounded_ratio": round(self.grounded_ratio, 4),
            "created_at": self.created_at,
            "metadata": self.metadata,
        }


class ProvenanceStore:
    def __init__(self, max_records: int = 5_000) -> None:
        self._lock = Lock()
        self._records: dict[str, _Record] = {}
        self._max = max_records

    def record(self, body: ProvenanceRecordIn) -> _Record:
        citations = attribute(body.answer, body.sources)
        grounded = sum(1 for c in citations if c["grounded"])
        total = max(len(citations), 1)
        rec = _Record(
            id=f"prov_{uuid.uuid4().hex[:10]}",
            generation_id=body.generation_id or f"gen_{uuid.uuid4().hex[:8]}",
            query=body.query,
            answer=body.answer,
            sources=[s.model_dump() if hasattr(s, "model_dump") else dict(s) for s in body.sources],
            citations=citations,
            metadata=dict(body.metadata),
            created_at=time.time(),
            grounded_ratio=grounded / total,
        )
        with self._lock:
            if len(self._records) >= self._max:
                oldest = min(self._records, key=lambda rid: self._records[rid].created_at)
                del self._records[oldest]
            self._records[rec.id] = rec
        return rec

    def get(self, record_id: str) -> _Record | None:
        with self._lock:
            rec = self._records.get(record_id)
            if rec:
                return rec
            for item in self._records.values():
                if item.generation_id == record_id:
                    return item
            return None

    def list_records(self, *, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            items = sorted(self._records.values(), key=lambda r: -r.created_at)
            return [r.to_dict() for r in items[:limit]]

    def graph(self, record_id: str) -> dict[str, Any] | None:
        rec = self.get(record_id)
        if rec is None:
            return None
        nodes = [
            {"id": "answer", "kind": "answer", "label": rec.query or "answer"},
        ]
        edges: list[dict[str, Any]] = []
        for i, src in enumerate(rec.sources):
            nid = f"src_{i}"
            nodes.append(
                {
                    "id": nid,
                    "kind": src.get("kind", "document"),
                    "label": src.get("title") or src.get("ref") or nid,
                    "score": src.get("score", 0),
                }
            )
        for cite in rec.citations:
            if not cite["grounded"]:
                continue
            for link in cite["sources"]:
                edges.append(
                    {
                        "from": f"src_{link['index']}",
                        "to": "answer",
                        "weight": link["overlap"],
                        "sentence": cite["sentence"][:160],
                    }
                )
        return {"record_id": rec.id, "nodes": nodes, "edges": edges, "grounded_ratio": rec.grounded_ratio}

    def clear(self) -> int:
        with self._lock:
            n = len(self._records)
            self._records.clear()
            return n

    def stats(self) -> dict[str, Any]:
        with self._lock:
            if not self._records:
                return {"records": 0, "mean_grounded_ratio": 0.0}
            mean = sum(r.grounded_ratio for r in self._records.values()) / len(self._records)
            return {"records": len(self._records), "mean_grounded_ratio": round(mean, 4)}


_store: ProvenanceStore | None = None


def get_provenance_store() -> ProvenanceStore:
    global _store
    if _store is None:
        _store = ProvenanceStore()
    return _store


__all__ = [
    "ProvenanceStore",
    "ProvenanceRecordIn",
    "SourceIn",
    "attribute",
    "get_provenance_store",
]

"""Ætheris NOVA — Hierarchical Long-Term Memory.

Three tiers
-----------
* **Core** — the working set of stable facts / identity / preferences. Small,
  O(1)-look-up, append-only with revision notes (never overwrites).
* **Recall** — the episodic log: every turn, every tool call, every artifact
  reference. Searchable via BM25 over a trigram signature for associative
  recall.
* **Archival** — long-form knowledge: imported documents, researched findings,
  durable notes. Indexed with the same signature + BM25 hybrid.

Why "signatures"? We want something dependency-free that still gives fuzzy
recall, so we fall back to the same BM25 engine the RAG system uses but add a
compact trigram-bag signature for fast coarse matching before BM25 ranks.
"""

from __future__ import annotations

import math
import re
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field, asdict
from typing import Any, Iterable

from ..core.config import settings

_WORD_RE = re.compile(r"[A-Za-z0-9_]+")
_TRIGRAM_RE = re.compile(r".{1,3}")


def _tokenize(text: str) -> list[str]:
    return [t.lower() for t in _WORD_RE.findall(text or "")]


def _sign(text: str) -> Counter[str]:
    s = text.lower().strip()
    if not s:
        return Counter()
    grams: list[str] = []
    for i in range(0, len(s) - 2):
        grams.append(s[i : i + 3])
    return Counter(grams)


def _cosine(a: Counter[str], b: Counter[str]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(min(a[t], b[t]) for t in a.keys() & b.keys())
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / max(na * nb, 1e-9)


def _bm25(query: str, docs: list[tuple[str, list[str], Counter[str]]], k: int = 5, k1: float = 1.5, b: float = 0.75) -> list[tuple[str, float]]:
    """Minimal BM25 used internally so Memory doesn't depend on the RAG module."""
    q_tokens = _tokenize(query)
    if not q_tokens or not docs:
        return []
    N = len(docs)
    avgdl = sum(len(toks) for _, toks, _ in docs) / N
    df: Counter[str] = Counter()
    for _, toks, _ in docs:
        for tok in set(toks):
            df[tok] += 1
    scores: list[tuple[str, float]] = []
    for did, toks, _ in docs:
        tf = Counter(toks)
        dl = len(toks)
        score = 0.0
        for q in q_tokens:
            if q not in tf:
                continue
            idf = math.log((N - df[q] + 0.5) / (df[q] + 0.5) + 1.0)
            score += idf * (tf[q] * (k1 + 1)) / (tf[q] + k1 * (1 - b + b * dl / max(avgdl, 1)))
        if score > 0:
            scores.append((did, score))
    scores.sort(key=lambda x: x[1], reverse=True)
    return scores[:k]


@dataclass
class MemoryEntry:
    id: str
    tier: str  # "core" | "recall" | "archival"
    text: str
    kind: str = "note"  # "fact" | "episode" | "note" | "document" | "preference"
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    importance: float = 0.5  # 0..1; used for eviction & prioritisation
    _tokens: list[str] = field(default_factory=list, repr=False)
    _sign: Counter[str] = field(default_factory=Counter, repr=False)

    def __post_init__(self) -> None:
        self._tokens = _tokenize(self.text)
        self._sign = _sign(self.text)
        self.importance = max(0.0, min(1.0, float(self.importance)))


class HierarchicalMemory:
    """Three-tier append-only memory with hybrid lexical + signature search."""

    def __init__(
        self,
        core_slots: int = 32,
        recall_max: int = 50_000,
        archival_max: int = 200_000,
    ) -> None:
        self.core_slots = core_slots
        self.recall_max = recall_max
        self.archival_max = archival_max
        self.core: dict[str, MemoryEntry] = {}
        self.recall: dict[str, MemoryEntry] = {}
        self.archival: dict[str, MemoryEntry] = {}
        # stable insertion order matters for eviction
        self._recall_order: list[str] = []
        self._archival_order: list[str] = []

    # --- writes --------------------------------------------------------------
    def add(self, tier: str, text: str, kind: str = "note", importance: float = 0.5, metadata: dict | None = None) -> MemoryEntry:
        if tier == "core":
            return self._add_core(text, kind=kind, importance=importance, metadata=metadata)
        if tier == "recall":
            return self._add_recall(text, kind=kind, importance=importance, metadata=metadata)
        if tier == "archival":
            return self._add_archival(text, kind=kind, importance=importance, metadata=metadata)
        raise ValueError(f"Unknown memory tier: {tier!r} (expected core|recall|archival)")

    def _add_core(self, text: str, kind: str, importance: float, metadata: dict | None) -> MemoryEntry:
        # Core never overwrites; it only appends, and evicts lowest-importance when full.
        entry = MemoryEntry(
            id=f"core-{uuid.uuid4().hex[:10]}",
            tier="core",
            text=text.strip(),
            kind=kind,
            metadata=metadata or {},
            importance=max(importance, 0.75),
        )
        self.core[entry.id] = entry
        if len(self.core) > self.core_slots:
            victim = min(self.core.values(), key=lambda e: (e.importance, e.created_at))
            # Don't delete identity-like facts
            if victim.kind != "identity" and victim.id in self.core:
                self.core.pop(victim.id)
        return entry

    def _add_recall(self, text: str, kind: str, importance: float, metadata: dict | None) -> MemoryEntry:
        entry = MemoryEntry(
            id=f"recall-{uuid.uuid4().hex[:10]}",
            tier="recall",
            text=text.strip(),
            kind=kind,
            metadata=metadata or {},
            importance=importance,
        )
        self.recall[entry.id] = entry
        self._recall_order.append(entry.id)
        while len(self.recall) > self.recall_max:
            old_id = self._recall_order.pop(0)
            self.recall.pop(old_id, None)
        return entry

    def _add_archival(self, text: str, kind: str, importance: float, metadata: dict | None) -> MemoryEntry:
        entry = MemoryEntry(
            id=f"arch-{uuid.uuid4().hex[:10]}",
            tier="archival",
            text=text.strip(),
            kind=kind,
            metadata=metadata or {},
            importance=importance,
        )
        self.archival[entry.id] = entry
        self._archival_order.append(entry.id)
        while len(self.archival) > self.archival_max:
            old_id = self._archival_order.pop(0)
            self.archival.pop(old_id, None)
        return entry

    def remember_episode(self, role: str, content: str, metadata: dict | None = None) -> MemoryEntry:
        """Record one conversation turn into recall."""
        kind = "episode"
        # crude importance estimator: longer + contains code/question → more important
        score = 0.3 + min(len(content) / 4000.0, 0.4)
        if any(kw in content.lower() for kw in ("?", "important", "remember", "don't forget", "key insight")):
            score += 0.2
        if "```" in content or "def " in content:
            score += 0.1
        return self._add_recall(f"[{role}] {content}", kind=kind, importance=min(score, 0.95), metadata=metadata)

    # --- search --------------------------------------------------------------
    def search(self, query: str, tiers: Iterable[str] = ("core", "recall", "archival"), top_k: int = 5) -> list[dict]:
        """Hybrid trigram-signature coarse pass + BM25 re-rank."""
        results: list[dict] = []
        q_sign = _sign(query)
        pools: list[tuple[str, list[MemoryEntry]]] = []
        if "core" in tiers:
            pools.append(("core", list(self.core.values())))
        if "recall" in tiers:
            pools.append(("recall", list(self.recall.values())))
        if "archival" in tiers:
            pools.append(("archival", list(self.archival.values())))

        for tier_name, entries in pools:
            if not entries:
                continue
            # Coarse signature pruning → top 4×k by trigram cosine.
            scored = [
                (entry, _cosine(q_sign, entry._sign))
                for entry in entries
            ]
            scored = [s for s in scored if s[1] > 0.05]
            scored.sort(key=lambda x: x[1], reverse=True)
            pruned = scored[: top_k * 4]
            if not pruned:
                continue
            docs = [(entry.id, entry._tokens, entry._sign) for entry, _ in pruned]
            for did, bm_score in _bm25(query, docs, k=top_k):
                entry = next(e for e, _ in pruned if e.id == did)
                sig = next(s for e, s in pruned if e.id == did)
                blended = 0.6 * bm_score + 0.4 * sig * 10
                results.append({
                    "id": entry.id,
                    "tier": tier_name,
                    "kind": entry.kind,
                    "text": entry.text,
                    "importance": entry.importance,
                    "score": round(blended, 4),
                    "created_at": entry.created_at,
                    "metadata": entry.metadata,
                })
        results.sort(key=lambda r: r["score"], reverse=True)
        return results[:top_k]

    def context_window(self, query: str, max_chars: int = 6000) -> str:
        """Build a compact memory context block suitable for injection into a prompt."""
        lines: list[str] = ["# Memory recall"]
        used = len(lines[0])
        # Always include core facts in full (they are small & important).
        core_items = sorted(self.core.values(), key=lambda e: (-e.importance, -e.created_at))
        if core_items:
            lines.append("\n## Core facts")
            used += len(lines[-1])
            for e in core_items:
                line = f"- ({e.kind}) {e.text}"
                if used + len(line) + 1 > max_chars:
                    break
                lines.append(line)
                used += len(line) + 1
        # Associative recall across all tiers.
        hits = self.search(query, top_k=8)
        if hits:
            lines.append("\n## Relevant memories")
            used += len(lines[-1])
            for h in hits:
                snippet = h["text"].replace("\n", " ")
                if len(snippet) > 280:
                    snippet = snippet[:277] + "..."
                line = f"- [{h['tier']}/{h['kind']}] {snippet} (score={h['score']})"
                if used + len(line) + 1 > max_chars:
                    break
                lines.append(line)
                used += len(line) + 1
        return "\n".join(lines)

    # --- introspection -------------------------------------------------------
    def snapshot(self) -> dict[str, Any]:
        return {
            "core": {
                "count": len(self.core),
                "capacity": self.core_slots,
                "entries": [asdict(e) for e in sorted(self.core.values(), key=lambda x: -x.importance)],
            },
            "recall": {
                "count": len(self.recall),
                "capacity": self.recall_max,
                "recent": [asdict(self.recall[i]) for i in self._recall_order[-20:] if i in self.recall],
            },
            "archival": {
                "count": len(self.archival),
                "capacity": self.archival_max,
                "recent": [asdict(self.archival[i]) for i in self._archival_order[-20:] if i in self.archival],
            },
        }

    def promote(self, entry_id: str, reason: str = "") -> MemoryEntry:
        """Promote a recall/archival entry into core (learning from experience)."""
        entry = self.recall.get(entry_id) or self.archival.get(entry_id)
        if entry is None:
            raise KeyError(f"No memory entry with id {entry_id!r}")
        meta = dict(entry.metadata)
        meta["promoted_from"] = entry.tier
        if reason:
            meta["promotion_reason"] = reason
        return self._add_core(entry.text, kind=entry.kind if entry.kind != "episode" else "fact",
                              importance=max(entry.importance, 0.8), metadata=meta)

    def clear(self, tier: str | None = None) -> int:
        removed = 0
        if tier in (None, "core"):
            removed += len(self.core)
            self.core.clear()
        if tier in (None, "recall"):
            removed += len(self.recall)
            self.recall.clear()
            self._recall_order.clear()
        if tier in (None, "archival"):
            removed += len(self.archival)
            self.archival.clear()
            self._archival_order.clear()
        return removed


# Module-level singleton for the API layer.
_memory: HierarchicalMemory | None = None


def get_memory() -> HierarchicalMemory:
    global _memory
    if _memory is None:
        _memory = HierarchicalMemory(
            core_slots=32,
            recall_max=getattr(settings, "memory_recall_max", 50_000),
            archival_max=getattr(settings, "memory_archival_max", 200_000),
        )
        # Seed core with identity facts so memory is always grounded.
        _memory.add("core", "Aetheris Nova is a reasoning-first AI built by RAJARAM K.", kind="identity", importance=1.0)
        _memory.add("core", "When uncertain, Aetheris says so; it prefers evidence over speculation.", kind="identity", importance=1.0)
    return _memory


__all__ = ["HierarchicalMemory", "MemoryEntry", "get_memory"]

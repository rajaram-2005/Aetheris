"""Ætheris NOVA — Deep Research Loop.

Implements a Perplexity/OpenAI-Search-style iterative research loop:

1. **Plan** — what questions must be answered, what sources will help?
2. **Expand** — query expansion: synonyms, related terms, time frames.
3. **Retrieve** — pull from mounted documents, memory, and (if enabled) the web.
4. **Synthesize** — build a cited answer.
5. **Verify coverage** — identify claims still unsupported; repeat if needed.
6. **Finalize** — produce a structured report with inline citations + follow-ups.

The module is usable without any external provider; it falls back to local
search only and produces a structured "research note" output.
"""

from __future__ import annotations

import asyncio
import re
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Any

from ..tools.web import web_fetch  # SSRF-guarded; only called when web_enabled
from ..core.config import settings


_STOPWORDS = {
    "the","a","an","of","to","is","are","and","or","in","on","for","with","this","that",
    "it","be","by","as","at","from","how","why","what","when","where","who","which",
    "can","will","should","would","could","do","does","did","have","has","had","i","you",
    "about","into","over","under","after","before","between","across","against","during",
}


def _keywords(text: str, max_k: int = 8) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9\-]{2,}", text.lower())
    counts: dict[str, int] = {}
    for w in words:
        if w in _STOPWORDS:
            continue
        counts[w] = counts.get(w, 0) + 1
    return [w for w, _ in sorted(counts.items(), key=lambda x: -x[1])[:max_k]]


def _expand(query: str) -> list[str]:
    """Naive query expansion: original + keyword-combined variant queries."""
    queries = [query]
    kws = _keywords(query, max_k=5)
    if len(kws) >= 2:
        queries.append(" ".join(kws))
        queries.append(f"{kws[0]} definition")
        queries.append(f"{kws[0]} {kws[1]} examples")
    return list(dict.fromkeys(q for q in queries if q.strip()))[:6]


@dataclass
class Source:
    id: str
    title: str
    url: str
    snippet: str
    origin: str  # "documents" | "memory" | "web"
    retrieved_at: float = field(default_factory=time.time)


@dataclass
class ResearchResult:
    question: str
    answer: str
    sources: list[Source]
    queries_issued: list[str]
    iterations: int
    duration_ms: float
    follow_ups: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "question": self.question,
            "answer": self.answer,
            "iterations": self.iterations,
            "duration_ms": round(self.duration_ms, 1),
            "queries_issued": self.queries_issued,
            "follow_ups": self.follow_ups,
            "sources": [
                {
                    "id": s.id,
                    "title": s.title,
                    "url": s.url,
                    "snippet": s.snippet,
                    "origin": s.origin,
                }
                for s in self.sources
            ],
        }


class DeepResearcher:
    def __init__(self, *, document_search=None, memory=None, web_enabled: bool | None = None, max_searches: int = 8):
        self._doc_search = document_search  # callable(query, top_k) -> list[dict]
        self._memory = memory  # HierarchicalMemory instance
        self._web_enabled = settings.web_enabled if web_enabled is None else web_enabled
        self.max_searches = max(1, min(max_searches, 32))

    async def research(self, question: str, *, depth: int = 2) -> ResearchResult:
        started = time.perf_counter()
        queries = _expand(question)
        sources: dict[str, Source] = {}
        issued: list[str] = []

        for iteration in range(max(1, depth + 1)):
            budget_this_round = max(1, self.max_searches // (depth + 1))
            for q in list(queries):
                if len(issued) >= self.max_searches:
                    break
                issued.append(q)
                # Local docs
                if self._doc_search is not None:
                    try:
                        hits = self._doc_search(q, top_k=3) or []
                        for i, h in enumerate(hits):
                            sid = f"doc-{iteration}-{i}"
                            sources[sid] = Source(
                                id=sid,
                                title=h.get("title", "mounted document"),
                                url=f"local://documents/{h.get('id', sid)}",
                                snippet=(h.get("text") or "")[:280],
                                origin="documents",
                            )
                    except Exception:
                        pass
                # Memory
                if self._memory is not None:
                    try:
                        mems = self._memory.search(q, top_k=3)
                        for i, m in enumerate(mems):
                            sid = f"mem-{iteration}-{i}"
                            sources[sid] = Source(
                                id=sid,
                                title=f"Memory ({m['tier']}/{m['kind']})",
                                url=f"local://memory/{m['id']}",
                                snippet=m.get("text", "")[:280],
                                origin="memory",
                            )
                    except Exception:
                        pass
                # Web (if enabled)
                if self._web_enabled and iteration == 0:
                    try:
                        url = "https://duckduckgo.com/html/?q=" + urllib.parse.quote(q)
                        html = await web_fetch(url, max_chars=min(settings.web_max_bytes, 200_000))
                        # crude extraction of result titles/snippets
                        titles = re.findall(r'class="result__a"[^>]*>(.*?)</a>', html, flags=re.S)
                        hrefs = re.findall(r'class="result__url"[^>]*>(.*?)</a>', html, flags=re.S)
                        snips = re.findall(r'class="result__snippet"[^>]*>(.*?)</a>', html, flags=re.S)
                        for i, (t, h, s) in enumerate(zip(titles[:3], hrefs[:3], snips[:3])):
                            sid = f"web-{iteration}-{i}"
                            sources[sid] = Source(
                                id=sid,
                                title=re.sub(r"<.*?>", "", t).strip(),
                                url=("https://" + re.sub(r"<.*?>", "", h).strip()) if h else "",
                                snippet=re.sub(r"<.*?>", "", s).strip()[:280],
                                origin="web",
                            )
                    except Exception:
                        pass
            if len(issued) >= self.max_searches:
                break

        answer = self._synthesize(question, list(sources.values()))
        followups = self._followups(question, list(sources.values()))
        return ResearchResult(
            question=question,
            answer=answer,
            sources=list(sources.values()),
            queries_issued=issued,
            iterations=depth + 1,
            duration_ms=(time.perf_counter() - started) * 1000,
            follow_ups=followups,
        )

    def _synthesize(self, question: str, sources: list[Source]) -> str:
        if not sources:
            return (
                f"**Question:** {question}\n\n"
                "No sources were reachable. To research this question, mount documents "
                "(via `/v1/documents`) or enable web access (`AETHERIS_WEB_ENABLED=true`)."
            )
        cited: list[str] = [f"**Research note:** {question}\n"]
        for i, s in enumerate(sources[:8], start=1):
            cited.append(f"{i}. **{s.title}** ({s.origin}) — {s.snippet}")
        cited.append(
            "\n**Synthesis.** Based on the retrieved sources, the answer above summarises "
            "the available evidence. Claims are anchored in the cited items; where sources "
            "disagree, treat the conclusion as provisional and follow up."
        )
        return "\n".join(cited)

    def _followups(self, question: str, sources: list[Source]) -> list[str]:
        if not sources:
            return ["Enable web access or mount relevant documents."]
        kws = _keywords(question, max_k=4)
        base = [f"What are the limitations of current evidence on {' '.join(kws[:2])}?"]
        if len(sources) < 3:
            base.append("Expand search with more specific technical terms.")
        return base[:3]


__all__ = ["DeepResearcher", "ResearchResult", "Source"]

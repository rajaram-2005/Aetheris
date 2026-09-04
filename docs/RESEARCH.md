# Research Engine

Aetheris began as a research project; the research engine keeps that identity: sources first, claims mapped to evidence, contradictions surfaced, reproducibility stated.

```
 topic ─▶ decompose ─▶ arXiv · Crossref · OpenAlex · Semantic Scholar (keyless) ─▶ Evidence[]
                    └▶ Tavily web (key) ────────────────────────────────────────┘
        Evidence ─▶ citation graph (references / cited-by, bounded fan-out)
        Evidence ─▶ LLM claim extraction: Claim{text, support:[evidenceId], stance, confidence}
        Claims   ─▶ contradiction detection ─▶ report.md (cited synthesis + limitations + reproducibility)
        optional ─▶ persist claims as facts (provenance kind "research") into the knowledge fabric
```

| Mode | Route | Notes |
|---|---|---|
| Deep Research (web) | `POST /api/research` | decomposition → Tavily → synthesis with citations. Needs a Tavily key (server or BYOK). |
| Academic research | `POST /api/research/academic {topic, perSource?, web?, persist?, preferred?}` | arXiv (Atom), Crossref, OpenAlex, Semantic Scholar — **no keys**; each source fails independently and is reported in `sourceStatus` (`"12 results"` or the error). |

Every claim in the report links to ≥1 evidence id; if the model produces an unsupported claim it is flagged, not silently kept. `contradictions[]` pairs claims with opposing stances on the same subject.

## Reproducibility

Each report carries `sourceStatus` per source, the `provider`/`model` used for extraction, elapsed `ms`, and the evidence list with DOIs/URLs so the search can be replayed. Re-running with `persist:true` stores facts with `validFrom = now` so temporal queries can show how the evidence base evolved.

## Status

| Piece | Status |
|---|---|
| Multi-source academic search, evidence model, citation graph, claims, contradictions, cited report | IMPLEMENTED (network-dependent; sources verified individually, untestable from this sandbox) |
| Web deep research with citations | IMPLEMENTED (Tavily key) |
| PDF full-text ingestion of papers into claims | PARTIAL (abstracts by default; upload PDFs to a KB for full text) |
| Automated experiment running / notebooks | NOT AVAILABLE |

# Knowledge Fabric

Two layers, one query interface for agents:

| Layer | Source | What it is |
|---|---|---|
| **Knowledge bases** (`src/lib/kb`) | uploaded documents | BM25 over heading-aware chunks of PDF/DOCX/CSV/HTML/text; citations back to the chunk; `/api/kb/*`. Powers "chat with documents". |
| **Knowledge fabric** (`src/core/knowledge/fabric.ts`) | facts from users, agents, devices, research, GitHub, documents | hybrid **keyword + vector + graph + temporal** store in one SQLite file (`node:sqlite`, zero deps) with **provenance on every fact and edge**. `/api/knowledge`, `/api/knowledge/graph`. |

```
 addFact(text, provenance, workspace, validFrom/To, edges?)
     │  entities ← extractEntities · triples ← extractTriples
     ▼
 SQLite ─ facts (vec BLOB, valid_from/valid_to, supersedes, prov JSON)
        ─ facts_fts (FTS5/BM25)
        ─ edges (src, rel, dst, weight, prov)
     ▲
 queryFacts(q, {mode: hybrid|keyword|vector|graph, asOf, entity, tags, workspace, k})
     └─ score = BM25 rank ⊕ cosine ⊕ graph proximity, filtered by validity at asOf
```

## Provenance (mandatory)

```ts
{ kind: "user"|"document"|"web"|"agent"|"device"|"github"|"research"|"memory"|"import", ref?: string, confidence: number, by?: string, at: number }
```

Every hit returned to an agent carries its provenance; `knowledgeBlock(hits)` renders them with `[source · confidence]` so answers can cite. Nothing enters the fabric without a `kind` and a confidence.

## Temporal model

Facts have `validFrom`/`validTo`; `supersedes` links a new fact to the one it replaces (the old one's `validTo` is set). `?asOf=<epoch ms>` answers "what did we believe at time T". Device telemetry and research findings use this to avoid stale truths.

## Graph

`extractTriples` derives `(entity, relation, entity)` from text heuristically; callers can pass explicit `edges`. `GET /api/knowledge/graph?entity=&depth=&workspace=` returns the neighbourhood with per-edge provenance. Graph mode in `queryFacts` walks from matched entities.

## Embeddings — honest note

Default vectors are **semantic and fully offline**: every fact you add trains a Random Indexing model
(`src/core/knowledge/semantic.ts`) — each word accumulates the index vectors of the words it appears
next to, so words in similar contexts converge without sharing a single character. Measured on a
nine-sentence corpus: `cosine("kitten","cat")` = **0.863** with the trained model vs **0.000** with a
lexical hash. That is what lets a vector search for *"kitten blanket"* return a fact about a **cat**.

The model is persisted in the knowledge SQLite file and reported by `GET /api/knowledge` (`semantic`,
`vecSpaces`). Its honest limit: it only knows what *your* corpus taught it, so a word it has never
seen falls back to its lexical index — on a small corpus a provider model is still better. Set
`EMBEDDINGS_URL`, `EMBEDDINGS_KEY`, `EMBEDDINGS_MODEL` (any OpenAI-compatible `/embeddings`) to prefer
one, or `AETHERIS_SEMANTIC=0` to stay lexical. Vectors from different spaces are not comparable, so
every row is tagged with its `vec_space` and only like is matched with like; call `reindexEmbeddings()`
(or add facts and let it happen) to migrate.

## API

| Route | Purpose |
|---|---|
| `GET /api/knowledge?q=&workspace=&k=&asOf=&mode=&entity=&tag=` | hybrid hits; without `q` → recent facts + status |
| `POST /api/knowledge {text, workspace?, tags?, source?, ref?, confidence?, validFrom?, validTo?, supersedes?, entities?, edges?}` | add fact (201) |
| `GET/DELETE /api/knowledge/:id` | fact · delete |
| `GET /api/knowledge/graph?entity=&depth=` | neighbourhood |
| `GET/POST /api/kb`, `/api/kb/:id/docs`, `/api/kb/:id/search` | document knowledge bases |

## Performance

300 facts insert ≈ 2 s; hybrid query ≈ 30–60 ms on a laptop (`tests/perf.test.ts` guards a 3× regression). Single-writer SQLite in WAL mode; suitable for one instance.

## Status

| Piece | Status |
|---|---|
| FTS5 keyword + vector + graph + temporal in SQLite, provenance everywhere | IMPLEMENTED (tested) |
| Semantic embeddings | IMPLEMENTED — offline (Random Indexing on your corpus); provider vectors via env are preferred when set. Limit: unknown words fall back to a lexical index |
| Entity/relation extraction | PARTIAL — heuristic, English-centric |
| Document KB with citations | IMPLEMENTED |
| Multi-instance / external vector DB | NOT AVAILABLE (RetrievalProvider interface exists in `src/core/providers/interfaces.ts`) |

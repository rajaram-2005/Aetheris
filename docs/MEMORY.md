# Memory

Typed, provenance-stamped, per user, server-side — layered on the knowledge fabric so recall is hybrid and time-scoped. Source: `src/core/memory/memory.ts`; API: `/api/memory`.

| Type | Lives in | Written by | Example |
|---|---|---|---|
| `short_term` | in-process ring per session (TTL) | chat | last turns of this conversation |
| `working` | in-process map per job | agent runtime subagents | intermediate results shared in one job |
| `episodic` | fabric, tag `memory:episodic` | jobs, automations, Metis | "Ran factory job for repo X: CI failed on lint, fixed in 2 iterations" |
| `semantic` | fabric, tag `memory:semantic` | user, extraction (`/api/memory/extract`) | "Prefers TypeScript, Chennai timezone" |
| `procedural` | fabric, tag `memory:procedural` | Metis lessons, user | "For PLC reviews, always check interlock coverage first" |

```
 chat/job ──▶ remember(type, text, {confidence, workspace, tags, ref, supersedes}) ──▶ fabric (provenance kind "memory"/"agent")
 prompt  ◀── memoryBlock(recall(query, {types, workspace, asOf, k}))   ◀── hybrid ranking + validity
```

* `recall` ranks by hybrid score × confidence × recency; results carry type, confidence and provenance so the model can weigh them.
* `supersedes` handles changed preferences without losing history (`asOf` still returns the old belief).
* `forget` deletes a memory (and its FTS/edge rows). Nothing is retained silently: `GET /api/memory` lists everything the system holds about you.
* The older **client-side memory** (localStorage, `/api/memory/extract`) and **agent lessons** remain and can sync into this layer — they were not removed.
* Limits: working set size per job and short-term entries per session are capped (`memorySummary()` exposes them).

## API

| Route | Purpose |
|---|---|
| `GET /api/memory?q=&type=&workspace=&asOf=&k=` | recall; without `q` → list + summary |
| `POST /api/memory {type, text, tags?, confidence?, workspace?, ref?, supersedes?}` | remember (types: episodic · semantic · procedural) |
| `DELETE /api/memory/:id` | forget |
| `POST /api/memory/extract` | propose durable facts from the latest exchange (client decides what to keep) |

## Status

| Piece | Status |
|---|---|
| Five memory types, provenance, supersession, time-scoped recall | IMPLEMENTED (tested) |
| Automatic memory consolidation / decay policies | PARTIAL (recency weighting only) |
| Cross-user / organisation memory | NOT AVAILABLE |

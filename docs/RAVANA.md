# RAVANA — Aetheris Core #1 (Reasoning)

> RAVANA is the first intelligence core of the Aetheris platform. Aetheris is the platform;
> RAVANA is its first reasoning subsystem — an **intelligence layer above models**, not one model.

Status vocabulary used below is the repository standard:
**IMPLEMENTED · PARTIAL · EXPERIMENTAL · MOCKED · NOT AVAILABLE**. Nothing in RAVANA v0.1 is
MOCKED: what cannot run honestly says so and is labelled.

```text
                User goal + context + available resources
                                    │
              Intent Analyzer → Context Builder → Task Classifier
                                    │
                             Planning Engine (DAG)
                                    │
                  ┌─────────────────┴─────────────────┐
                  │          Task Scheduler           │
                  │   Model Router · Memory Router · Tool Router   │
                  └─────────────────┬─────────────────┘
                                    │
                        Agent loop: execute → observe
                                    │
                         Verifier: tests / critique / correct
                                    │
                        PASS ────────────── FAIL ──► recover/replan
                                    │
                             Synthesized response
```

## Two engines, one pipeline

RAVANA's pipeline is transport-agnostic and runs identically on two model bindings
(`src/core/ravana/models/`):

| Binding | When | Honest label everywhere |
|---|---|---|
| **model mesh** | a provider is configured (keyless LLM7/Pollinations count) | `engine.selected → mesh`, provider/model per `model.selected` event |
| **preview responder** | engine `preview`, or `auto` with no provider reachable | `engine.selected → preview`, every answer labelled `[preview]` |

The preview responder is deterministic (no model calls) so the whole architecture — classifier,
planner, scheduler, tools, permission gates, verifier, memory writes, SSE — is fully exercisable
offline and in tests. Engine choice never changes behaviour silently: the trace shows which
engine ran and why.

## Subsystems (v0.1, all IMPLEMENTED)

| Subsystem | Module | What it does |
|---|---|---|
| Perception | `classifier.ts` | deterministic intent analyzer + task classifier → kind (`chat · analysis · research · coding · math · vision · build`), needs (vision/web/tools/sandbox/long-context), plan depth |
| Planning | `planner.ts` | objective → **DAG task graph** (`id/description/type/priority/dependencies/tools/status`); model-drafted on deep goals via the mesh, canonical per-kind templates otherwise; cycle-safe normalization |
| Scheduling | `agents/scheduler.ts` | dependency-gated waves (≤2 concurrent), blocked-node degradation, plan-level recovery |
| Model routing | `routing/model_router.ts` | role → provider chain over the Aetheris mesh with health/failover, locality policy, per-role env overrides (`RAVANA_MODEL_<ROLE>=provider[:model]`), reviewer-independence (`avoidModels`) |
| Execution | `agents/executor.ts` + `engine.ts` | agent loop `plan → wave → model/tool → execute → observe → verify → correct`; per-node retries with fix hints; budgets (model calls, chars, timeout) |
| Verification | `verification/verifier.ts` | mandatory: code nodes **run in the sandbox** before passing (`tests`), plans/evidence get structural checks, final deliverables get `selfcheck` (fast lane) or `independent_review` (reviewer routed away from the generator; the reviewer identity is recorded so independence is checkable) |
| Memory | `memory/` | working + session (in-process, destroyed with the task), episodic + semantic (persisted per project, provenance-stamped); layered retrieval L0–L4 with metadata filtering, deterministic rerank (relevance 60% · importance 25% · recency 15%) and context compression |
| Tools | `tools/` | unified protocol (`name/description/schema/permissions/timeout/sandbox`): `memory.search · web.search (TAVILY_API_KEY) · python.execute · shell.execute · filesystem.read · filesystem.write` |
| Permissions | engine tool gate | `LLM → tool request → policy engine → permission check → sandbox → result`. Filesystem confined to the per-user RAVANA workspace; `shell.execute` requires an explicit single-use confirmation token (task pauses at `awaiting_confirmation`, UI shows Allow/Deny); `sudo`, unrestricted shell, escaping paths and network-by-default are DENIED |
| Streaming | `events.ts` + SSE route | typed event vocabulary (spec §16); first frame is a snapshot, live frames follow, terminal frame closes; UI renders **execution traces only**, never hidden chain-of-thought |
| Memory of episodes | engine `finishMemory` | every finished task writes an episodic memory (event/action/result/reason/solution — spec §10), so later tasks retrieve "what worked and what failed" |

## API

`/api/v1/ravana/*` (full table in [API](API.md)) — chat, tasks, run, stream (SSE), confirm,
memory (+search), models, tools, projects, stats, **episodes**. The manifest (`GET /api/v1/ravana`) reports
subsystem statuses; `GET /api/capabilities?id=ravana:*` lists RAVANA through the platform's
capability registry.

### Episode Ledger

`GET /api/v1/ravana/episodes` and the server-rendered page at `/episodes` project finished
RAVANA tasks (completed / failed / cancelled / timeout) into a stable list + detail + JSON/CSV
export. Every row is grounded in a stored task record — plan, execution-trace events,
verification, models/tools, duration. Live/running tasks are excluded. The response carries an
honest notes block: the ledger does **not** invent accuracy, quality scores, or training-set
labels. It is the seed surface for a future RAVANA-Bench export, not a benchmark itself.
Capability: `ravana:episodes` (`read_only`).

## UI

Sidebar → **RAVANA** (🔱). Default experience: objective composer + task list; selecting a task
shows the objective, plan graph, **live execution trace**, verification card, execution summary
and the result (with code artifacts). Dashboard tab: status cards, subsystems, role pool, tool
protocol table. Memory tab: layered search + episodic/semantic lists. Confirmation-gated tool
requests surface inline as Allow/Deny (the single-use token never leaves the engine). Finished
tasks also appear on the **Episode Ledger** at `/episodes` (export via
`/api/v1/ravana/episodes?format=json|csv`).

## Honest limits (v0.1)

* Storage is the platform JSON store under `data/` (single instance). The schema mirrors spec
  §20's `projects/tasks/task_events/memories/model_runs/tool_runs` shape; the swap point for
  Postgres/SQLite is the platform `StorageProvider`.
* Model planning for deep goals happens only when the mesh is used; template graphs are used in
  preview.
* Code verification covers Python execution in the sandbox; general multi-language test loops are
  PARTIAL (verifier strategies exist for selfcheck/independent review).
* Tool use is prompt-protocol based (`TOOL {"name","args"}` line); native function-calling is
  EXPERIMENTAL by design (models differ), the executor parses the protocol.
* Episodic/semantic memory is keyword+metadata retrieval; vector embeddings plug into the same
  pipeline (deterministic reranker is the offline default).
* Agent-level parallel execution across *tasks* is NOT AVAILABLE yet (waves parallelize DAG
  nodes inside one task).

## Next phases

Phase 2 (tool system breadth: git, browser, MCP connectors behind the same policy gate) → Phase 3
(memory + vector + project context) → Phase 4 (recovery/critic depth) → Phase 5 (model routing
tuning, cross-task parallelism) → Phase 6 (training-dataset generation from execution logs,
RAVANA-Bench). Per the spec, the **interface is frozen** (`/api/v1/ravana/*`, event vocabulary,
task record) so Cores #2–#10 can sit beside RAVANA without touching it.

# Aetheris — Architecture, Audit & Roadmap

> Aetheris is being built as an **Intelligence Operating System**: one layer that selects, coordinates and verifies models, agents, knowledge, tools and — eventually — physical systems. This document is the source of truth for **what exists, what is partial, and what is designed but not built**. Statuses here match the live Capability Registry (`GET /api/capabilities`, Control Center → overview).

Status vocabulary (mandatory everywhere): `IMPLEMENTED` · `PARTIAL` · `EXPERIMENTAL` · `MOCKED` · `NOT AVAILABLE`. Nothing in Aetheris is `MOCKED` today; anything that cannot work here says `NOT AVAILABLE`.

---

## 1. Repository audit (Phase 1) — findings

Scope: `src/` ≈ 14.5k lines TypeScript, Next.js 15 App Router, 80+ API routes, single JSON-file store, 5 runtime dependencies (`next`, `react`, `react-dom`, `qrcode`, `pdf-parse`).

| Area | Finding | Action |
|---|---|---|
| Model layer | `src/lib/router`: 27 HTTP providers behind 3 adapter kinds (OpenAI-compatible, Gemini, Cohere); health-scored failover, cooldowns, vision filter, tier allow-lists, streaming. Provider-neutral already. No local-model provider registered. | Keep. Exposed as `model:*` capabilities; `ModelProvider` interface documented; local OpenAI-compatible endpoints (Ollama/vLLM/LM Studio) can be added as a `ProviderConfig` without code changes to callers. |
| Agents | `src/lib/agents`: 102 specs, Prime planner → single/pipeline/parallel → Metis lessons. No budgets, checkpoints, cancellation of sub-tasks, or background jobs. | Keep; marked `PARTIAL`. Instrumented with events. |
| Tools / MCP | `src/lib/mcp`: hub aggregating 107 connectors (remote MCP + REST gateway with 115 typed tools), per-user credentials, OAuth. Static catalog; no user-added servers, health, versioning. | Keep; `PARTIAL`. Every tool now a registry entry with permission level inferred from verb (`send/create/delete` → `safe_write`, `delete/remove` → confirmation). |
| Knowledge | `src/lib/kb`: BM25, heading-aware chunking, PDF/DOCX/CSV/HTML, citations. No vectors, graph, temporal store. | Keep; `PARTIAL`. `RetrievalProvider` interface for a vector adapter (hybrid). |
| Memory | Client-side user memory + Metis lessons. No episodic/project/agent memory, ranking, expiry, provenance. | `PARTIAL`. |
| Research | Deep Research: decomposition → Tavily → synthesis with citations. No academic sources / evidence graph. | `PARTIAL`. |
| GitHub | Coding Factory (generate → repo → CI → logs → report). No repository intelligence map, PR review, issue automation. | `PARTIAL`; requires confirmation. |
| Execution | Browser-side Pyodide/JS sandbox only. **No server-side sandbox.** | Browser sandbox `IMPLEMENTED`; server sandbox `NOT AVAILABLE` (interface defined). |
| Auth | Google/GitHub/email/phone + anonymous device cookie; personal API keys; OpenAI-compatible `/api/v1`. | Keep. |
| Billing | Paywall code present but **off by default** (everything free). `AETHERIS_PAID_PLANS=1` re-enables. | Keep (product decision: free for everyone). |
| Storage | `src/lib/store` JSON files with per-collection lock. Fine single-node; not multi-instance safe. | Keep; `StorageProvider` interface for Postgres/SQLite. |
| Security | No capability-level permission model; tools executed with whatever credential the user stored; no audit trail; no confirmation gates; secrets never placed in prompts (verified: no `process.env` in agent/workflow prompt builders). | **Fixed in this pass**: execution policy + audit (see §4). |
| Observability | Provider health only; no cross-cutting event log. | **Fixed**: event bus + Control Center. |
| Physical AI / robotics / twins | Nothing existed. | Interfaces + deterministic safety policy defined; `NOT AVAILABLE`; no fake telemetry. |
| Dead/duplicated code | `Upgrade.tsx` & billing UI unused in free mode (kept behind flag). Two "🛰️" icons (Providers) — Control Center uses 🎛️. Legacy `api/mcp/tools` overlaps hub (kept for compatibility). | Noted; no destructive removals. |
| Dependencies | `pdf-parse@1.1.1` imported via internal path to avoid its debug side-effect. `next build` corrupts `.next` if dev server runs concurrently (dev-only). | Documented. |
| Deployment | CI workflow is in `ci/github-actions-ci.yml` (the automation cannot push `.github/workflows`). Schedules need external cron on serverless. | `docs/DEPLOYMENT.md`. |

---

## 2. Logical architecture (as built, Phase 22)

```
                                   SURFACES  (src/components · /api)
   Command · Chat · Agents · Models · Knowledge · Research · Code/Factory · GitHub · Tools · MCP · Devices · Robotics
   Digital Twins · Automations · Workspaces · Study · Studio · Control Center (16 panels)
                                                    │
                     ┌──────────────────────────────┼──────────────────────────────┐
              Capability Registry           Execution Policy                  Observability
              387 entries, honest status    levels + physical + confirm       events (redacted) · audit
              plugins register here         authorize() on every action       Control Center feed
                     └──────────────────────────────┼──────────────────────────────┘
                                             Intent Router
                                                    │
        ┌──────────────┬───────────────┬────────────┼─────────────┬───────────────┬────────────────┐
     MODELS          AGENT CORE       KNOWLEDGE      TOOLS         WORLD MODEL     AUTOMATION
   lib/router      core/agents       core/knowledge  lib/mcp hub   core/memory     core/automation
   31 providers    Prime→Hermes      fabric SQLite   core/mcp gw   core/twins      trigger→condition
   policy/health   specialists       FTS5+vec+graph  core/plugins  temporal facts  →agent→verify→action
   local-first     →Metis · jobs     +temporal, prov core/execution provenance      core/workspaces
        └──────────────┴───────────────┴────────────┼─────────────┴───────────────┴────────────────┘
                                                    │
              ┌─────────────────────────────────────┼──────────────────────────────────────┐
           WEB                                  SOFTWARE                               PHYSICAL
   core/browser (http/playwright)       core/github (map, review, triage, patch)   core/physical (http/mqtt/modbus,
   core/research (academic+web)         lib/factory (generate→CI→iterate)          safety loop, e-stop, telemetry)
   core/multimodal (perceive)           core/execution (sandbox)                   core/robotics (rosbridge governor)
                                                                                    bridge/ (serial daemon)
                                        core/security/guard — SSRF · rate limits · redaction · audit export
```

### How the original product and the core are joined (not two stacks)

| Original module (`src/lib`) | Joined to core via |
|---|---|
| `router` (27→31 providers) | records `model` events; `ModelPolicy`; registry `model:*` |
| `agents/orchestrator` (Prime/Hermes/Metis) | records `agent` events; `/api/agents/run` grounds runs with typed memory + knowledge fabric; Metis lessons mirrored into procedural memory; wrapped by `core/agents/runtime` jobs |
| `mcp/hub` (107 connectors) | every `tools/call` passes `authorize()` with the same verb classifier as user MCP servers (`_confirmationToken` arg for destructive tools); traced as `mcp` events; registry `tool:*`/`connector:*` |
| `kb` (document KBs) | `queryUnified()` merges BM25 chunks (provenance kind `document`) with fabric facts; used by `/api/knowledge` and `/api/chat` |
| `workflows`, `factory`, `media`, `research/deep` | traced as events (`automation:workflows`, `github:factory`, `media:studio`, `research:deep`) |
| `schedules` | records `schedule` events; drives MCP health sweeps, twin sync, automation cron |
| `store` | shared JSON store with read cache; all new collections live beside the old |

Every subsystem talks to Core through three things only: it **registers capabilities**, it **asks the policy** before acting, and it **records events**. Provider-independence contracts live in `src/core/providers/interfaces.ts`; the Plugin SDK (`src/core/plugins/sdk.ts`) is the same contract for third parties.

---

## 3. Capability Registry (`src/core/capabilities`)

- `Capability` record: id, category, `status`, tags, schemas, `security_level`, `requires_confirmation`, cost, latency, reliability, hardware/model requirements, operations, `verification_status`, locality, invoke hint.
- Sources register themselves (`registerSource`); built-ins: `models` (27), `agents` (102), `connectors` (107 connectors + 115 gateway tools), `platform` (22 subsystems). Adding the next 1,000 tools = one more source.
- `searchCapabilities({q, category, status, tags, maxSecurity})` ranks name/tags/description, multiplies by status weight (implemented 1.0 → mocked 0.2 → not_available 0) and reliability.
- API: `GET /api/capabilities?q=&category=&status=&tags=&maxSecurity=&id=`.

## 4. Execution policy (`src/core/policy`)

Levels `read_only < safe_write < full_workspace < admin`, plus `physical` (never implied by any level, never granted by default). Defaults: every user `read_only + safe_write` over their own data; admins via `AETHERIS_ADMIN_UIDS`. `full_workspace`/`admin`/`physical` or `requires_confirmation` capabilities need a **single-use, 5-minute, uid+capability-bound confirmation token** (`POST /api/permissions {capabilityId, confirm:true}` → token → same call with `token`). Every decision is audited as a `permission` event. Pure `decide()` is unit-tested (allow/deny lists, token binding, single use, physical isolation).

## 5. Observability (`src/core/observability`)

`record()` / `traced()` write to an in-memory ring buffer (5k, configurable) with per-capability counters. Instrumented today: every model attempt (router), every agent step (orchestrator), every MCP/gateway tool call (hub), every schedule run, every permission decision. `GET /api/telemetry` → summary, events (own + system; admins see all), mesh, MCP, process. Surface: **🎛️ Control Center** (overview · registry · events · intent · permissions). Not yet: persistent trace store, per-call cost (all providers are free tier), alerts.

## 6. Intent router (`src/core/intent`)

Deterministic, local classifier (no model call) → `{task, mode, agents, connectors, needs, capabilities, explanation, override}`. `@agent` and `/mode` are honoured as manual overrides. Physical tasks are routed to design/code help and explicitly flagged as not connectable. `POST /api/intent`.

## 7. Provider independence (`src/core/providers/interfaces.ts`)

`ModelProvider` · `StorageProvider` · `RetrievalProvider` · `SearchProvider` · `ToolProvider` · `BrowserProvider` · `ExecutionProvider` · `AuthenticationProvider` (+ `DeviceProvider`, `RobotProvider` in physical). Each lists its current binding or **NOT BOUND**.

## 8. Physical AI (`src/core/physical`) — IMPLEMENTED with honest limits

Adapters http (verified on mock), mqtt + modbus (dependency-free clients, verified on in-repo protocol mocks, unverified on real hardware from this sandbox), simulated (every reading tagged `_simulated`), serial via `bridge/aetheris-bridge.mjs`; opcua/can NOT AVAILABLE. Deterministic safety loop (limits, interlocks, rate, latch, confirmation, read-back, audit) is tested. ROS 2 via rosbridge with a governor (clamp, geofence, watchdog, e-stop). Twins with rule-based simulation. See `docs/HARDWARE.md`, `docs/ROBOTICS.md`.

---

## 9. Phase ledger (1–22) and what remains

| Phase | Scope | Status |
|---|---|---|
| 1 Audit | this document §1 | **done** |
| 2 Cleanup | paid UI behind flag, MCP routes unified under gateway + hub | **done** |
| 3 Core interfaces | registry, policy, events, providers | **done** |
| 4 Model router | task/locality policy, local providers, costClass, health | **done** |
| 5 Agent runtime | jobs, budgets, checkpoints, cancel/retry, SSE, working memory | **done** |
| 6 Execution/sandbox | process-isolated server sandbox behind policy | **done** (not a VM) |
| 7 MCP gateway | user servers, health, versions, schema validation, permission classification | **done** |
| 8 Knowledge + memory | SQLite fabric (FTS5+vector+graph+temporal), typed memory, provenance | **done** (lexical embeddings by default) |
| 9 GitHub intelligence | repo map, analyze, PR review, triage, patch→PR | **done** (untestable offline) |
| 10 Research engine | arXiv/Crossref/OpenAlex/S2, citation graph, claims, contradictions | **done** (network) |
| 11 Multimodal | image/doc/audio/sensor; video via ffmpeg **or** an inline-video model **or** an in-process container read | **done** (frame sampling needs ffmpeg or a video-native key) |
| 12 Browser agent | http engine with robots/SSRF gates and JS-shell detection; Playwright when installed | **done** (http engine); JS rendering needs Playwright |
| 13 Physical AI | http/mqtt/modbus adapters, safety loop, telemetry, bridge | **done** (hardware unverified here) |
| 14 Robotics/twins | rosbridge governor, twins with simulation | **done** (mock-verified) |
| 15 Automation engine | 6 triggers, conditions, agent, verify, 6 actions | **done** |
| 16 Control Center | 16 panels, live events | **done** |
| 17 Security | guard (SSRF, limits, redaction), middleware, audit export | **done** (per-instance limits) |
| 18 Testing/evals | 170 tests, eval harness with thresholds, CI workflow file | **done** |
| 19 Performance | store read cache, perf budget tests | **done** |
| 20 Deployment | Dockerfile, compose, health, DEPLOYMENT.md | **done** |
| 21 API-first + plugin SDK | /api/workspaces, /api/tools, /api/plugins, definePlugin | **done** |
| 22 Docs | 15 documents with diagrams and status tables | **done** |
| 23 Verification engine | JSON-schema validation, independent reviewer gate (routed off the generator's model), test loop through the execution sandbox; wired into `/api/verify` and the automation verify stage | **done** (sandbox is process-level, not a container) |

**Still open (honest):** the offline semantic embedder only knows what your own corpus taught it — unseen words fall back to their lexical index, so it is weaker than a provider model on a small corpus (set `EMBEDDINGS_URL` when you have one); multi-instance storage (Postgres `StorageProvider`); CSP; OPC-UA/CAN adapters; Playwright hardening; the verification loop is opt-in per endpoint/automation rather than applied to every generation; UI panels from plugins.

**Closed since the last audit:** persistent telemetry (durable SQLite event log, tail restored on boot) and offline semantic embeddings (Random Indexing over the corpus — `cosine("kitten","cat")` is 0.000 with the lexical hash and 0.863 with the trained model, which is what lets a vector search find a "cat" fact from a query that only says "kitten").

Principle for every phase: *"Reasoning is not completion. Verified execution is completion."* A capability is only marked `IMPLEMENTED` when it is exercised by a test or a live call.

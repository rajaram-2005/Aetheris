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
| Deployment | CI is in `docs/ci.yml` (cannot push `.github/workflows` from this environment). Schedules need external cron on serverless. | Documented in `/docs/schedules`, `/docs/self-host`. |

---

## 2. Logical architecture (as built)

```
                              AETHERIS CORE  (src/core)
        ┌──────────────────────────────┼──────────────────────────────┐
  Capability Registry          Execution Policy               Observability
  (types, registry, sources)   (permissions, confirm, audit)  (events, summary)
        └──────────────────────────────┼──────────────────────────────┘
                                 Intent Router
                                       │
   ┌───────────────┬───────────────────┼─────────────────────┬────────────────┐
 MODELS          AGENTS             KNOWLEDGE              TOOLS           AUTOMATION
 lib/router      lib/agents         lib/kb, lib/research   lib/mcp         lib/workflows
 27 providers    Prime/Metis/102    BM25 + citations       hub 107/115     lib/schedules
   │               │                   │                     │                │
   └───────────────┴───────────────────┴─────────────────────┴────────────────┘
                                       │
                            SURFACES (src/components)
   Chat · Agents · Factory · Studio · Apps · Docs · Study · Learn · Workflows · Schedules · Control Center
                                       │
                         PHYSICAL (src/core/physical) — interfaces + safety policy only
```

Every subsystem talks to Core through three things only: it **registers capabilities**, it **asks the policy** before acting, and it **records events**.

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

## 8. Physical AI (`src/core/physical/interfaces.ts`) — NOT AVAILABLE

Contracts for sensors/actuators/transports (MQTT, serial, Modbus, OPC-UA, CAN, ROS 2, simulated), `DeviceProvider`, `RobotProvider`, `DigitalTwin`, and a **deterministic safety policy** (`checkSafety`) that every command must pass: known device/actuator, params within declared limits, fresh telemetry (<5 min), explicit confirmation. Tested. No adapter is implemented and no telemetry is fabricated; the loop `Sensor → Gateway → Telemetry → World Model → Reasoning → Safety → Command → Actuator` is the target design.

---

## 9. Roadmap (phased; each phase lands behind a registry status)

| Phase | Scope | Status |
|---|---|---|
| 1 Audit | this document | done |
| 2 Cleanup | remove paid-plan UI when flag off; unify MCP routes | partial |
| 3 Core interfaces | registry, policy, events, providers | **done** |
| 4 Model router | task-aware selection (coding/reasoning/vision), local providers, cost metadata | partial (health/vision/tier only) |
| 5 Agent runtime | budgets, timeouts, checkpoints, cancellation, background jobs, agent memory | partial |
| 6 Execution/sandbox | server-side container sandbox behind `ExecutionProvider` + policy | not started |
| 7 MCP gateway | user-added servers, health, versioning, schema validation, tool ranking | partial |
| 8 Knowledge + memory | vector adapter (hybrid), entities/graph, temporal store, memory types & provenance | partial |
| 9 GitHub intelligence | repository map, PR review, issue → PR automation | partial |
| 10 Research engine | academic sources, evidence graph, citation graph | partial |
| 11 Multimodal | video/audio understanding, sensor streams | partial |
| 12 Browser agent | `BrowserProvider` with observable steps | not started |
| 13 Physical AI | MQTT + serial adapters, telemetry pipeline, twin store, safety UI | interfaces only |
| 14 Robotics/twins | ROS 2 bridge, simulation | interfaces only |
| 15 Automation engine | event triggers (GitHub issue, sensor anomaly), conditions | partial (cron only) |
| 16 Control Center | live health/registry/events/permissions | **done (v1)** |
| 17 Security hardening | rate limits per capability, network policy for gateway, secret vault | partial |
| 18 Testing/evaluation | 84 unit tests; evaluation harness for routing/RAG/agents | partial |
| 19 Performance | caching, parallel agents, incremental indexing | partial |
| 20 Production | Postgres `StorageProvider`, multi-instance, external cron | partial |

Principle for every phase: *"Reasoning is not completion. Verified execution is completion."* A capability is only marked `IMPLEMENTED` when it is exercised by a test or a live call.

# Agents

```
 task ─▶ Intent router ─▶ Prime (planner) ─▶ plan {agents[], mode: single|pipeline|parallel|debate, briefs[]}
                                                  │
                             ┌────────────────────┼─────────────────────┐
                        specialist 1         specialist 2  …      (≤ maxAgents)
                             └────────────────────┼─────────────────────┘
                                          Metis (verifier / critic / lessons)
                                                  │
                                       answer + trace + events + lessons
```

## Hierarchy

* **Prime** — planner. Reads the specialist catalog, returns JSON `{agents, mode, reason, briefs}`. `@mention` forces a specific agent or a pipeline (`@a @b`).
* **Hermes** ⚡ (god-agent, execution) — the base every specialist inherits: tool-using, code-first, verification-minded.
* **Metis** 🦉 (god-agent, meta-learning) — reviews outputs, extracts *lessons* stored per agent and injected into future runs (`src/lib/agents/lessons.ts`).
* **102 specialists** across code, research, data, ops, education, health, law, finance, creative, robotics… (`catalog.ts`, `catalog-extended.ts`). Each is a registry capability `agent:<id>`.

Modes: `single`, `pipeline` (output feeds next brief), `parallel` (fan-out, merged), `debate` (`/api/debate`: two positions + judge).

## Agent runtime (`src/core/agents/runtime.ts`) — background jobs

A **Job** = task + budget + timeout + permissions + checkpoints + state machine `queued → running → (paused|done|error|cancelled)`.

```ts
DEFAULT_BUDGET = { maxModelCalls: 12, maxChars: 60_000, timeoutMs: 240_000, maxAgents: 3 }
```

* Runs detached from the HTTP request; checkpoints after every agent event; survives page reloads.
* `POST /api/jobs {task, title?, agents?, budget?, model?, workspace?}` → job · `GET /api/jobs` · `GET /api/jobs/:id[?stream=1]` (state, checkpoints, SSE) · `DELETE /api/jobs/:id` (cancel) · `POST /api/jobs/:id` (retry).
* Budgets count model calls and characters (providers are free, so cost = calls). Exceeding → `error` with reason, never a silent truncation.
* Subagents share a per-job **working memory** (`src/core/memory/memory.ts`); results can be stored as episodic memory with provenance.
* Automations can trigger on job completion (`trigger.kind = "job"`).

## Verification (`system:verifier`, PARTIAL)

Implemented: Metis critique pass, explainability endpoint (`/api/explain`: fact vs inference, confidence, how to verify), automation `verify` stage (model rubric must answer PASS, or numeric expression must hold) that **blocks actions on failure**; the Coding Factory verifies generated code by running real CI in GitHub Actions and iterating on the logs.
Missing (honest): automatic sandbox test/type-check loops on every code generation outside the Factory, schema validation of every tool output, independent second-model reviewer gate by default.

## Development agent capabilities (Claude-Code-like, permissioned)

| Capability | Level | Where |
|---|---|---|
| Read repo / search / map | read_only | `github:intelligence` (`GET /api/github/repos/intel?repo=`) |
| Review PR, triage issues | read_only (posting = safe_write + confirm) | same route, `op: review|triage` |
| Propose patch → branch + PR | safe_write + confirmation | `op: patch` |
| Generate a project, run CI, iterate on logs | safe_write + confirmation | Coding Factory `POST /api/factory/run` |
| Execute commands in a server sandbox | full_workspace + confirmation | `POST /api/executions` |
| In-browser Python/JS sandbox | read_only (client-side) | Chat code blocks |

Unrestricted shell or admin tools are never enabled by default.

## Writing a new agent

Add a spec to `src/lib/agents/catalog-extended.ts`:

```ts
{ id: "plc-safety-reviewer", name: "PLC Safety Reviewer", icon: "🦺", tier: "sub", domain: "industrial",
  description: "Reviews ladder/ST logic and interlocks against IEC 61508 practice.",
  system: `${HERMES_BASE}\nYou review PLC programs…`, strengths: ["reasoning"], tools: ["knowledge", "devices"] }
```

It appears in the registry, the @picker, the planner catalog and the evals automatically. Add an intent example to `evals/cases.json` if it should be auto-selected.

## Status

| Piece | Status |
|---|---|
| Planner → specialists → Metis, 4 modes, lessons | IMPLEMENTED (tested) |
| Background jobs with budgets, checkpoints, cancel/retry, SSE | IMPLEMENTED (tested) |
| Verifier | PARTIAL |
| Agent-to-agent negotiation / long-lived autonomous agents | NOT AVAILABLE |

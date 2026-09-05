# API

Every capability is reachable over typed JSON endpoints under `/api`. Conventions:

* **Identity**: browser session cookie (`aetheris_uid`, anonymous until sign-in) or `Authorization: Bearer sk-aeth-…` (personal API key from Settings → API keys; free).
* **Errors**: `{error, code?}` with 400 (input), 401, 403 (`code: insufficient_level | confirmation_required | denied`), 404, 429 (`retryAfterSec`), 502 (upstream), 503.
* **Confirmation**: operations marked ⚠ need `confirmationToken` from `POST /api/permissions {capabilityId, issue:true}` (single-use, 5 min). Operations marked 🦾 additionally need the **physical** grant (`POST /api/devices/optin`).
* **Status**: every capability's honest status is in `GET /api/capabilities`; nothing below returns fabricated data.

## Core

| Endpoint | Description |
|---|---|
| `GET /api/health` | liveness + data-dir writability |
| `GET /api/capabilities?q=&category=&status=&tags=&maxSecurity=&limit=` · `?id=` | Capability Registry search / one capability |
| `GET /api/tools?q=&status=&maxSecurity=` | callable-tool view of the registry with invoke hints |
| `POST /api/intent {text, hasImages?, hasKb?}` | universal command → IntentPlan (task, mode, agents, connectors, capabilities) |
| `GET /api/permissions` · `POST {capabilityId, issue:true}` · `POST {capabilityId, confirm?, token?}` | my principal · issue confirmation · policy tester |
| `GET /api/telemetry?type=&limit=&errors=1` | event feed (own events; admins all) |
| `GET /api/telemetry/audit?since=&format=csv\|json` | audit export, redacted |

## Models & chat

| Endpoint | Description |
|---|---|
| `GET /api/models` | providers/tiers available (all free) |
| `GET /api/providers` | mesh health, cooldowns |
| `POST /api/chat` | One Chat: streaming SSE, images, KB grounding, agent auto-delegation, `@agent`; optional database persona via `character:{id,mode:"roleplay"|"guide"}` |
| `GET/POST /api/characters` · `GET/PATCH/DELETE /api/characters/:id` | curated mythic personas + owner-private character creator ([CHARACTERS](CHARACTERS.md)) |
| `POST /api/v1/chat/completions` · `GET /api/v1/models` | OpenAI-compatible |
| `POST /api/explain` | fact-vs-inference explainability for an answer |
| `POST /api/debate` | two positions + judge |

## Agents & execution

| Endpoint | Description |
|---|---|
| `GET /api/agents` · `GET /api/agents/lessons` | catalog · Metis lessons |
| `POST /api/agents/run` | synchronous orchestrated run (SSE events) |
| `GET/POST /api/jobs` · `GET /api/jobs/:id[?stream=1]` · `DELETE` (cancel) · `POST` (retry) | background agent jobs with budgets/checkpoints |
| `GET /api/executions` · `POST {command, files?, timeoutMs?, network?, confirmationToken}` ⚠ | server sandbox status · run |
| `GET /api/verify` · `POST {kind:"schema", value, schema}` · `POST {kind:"review", question, answer, generator?, minScore?}` · `POST {kind:"tests", command, files?, maxIterations?, confirmationToken}` ⚠ | verification engine: JSON-schema validation (free, offline) · independent reviewer routed off the generator's model · test loop in the sandbox that feeds failures back to a revise pass (needs a confirmation token, like `/api/executions`) |
| `GET/POST /api/workflows` · `POST /api/workflows/:id/run` | saved multi-agent workflows |

## Knowledge, memory, research

| Endpoint | Description |
|---|---|
| `GET/POST /api/knowledge` · `GET/DELETE /api/knowledge/:id` · `GET /api/knowledge/graph` | fabric facts, graph |
| `GET/POST /api/kb` · `/api/kb/:id/docs` · `/api/kb/:id/search` | document KBs |
| `GET/POST /api/memory` · `DELETE /api/memory/:id` · `POST /api/memory/extract` | typed memory |
| `POST /api/research` · `POST /api/research/academic` | web deep research · academic engine |
| `GET/POST /api/workspaces` · `GET/PATCH/DELETE /api/workspaces/:id` | scopes with computed stats |
| `GET/POST /api/workspaces/:id/members` · `PATCH/DELETE /api/workspaces/:id/members/:member` | share a workspace: `POST {member, role:"editor"\|"viewer"}` (owner only, 25 max), list, re-role, remove or leave. Members read the shared scope via `GET /api/knowledge?workspace=…`; writes stay their own. The default workspace cannot be shared. |

## Tools & MCP

| Endpoint | Description |
|---|---|
| `GET /api/mcp/catalog` | 106 connectors |
| `POST /api/mcp/hub` (JSON-RPC) · `GET` | Aetheris as an MCP server |
| `POST /api/mcp/hub/credentials` · `/api/mcp/oauth/start\|callback\|disconnect` | connector credentials |
| `GET/POST /api/mcp/servers` · `GET/POST/PATCH/DELETE /api/mcp/servers/:id` · `POST /api/mcp/servers/:id/call` (⚠ per classification) | user MCP servers |
| `POST /api/gateway/:id` | REST gateway connector call |
| `GET/POST /api/browser` (form submit ⚠) | browser agent |
| `GET/POST /api/multimodal` | perceive image/document/audio/video/sensor |
| `POST /api/media/generate` · `GET /api/media/providers` | image/speech/video generation |

## Authentication

| Endpoint | Description |
|---|---|
| `GET /api/auth/session` · `DELETE /api/auth/session` | account, provider readiness and sign-out |
| `GET /api/auth/google` · `/api/auth/google/callback` | Google OAuth |
| `GET /api/auth/github` · `/api/auth/github/callback` | GitHub OAuth |
| `POST /api/auth/guest {name}` | create a named browser-local guest session |

With `AETHERIS_REQUIRE_AUTH=1`, protected API calls without a valid sealed session return `401 { error: "authentication_required" }`. Setup: [AUTHENTICATION](AUTHENTICATION.md).

## GitHub

| Endpoint | Description |
|---|---|
| `GET /api/github/repos/intel?repo=&ref=` | repository map |
| `POST /api/github/repos/intel {op: analyze\|review\|triage\|patch, …}` (post/apply/patch ⚠) | intelligence ops |
| `POST /api/factory/run` ⚠ | Coding Factory: generate → repo → CI → iterate |
| `/api/auth/github*` | OAuth |

## Physical, robotics, twins, automations

| Endpoint | Description |
|---|---|
| `GET/POST /api/devices` · `GET /api/devices/:id?telemetry=1` | registry (+adapter availability) · device + telemetry |
| `POST /api/devices/:id {op: read \| ingest \| validate}` | poll · push telemetry (ingest token) · dry-run safety |
| `POST /api/devices/:id {op: actuate, capability, value, confirmationToken}` 🦾⚠ · `{op: estop}` 🦾 · `{op: reset}` 🦾⚠ | safety loop |
| `POST /api/devices/optin {acknowledge}` · `DELETE` | physical grant |
| `GET /api/robots?url=` · `POST {op: echo \| govern \| move 🦾⚠ \| estop 🦾}` | ROS 2 via rosbridge |
| `GET/POST /api/twins` · `POST /api/twins/:id {op: sync \| simulate \| event \| maintenance}` · `DELETE` | digital twins |
| `GET/POST /api/automations` · `GET/PATCH/DELETE /api/automations/:id` · `POST /api/automations/:id` (run now) · `POST /api/automations/:id/hook?secret=` | trigger → condition → agent → verify → action |
| `GET/POST /api/schedules` · `/api/schedules/:id/run` · `/api/schedules/tick` (`CRON_SECRET`) | cron schedules |

### Automation schema (from `src/core/automation/engine.ts`)

```ts
Trigger   = {kind:"cron",cron,tz} | {kind:"webhook",secret} | {kind:"device",deviceId,key,op,value,cooldownMin?} | {kind:"twin",twinId,minScore?} | {kind:"job",status?} | {kind:"manual"}
Condition = {kind:"always"} | {kind:"expr",expr}
Verify    = {kind:"none"} | {kind:"rubric",rubric} | {kind:"expr",expr}
Action    = {kind:"webhook",url} | {kind:"email",to} | {kind:"remember",type,template} | {kind:"actuate",deviceId,capability,value} | {kind:"twin_event",twinId,eventKind,template} | {kind:"job",task,agents?}
```

Limits: 60 automations/user, cron ≥ 5 min, 60 runs kept, 3 attempts with backoff. `actuate` actions require the physical grant and a `physicalToken` stored on the automation at creation.

## Accounts, sync, misc

`/api/auth/*` (Google, GitHub, named guest, session, logout, token), `/api/keys`, `/api/sync`, `/api/share`, `/api/rooms/*`, `/api/gallery`, `/api/study/*`, `/api/concepts`, `/api/arena`. Billing routes exist but plans are off (`AETHERIS_PAID_PLANS` unset → everything free).

## Example: safe device actuation

```bash
# 1. confirm intent for this exact capability
TOKEN=$(curl -s -b c -X POST localhost:3000/api/permissions -H 'content-type: application/json' \
  -d '{"capabilityId":"device:abc12.relay","issue":true}' | jq -r .token)
# 2. dry-run
curl -s -b c -X POST localhost:3000/api/devices/abc12 -d '{"op":"validate","capability":"relay","value":1}'
# 3. act (needs physical grant + token)
curl -s -b c -X POST localhost:3000/api/devices/abc12 -d "{\"op\":\"actuate\",\"capability\":\"relay\",\"value\":1,\"confirmationToken\":\"$TOKEN\"}"
```

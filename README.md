# Aetheris One — a local, open-source Intelligence Operating System

**One layer that selects, coordinates and verifies models, agents, knowledge and tools — on your own computer.** Free for everyone. MIT. No paid tier, no metering, no vendor lock-in.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![CI](https://github.com/rajaram-2005/Aetheris/actions/workflows/ci.yml/badge.svg)](https://github.com/rajaram-2005/Aetheris/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-2026.9.2-informational.svg)](CHANGELOG.md)
[![Release](https://img.shields.io/badge/release-monthly%20CalVer-informational.svg)](CHANGELOG.md)

> Founder & Chief Architect: Rajaram · ramkpraja175@gmail.com · Chennai, India

Aetheris is a **local-only application**: use it in your browser with a local Node.js process, or as an Electron desktop app on macOS, Linux or Windows. There is no hosted Aetheris service to sign up for, and cloud deployment is not a supported workflow. The Apps catalog contains optional integrations, not deployment services.

**Local does not mean offline.** Online model providers, web search, GitHub and connected MCP services send requests to their respective services. For local model inference, configure Ollama, LM Studio or a local OpenAI-compatible server and set `AETHERIS_LOCALITY=local`. Online integrations still need an internet connection; see [MODELS](docs/MODELS.md).

```text
  Models (31 providers)      Knowledge (hybrid fabric + doc KBs)      Tools (102 connectors · MCP · plugins)
            └──────────────────────────────┬──────────────────────────────────┘
                     Capability Registry · Execution Policy · Observability
                                           │
              Agent Core — Prime planner → Hermes specialists → Metis verifier
                                           │
              World model — typed memory · digital twins · temporal facts
            ┌──────────────────────────────┼──────────────────────────────────┐
      Web & research            Software (GitHub, coding factory)      Physical (PLC/MQTT · ROS 2)
```

Everything is **discoverable** (`GET /api/capabilities`), **callable** (typed `/api/*`), **permissioned** (`read_only → safe_write → full_workspace → admin`, plus an isolated `physical` grant), **observable** (`/api/telemetry`, Control Center), **testable** (`npm test`, `npm run eval`) and **replaceable** (provider interfaces, plugin SDK).

## Quick start — local browser

Requires **Node.js 22.x**, npm and Git. Node 22 is needed for the knowledge fabric's `node:sqlite` support.

```bash
git clone https://github.com/rajaram-2005/Aetheris.git
cd Aetheris
npm ci
cp .env.example .env.local
npm run dev -- --hostname 127.0.0.1
```

Open **http://localhost:3000**. The workspace opens directly with anonymous browser-local data; no login or display name is required. On Windows, copy `.env.example` to `.env.local` with PowerShell or File Explorer.

**No model-provider key is required to get started** — Pollinations and LLM7.io are keyless online providers. Add optional provider keys in `.env.local` or the Providers view for more capacity. Upstream providers' availability and rate limits still apply.

For an optimized local build:

```bash
npm run build
npm start -- --hostname 127.0.0.1
```

The hostname override keeps these browser workflows on loopback. Keep the process running while you use Aetheris; no domain, public server or deployment account is needed.

## Desktop app

Download the installer for your platform from [GitHub Releases](https://github.com/rajaram-2005/Aetheris/releases), then use the default **local / embedded** mode. The app starts its own loopback server and stores its data on your computer.

To develop or build the desktop app from this checkout:

```bash
npm --prefix desktop ci
npm run desktop:dev      # local Next.js dev server + Electron shell
npm run desktop:build    # packaged app with an embedded server
```

Platform requirements, installer commands and data locations: [DESKTOP](docs/DESKTOP.md).

## What's inside

- **Model mesh** — 31 providers with priority ordering, load-balancing, cooldowns, health tracking and failover; per-message `provider · latency · failover` transparency, plus local inference support.
- **Agents** — 102 specialists across 17 domains under Prime (planner), Hermes (executor) and Metis (meta-learning), plus `@picker`, slash commands, workflows and debate mode.
- **Characters** — database-backed persona creator plus 16 curated deity interpretations across Hindu, Greek, Norse and Egyptian traditions, each with transparent roleplay and educational guide modes.
- **Knowledge & memory** — hybrid FTS5 + vector + graph + temporal fabric with provenance, typed memory, and per-user document KBs (PDF/DOCX/CSV/HTML) with cited answers.
- **Apps & tools** — 102 MCP connectors behind one Streamable-HTTP hub (`POST /api/mcp/hub`), a REST→MCP gateway, and a plugin SDK. Connect services such as Notion, GitHub and Slack from your local workspace; cloud deployment connectors are not included.
- **Software** — GitHub repository intelligence and the Coding Factory (codegen → commit → Actions → logs → report). GitHub features require an internet connection and explicit authorization.
- **Physical AI** — HTTP/MQTT/Modbus adapters, ROS 2 via rosbridge, digital twins, safety loop and e-stop, with explicit permission for physical systems.
- **Chat UX** — streaming, vision, artifacts, web search + citations, Deep Research, projects, memory, Model Arena, voice mode, in-browser code interpreter, study mode and prompt gallery.
- **Local operations** — Control Center (16 panels), execution policy + audit, SSRF guard and redaction, telemetry, optional local Docker, and monthly CalVer releases.

Aetheris is **free by default**: every feature, no Aetheris credits or daily quota. Leave `AETHERIS_PAID_PLANS` unset or `0`; the legacy optional billing code is not needed for local use. External providers may have their own limits or charges.

## Local data and configuration

- Browser chats, projects and settings stay in that browser's local storage. Server-side records live in `data/` (`AETHERIS_DATA_DIR`); the desktop app uses its own local data directory.
- Back up both exported browser data and the server data directory before an upgrade. Clearing browser storage or its anonymous owner cookie can lose access to that owner's records.
- Keep secrets in `.env.local` (desktop: `<dataDir>/.env.local`), never in Git. Set `AETHERIS_SECRET` when using encrypted credentials or OAuth integrations. OAuth is optional, not a login requirement; see [AUTHENTICATION](docs/AUTHENTICATION.md) for localhost callbacks.
- Optional Docker runs on your own computer: `docker compose up -d --build`. Its port is published only on `127.0.0.1:3000`, with persistent data in the `aetheris-data` volume.
- Use one local instance per data directory. Do not expose the anonymous workspace through a public host, port-forward or tunnel.

Full setup, local inference, backups and troubleshooting: **[LOCAL SETUP](docs/LOCAL_SETUP.md)**.

## What Aetheris can say today (Section 3 labeling)

The system has 10 named cores, each labeled with the build-call from the architecture document. None of the labels claim more than the data supports. Run `npm test` and the per-core surface at `/cores` and `/cores-health` for live evidence; the operator runbook at `/runbook` and the capabilities statement at `/capabilities` carry the human-readable form.

| Core | Build call | Surface | Honest scope |
|---|---|---|---|
| RAVANA | Build as orchestration | `/agents` `/trace` `/fuse` `/shell` | Decomposes tasks, runs the agent loop, fuses telemetry/twin/evidence/memory/verification into a single decision. Does not claim AGI. |
| VAYU-1 | Build as proxy | `/vayu` | Composes PBNN + anomaly + arena + FFT. It is a service that routes to existing modules, not a fine-tuned domain model. |
| DRISHTI | Build the integration now; train later | `/diagnostics` | Multimodal interface that calls existing vision-capable models. Does not claim proprietary visual intelligence. |
| YANTRA | Build now | `/twin-3d` `/twins` `/twins/edit` | 3D asset graph, the canonical turbine, twin state with bounds/rules. Not a validated engineering digital twin. |
| PRAVAAH | Build now | `/devices` `/fleet` | Ingestion, normalization, time-series. Engineering, not validated. |
| NIRIKSHAN | Build as analytics/diagnostic engine | `/diagnostics` `/learning` `/anomaly` `/thresholds` `/residual-thresholds` | FFT, thresholds from history, residual thresholds from PBNN. Not production-accuracy. |
| CHAKRA | Build initially as recommendation/optimization layer | `/arena` `/arena-compare` `/credits` | Model arena, recommendations. Recommends; does not actuate. |
| SMRITI | Build now | `/knowledge-graph` `/evidence` `/handoff` | Memory fabric, knowledge graph, evidence ledger. Retrieves what was actually written. |
| SETU | Build now | `/terminal` `/lab-history` `/warroom` | WSO2, MCP, sandboxed commands. The allowlist is real. |
| NIRNAYA | Build now, but don't claim | `/audit` `/trace` `/permissions-matrix` `/trust` | Verifier with evidence/constraint/test execution. Does not provide a proof of correctness. |

Full per-core honest-scope notes: [`/cores`](src/app/cores/page.tsx) · [`/capabilities`](src/app/capabilities/page.tsx) · [`/runbook`](src/app/runbook/page.tsx).

## What Aetheris does not yet claim

The architecture document labels 9 capabilities as not buildable without data, hardware, or training we do not have. They are listed on the `/capabilities` page. We do not build them.

## Development and status

```bash
npm run typecheck
npm test             # no provider API keys needed
npm run eval         # routing / policy / retrieval evals
```

Status vocabulary: **IMPLEMENTED · PARTIAL · EXPERIMENTAL · MOCKED · NOT AVAILABLE**. Known gap: horizontal scaling is NOT AVAILABLE; the JSON/SQLite stores are single-instance. See the per-subsystem status table, API surface and project layout in **[OVERVIEW](docs/OVERVIEW.md)**.

## Docs

[LOCAL SETUP](docs/LOCAL_SETUP.md) · [DESKTOP](docs/DESKTOP.md) · [OVERVIEW](docs/OVERVIEW.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [DEVELOPMENT](docs/DEVELOPMENT.md) · [API](docs/API.md) · [AUTHENTICATION](docs/AUTHENTICATION.md) · [AGENTS](docs/AGENTS.md) · [CHARACTERS](docs/CHARACTERS.md) · [MCP](docs/MCP.md) · [MODELS](docs/MODELS.md) · [KNOWLEDGE](docs/KNOWLEDGE.md) · [MEMORY](docs/MEMORY.md) · [SECURITY](docs/SECURITY.md) · [HARDWARE](docs/HARDWARE.md) · [ROBOTICS](docs/ROBOTICS.md) · [RESEARCH](docs/RESEARCH.md) · [PLUGIN_SDK](docs/PLUGIN_SDK.md) · [CONTRIBUTING](CONTRIBUTING.md) · [CHANGELOG](CHANGELOG.md)

## License

MIT © 2026 Rajaram K — see [LICENSE](LICENSE).

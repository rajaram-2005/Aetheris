# Aetheris One — an open Intelligence Operating System

**One layer that selects, coordinates and verifies models, agents, knowledge, tools — and, with explicit permission, physical systems.** Free for everyone. MIT. No paid tier, no metering, no vendor lock-in.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Tests](https://img.shields.io/badge/tests-182%20passing-brightgreen.svg)](tests)
[![Version](https://img.shields.io/badge/version-2026.9.1-informational.svg)](CHANGELOG.md)
[![Release](https://img.shields.io/badge/release-monthly%20CalVer-informational.svg)](CHANGELOG.md)

> Founder & Chief Architect: Rajaram · ramkpraja175@gmail.com · Chennai, India

```
  Models (31 providers)      Knowledge (hybrid fabric + doc KBs)      Tools (106 connectors · MCP · plugins)
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

## Quick start

```bash
npm install
cp .env.example .env.local     # optional: add a key, e.g. GROQ_API_KEY
npm run dev                    # http://localhost:3000
```

**Zero keys works** — Pollinations and LLM7.io are keyless, so a fresh deployment answers immediately at low rate limits. Every key you add raises quality and throughput; the router only uses providers whose key is set.

```bash
npm test          # 182 tests, no API keys needed
npm run eval      # routing / policy / retrieval evals
npm run build && npm start
npm run desktop:dev / desktop:build     # Electron app (macOS · Linux · Windows)
```

## What's inside

- **Model mesh** — 31 providers with priority ordering, load-balancing, cooldowns, health tracking and silent failover; per-message `provider · latency · failover` transparency.
- **Agents** — 102 specialists across 17 domains under Prime (planner), Hermes (executor) and Metis (meta-learning), plus `@picker`, slash commands, workflows and debate mode.
- **Knowledge & memory** — hybrid FTS5 + vector + graph + temporal fabric with provenance, typed memory, and per-user document KBs (PDF/DOCX/CSV/HTML) with cited answers.
- **Tools** — 106 MCP connectors behind one Streamable-HTTP hub (`POST /api/mcp/hub`), a REST→MCP gateway, and a plugin SDK.
- **Software** — GitHub repository intelligence and the Cloud Coding Factory (codegen → commit → Actions → logs → report).
- **Physical AI** — http/mqtt/modbus adapters, ROS 2 via rosbridge, digital twins, safety loop and e-stop.
- **Chat UX** — streaming, vision, artifacts, web search + citations, Deep Research, projects, memory, Model Arena, voice mode, in-browser code interpreter, live rooms, study mode, prompt gallery.
- **Ops** — Control Center (16 panels), execution policy + audit, SSRF guard and redaction, durable telemetry, Docker/compose deployment, monthly CalVer releases.

Aetheris is **100% free**: every feature for every user, no credits, no daily limit. An optional billing system ships in the codebase for self-hosters and is off unless `AETHERIS_PAID_PLANS=1`.

## Status vocabulary

Used everywhere, including the live registry: **IMPLEMENTED · PARTIAL · EXPERIMENTAL · MOCKED · NOT AVAILABLE**. Nothing in Aetheris is MOCKED; what cannot run here says so. Known gap: horizontal scaling is NOT AVAILABLE (single-instance JSON store; `StorageProvider` is the swap point).

Full per-subsystem status table, provider mesh, phase history, API surface and project layout: **[docs/OVERVIEW.md](docs/OVERVIEW.md)**.

## Self-hosting

```bash
git clone https://github.com/rajaram-2005/Aetheris && cd Aetheris
npm install && cp .env.example .env.local
npm run dev            # or: npm run build && npm start
```

Set `AETHERIS_SECRET` (cookie/credential sealing) and `AETHERIS_ADMIN_EMAILS`/`_PHONES`; the rest of the sign-in and payment variables are optional and documented in `.env.example`. Deploy with Docker (`docker compose up -d --build`) or any container host — Render/Fly blueprints live in `deploy/`. Serverless (Vercel & co.) is not supported: Aetheris needs a long-lived process and a writable volume; persistent data lives in `data/` (`AETHERIS_DATA_DIR`).

## Docs

[OVERVIEW](docs/OVERVIEW.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [DEVELOPMENT](docs/DEVELOPMENT.md) · [API](docs/API.md) · [AGENTS](docs/AGENTS.md) · [MCP](docs/MCP.md) · [MODELS](docs/MODELS.md) · [KNOWLEDGE](docs/KNOWLEDGE.md) · [MEMORY](docs/MEMORY.md) · [SECURITY](docs/SECURITY.md) · [HARDWARE](docs/HARDWARE.md) · [ROBOTICS](docs/ROBOTICS.md) · [RESEARCH](docs/RESEARCH.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) · [deploy recipes](deploy/README.md) · [DESKTOP](docs/DESKTOP.md) · [PLUGIN_SDK](docs/PLUGIN_SDK.md) · [CONTRIBUTING](CONTRIBUTING.md) · [CHANGELOG](CHANGELOG.md)

## License

MIT © 2026 Rajaram K — see [LICENSE](LICENSE).

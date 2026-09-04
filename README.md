# Aetheris One — an open Intelligence Operating System

**One layer that selects, coordinates and verifies models, agents, knowledge, tools — and, with explicit permission, physical systems.** Free for everyone. MIT. No paid tier, no metering, no vendor lock-in.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Tests](https://img.shields.io/badge/tests-133%20passing-brightgreen.svg)](tests)
[![Version](https://img.shields.io/badge/version-2026.9.1-informational.svg)](CHANGELOG.md)
[![Release](https://img.shields.io/badge/release-monthly%20CalVer-informational.svg)](CHANGELOG.md)

> Founder & Chief Architect: Rajaram · ramkpraja175@gmail.com · Chennai, India

```
  Models (31 providers, local-first option)   Knowledge (hybrid fabric + document KBs)   Tools (107 connectors · your MCP servers · plugins)
                 └──────────────────────────────────┬──────────────────────────────────────┘
                                   Capability Registry · Execution Policy · Observability
                                                    │
                          Agent Core — Prime planner → Hermes specialists → Metis verifier · background jobs
                                                    │
                          World model — typed memory · digital twins · temporal facts with provenance
                 ┌──────────────────────────────────┼──────────────────────────────────────┐
             Web & research                Software (GitHub intelligence,            Physical (devices · PLC/MQTT ·
        (browser agent, academic engine)    coding factory, sandbox)                   ROS 2 · safety loop)
```

Everything here is **discoverable** (`GET /api/capabilities`), **callable** (typed `/api/*`), **permissioned** (`read_only → safe_write → full_workspace → admin`, plus an isolated `physical` grant), **observable** (`/api/telemetry`, Control Center), **testable** (`npm test`, `npm run eval`) and **replaceable** (provider interfaces, plugin SDK).

## Honest status

Vocabulary used everywhere, including the live registry: **IMPLEMENTED · PARTIAL · EXPERIMENTAL · MOCKED · NOT AVAILABLE**. Nothing in Aetheris is MOCKED; what cannot run here says so.

| Subsystem | Status | Notes / doc |
|---|---|---|
| ModelRouter — 31 providers, task/locality policy, health, failover, streaming | IMPLEMENTED | [MODELS](docs/MODELS.md) |
| Agent core — Prime/Hermes/Metis, 102 specialists, 4 modes, lessons | IMPLEMENTED | [AGENTS](docs/AGENTS.md) |
| Agent runtime — background jobs, budgets, checkpoints, cancel/retry, SSE | IMPLEMENTED | [AGENTS](docs/AGENTS.md) |
| Verification engine | PARTIAL | critique/explain/automation-verify; no default test loop |
| Capability Registry (383 entries) + intent router + `/api/tools` | IMPLEMENTED | [ARCHITECTURE](docs/ARCHITECTURE.md) |
| Execution policy, confirmations, audit | IMPLEMENTED | [SECURITY](docs/SECURITY.md) |
| Server sandbox (process isolation, empty env, timeouts, netns when allowed) | IMPLEMENTED (not a VM) | [SECURITY](docs/SECURITY.md) |
| MCP hub (Aetheris as server, 107 connectors) | IMPLEMENTED | [MCP](docs/MCP.md) |
| MCP gateway (your servers: probe, health, versions, schema validation) | IMPLEMENTED | [MCP](docs/MCP.md) |
| Knowledge fabric — FTS5 + vector + graph + temporal, provenance | IMPLEMENTED (lexical embeddings by default) | [KNOWLEDGE](docs/KNOWLEDGE.md) |
| Typed memory (episodic/semantic/procedural/working/short-term) | IMPLEMENTED | [MEMORY](docs/MEMORY.md) |
| Research engine — arXiv/Crossref/OpenAlex/S2, claims, contradictions | IMPLEMENTED (network) | [RESEARCH](docs/RESEARCH.md) |
| GitHub repository intelligence + coding factory | IMPLEMENTED (untestable offline) | [AGENTS](docs/AGENTS.md) |
| Multimodal perception (image/doc/audio/sensor; video needs ffmpeg) | PARTIAL | `GET /api/multimodal` |
| Browser agent (http engine; Playwright optional) | PARTIAL | `GET /api/browser` |
| Physical AI — http/mqtt/modbus adapters, safety loop, e-stop, telemetry | IMPLEMENTED (mqtt/modbus verified on mocks only); serial via bridge; opcua/can NOT AVAILABLE | [HARDWARE](docs/HARDWARE.md) |
| Robotics — ROS 2 via rosbridge, governor, watchdog, e-stop | IMPLEMENTED (verified on mock rosbridge) | [ROBOTICS](docs/ROBOTICS.md) |
| Digital twins — sync, rule simulation, health | IMPLEMENTED | [ROBOTICS](docs/ROBOTICS.md) |
| Automation engine — trigger → condition → agent → verify → action | IMPLEMENTED | [API](docs/API.md) |
| Workspaces | IMPLEMENTED (no sharing) | [API](docs/API.md) |
| Control Center (16 panels) | IMPLEMENTED | in-app 🎛️ |
| Security — SSRF guard, rate limits, redaction, audit export | IMPLEMENTED (per-instance limits, no WAF) | [SECURITY](docs/SECURITY.md) |
| Plugin SDK | IMPLEMENTED | [PLUGIN_SDK](docs/PLUGIN_SDK.md) |
| Evals (intent, policy, sandbox, retrieval) + 106 tests + perf budgets | IMPLEMENTED | `npm run eval` |
| Deployment — Docker, compose, health endpoint | IMPLEMENTED | [DEPLOYMENT](docs/DEPLOYMENT.md) |
| Desktop app — macOS / Linux / Windows, embedded loopback server or remote, tray, deep links, update check | IMPLEMENTED (unsigned; no self-update) | [DESKTOP](docs/DESKTOP.md) |
| Monthly CalVer release pipeline — `VERSION`, changelog, tagged GitHub Release, per-OS installers | IMPLEMENTED | [CHANGELOG](CHANGELOG.md) |
| Horizontal scaling, persistent telemetry store, semantic embeddings offline | NOT AVAILABLE / PARTIAL | roadmap in [ARCHITECTURE](docs/ARCHITECTURE.md) |

Docs index: [ARCHITECTURE](docs/ARCHITECTURE.md) · [DEVELOPMENT](docs/DEVELOPMENT.md) · [API](docs/API.md) · [AGENTS](docs/AGENTS.md) · [MCP](docs/MCP.md) · [MODELS](docs/MODELS.md) · [KNOWLEDGE](docs/KNOWLEDGE.md) · [MEMORY](docs/MEMORY.md) · [SECURITY](docs/SECURITY.md) · [HARDWARE](docs/HARDWARE.md) · [ROBOTICS](docs/ROBOTICS.md) · [RESEARCH](docs/RESEARCH.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) · [CONTRIBUTING](CONTRIBUTING.md) · [PLUGIN_SDK](docs/PLUGIN_SDK.md) · [DESKTOP](docs/DESKTOP.md) · [CHANGELOG](CHANGELOG.md)

---

## Product history (all still shipped)

Aetheris began as *One Chat over a mesh of free providers* and grew phase by phase. Everything below remains in the product; the Intelligence-OS core wraps it rather than replacing it.

| Phase | Component | State |
|---|---|---|
| 1 | **One Chat + Omni-Router** (failover, cooldowns, provider pinning) | ✅ |
| 2 | **GitHub Coding Factory** (OAuth/PAT → codegen → push → Actions → read logs → report) | ✅ |
| 3 | **Multimodal Cloud Studio** (image / speech / video meshes, BYOK) | ✅ |
| 4 | **Cloud MCP App Store** (107 connectors: vendor MCP servers w/ OAuth + REST→MCP gateway) | ✅ |
| 5 | UPI monetisation code — **off by default; everything is free** | ✅ (flag) |
| 6 | **One Chat flagship UX** (streaming, vision, artifacts, web search, Deep Research, projects, memory, Arena, voice, code interpreter) | ✅ |
| 7–22 | **Intelligence OS**: registry, policy, observability, router policy, agent runtime, sandbox, MCP gateway, knowledge/memory, GitHub intelligence, research engine, multimodal, browser, physical AI, robotics/twins, automation, Control Center, security, evals, perf, deployment, plugin SDK, docs | ✅ see status table |

## Quick start

```bash
npm install
cp .env.example .env.local     # add at least one key, e.g. GROQ_API_KEY
npm run dev                    # http://localhost:3000
```

Any subset of keys works — the router only uses providers whose key is set.
**Zero keys also works:** Pollinations and LLM7.io are keyless community endpoints, so a fresh
deployment answers immediately (at low rate limits) and every key you add raises quality and
throughput. The **Providers** page in the app links straight to each provider's free-key page.

## Desktop app — macOS, Linux, Windows

Aetheris also ships as a desktop app (`desktop/`, Electron) around the same code — not a second
product. It either runs the server **embedded** on `127.0.0.1` (a self-contained, offline app whose
data lives in `~/Library/Application Support/Aetheris`, `~/.config/Aetheris` or `%APPDATA%/Aetheris`),
or acts as a thin client for **any** Aetheris server you point it at — switchable in
Settings → Connection. Tray icon, `aetheris://` deep links, a redacted log, and a monthly update
check come with it. See [docs/DESKTOP.md](docs/DESKTOP.md).

| Platform | Artefacts |
|---|---|
| macOS | `.dmg` + `.zip` — Apple silicon and Intel (unsigned: right-click → Open the first time) |
| Linux | `.AppImage`, `.deb`, `.rpm` — x64 and arm64 |
| Windows | NSIS installer + `.zip` — x64 |

```bash
npm run desktop:dev      # next dev + the desktop shell, with hot reload
npm run desktop:build    # standalone server → resources/server → unpacked app you can run
```

## Versioning — a new release every month

Aetheris releases on **CalVer `YYYY.M.P`**, once a month, and the schedule is enforced by CI rather
than by memory:

```
2026.9.1  →  2026.10.1  →  2026.11.1  →  2026.12.1  →  2027.1.1     monthly (the patch resets)
2026.9.1  →  2026.9.2                                               hot-fix inside a month
```

At 03:30 UTC on the 1st of every month `ci/release.yml` verifies the tree, bumps the version,
writes the CHANGELOG from the commits since the previous tag, pushes the tag, opens the GitHub
Release, and attaches desktop installers built on macOS, Linux and Windows runners. To do it by
hand: `bash tools/release.sh` (`--patch` for a hot-fix, `--set 2027.3.1` for an exact version,
`--no-push` to stop before pushing).

`VERSION` at the repository root is the single source of truth; the release tooling copies it into
`package.json`, `desktop/package.json` and `public/manifest.webmanifest`, and `GET /api/version`
serves it. `tests/desktop.test.ts` fails if those copies drift apart or if the schedule stops being
monthly.

## 100% free — for everyone

Aetheris is free. No plans, no credits, no payments: every user gets every feature (all models, parallel agents,
deep research, video, premium MCP connectors, Enterprise Factory, 50 API keys) with **no daily limit**.
The only limits are the free tiers of the upstream providers, which the router balances across 27 of them.

The optional billing system below is kept in the codebase for self-hosters who want it; it is **off by default**.
Set `AETHERIS_PAID_PLANS=1` to turn it on.

## (Optional) Plans, models and API keys — off by default

| Plan | ₹/month | Credits/day | Model | Agents/run | API keys | Extras |
|---|---|---|---|---|---|---|
| Free | 0 | 50 | `aetheris-free` (community + free tiers) | 1 | 0 | — |
| Lite | 200 | 300 | `aetheris-lite` | 2 | 1 | Prime routing |
| Pro | 500 | 1,000 | `aetheris-pro` (strongest free-tier models first) | 3 | 3 | Deep Research, premium MCP, priority routing |
| Pro Max | 1,500 | 4,000 | `aetheris-pro-max` | 4 (parallel) | 10 | + Video generation |
| God Mode | 4,000 | unlimited | `aetheris-god` (Metis critique-and-revise on every answer) | 6 | 50 | + Enterprise GitHub Factory |

Credits: chat = 1, agent run = 2, image/speech = 2, Factory run = 3, Deep Research = 5, video = 5, Arena = 1 per lane.
Every feature is metered through one ledger (`consumeChat(uid, cost, kind)`), which refuses over-limit
requests *before* charging and keeps a per-feature breakdown + 30-day history (Settings → Plan & usage).
Paid plans get **priority routing** (providers ranked by live health instead of shuffled); God Mode's
**Enterprise Factory** unlocks custom target repos and specs over 2,000 characters. `/admin` shows
subscribers, MRR, today's active users, and lets you change any user's plan manually. Payment is a UPI QR to the
founder; the admin approves the UTR at `/admin` and the plan unlocks automatically.

**Personal API keys** (Settings → API keys, Lite+) are OpenAI-compatible:

```bash
curl https://<host>/api/v1/chat/completions \
  -H "Authorization: Bearer sk-aeth-…" -H "Content-Type: application/json" \
  -d '{"model":"aetheris-pro","messages":[{"role":"user","content":"@coder write fizzbuzz in Go"}],"stream":true}'
```
`GET /api/v1/models` lists tiers. Keys are stored as SHA-256 hashes; a requested tier above the plan
is silently capped to the plan's best tier.

## Aetheris Hub — all 107 MCP connectors behind one server

`POST /api/mcp/hub` is a single Streamable-HTTP MCP server that fronts every connector in the
catalog (58 vendor-hosted MCP servers proxied + 49 REST APIs via the built-in gateway + the Factory).
Tools are namespaced `<connector>__<tool>`; meta-tools `hub__connectors`, `hub__search_tools` and
`hub__list_tools` let a model discover what it can do. Remote servers' tool lists load lazily and are
cached 10 minutes.

- **In One Chat**: Apps → "Enable all" on the Hub card. The model then sees every *ready* connector
  (public ones + those you have connected) and can search for the rest.
- **From any MCP client** (Claude Desktop, Cursor, Windsurf…): `{"url": "https://<host>/api/mcp/hub",
  "headers": {"Authorization": "Bearer sk-aeth-…"}}`. Needs a Lite+ API key.
- **From your API key**: `POST /api/v1/chat/completions` with `"hub": true` (or `"connectors": ["github","slack"]`).
- Credentials you connect in Apps are stored **sealed (AES-GCM) server-side** so the Hub and your
  keys can use them; or pass them per request as `X-Aetheris-Cred-<connector>`. Restrict a session
  with `X-Aetheris-Connectors: github,notion`. Premium connectors still need `mcp_premium` (Pro+).

## The agent hierarchy

```
✴️ Aetheris Prime (ultra)  — plans, delegates, synthesises
   ├─ ⚡ Hermes (god)        — execution base every agent inherits: reason → tools → deliver
   ├─ 🦉 Metis (god)         — meta-learning: reflects after each run, stores lessons, injects them next time
   └─ 26 sub-agents          — Academy (tutor, math, quiz, scholar), Coding (architect, coder, debugger,
                               reviewer, devops), Research/Data (researcher, analyst, scientist), Writing
                               (writer, editor, storyteller, translator), Business (strategist, marketer,
                               finance, sales), Life & work (legal, health, career, planner, designer, prompt)
```

- Turn on **🤖 Agents** in the composer and Prime routes automatically (single agent for simple asks;
  pipeline/parallel for cross-domain tasks), or type `@coder`, `@tutor`, `@academy`… to force one.
- `GET /api/agents` lists the catalog; `POST /api/agents/run` streams `plan → agent_start/delta/done →
  synthesis → done → lessons` events; `GET/DELETE /api/agents/lessons` manages Metis's memory.

## The provider mesh

| # | Provider | Env var | Default model | Priority |
|---|---|---|---|---|
| 1 | Groq Cloud | `GROQ_API_KEY` | llama-3.3-70b-versatile | 1 |
| 2 | Cerebras Inference | `CEREBRAS_API_KEY` | llama-3.3-70b | 1 |
| 3 | SambaNova Cloud | `SAMBANOVA_API_KEY` | Meta-Llama-3.3-70B-Instruct | 1 |
| 4 | Google AI Studio | `GEMINI_API_KEY` | gemini-2.0-flash | 1 |
| 5 | GitHub Models | `GITHUB_MODELS_TOKEN` | openai/gpt-4o-mini | 2 |
| 6 | OpenRouter (free) | `OPENROUTER_API_KEY` | llama-3.3-70b-instruct:free | 2 |
| 7 | Mistral La Plateforme | `MISTRAL_API_KEY` | open-mistral-nemo | 2 |
| 8 | Together AI | `TOGETHER_API_KEY` | Llama-3.3-70B-Instruct-Turbo-Free | 2 |
| 9 | Cohere | `COHERE_API_KEY` | command-r-08-2024 | 2 |
| 10 | Cloudflare Workers AI | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | @cf/meta/llama-3.1-8b-instruct | 2 |
| 11 | Hugging Face Inference | `HF_TOKEN` | Llama-3.1-8B-Instruct | 2 |
| 12 | NVIDIA NIM | `NVIDIA_API_KEY` | meta/llama-3.1-70b-instruct | 3 |
| 13 | DeepSeek | `DEEPSEEK_API_KEY` | deepseek-chat | 3 |
| 14 | AI21 Labs | `AI21_API_KEY` | jamba-mini | 3 |
| 15 | Perplexity | `PERPLEXITY_API_KEY` | sonar | 4 |
| 16 | ModelScope | `MODELSCOPE_API_KEY` | Qwen/Qwen2.5-72B-Instruct | 3 |
| 17 | OVHcloud AI Endpoints | `OVH_AI_ENDPOINTS_TOKEN` | Meta-Llama-3_3-70B-Instruct | 3 |
| 18 | Ollama Cloud | `OLLAMA_API_KEY` | gpt-oss:20b | 3 |
| 19 | Kilo Code | `KILO_API_KEY` | nemotron-3-super-120b:free | 3 |
| 20 | Z.AI (GLM) | `ZAI_API_KEY` | glm-4-flash | 3 |
| 21 | SiliconFlow | `SILICONFLOW_API_KEY` | Qwen/Qwen2.5-7B-Instruct | 3 |
| 22 | Nebius AI Studio | `NEBIUS_API_KEY` | Meta-Llama-3.1-70B-Instruct | 3 |
| 23 | Chutes.ai | `CHUTES_API_KEY` | DeepSeek-V3-0324 | 3 |
| 24 | glhf.chat | `GLHF_API_KEY` | hf:Llama-3.3-70B-Instruct | 3 |
| 25 | Nscale | `NSCALE_API_KEY` | Llama-3.3-70B-Instruct | 3 |
| 26 | Pollinations *(keyless)* | `POLLINATIONS_API_KEY` (optional) | openai | 5 |
| 27 | LLM7.io *(keyless)* | `LLM7_API_KEY` (optional) | gpt-4o-mini | 5 |

Every key above is free (no credit card). A note on what "free" means here: each provider's
free tier is granted to **you**, the deployer, under that provider's terms — Aetheris does not
ship, share, or rotate anyone else's keys. Directories such as
[awesome-freellm-apis](https://github.com/open-free-llm-api/awesome-freellm-apis) track which
tiers are still live.

Override any default model with `AETHERIS_MODEL_<ID>` (e.g. `AETHERIS_MODEL_GROQ=llama-3.1-8b-instant`).
Free-tier model catalogs change often; if a provider returns 404 for its model, set an override.

## How routing works

```
request ─► candidates = configured providers
            ├─ sorted by priority (1 first)
            ├─ shuffled within each priority  (load balancing)
            └─ providers in cooldown moved to the end
         ─► try each in order until one succeeds
            ├─ 429 / 5xx / timeout  → cooldown 60 s, next provider
            ├─ 401 / 403 (bad key)  → cooldown 15 min, next provider
            └─ success              → record latency, return
```

The response includes `provider`, `model`, `latencyMs` and the full `attempts` list, which
the UI shows under each reply (e.g. `via groq · 412 ms · ↻ 1 failover`).

Click the mesh pill in the header to see live provider health and **pin** a provider to be tried first.

## Cloud Coding Factory (Phase 2)

Switch the header toggle to **Factory**, connect GitHub, and describe a program. Aetheris then:

```
prompt ─► router generates {files, testCommand} as JSON (Python / Node / Java)
       ─► ensures a private repo  <you>/aetheris-factory  exists
       ─► ONE commit on branch run/<id> (Git Data API) with the project + a workflow
       ─► GitHub Actions runs the tests (ubuntu-latest, pytest / node --test / mvn test)
       ─► polls the run, downloads the job log
       ─► router summarises pass/fail + suggested fix ─► shown in One Chat
```

Progress streams live over SSE; every step links to the commit / run on GitHub. Nothing
executes on your machine — compile & test happen on GitHub's free Actions minutes.

**Connecting GitHub**
- *OAuth*: create an OAuth App and set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (callback `<origin>/api/auth/github/callback`).
- *Token*: without OAuth, paste a PAT with `repo` + `workflow` scopes. Either way the token is stored only in an AES-GCM-sealed httpOnly cookie (`AETHERIS_SECRET`).

Runs land in `runs/<id>-<name>/` on branch `run/<id>`; nothing touches your other repos.

## Multimodal Cloud Studio (Phase 3)

**Studio** tab. Each media type has its own failover mesh, same pattern as chat:

| Kind | Providers (priority order) | Notes |
|---|---|---|
| Image | Hugging Face FLUX.1-schnell → Fal.ai FLUX → Cloudflare SDXL Lightning | free tiers |
| Speech | ElevenLabs → Hugging Face Kokoro Space | ElevenLabs is BYOK |
| Video ✦ | Luma Dream Machine → Runway Gen-3 Alpha Turbo | **Pro feature**, or BYOK |

**BYOK**: users can paste their own keys in the Studio; they live in the browser and travel
only with that request. Video is gated behind Aetheris Pro *unless* the user brings a Luma or
Runway key. We deliberately do not cycle trial keys — it violates those providers' terms.

## One Chat — flagship features (Phase 6)

Everything people expect from Claude / ChatGPT / Gemini, on top of the free-provider mesh:

| Feature | How it works |
|---|---|
| **Streaming** | `/api/chat` returns SSE (`provider`, `delta`, `sources`, `tool`, `done`, `error`). Every adapter streams (OpenAI-compatible, Gemini `streamGenerateContent`, Cohere v2); Cloudflare is buffered. Failover stays *silent* until the first token; a mid-stream failure keeps the partial text and is flagged. |
| **Multi-chat sidebar** | Conversations with auto-titles, search (title + body), pin, rename, delete, date groups; export all as JSON. Stored in `localStorage` (versioned; v1 single-thread chat is migrated). |
| **Vision** | Paste / drop / attach up to 4 images (downscaled client-side). Router restricts candidates to `vision: true` providers and swaps to their `visionModel` (Groq Llama-4 Scout, Gemini, GitHub GPT-4o-mini, OpenRouter Gemma-3, Mistral Pixtral, Together Llama-Vision, SambaNova Maverick, NVIDIA Llama-3.2-90B). |
| **Artifacts** | The system prompt asks the model to emit substantial content as ```` ```html title="…" ```` fences. They open in a side panel with live preview (HTML/SVG in a sandboxed iframe, **React/TSX** via Babel + Tailwind CDN, **Mermaid** diagrams, Markdown), an editable code view, copy, download, open-in-tab. |
| **Web search + citations** | Tavily (free 1k/month, BYOK in Settings or `TAVILY_API_KEY`). Modes: *auto* (heuristic for time-sensitive prompts), *on*, *off*. Results are injected as a numbered grounding block; the reply cites `[n]` and source chips are shown. |
| **Deep Research** | `/api/research` (SSE): plan 3–8 sub-questions → parallel advanced searches → cited notes per question → streamed long-form report with a deduplicated bibliography. Costs 5 message credits. |
| **Projects** | Folders with custom instructions and knowledge files (text/code/CSV/JSON, ≤2 MB, ≤20). Instructions + ~40k chars of files are prepended to every chat in the project. |
| **Memory** | After each exchange `/api/memory/extract` asks the router for ≤3 durable third-person facts; they are stored locally, shown/edited in Settings → Memory and injected into future chats. Toggle off any time. |
| **Model Arena** | ⚔️ toggle: one prompt → 2–4 providers streamed side-by-side on a single SSE connection (`/api/arena`), blind labels until finished, vote 👍 Best (local leaderboard), "Continue with this" adopts that answer and pins the provider. Costs one credit per lane. |
| **Voice mode** | 🎙 toggle: browser speech recognition for input (auto-sends on pause), replies spoken via the Studio TTS mesh (ElevenLabs/Kokoro, BYOK-aware) with `speechSynthesis` fallback. Mute / stop any time. |
| **Code interpreter** | Every Python / JavaScript block in a reply gets a **▶ Run** button. Runs entirely in the browser: Python via Pyodide (numpy/pandas/matplotlib auto-loaded; figures rendered inline), JS in a sandboxed iframe. Errors get a 🛠 "Ask to fix" button that feeds code + traceback back to the model. |
| Also | Regenerate, copy, per-message provider/model/latency/failover meta, richer Markdown (tables, ordered lists, quotes), mobile layout (sidebar/artifacts become overlays). |

## Cloud MCP App Store (Phase 4)

**Apps** tab — **107 connectors**, every one backed by a real endpoint:

| Kind | Count | How it works |
|---|---|---|
| **MCP** (vendor-hosted) | 63 | Aetheris' MCP client talks Streamable HTTP to the vendor's own server (Notion, GitHub, Slack, Figma, Stripe, Linear, Atlassian, Vercel, Supabase, Sentry, Canva, Zapier, Google's official Workspace servers…). 51 of them support **MCP OAuth 2.1** — click *Sign in*, approve, done. Others take a pasted token. |
| **Gateway** (built-in) | 45 | Aetheris itself serves an MCP server at `/api/gateway/<id>` that wraps the vendor's public REST API (Razorpay, WhatsApp Business, Twilio, Discord, Telegram, X, YouTube, Google Workspace REST, Salesforce, Zoho, Zendesk, Odoo, SAP OData, BigQuery, Snowflake, OpenWeather, CoinGecko, Hacker News, Wikipedia…). Because it is a real MCP endpoint, Claude Desktop / Cursor / any client can use it too. |

**How it's built**
- `src/lib/mcp/client.ts` — MCP client (Streamable HTTP, JSON-RPC, SSE responses, session ids).
- `src/lib/mcp/oauth.ts` — MCP authorization spec: protected-resource metadata → AS metadata → **dynamic client registration** → **PKCE** → token → refresh. Tokens sealed in an httpOnly cookie; nothing server-side.
- `src/lib/gateway/engine.ts` — declarative REST→MCP engine: `{path, query, body}` templates, header/query/basic/arg auth, JSON or form bodies, `prepare()` hooks; exposes `tools/list` + `tools/call`.
- `src/lib/gateway/apis.ts` — the 45 API definitions (~110 tools).
- `src/lib/mcp/agent.ts` — **provider-agnostic tool loop**: tools go in the prompt, the model emits `<tool_call>{…}</tool_call>`, Aetheris executes (remote MCP or in-process gateway) and feeds the result back. Works with *every* model in the mesh. The *Enterprise GitHub Automation* connector calls the Phase-2 factory directly.
- Pasted credentials stay in the browser and are forwarded only to that connector; premium connectors require Pro.

**Live-checked 2026-09-04** — every remote MCP URL in the catalog was probed over HTTPS and answered with a protocol-level response (OAuth challenge / JSON-RPC error / 405 on GET), confirming the endpoint exists. Corrections made from that sweep: PayPal → `mcp.paypal.com/mcp`; Box → `/mcp`; Alpha Vantage → `/mcp`; Docker Hub, Cashfree, Web Fetch and Vercel moved to the built-in gateway (Docker/Cashfree have no hosted MCP; `remote.mcpservers.org` was down; Vercel's MCP admits only allow-listed clients). Sequential Thinking dropped. See `LIVE_CHECKED_AT` in `src/lib/mcp/catalog.ts`.

**Verifying endpoints** — vendors move URLs. `npm run verify:connectors` probes every remote MCP server (`initialize`) and gateway upstream and prints a ✓/✗ table; the Apps tab's *test connection* does the same per connector.

## UPI Monetisation (Phase 5)

Free tier: 50 chat messages/day, images, speech, standard connectors.
**Pro ₹299/30d** (video, unlimited chat, premium MCP) · **Enterprise ₹999/30d** (+ Enterprise GitHub Automation).

```
Upgrade → POST /api/billing/checkout  → order ref AETxxxxxxxx + upi://pay QR (pa=9488407998@upi, am, tr)
user scans with GPay/PhonePe → pays → enters 12-digit UTR → POST /api/billing/confirm  (status: submitted)
founder opens /admin (AETHERIS_ADMIN_KEY) → verifies UTR in GPay history → Approve
→ entitlement granted; the user's open modal polls /api/billing/status and unlocks instantly
```

Personal UPI has no webhook, so verification is a one-click manual approval. Swapping in a
Razorpay/Cashfree webhook later only touches `src/lib/billing/payments.ts::decide`.
Data lives in `data/*.json` (git-ignored) via a tiny locked JSON store — swap for a DB by
re-implementing `src/lib/store.ts`.

## API

`POST /api/chat`
```json
{ "messages": [{ "role": "user", "content": "hello" }], "preferred": "groq" }
```
→ `{ "provider": "groq", "model": "...", "content": "...", "latencyMs": 412, "attempts": [...] }`

`GET /api/providers` → mesh status (configured / ready / cooldown, success & failure counts, avg latency).

`POST /api/factory/run` `{ "task": "…", "preferred"?: "groq" }` → `text/event-stream` of
`{type:"step", step, status, detail, data}` events followed by `{type:"result", ok, conclusion, report, runUrl, commitUrl, branch, files}`.

Auth: `GET /api/auth/github` (OAuth start) · `POST /api/auth/token` `{token}` · `GET /api/auth/me` · `POST /api/auth/logout`

Chat with tools: `POST /api/chat` also accepts `servers: [{id, url?, credential?, headerName?, headerPrefix?}]` and returns `toolEvents`.

Media: `POST /api/media/generate` `{kind: image|audio|video, prompt, keys?, voice?}` → `{url, mime, provider, attempts}` · `GET /api/media/providers`

MCP: `GET /api/mcp/catalog` · `POST /api/mcp/tools` (test a server, list tools) · `GET /api/mcp/oauth/start?id=` · `POST /api/mcp/oauth/disconnect`

Gateway (MCP Streamable HTTP): `POST /api/gateway/<id>` with `Authorization: Bearer <credential>` — e.g. add `https://<your-host>/api/gateway/razorpay` to Claude Desktop or Cursor.

Billing: `GET /api/billing/plans` · `POST /api/billing/checkout {planId}` · `POST /api/billing/confirm {id, utr}` · `GET /api/billing/status?id=` · admin `GET|POST /api/admin/payments` (Bearer `AETHERIS_ADMIN_KEY`)

## Project layout

```
src/lib/router/
  providers.ts   the 31-provider registry (cloud free tiers, keyless, local Ollama/LM Studio/vLLM)
  adapters.ts    wire protocols: OpenAI-compatible, Gemini, Cohere, Cloudflare
  router.ts      ordering, failover, cooldown/health tracking
src/lib/github/
  auth.ts        sealed-cookie session, OAuth helpers
  api.ts         GitHub REST client: repos, Git Data commits, Actions runs/jobs/logs
src/lib/factory/
  codegen.ts     prompt → structured project plan; CI log → summary (via the router)
  workflow.ts    GitHub Actions workflow template per language
  pipeline.ts    the orchestrator (emits step events)
src/lib/media/   image / speech / video provider mesh + adapters
src/lib/mcp/     MCP client, OAuth 2.1 client, 107-connector catalog, tool-calling agent loop
src/lib/gateway/ REST→MCP gateway engine + 45 API definitions (served at /api/gateway/<id>)
src/lib/billing/ plans, entitlements + free-tier metering, UPI payments, admin auth
src/lib/store.ts locked JSON file store (data/)
src/app/api/     chat, providers, factory, auth, media, mcp, billing, admin
src/app/admin/   payments approval console
src/components/  Chat (modes: Chat · Factory · Studio · Apps), Upgrade modal, mesh panel…
tests/           106 tests (node:test): core registry/policy/events, router, agents, knowledge, physical, gateway, plugins, perf…
src/core/        Intelligence-OS core — see docs/DEVELOPMENT.md for the map
src/plugins/     plugins (docs/PLUGIN_SDK.md) · bridge/ aetheris-bridge serial daemon · evals/ eval harness
scripts/         verify-connectors.ts — live probe of every connector endpoint
```

## Scripts

- `npm run dev` — dev server
- `npm test` — 106 tests (no API keys needed) · `npm run eval` — routing/policy/retrieval evals with thresholds
- `npm run typecheck` — TypeScript
- `npm run build && npm start` — production

## Sign in — one account, every device

`/login` offers **Continue with Google**, **Continue with GitHub**, **Email code** and **Phone (SMS) code**.
All methods *join* into a single Aetheris account: a verified email or phone seen via any provider links to the
same account (Google login with `you@x.com` + later email-OTP with `you@x.com` → one account), and signing in
while already signed in links the new method to the current account. Your anonymous usage (plan, credits,
memory, API keys) is adopted by the account on first sign-in.

| Method | Env vars | Without config |
| --- | --- | --- |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (redirect `…/api/auth/google/callback`) | button disabled |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (redirect `…/api/auth/github/callback`) | button disabled |
| Email  | `RESEND_API_KEY`, `AUTH_EMAIL_FROM` | dev code shown on the page (non-production only) |
| Phone  | `TWILIO_*` or `MSG91_AUTH_KEY` + `MSG91_TEMPLATE_ID` | dev code shown on the page (non-production only) |

Bare 10-digit numbers default to `+91`. Sessions are sealed cookies valid 90 days; `DELETE /api/auth/session` signs out.

### Admin accounts
Sign in with an address listed in `AETHERIS_ADMIN_EMAILS` / `AETHERIS_ADMIN_PHONES` (defaults: the founder's
`ramkpraja175@gmail.com` and `+91 9488407998`) and you get **everything**: God Mode features, no credit metering,
unlimited agents/API keys, and `/admin` (payments, users, plan changes) without typing `AETHERIS_ADMIN_KEY`.
The key still works for scripts (`Authorization: Bearer …`).

## Sync, share, install

- **Cloud sync** — sign in and your chats, projects, memory and settings follow you to every device (`/api/sync`,
  merge by `updatedAt`, deletions propagate via tombstones). Guests stay local-only.
- **Share a chat** — 🔗 in the header creates a public read-only snapshot at `/s/<id>` (revocable). Readers can
  "Continue this chat in Aetheris", which imports it as a new conversation.
- **Install as an app** — PWA manifest + service worker: "Add to Home Screen" on Android/iOS or Install in Chrome/Edge.
  The shell loads offline; API calls always go to the network.

## 102 agents, @picker, slash commands, workflows, debate

- **102 agents** across 17 domains (academy incl. physics/chemistry/biology/history/economics/exam strategist/kids;
  coding incl. frontend/backend/mobile/SRE/security/QA/docs/embedded/gamedev/web3; data incl. ML/SQL/data-eng/spreadsheets;
  research, science, writing, creative, business, marketing, finance (Indian tax, investing, accounting), legal, health,
  career, language (English/Tamil/Hindi/polyglot), productivity, design). Each has its own protocol, skills and aliases;
  Prime auto-routes, or force with `@id`. Roster: `src/lib/agents/catalog.ts` + `catalog-extended.ts`.
- **@ picker** — type `@` in the composer to search agents by id, alias, name, domain or skill (↑↓, Tab/Enter).
- **Slash commands** — `/research`, `/arena`, `/debate <motion>`, `/image`, `/room`, `/share`, `/workflows`, `/gallery`,
  `/agents`, `/settings`, `/export`, `/new`.
- **Workflows** (⛓️ mode) — chain agents into saved automations with templated prompts (`{{input}}`, `{{prev}}`,
  `{{steps.id}}`), pure transforms (bullets, extract_json…), and regex branches. Streams every step; 5 public templates
  (blog pipeline, code review + tests, startup validator, lesson plan, Tamil+Hindi translation pack). `/api/workflows`.
- **Debate** — `/debate Remote work beats office work`: two agents argue for/against over rounds, Metis adjudicates
  with a scorecard. `/api/debate`.

## Rooms, gallery, languages

- **Live rooms** — 👥 in the header turns the current chat into a room at `/room/<id>`. Anyone with the link joins;
  every message shows who said it, presence avatars update live (SSE with polling fallback), and the AI answers in the
  room for everyone (it sees the speakers' names). Start a message with `//` or use *aside* to talk to humans only.
- **Prompt & agent gallery** — 🗂️ Gallery mode: community-shared prompts and agent recipes (with `@agent` mentions
  and tags). Search, like, "Use →" drops it into the composer, publish your own; seeded with starters incl. Tamil/Hindi.
- **Languages** — Settings → General → Language: English, தமிழ், हिन्दी (auto-detected from the browser). Add a
  language by extending `src/lib/i18n.ts`.

## Self-hosting

```bash
git clone https://github.com/rajaram-2005/Aetheris && cd Aetheris
npm install && cp .env.example .env.local
npm run dev            # or: npm run build && npm start
```
Works with zero keys (keyless providers). Add provider keys in Settings or `.env.local` for more capacity.
Set `AETHERIS_SECRET` (cookie/credential sealing), `AETHERIS_ADMIN_EMAILS`/`_PHONES` (your admin identities) and the
optional sign-in / payment variables from `.env.example`. Deploys anywhere Next.js runs (Vercel, Render, Fly, Docker);
persistent data lives in `data/` (`AETHERIS_DATA_DIR`).


## 🎙 Voice mode

Hands-free conversation: browser speech recognition in 18 languages/accents (English-India, Tamil, Hindi, Telugu, Kannada, Malayalam, …), spoken replies that start while the answer is still streaming (browser TTS) or via the Studio TTS mesh, barge-in interruption, automatic re-listen, and voice-tuned answers (short, no markdown, language-matched). Nothing is recorded — only the transcript is sent. `/voice` or the 🎙 chip. See `/docs/voice`.

## 🎛️ Intelligence OS core (Control Center)

`src/core` holds the **Capability Registry** (383 models/agents/tools/connectors/subsystems/plugins with honest status), the **execution policy** (permission levels + isolated `physical` grant, single-use confirmation tokens, audit), **observability** (structured, redacted events), the **intent router**, the **agent runtime**, **sandbox**, **MCP gateway**, **knowledge fabric + memory**, **research**, **GitHub intelligence**, **browser**, **multimodal**, **physical devices**, **robotics**, **twins**, **automation**, **workspaces**, **security guard** and the **plugin SDK**. The **Control Center** (16 panels) shows all of it live, from real events — nothing on it is mocked. Audit + roadmap: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## ⏰ Scheduled automations

Run any agent prompt or workflow on a cron schedule (presets or custom, time-zone aware, 15-min floor) with run history, share-link publishing, email (Resend) and webhook delivery (Slack/Discord/WhatsApp gateways/Zapier/n8n). In-process ticker plus `GET /api/schedules/tick` for external crons (Vercel Cron, GitHub Actions, cron-job.org) protected by `CRON_SECRET`; claim-before-run prevents double execution. See `/docs/schedules`.

## 📁 Chat with documents

Per-user knowledge bases: upload PDF (page-aware), DOCX, CSV (row-aware), TXT/Markdown, HTML, JSON, code, web pages or pasted text; sentence/heading-aware chunking with overlap; BM25 retrieval (no embedding API needed — works anywhere, free); answers cite passages as [D1], [D2]… with document/page/section shown under each reply; retrieval tester; API under `/api/kb`. See `/docs/documents`.

## 🎓 Study mode

Adaptive quizzes and flashcards with spaced repetition. Create a deck for any subject in any language; the matching tutor agent writes flashcards, MCQs, cloze and short-answer cards (with explanations); **adaptive generation** targets what you keep missing; sessions schedule cards with an SM-2 algorithm (Again/Hard/Good/Easy); typed answers are graded (exact match, else by the tutor); progress shows stages, retention, heatmap and streak. API under `/api/study/decks`. See `/docs/study`.

## AI ethics & explainability

- **`/explain`** (or the *explain* link under any answer) — the AI Explainer audits the answer: fact vs inference vs guess, assumptions, calibrated confidence, what's most likely wrong, how to verify, bias/framing check. `POST /api/explain`.
- **`/ethics <plan or text>`** — the AI Ethicist runs a structured impact assessment (harms × likelihood × severity, consent, accountability, mitigations, go/no-go).
- **`@fairness`** — bias audit for text, prompts, datasets and model behaviour (India-aware axes incl. caste, region, language).
- **📚 Learn / `/docs/concepts`** — *Explained AI*: 46 plain-language concepts (how LLMs work, limits, agents & RAG, explainability, ethics, law & governance incl. DPDP/EU AI Act, using AI well), each with an analogy, misconception, and a try-it prompt. Public `GET /api/concepts`; also grounds the Explainer/Ethicist agents.
- Transparency everywhere: provider/model/latency under every message, agent plan cards, inline tool trails, sources, editable Metis lessons, Markdown export, MIT code. See `/docs/ethics`.

## Docs & prompt gallery

- **In-app docs at `/docs`** — 13 hand-written guides (routing, agents, workflows, Hub, API, self-hosting…) plus **reference pages generated from the live catalogs** (all 102 agents with aliases/skills, 27 providers with free-tier limits and key links, 100+ MCP connectors, commands, HTTP endpoints). They can't drift from the code.
- **Prompt gallery seed** — 700+ hand-written, templated recipes across 26 domains — education, students, coding, engineering (civil/mechanical/electrical/chemical/aero/auto), business, industry playbooks (agriculture, hospitality, retail, real estate, logistics, manufacturing, NGOs, government, sports…), marketing, writing, presentation & speaking, arts (music, photography, film, fashion, architecture), life, finance, legal, health, science, design, career, language, productivity, creative, data/ML, gaming & entertainment, social & relationships, safety & security, using-AI-well, and a **world** set with writing recipes written natively in 40+ languages (Indian languages, Spanish, French, German, Portuguese, Arabic, Chinese, Japanese, Korean, Russian, Indonesian, Swahili and more) (Tamil/Hindi included) in `src/lib/gallery/seeds/*.ts`. Every recipe references real agents (tested).

## License
MIT © 2026 Rajaram K — see [LICENSE](LICENSE).

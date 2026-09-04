# Aetheris One

**One chat. A mesh of free AI providers. Automatic failover.**

[![CI](https://github.com/rajaram-2005/Aetheris/actions/workflows/ci.yml/badge.svg)](https://github.com/rajaram-2005/Aetheris/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Aetheris is **open source (MIT)**. Self-host it in a minute, fork it, or contribute a provider, agent or MCP connector — see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

Aetheris One is a minimalist chat interface backed by an *omni-router*: your prompt is
load-balanced across 27 free-tier AI providers. When one provider rate-limits or errors,
Aetheris silently reroutes to the next — no local GPU, no paid API required.

> Founder & Chief Architect: Rajaram · ramkpraja175@gmail.com

## Status

| Phase | Component | State |
|---|---|---|
| 1 | **One Chat + Omni-Router** (27 providers, failover, cooldowns, provider pinning) | ✅ this repo |
| 2 | **GitHub Coding Factory** (OAuth/PAT → codegen → push → Actions → read logs → report) | ✅ this repo |
| 3 | **Multimodal Cloud Studio** (image / speech / video meshes, BYOK) | ✅ this repo |
| 6 | **One Chat flagship UX** (streaming, sidebar, vision, artifacts, web search, Deep Research, projects, memory, Arena, voice, code interpreter) | ✅ this repo |
| 4 | **Cloud MCP App Store** (107 connectors: 58 vendor MCP servers w/ OAuth + 49 via built-in REST→MCP gateway) | ✅ this repo |
| 5 | **UPI monetisation** (dynamic QR → UTR → admin approval → instant unlock) | ✅ this repo |

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
  providers.ts   the 15-provider registry
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
tests/           20 tests: router failover, factory pipeline, MCP client/OAuth/agent, gateway engine, media mesh, billing
scripts/         verify-connectors.ts — live probe of every connector endpoint
```

## Scripts

- `npm run dev` — dev server
- `npm test` — router failover tests (no API keys needed)
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

## License
MIT © 2026 Rajaram K — see [LICENSE](LICENSE).

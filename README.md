# Aetheris One

**One chat. A mesh of free AI providers. Automatic failover.**

Aetheris One is a minimalist chat interface backed by an *omni-router*: your prompt is
load-balanced across 15 free-tier AI providers. When one provider rate-limits or errors,
Aetheris silently reroutes to the next — no local GPU, no paid API required.

> Founder & Chief Architect: Rajaram · ramkpraja175@gmail.com

## Status

| Phase | Component | State |
|---|---|---|
| 1 | **One Chat + Omni-Router** (15 providers, failover, cooldowns, provider pinning) | ✅ this repo |
| 2 | **GitHub Coding Factory** (OAuth/PAT → codegen → push → Actions → read logs → report) | ✅ this repo |
| 3 | **Multimodal Cloud Studio** (image / speech / video meshes, BYOK) | ✅ this repo |
| 4 | **Cloud MCP App Store** (91 connectors, real MCP client, tool-calling for any model) | ✅ this repo |
| 5 | **UPI monetisation** (dynamic QR → UTR → admin approval → instant unlock) | ✅ this repo |

## Quick start

```bash
npm install
cp .env.example .env.local     # add at least one key, e.g. GROQ_API_KEY
npm run dev                    # http://localhost:3000
```

Any subset of keys works — the router only uses providers whose key is set.

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

## Cloud MCP App Store (Phase 4)

**Apps** tab — 91 connectors across productivity, dev, payments, CRM/ERP, social, web-scraping,
storage. Featured: Notion, GitHub, Slack, Figma, Stripe, Razorpay, Vercel, Google Workspace.

- `src/lib/mcp/client.ts` — a real **MCP client** (Streamable HTTP, JSON-RPC, SSE responses, session ids).
- `src/lib/mcp/agent.ts` — a **provider-agnostic tool loop**: tools are described in the system prompt and the model emits `<tool_call>{…}</tool_call>`; Aetheris executes it against the MCP server and feeds the result back (max 6 rounds). This works with *every* model in the mesh, not just those with native function-calling.
- Credentials for a connector are stored in the browser and forwarded only to that connector's URL.
- "verified" connectors point at known public MCP endpoints; "community" ones ship with a placeholder URL — add a hosted endpoint via *custom server*.
- Premium connectors (Google Workspace, Salesforce, SAP, WhatsApp Business, Enterprise GitHub Automation…) require Pro.

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

MCP: `GET /api/mcp/catalog` · `POST /api/mcp/tools` (test a server, list tools)

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
src/lib/mcp/     MCP client, 91-connector catalog, tool-calling agent loop
src/lib/billing/ plans, entitlements + free-tier metering, UPI payments, admin auth
src/lib/store.ts locked JSON file store (data/)
src/app/api/     chat, providers, factory, auth, media, mcp, billing, admin
src/app/admin/   payments approval console
src/components/  Chat (modes: Chat · Factory · Studio · Apps), Upgrade modal, mesh panel…
tests/           13 tests: router failover, factory pipeline, MCP client + agent, media mesh, billing
```

## Scripts

- `npm run dev` — dev server
- `npm test` — router failover tests (no API keys needed)
- `npm run typecheck` — TypeScript
- `npm run build && npm start` — production

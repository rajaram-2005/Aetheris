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
| 2 | GitHub Coding Factory (OAuth → push → Actions → read logs) | planned |
| 3 | Multimodal Cloud Studio (image / video / audio routing) | planned |
| 4 | Cloud MCP App Store | planned |
| 5 | UPI paywall (static QR + manual admin approval) | planned |

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

## API

`POST /api/chat`
```json
{ "messages": [{ "role": "user", "content": "hello" }], "preferred": "groq" }
```
→ `{ "provider": "groq", "model": "...", "content": "...", "latencyMs": 412, "attempts": [...] }`

`GET /api/providers` → mesh status (configured / ready / cooldown, success & failure counts, avg latency).

## Project layout

```
src/lib/router/
  providers.ts   the 15-provider registry
  adapters.ts    wire protocols: OpenAI-compatible, Gemini, Cohere, Cloudflare
  router.ts      ordering, failover, cooldown/health tracking
src/app/api/     /api/chat, /api/providers
src/components/  Chat UI, mesh panel, tiny markdown renderer
tests/           failover tests against a mock provider (npm test)
```

## Scripts

- `npm run dev` — dev server
- `npm test` — router failover tests (no API keys needed)
- `npm run typecheck` — TypeScript
- `npm run build && npm start` — production

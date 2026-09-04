# Models & the ModelRouter

Aetheris never depends on one provider. The router (`src/lib/router/`) sees a list of `ProviderConfig`s — 31 today, all free-tier or local — and picks per request by **task fit, locality, health, cooldown and tier**, then fails over in order. Callers ask for *a completion under a policy*, never for a vendor.

```
 messages ─▶ inferPolicy() ─▶ orderedCandidates(policy, vision, allow, preferred)
                  │                     │  priority → task strengths → context → locality → health score
                  │                     ▼
                  └────────▶ route(): try provider 1 ─▶ 429/5xx/timeout? cooldown + next ─▶ … ─▶ RouteResult
                                             │ success → record(model event: provider, model, ms, task, local, costClass)
```

## ModelPolicy (`router.ts`)

```ts
interface ModelPolicy {
  task?: "coding" | "reasoning" | "chat" | "long_context" | "fast" | "multilingual";
  minContext?: number;                    // tokens
  locality?: "local" | "prefer_local" | "remote" | "any";
}
```

* `inferPolicy(messages)` derives task from the last message (code fences/keywords → coding; prove/derive/compare → reasoning; Tamil/Devanagari → multilingual; > 24k tokens → long_context with `minContext`). `AETHERIS_LOCALITY` sets a global locality preference.
* `applyPolicy` (pure, tested) re-ranks: +2 per matching `strengths`, +2 for ≥100k context on long_context, +3 for local providers under `prefer_local`, hard filter for `local`/`remote`.
* Health: Bayesian success rate lightly penalised by latency, per provider, in-process. Rate-limit/5xx → 60 s cooldown (`AETHERIS_COOLDOWN_MS`); auth failure → 15 min.
* Vision requests filter to vision-capable providers/models (`AETHERIS_VISION_MODEL_<ID>`).
* Cost: every provider carries `costClass: free | local | credit | paid`; there is no dollar metering because nothing here costs money by default.

## Providers

| Kind | IDs |
|---|---|
| Cloud, key required, free tier | groq · cerebras · sambanova · gemini · github (Models) · openrouter · mistral · together · cohere · cloudflare · huggingface · nvidia · deepseek · ai21 · perplexity · modelscope · ovh · ollama-cloud · kilo · zai · siliconflow · nebius · chutes · glhf · nscale |
| Keyless community | pollinations · llm7 (optional token raises limits) |
| **Local / self-hosted** (offline-first) | ollama (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`) · lmstudio (`LMSTUDIO_BASE_URL`) · vllm / any OpenAI-compatible (`CUSTOM_LLM_BASE_URL`, `CUSTOM_LLM_MODEL`) |

Adapter kinds: OpenAI-compatible chat, Gemini native, Cohere v2 (`adapters.ts`). Adding a provider = one `ProviderConfig` entry (base URL, env var, default model, strengths, contextTokens, costClass, local?) — no caller changes. Key pages and limits are listed in `.env.example`; keys are read from env or the user's encrypted BYOK store, never from prompts.

Provider capability entries in the registry are `model:<id>` with status `implemented` when a key/endpoint is configured and `not_available` otherwise — the Control Center shows exactly which are live.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /api/models` | tiers/providers available to the caller (all tiers open — free for everyone) |
| `GET /api/providers` | mesh status: configured, health score, cooldowns |
| `POST /api/chat` | One Chat (streaming, images, KB grounding, agents auto-delegation) |
| `POST /api/v1/chat/completions`, `GET /api/v1/models` | OpenAI-compatible surface with personal API keys (`sk-aeth-…`) |

## Embeddings & speech

* Embeddings for the knowledge fabric: local hashed n-gram model by default (lexical, honest: not semantic); set `EMBEDDINGS_URL/KEY/MODEL` for real vectors.
* STT: Groq whisper-large-v3 or `STT_URL/KEY`. TTS/image/video generation live in `src/lib/media` (see README → Studio).

## Status

| Piece | Status |
|---|---|
| Provider-neutral routing with failover, health, cooldowns, streaming | IMPLEMENTED (tested) |
| Task-aware policy + locality + local providers | IMPLEMENTED (tested) |
| Per-token cost accounting | NOT AVAILABLE by design (free providers; `costClass` only) |
| Automatic benchmark-driven model selection | NOT AVAILABLE (see `evals/` for the harness you could feed it from) |

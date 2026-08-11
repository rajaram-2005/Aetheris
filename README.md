# Æ Aetheris

> *Where Raw Intellect Meets Human Intuition.*

**Aetheris** (pronounced *ay-THER-iss*) is a next-generation AI thought partner
designed for deep reasoning, creative synthesis, and technical precision. Powered
by multimodal intelligence and agentic problem-solving, Aetheris effortlessly
writes clean code, analyzes complex data, and refines ideas—delivering clear,
actionable intelligence for any workflow.

This repository implements the **Aetheris Model Identity & Brand Blueprint** as a
runnable service: a production-style FastAPI backend that exposes an
OpenAI-compatible chat-completions API, a model-tier registry, a managed
system-prompt suite that activates the official Aetheris identity, and a branded
landing page.

---

## Highlights

- **OpenAI-compatible API** — `POST /v1/chat/completions` with streaming (SSE) and
  non-streaming responses. Point any existing OpenAI client at Aetheris.
- **Aetheris `mode` extension** — a single extra field selects the active identity:
  `general`, `engineering`, `editorial`, or `structured`.
- **Model-tier registry** — `aetheris-lite` (Flash), `aetheris-pro`, and
  `aetheris-ultra` (Reasoning Engine), addressable by id or alias.
- **Production system-prompt suite** — the four official prompts, injected
  automatically so the Aetheris persona is always active.
- **Provider abstraction** — runs out-of-the-box with a brand-aware **mock**
  provider; switch to any OpenAI-compatible endpoint (OpenAI, Groq, Together,
  vLLM, Ollama, LM Studio) via environment variables.
- **Typed everywhere** — Pydantic v2 schemas, Python 3.11+ idioms, defensive error
  handling.
- **Interactive product experience** at `/` with a live streaming playground,
  adaptive model/mode controls, responsive light/dark themes, architecture
  visualization, and copy-ready API examples in the canonical Aetheris palette.
- **God Mode orchestration** — activate an expert control deck with sampling
  controls, mission profiles, local context-file mounting, execution telemetry,
  a three-agent Council workflow, a Lite-vs-Pro-vs-Ultra Model Arena, sequential
  Flow Forge recipes, persistent workspaces, live session analytics, cancellable
  runs, voice input, response refinement actions, session export, and a
  `⌘/Ctrl+K` command center.

---

## Quickstart

Requires Python 3.11+.

```bash
# 1. Create a virtual environment and install dependencies
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. (Optional) configure a real backend — otherwise the mock provider is used
cp .env.example .env
#   set AETHERIS_LLM_PROVIDER=openai and AETHERIS_LLM_API_KEY=sk-... to go live

# 3. Run the server (binds 0.0.0.0:8000)
.venv/bin/uvicorn aetheris.main:app --host 0.0.0.0 --port 8000

#   or: .venv/bin/python -m aetheris.main
```

Then open:

- `http://localhost:8000/` — branded landing page
- `http://localhost:8000/docs` — interactive OpenAPI docs
- `http://localhost:8000/v1/health` — liveness + active provider

---

## Command-line interface

Aetheris ships a self-contained `aetheris` command for working with **every tier
and every mode directly from the command prompt** — no browser, no server
required. Inference runs in-process via the same provider layer, so it works
offline with the brand-aware mock engine and transparently uses your
OpenAI-compatible backend when configured.

Install it (creates the `aetheris` script):

```bash
.venv/bin/pip install -e .
# also runnable as: .venv/bin/python -m aetheris <command>
```

### Commands

| Command | What it does |
|---------|--------------|
| `aetheris chat` | Interactive REPL: live streaming, slash commands, switch tier/mode on the fly. |
| `aetheris ask "<prompt>"` | One-shot prompt. Streams live by default; `--md` buffers and renders Markdown. |
| `aetheris stream "<prompt>"` | One-shot, explicitly streamed. |
| `aetheris models` | List the three tiers (table, or `--json`). |
| `aetheris modes` | List the four modes (table, or `--json`). |
| `aetheris info` | Full brand identity (palette, taglines, personality, capabilities, audiences). |
| `aetheris spec` | Architecture + training spec with `blueprint`/`scaffold`/`pending` evidence tags. |
| `aetheris health` | In-process provider/status. `--base-url URL` probes a running server instead. |
| `aetheris serve` | Launch the HTTP API (`--host` / `--port` / `--reload`). |

### Common flags (chat / ask / stream)

```
-m, --model TIER   aetheris-lite|flash | aetheris-pro|pro | aetheris-ultra|ultra
-M, --mode  MODE   general | engineering | editorial | structured
    --md           buffer the response and render it as Markdown (non-streaming)
    --no-color     disable ANSI color
```

### Examples

```bash
# One-shot, default tier (Pro) + mode (general), streamed live
aetheris ask "How should I prioritize a backlog of 40 bugs?"

# Ultra tier in Engineering mode, rendered as Markdown
aetheris ask -m ultra -M engineering --md "Design a rate limiter for a public API"

# Structured mode emits strict JSON only
aetheris ask -M structured "Summarize the quarterly risk report for the API gateway"

# Interactive chat — switch tiers/modes mid-conversation
aetheris chat
» /model ultra
» /mode engineering
» Design a small in-memory rate limiter
» /quit

# Introspection
aetheris models --json
aetheris spec

# Launch the HTTP API from the same command
aetheris serve --port 8000 --reload
```

### Chat slash commands

`/model [TIER]` · `/mode [MODE]` · `/models` · `/modes` · `/system` (show active
system prompt) · `/info` · `/spec` · `/md [on|off]` (toggle Markdown rendering) ·
`/clear` (clear history) · `/help` · `/quit`.

---

## Model tiers

| Tier | Alias | Optimized for | Context | Reasoning |
|------|-------|---------------|---------|-----------|
| `aetheris-lite` | `flash` | Instant chat, lightweight automation, low latency | 32K | — |
| `aetheris-pro` | `pro` | The balanced daily workhorse: coding, documents, writing | 128K | — |
| `aetheris-ultra` | `ultra` | Heavyweight reasoning: proofs, architecture, agent workflows | 256K | ✅ |

List them with `GET /v1/models`. Any tier can run in any mode.

## Inference modes

Each mode activates the Aetheris identity via one of the four production system
prompts from the blueprint.

| Mode | Identity | Use it for |
|------|----------|-----------|
| `general` | Master System Prompt | Default high-level reasoning and synthesis |
| `engineering` | Engineering (Pair-Programming) | Production-grade code, architecture-first |
| `editorial` | Editorial (Creative Writing) | Voice-preserving writing coaching |
| `structured` | Structured Inference Node | Strict, schema-compliant JSON output |

List them with `GET /v1/modes`.

---

## API reference

### `POST /v1/chat/completions`

OpenAI-compatible, extended with `mode`.

```bash
curl -N http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "aetheris-pro",
    "mode": "engineering",
    "stream": true,
    "messages": [
      { "role": "user", "content": "Design a rate limiter for a public API." }
    ]
  }'
```

Request fields:

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `model` | `string?` | `aetheris-pro` | Tier id or alias (`flash`/`pro`/`ultra`). |
| `messages` | `ChatMessage[]` | — | At least one `user` message required. |
| `mode` | `string?` | `general` | One of the four inference modes. |
| `stream` | `boolean` | `false` | Stream SSE chunks when `true`. |
| `temperature` / `max_tokens` / `top_p` / `stop` | various | — | Forwarded to the upstream provider when set. |

The response envelope matches OpenAI (`chat.completion` / `chat.completion.chunk`),
with an added `mode` field for traceability. When `mode=structured`, the assistant
content is strict JSON only.

### Other endpoints

| Method & path | Purpose |
|---------------|---------|
| `GET /v1/models` | List Aetheris tiers (OpenAI `list` envelope). |
| `GET /v1/modes` | List inference modes. |
| `GET /v1/architecture` | Foundation-model architecture spec (transformer config, modalities, optimizations). |
| `GET /v1/training` | Training pipeline — the Hermes Agent + Meta-Learning stages. |
| `GET /v1/spec` | Combined architecture + training specification. |
| `GET /v1/identity` | Foundation-model spec + full brand identity (media-kit surface). |
| `GET /v1/health` | Liveness, version, active provider. |
| `GET /` | Branded landing page (now includes Architecture & Training sections). |
| `GET /docs` | Interactive OpenAPI docs. |

---

## Architecture & training specification

Aetheris separates *identity* (`core/branding.py`) from *how it's built*
(`core/spec.py`). The spec module encodes the foundation-model architecture and
the training pipeline with **explicit provenance** on every field:

| Evidence tag | Meaning |
|--------------|---------|
| `blueprint` | Sourced from the *Aetheris Model Identity & Brand Blueprint*. |
| `scaffold` | A structured placeholder with the right shape, awaiting authoritative values. |
| `pending` | Reserved for the *Aetheris Training & Architecture Blueprint (Hermes Agent Foundation)*. |

**Architecture** (`GET /v1/architecture`) — blueprint-sourced: a decoder-only
multimodal transformer optimized for long-context comprehension, structured code
execution, and autonomous tool usage; SFT + DPO instruction alignment; output
fidelity across JSON schemas, mathematical proofs, and complex natural language;
per-tier context windows (32K / 128K / 256K). The concrete transformer
hyperparameters (layers, hidden size, heads, …) are a reference scaffold.

**Training pipeline** (`GET /v1/training`) — the **Hermes Agent + Meta-Learning**
program, a two-pillar foundation: the Hermes Agent program (agentic tool use and
self-correction) plus a Meta-Learning pillar (learning-to-learn, sample-efficient
adaptation). Alignment methods `SFT`, `DPO`; meta-learning methods `MAML`,
`Reptile`, `few-shot adaptation`, `in-context learning tuning`.

1. `continued_pretraining` — domain-adaptive pretraining *(scaffold)*
2. `sft` — Supervised Fine-Tuning / instruction alignment *(blueprint)*
3. `dpo` — Direct Preference Optimization / hallucination reduction *(blueprint)*
4. `agent_tuning` — agentic tool-use instruction tuning *(scaffold)*
5. `meta_learning` — learning-to-learn / few-shot adaptation *(scaffold)*
6. `evaluation` — output-fidelity & hallucination-rate gating *(blueprint)*

### Populating the Hermes blueprint details (no code change)

The full spec is overridable from a JSON file. Copy
[`aetheris/core/aetheris_spec.example.json`](aetheris/core/aetheris_spec.example.json)
to `aetheris/core/aetheris_spec.json` (or set `AETHERIS_SPEC_FILE` to any path),
fill in the authoritative values from the Hermes blueprint, and restart. The
override is a **partial merge**: fields you omit keep their blueprint-derived
defaults, stages merge by id, and nested objects merge field-by-field — so you
only need to supply the values the blueprint actually specifies. Malformed or
missing override files fall back to the defaults with a logged warning rather
than crashing the service.

---

## Configuration

All settings are environment variables (prefix `AETHERIS_`), optionally read from
a `.env` file. See [`.env.example`](.env.example).

| Variable | Default | Description |
|----------|---------|-------------|
| `AETHERIS_HOST` | `0.0.0.0` | Bind host. |
| `AETHERIS_PORT` | `8000` | Bind port. |
| `AETHERIS_LLM_PROVIDER` | `mock` | `mock` (offline) or `openai`. |
| `AETHERIS_LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL. |
| `AETHERIS_LLM_API_KEY` | *(empty)* | API key for the upstream endpoint. |
| `AETHERIS_LLM_MODEL` | `gpt-4o-mini` | Upstream fallback model. |
| `AETHERIS_LLM_TIMEOUT` | `120` | Per-request upstream timeout (seconds). |

> If `AETHERIS_LLM_PROVIDER=openai` is set without an API key, Aetheris logs a
> warning and falls back to the mock provider so the service stays live and
> diagnosable rather than failing to start.

---

## Architecture

```
aetheris/
├── __init__.py
├── __main__.py             # `python -m aetheris` → CLI
├── cli.py                  # the `aetheris` command (chat/ask/stream/models/modes/info/spec/health/serve)
├── main.py                 # FastAPI app, lifespan, CORS, server entrypoint
├── core/
│   ├── branding.py         # Canonical brand identity (name, palette, copy)
│   ├── config.py           # Environment-driven settings (pydantic-settings)
│   ├── tiers.py            # Model-tier registry + foundation spec
│   ├── modes.py            # Inference modes → system-prompt binding
│   └── spec.py             # Architecture + training spec (provenance-tagged, JSON-overridable)
├── prompts/
│   └── system_prompts.py   # The four production system prompts (verbatim)
├── schemas/
│   ├── chat.py             # OpenAI-compatible chat request/response/chunk
│   ├── models.py           # Model/mode introspection schemas
│   └── spec.py             # Architecture/training spec response schemas
├── services/
│   ├── llm.py              # Provider interface, shared prepare_conversation, factory
│   ├── mock_provider.py    # Brand-aware offline provider (default)
│   └── openai_provider.py  # OpenAI-compatible forwarding/streaming provider
└── api/
    ├── routes.py           # /v1/chat/completions, /v1/models, /v1/modes, /v1/architecture, …
    └── landing.py          # Branded HTML landing page (data-driven)
```

**Request flow:** a chat request is resolved into a `PreparedConversation` (tier
+ mode + the mode's system prompt prepended to the messages), then handed to the
active `LLMProvider`. The provider returns a `CompletionResult` (non-streaming)
or an async iterator of text deltas (streaming), which the API layer wraps into
the OpenAI-compatible wire format.

**Design note:** the brand identity lives in exactly one place
(`core/branding.py`) and the system prompts in exactly one place
(`prompts/system_prompts.py`). The tiers, modes, landing page, mock persona, and
`/v1/identity` endpoint all read from these sources, so the blueprint cannot
drift across surfaces.

---

## Brand identity (summary)

- **Etymology:** *Aether* (the classical fifth element — pure, unbounded sky and
  realm of ideas) + *Synthesis* (integrating complex information into new clarity).
- **Palette:** cosmic indigo `#0B132B`, electric teal `#00B4D8`, crisp white `#F8F9FA`.
- **Voice:** articulate, insightful, calm, constructive. Honest about uncertainty;
  breaks complex problems into clear, step-by-step frameworks.
- **Capabilities:** deep context synthesis · multimodal fluidity · autonomous
  agentic reasoning · precision code & logic.
- **Audiences:** developers & engineers · creators & writers · enterprise &
  researchers.

The complete identity (all copy formats, personality traits, capability list,
audience positioning) is available machine-readably at `GET /v1/identity`.

---

## Development

```bash
.venv/bin/pip install -e ".[dev]"
.venv/bin/pytest        # when tests are added
.venv/bin/python -m compileall aetheris
```

The server supports `--reload` for live editing during development.

---

## License

MIT © 2026 RAJARAM K. See [LICENSE](LICENSE).

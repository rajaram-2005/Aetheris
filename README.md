# Æ Aetheris

> *Where Raw Intellect Meets Human Intuition.*

**Aetheris** (pronounced *ay-THER-iss*) is a next-generation AI thought partner
designed for deep reasoning, creative synthesis, and technical precision. Powered
by multimodal intelligence and agentic problem-solving, Aetheris effortlessly
writes clean code, analyzes complex data, and refines ideas—delivering clear,
actionable intelligence for any workflow.

This repository is **one application**: a FastAPI backend and a Next.js web UI
that ship and run as a single process, both driven by one brain — the
**Hermes agent with meta-learning** — which runs **entirely offline**. No API
key, no vendor API, no model weights, no network.

---

## One app, one brain

Everything runs through a single cascade. There is no second engine, no
browser-side copy of the logic, and no disconnected subsystem:

```
                        ┌──────────────────────────────┐
  Browser UI  ──────────►  FastAPI (one process, :8000) │
  (served at /)         │                              │
                        │   /v1/hermes/*   /v1/chat/*  │
                        └───────────────┬──────────────┘
                                        │
                              ┌─────────▼─────────┐
                              │   HERMES AGENT    │
                              └─────────┬─────────┘
   perceive → classify → adapt → deliberate → ground → route → recall
            → act → synthesize → polish → learn
                          │                        │
                   (meta-learning in)      (meta-learning out)
```

| Stage | What actually happens |
|-------|----------------------|
| `perceive` | Tokenization, language/script detection, entities, sentiment, keywords |
| `classify` | Intent via cue regexes + TF-IDF cosine over 40 intent prototypes |
| `adapt` | **Meta-learning inner loop** — few-shot exemplars, intent priors, tool priors, fast-adapted strategy |
| `deliberate` | Exact symbolic computation: recursive-descent parser, conversions, percentages, quadratics, statistics |
| `ground` | BM25 over a 31-article built-in corpus **and** any documents you mount |
| `route` | NOVA sparse mixture-of-experts routing |
| `recall` | NOVA hierarchical long-term memory |
| `act` | **Real tool execution** — sandboxed Python, retrieval, media synthesis |
| `synthesize` | Composes the answer, shaped by the learned strategy |
| `polish` | Safety gating, vendor-voice stripping, honesty enforcement |
| `learn` | **Meta-learning outer loop** — records the episode and updates the learner |

### The two pillars are live, not planned

`Hermes Agent + Meta-Learning` used to be a string in a spec file. Both pillars
are now executing code you can call:

* **Hermes Agent** ([`aetheris/hermes/agent.py`](aetheris/hermes/agent.py)) —
  plan → act → observe → self-correct against the real toolbelt, every stage
  traced. `POST /v1/hermes/run`
* **Meta-Learning** ([`aetheris/hermes/meta_learning.py`](aetheris/hermes/meta_learning.py)) —
  Dirichlet intent priors, per-intent tool priors, trigram-nearest few-shot
  exemplar recall, and a Reptile-style online strategy update, all learned from
  the agent's own episodes. `GET /v1/hermes/meta`

Learning is observable. Ask something, rate the answer 👍/👎, and watch the
strategy, priors, and exemplar store move in the Inspector's **learning** tab —
or at `GET /v1/hermes/meta`. `GET /v1/training` reports this as live telemetry
rather than a declared intention.

### Offline by construction

The default provider is the local Hermes agent. With every socket and DNS call
blocked, arithmetic, retrieval, code execution, and generation all still work.
Point `AETHERIS_LLM_PROVIDER=openai` at an upstream model if you want one — the
Hermes runtime stays available at `/v1/hermes/*` either way.

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
- **Provider abstraction** — runs out-of-the-box on the offline **Hermes** agent;
  switch to any OpenAI-compatible endpoint (OpenAI, Groq, Together, vLLM, Ollama,
  LM Studio) via environment variables.
- **Typed everywhere** — Pydantic v2 schemas, Python 3.11+ idioms, defensive error
  handling.
- **Integrated web application** at `/` — threaded chat, an eleven-stage cascade
  Inspector, a live meta-learning dashboard, 👍/👎 reinforcement, file attachment,
  command palette, and prompt library. Served by the Python process itself.
- **Branded landing page** at `/landing` with a live streaming playground,
  architecture visualization, and copy-ready API examples.
- **God Mode orchestration** — activate an expert control deck with sampling
  controls, mission profiles, local context-file mounting, execution telemetry,
  a three-agent Council workflow, a Lite-vs-Pro-vs-Ultra Model Arena, sequential
  Flow Forge recipes, intent-aware Smart Routing, persistent workspaces, live
  session analytics, cancellable runs, voice input, response refinement actions,
  session export, and a `⌘/Ctrl+K` command center.
- **Local Operations Dock** — inspect sanitized API payload previews, validate
  structured JSON responses, export response artifacts, create restorable
  workspace checkpoints, and manage a reusable local Prompt Vault.
- **Executable capabilities, not claims** — the blueprint's agentic promises are
  implemented and running:
  - **Code sandbox** — real Python execution in an isolated subprocess with CPU,
    memory, wall-clock, and network limits.
  - **Deep document search (RAG)** — dependency-free BM25 retrieval over
    chunked documents, with automatic grounding for plain chat.
  - **Autonomous agent loop** — plan → call tools → observe → self-correct,
    bounded and fully traced.
  - **Multimodal input** — OpenAI-style `image_url` content parts.
  - **Tool calling** — the full OpenAI `tools` contract, forwarded upstream or
    executed in-process.
  - **Sovereign mode** — an opt-in unrestricted expert identity.
- **Creation, not just conversation** — Aetheris produces real files, encoded
  in-process with the standard library alone (no Pillow, no ffmpeg, no GPU, no
  API key):
  - **Images** — procedural PNG synthesis across eight compositions.
  - **Video** — looping animated GIFs across eight motion styles.
  - **Audio** — 16-bit WAV melodies, chord progressions, and tones.
  - **Code** — projects scaffolded as runnable ZIPs, and snippets *executed*
    to prove they work before you are shown them.

---

## Quickstart

Requires Python 3.11+.

Requires Python 3.11+ (and Node 20+ once, to build the UI).

```bash
# 1. Create a virtual environment and install dependencies
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. Build the web UI once (static export served by Python)
cd aurion && npm install && npm run build && cd ..

# 3. Run the whole app — UI + API, one process, one port
.venv/bin/uvicorn aetheris.main:app --host 0.0.0.0 --port 8000
```

That's it. No API key, no network, no Node at runtime.

Then open:

- `http://localhost:8000/` — **the application**
- `http://localhost:8000/landing` — branded landing page
- `http://localhost:8000/docs` — interactive OpenAPI docs
- `http://localhost:8000/v1/hermes` — the Hermes runtime manifest

### Optional configuration

```bash
cp .env.example .env
```

| Variable | Effect |
|----------|--------|
| `AETHERIS_LLM_PROVIDER` | `hermes` (default, offline), `openai`, or `mock` |
| `AETHERIS_HERMES_LEARNING_ENABLED` | Set `false` for a stateless, reproducible deployment |
| `AETHERIS_HERMES_META_STATE_PATH` | Persist meta-learned state across restarts |
| `AETHERIS_LLM_API_KEY` | Only needed when using an upstream provider |

### Developing the UI

```bash
# Terminal 1 — the runtime
.venv/bin/uvicorn aetheris.main:app --port 8000
# Terminal 2 — UI with hot reload, proxying /v1 to the runtime
cd aurion && npm run dev
```

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
| `aetheris tools` | List the executable toolbelt and which tools are live. |
| `aetheris capabilities` | Show which capabilities are enabled in this process. |
| `aetheris image "<prompt>"` | Render a PNG. `--style --palette --width --height --seed` |
| `aetheris video "<prompt>"` | Render an animated GIF. `--motion --seconds --fps` |
| `aetheris audio` | Synthesise a WAV. `--mode --notation --key --scale --timbre` |
| `aetheris project KIND NAME` | Scaffold a runnable project (`--zip` for an archive). |
| `aetheris health` | In-process provider/status. `--base-url URL` probes a running server instead. |
| `aetheris serve` | Launch the HTTP API (`--host` / `--port` / `--reload`). |

### Common flags (chat / ask / stream)

```
-m, --model TIER   aetheris-lite|flash | aetheris-pro|pro | aetheris-ultra|ultra
-M, --mode  MODE   general | engineering | editorial | structured | sovereign
-a, --agent        run the agent loop: call real tools and self-correct
    --tools SPEC   expose the toolbelt ('auto' or 'none')
    --doc PATH     mount a file into the retrieval index (repeatable)
    --image PATH   attach an image for multimodal input (repeatable)
    --md           buffer the response and render it as Markdown (non-streaming)
    --no-color     disable ANSI color (global flag: `aetheris --no-color ask …`)
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

# Agentic: mount a document, then let Aetheris search it and self-correct
aetheris ask --agent --doc ./architecture.md "What does the spec say about failover?"

# Agentic: verify a computation by actually executing it
aetheris ask --agent "Compute the 40th Fibonacci number and verify it by running code"

# Multimodal: attach an image
aetheris ask --image ./diagram.png "What is wrong with this architecture?"

# Introspection
aetheris models --json
aetheris tools
aetheris capabilities
aetheris spec

# Launch the HTTP API from the same command
aetheris serve --port 8000 --reload
```

### Chat slash commands

`/model [TIER]` · `/mode [MODE]` · `/models` · `/modes` · `/agent [on|off]`
(toggle agentic tool use) · `/tools` (list the toolbelt) · `/mount PATH` (index a
file) · `/docs` (list mounted documents) · `/image PATH` (attach an image) ·
`/system` (show active system prompt) · `/info` · `/spec` · `/md [on|off]`
(toggle Markdown rendering) · `/clear` (clear history) · `/help` · `/quit`.

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
| `sovereign` | Sovereign (Unrestricted Expert) | Direct, unhedged expert output — *opt-in* |

List them with `GET /v1/modes`. `sovereign` appears only when
`AETHERIS_SOVEREIGN_ENABLED=true`; see [Capabilities](#capabilities).

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
| `tools` | `ToolDef[] \| "auto" \| "none"` | — | `"auto"` exposes the built-in toolbelt; a list forwards your own definitions. |
| `tool_choice` | `string \| object?` | `auto` | `auto` / `none` / `required` / a specific function. |
| `agent` | `boolean` | `false` | Run the autonomous loop: call tools and self-correct before answering. |
| `max_tool_iterations` | `integer?` | server default | Cap the agent's tool-calling rounds (1-12). |

Message `content` accepts a plain string **or** a list of OpenAI content parts
(`text` / `image_url`), which is what activates multimodal input.

The response envelope matches OpenAI (`chat.completion` / `chat.completion.chunk`),
with an added `mode` field for traceability. When `mode=structured`, the assistant
content is strict JSON only. Agent runs add a `tool_trace` array to the response,
and streamed agent runs emit `tool_event` chunks as each tool executes.

### Other endpoints

| Method & path | Purpose |
|---------------|---------|
| `GET /v1/models` | List Aetheris tiers (OpenAI `list` envelope). |
| `GET /v1/modes` | List the inference modes available on this deployment. |
| `GET /v1/capabilities` | Which capabilities, tools, and modes are live. |
| `GET /v1/tools` | List the executable toolbelt (OpenAI tool schemas). |
| `POST /v1/tools/{name}/invoke` | Run one tool directly, no model in the loop. |
| `GET /v1/documents` | List the mounted retrieval corpus. |
| `POST /v1/documents` | Index a document (JSON body). |
| `POST /v1/documents/upload` | Index an uploaded file (multipart). |
| `POST /v1/documents/search` | BM25 query against the corpus. |
| `POST /v1/images/generations` | Generate a PNG from a prompt. |
| `POST /v1/videos/generations` | Generate an animated GIF. |
| `POST /v1/audio/generations` | Synthesise a WAV file. |
| `POST /v1/code/projects` | Scaffold a project as a ZIP. |
| `GET /v1/artifacts` | List generated artifacts. |
| `GET /v1/artifacts/{id}` | Fetch an artifact's bytes (`?download=true`). |
| `DELETE /v1/documents/{id}` | Unmount one document (or all, without an id). |
| `GET /v1/architecture` | Foundation-model architecture spec (transformer config, modalities, optimizations). |
| `GET /v1/training` | Training pipeline + **live runtime telemetry** from the Hermes Agent + Meta-Learning pillars. |
| `GET /v1/hermes` | Hermes runtime manifest — pillars, cascade stages, learning state. |
| `POST /v1/hermes/run` | Run one task through the full 11-stage cascade (fully traced). |
| `POST /v1/hermes/cognition` | Inspect perception/intent/computation/grounding only (no tools, no learning). |
| `GET /v1/hermes/knowledge` | The built-in offline knowledge corpus. |
| `GET /v1/hermes/knowledge/search/{q}` | BM25 search over the corpus. |
| `GET /v1/hermes/meta` | Everything the meta-learner currently believes. |
| `GET /v1/hermes/meta/episodes` | Recent learned episodes. |
| `POST /v1/hermes/meta/adapt` | Preview the adaptation for a task without running it. |
| `POST /v1/hermes/feedback` | Reinforce or penalise an episode (this is what teaches it). |
| `DELETE /v1/hermes/meta` | Forget all meta-learned state. |
| `GET /v1/spec` | Combined architecture + training specification. |
| `GET /v1/identity` | Foundation-model spec + full brand identity (media-kit surface). |
| `GET /v1/health` | Liveness, version, active provider. |
| `GET /` | The web application (served from Python; falls back to the landing page if unbuilt). |
| `GET /landing` | Branded landing page (Architecture & Training sections). |
| `GET /docs` | Interactive OpenAPI docs. |

---

## Architecture & training specification

Aetheris separates *identity* (`core/branding.py`) from *how it's built*
(`core/spec.py`). The spec module encodes the foundation-model architecture and
the training pipeline with **explicit provenance** on every field:

| Evidence tag | Meaning |
|--------------|---------|
| `live` | Implemented and executing in this process — verifiable at runtime. |
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
foundation. Both pillars are **live code running in this process**, not planned
work, and the endpoint reports measured telemetry from them under `runtime`:

1. `continued_pretraining` — domain-adaptive pretraining *(scaffold)*
2. `sft` — Supervised Fine-Tuning / instruction alignment *(blueprint)*
3. `dpo` — Direct Preference Optimization / hallucination reduction *(blueprint)*
4. `agent_tuning` — agentic tool use and self-correction — **live**
   ([`aetheris/hermes/agent.py`](aetheris/hermes/agent.py))
5. `meta_learning` — learning-to-learn / few-shot adaptation — **live**
   ([`aetheris/hermes/meta_learning.py`](aetheris/hermes/meta_learning.py))
6. `evaluation` — output-fidelity & hallucination-rate gating *(blueprint)*

The pretraining and alignment stages remain descriptive scaffolds — they
describe how a model would be trained, which this repository does not do. The
two Hermes pillars are marked `live` because you can execute them.

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

## Capabilities

Aetheris ships the capabilities its blueprint advertises as working code. Every
one is introspectable at `GET /v1/capabilities` (or `aetheris capabilities`), so
a client can discover what a deployment can actually do before relying on it.

| Capability | Default | Flag | What it really does |
|------------|---------|------|---------------------|
| Tool calling | **on** | `AETHERIS_TOOLS_ENABLED` | Full OpenAI `tools` contract. |
| Agent loop | **on** | `AETHERIS_AGENT_ENABLED` | Plan → act → observe → self-correct. |
| Code sandbox | **on** | `AETHERIS_SANDBOX_ENABLED` | Isolated subprocess Python execution. |
| Retrieval (RAG) | **on** | `AETHERIS_RAG_ENABLED` | BM25 search over mounted documents. |
| Vision | **on** | `AETHERIS_VISION_ENABLED` | OpenAI `image_url` content parts. |
| Web access | *off* | `AETHERIS_WEB_ENABLED` | SSRF-guarded outbound HTTP. |
| Sovereign mode | *off* | `AETHERIS_SOVEREIGN_ENABLED` | Unrestricted expert identity. |
| Image generation | **on** | `AETHERIS_IMAGE_GENERATION_ENABLED` | Procedural PNG synthesis. |
| Video generation | **on** | `AETHERIS_VIDEO_GENERATION_ENABLED` | Animated GIF synthesis. |
| Audio generation | **on** | `AETHERIS_AUDIO_GENERATION_ENABLED` | WAV instrumental synthesis. |
| Code generation | **on** | `AETHERIS_CODE_GENERATION_ENABLED` | Runnable project scaffolds. |

Capabilities contained inside the process are enabled by default; those that
reach outside it are opt-in.

### The toolbelt

`GET /v1/tools` returns every tool in OpenAI schema form; `POST
/v1/tools/{name}/invoke` runs one directly, no model required.

| Tool | Purpose |
|------|---------|
| `code_interpreter` | Execute Python in the sandbox and return stdout/stderr/exit code. |
| `document_search` | BM25 retrieval over the mounted corpus. |
| `list_documents` | Enumerate mounted documents. |
| `calculator` | Exact arithmetic via a whitelisted AST evaluator (never `eval`). |
| `current_time` | Real clock, with optional UTC offset. |
| `validate_json` | Parse and shape-check JSON — used to self-check structured output. |
| `think` | A no-op scratchpad for explicit planning. |
| `web_fetch` | Retrieve a URL as readable text *(requires web access)*. |
| `generate_image` | Render a PNG from a description. |
| `generate_video` | Render a looping animated GIF. |
| `generate_audio` | Synthesise a WAV melody, progression, or tone. |
| `write_and_verify_code` | Write Python **and run it** to prove it works. |
| `create_project` | Scaffold a runnable multi-file project as a ZIP. |
| `list_artifacts` | List everything generated this session. |

### The agent loop

Set `"agent": true` and Aetheris runs the loop itself: it asks the model for a
completion with the toolbelt attached, executes any tool calls (independent
calls run **concurrently**), feeds the observations back, and repeats until the
model answers or the iteration budget is spent.

```bash
curl -s localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "agent": true,
    "messages": [{ "role": "user", "content": "Compute the 30th Fibonacci number and verify it by running code." }]
  }'
```

The response carries a `tool_trace` array — every call, its arguments, its
output, and its duration. When streaming, each execution arrives as a
`tool_event` chunk so a UI can render the trace live.

Guarantees: **bounded** (never exceeds `max_tool_iterations`), **non-fatal** (a
tool failure becomes an observation the model can recover from, not a 500), and
**observable** (nothing executes without appearing in the trace).

### Code sandbox

Sandboxed code runs in a separate short-lived process, never in the API worker:

- a dedicated temp directory, destroyed after the run;
- POSIX `RLIMIT` caps on CPU, address space, file size, cores, and processes;
- a wall-clock timeout that kills the whole process group;
- a scrubbed environment — no inherited API keys;
- sockets disabled by default via a guard injected ahead of user code;
- truncated output so a print-loop cannot exhaust memory.

```bash
curl -s localhost:8000/v1/tools/code_interpreter/invoke \
  -H "Content-Type: application/json" \
  -d '{"arguments": {"code": "print(sum(i*i for i in range(1, 11)))"}}'
```

### Retrieval (RAG)

Mount documents, then search them — no vector database or embedding service
required. Documents are chunked with overlap and ranked with BM25.

```bash
# Mount a document (JSON or multipart upload)
curl -s -X POST localhost:8000/v1/documents \
  -H "Content-Type: application/json" \
  -d '{"title": "Runbook", "text": "Rollback: run make rollback TAG=previous."}'

curl -s -X POST localhost:8000/v1/documents/upload -F "file=@notes.md"

# Query it directly
curl -s -X POST localhost:8000/v1/documents/search \
  -H "Content-Type: application/json" -d '{"query": "rollback", "top_k": 3}'
```

With `AETHERIS_RAG_AUTO_CONTEXT=true` (the default), even a plain chat request
is grounded: the latest user turn is used to retrieve passages that are injected
as system context, so OpenAI clients that never call a tool still benefit.
Set `AETHERIS_RAG_CORPUS_DIR` to index a directory at startup.

### Multimodal input

Messages accept OpenAI-style content parts. Images are validated (count, size,
scheme) and forwarded to a vision-capable upstream.

```json
{
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "What is wrong with this architecture diagram?" },
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
    ]
  }]
}
```

In the playground, drag in an image, paste one from the clipboard, or use the
paperclip — text files are mounted into the retrieval index, images become
vision attachments.

### Web access *(opt-in)*

`AETHERIS_WEB_ENABLED=true` activates `web_fetch`. Every request is SSRF-guarded:
scheme allowlist, DNS resolution followed by an IP check that refuses loopback,
private, link-local, reserved, and multicast ranges (including cloud metadata at
`169.254.169.254`), re-validated on every redirect hop. `AETHERIS_WEB_ALLOWED_HOSTS`
narrows it further.

### Creation: images, video, audio, and code

Aetheris produces real files. Every encoder — PNG, GIF, WAV, ZIP — is written in
pure Python against the standard library, so creation works offline, in any
deployment, with no API key, no GPU, and no ffmpeg.

Generated files are stored in a bounded in-memory artifact store and served from
`/v1/artifacts/{id}` with their true media type, so they render inline in a
browser, a Markdown preview, or the playground. **Artifacts are ephemeral**: the
oldest are evicted when the memory budget fills, and everything is lost on
restart. Download anything you want to keep.

#### Images

```bash
curl -s -X POST localhost:8000/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a serene sunset over mountain ranges", "width": 1024, "height": 576}'

aetheris image "deep space nebula" --style space --palette neon -o nebula.png
```

Aetheris is **not a diffusion model**, and it does not pretend to be one. It is a
procedural renderer that parses intent — subject, palette, mood, composition —
out of the prompt and draws the result from generative primitives. That makes it
genuinely good at abstract art, backdrops, wallpapers, gradients, posters, title
cards, and placeholder assets, and genuinely unable to produce photorealistic
scenes or specific real people. The artifact metadata says so explicitly rather
than implying a capability it lacks.

Eight compositions: `landscape` · `space` · `waves` · `particles` · `geometric`
· `spiral` · `gradient` · `poster`. Ten palettes: `aetheris` · `sunset` ·
`ocean` · `forest` · `ember` · `arctic` · `neon` · `mono` · `sakura` · `gold`,
or pass your own comma-separated hex ramp. Both are inferred from the prompt
when you do not name them.

Renders are **deterministic**: the seed is derived from the prompt, so the same
prompt always returns the same image. Pass `seed` to pin or vary it.

#### Video

```bash
curl -s -X POST localhost:8000/v1/videos/generations \
  -H "Content-Type: application/json" \
  -d '{"prompt": "orbiting planets", "seconds": 3, "fps": 12}'

aetheris video "pulsing radar sweep" --motion pulse -o radar.gif
```

Delivered as animated GIF — deliberately, because it is the only broadly
playable animated format producible without a video codec, so the result plays
inline anywhere. Eight motion styles: `orbit` · `waveform` · `pulse` ·
`starfield` · `spiral` · `bars` · `gradient` · `typewriter`. Every animation is
a seamless loop.

#### Audio

```bash
curl -s -X POST localhost:8000/v1/audio/generations \
  -H "Content-Type: application/json" \
  -d '{"mode": "melody", "notation": "C4:0.5 E4 G4 C5:2", "tempo": 120}'

aetheris audio --mode chords --notation "Cmaj7 Amin7 Fmaj7 G" -o progression.wav
aetheris audio --mode compose --key D4 --scale pentatonic --bars 8
```

Four modes: `melody` (note notation, `R` for rests), `chords` (progressions),
`compose` (auto-generate a melody by walking a scale), and `tone`. Synthesis is
additive-harmonic with an ADSR envelope across six timbres, written as 16-bit
44.1 kHz mono WAV.

**Aetheris has no text-to-speech.** It cannot speak or sing; this is
instrumental synthesis only, and the tool description says so.

#### Code

Two distinct capabilities. First, **verified snippets** — `write_and_verify_code`
runs what it wrote in the sandbox and returns the output, or a specific
diagnosis on failure:

```
language: python
verified: no
result: FAILED (exit code 1)

diagnosis: NameError: name 'totl' is not defined — A name is used before
assignment; check for typos or a missing import.
```

Second, **whole projects** — `create_project` scaffolds a runnable tree as a ZIP:

```bash
aetheris project fastapi-service invoice-api -d "Invoice service"
aetheris project cli-tool logparse --zip
```

Four kinds: `fastapi-service` (routes, Pydantic models, tests),
`python-package` (installable library with `pyproject.toml` and tests),
`cli-tool` (argparse command with a console entry point), and `static-site`
(HTML/CSS/JS). Every scaffold ships a README, tests, and `.gitignore` — and the
test suite verifies that the generated projects actually install, run, and pass
their own tests.

#### In conversation

With **Create media** enabled in the playground (or `agent: true` via the API),
Aetheris decides for itself when a request wants an artifact and generates it
mid-answer, embedding a live player in the reply:

> **You:** Create an image of a sunset over mountains, then compose a short melody to match.

Artifacts are managed at `GET /v1/artifacts`, `GET /v1/artifacts/{id}`
(`?download=true` to force a download), and `DELETE /v1/artifacts/{id}`.

---

### Sovereign mode *(opt-in)*

`AETHERIS_SOVEREIGN_ENABLED=true` adds a fifth inference mode. It removes
*stylistic* restraint — reflexive hedging, boilerplate disclaimers, and
topic-avoidance — for expert operators who want direct answers: it takes explicit
positions, engages difficult and dual-use technical material at full depth, and
replaces hedging with calibrated confidence.

It is **not** a jailbreak. Fabrication is still forbidden, the prompt keeps a
hard floor against mass-casualty weapons uplift, sexual content involving minors,
and targeted harassment, and your upstream provider's own policies still apply.
While disabled, the mode is hidden from `/v1/modes` and the playground, and
requesting it returns a `400` explaining how to enable it — it never silently
downgrades to a different identity.

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
│   └── system_prompts.py   # The production system prompts + capability directives
├── schemas/
│   ├── chat.py             # OpenAI-compatible chat, tool calls, multimodal parts
│   ├── models.py           # Model/mode introspection schemas
│   ├── tools.py            # Tool, document, and capability schemas
│   └── spec.py             # Architecture/training spec response schemas
├── media/                  # Dependency-free generation (stdlib only)
│   ├── canvas.py           # RGB raster + PNG and animated-GIF encoders
│   ├── font.py             # 5x7 bitmap font for text in images
│   ├── images.py           # Procedural image synthesis (8 compositions)
│   ├── video.py            # Frame-by-frame animation (8 motion styles)
│   ├── audio.py            # Additive synthesis -> 16-bit WAV
│   ├── code.py             # Verified snippets + project scaffolds
│   └── store.py            # Bounded in-memory artifact store
├── tools/                  # The executable toolbelt
│   ├── registry.py         # Tool registration, schema export, safe execution
│   ├── sandbox.py          # Isolated subprocess Python execution
│   ├── retrieval.py        # BM25 chunked document index (RAG)
│   ├── builtins.py         # calculator / current_time / validate_json / think
│   ├── creation.py         # image / video / audio / project generation tools
│   └── web.py              # SSRF-guarded HTTP fetch (opt-in)
├── services/
│   ├── llm.py              # Provider interface, prepare_conversation, factory
│   ├── agent.py            # The autonomous plan→act→observe→correct loop
│   ├── mock_provider.py    # Brand-aware offline provider + real tool selection
│   └── openai_provider.py  # OpenAI-compatible forwarding (tools + vision)
└── api/
    ├── routes.py           # /v1/chat/completions, /v1/tools, /v1/documents, …
    └── landing.py          # Branded HTML landing page (data-driven)
```

**Request flow:** a chat request is resolved into a `PreparedConversation` — tier
+ mode + the mode's system prompt, extended with the tool-use, agent-loop, and
vision directives whose capabilities are actually live, plus any retrieved
grounding context. It is then handed to the active `LLMProvider`, which returns
a `CompletionResult` (text *or* tool calls) or an async iterator of text deltas.
When the request is agentic, `services/agent.py` drives the loop: it executes
requested tools through the registry, appends the observations, and asks again
until the model answers or the iteration budget is spent. The API layer wraps
the outcome into the OpenAI-compatible wire format.

**Capability principle:** the model is only ever told about capabilities it
actually has. Directives are injected per-request based on the resolved
capability set, so a deployment with the sandbox disabled never sees a prompt
promising code execution — the identity and the abilities cannot drift apart.

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
.venv/bin/pytest        # 63 capability + media tests
.venv/bin/python -m compileall aetheris
```

The suite exercises the real implementations rather than fixtures: the sandbox
genuinely forks a process (including timeout and network-block assertions), BM25
genuinely ranks, the agent loop genuinely calls tools, and the SSRF guard is
tested against live metadata-endpoint addresses.

The server supports `--reload` for live editing during development.

---

## License

MIT © 2026 RAJARAM K. See [LICENSE](LICENSE).

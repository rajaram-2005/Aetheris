# Changelog

Aetheris ships on a **monthly CalVer cadence**: `YYYY.M.P`. A new minor-free monthly release goes
out at the start of every month (`2026.9.1` → `2026.10.1` → `2026.11.1` → …, rolling to
`2027.1.1` in January); hot-fixes inside a month bump the patch (`2026.9.2`).

`VERSION` at the repository root is the source of truth. The bump is done by
`node tools/bump-version.mjs` (imported by `ci/release.yml`, which runs on the 1st of each month),
and this file is written by `node tools/changelog.mjs`. Every release also ships desktop installers
for macOS, Linux and Windows — see [docs/DESKTOP.md](docs/DESKTOP.md).

<!-- CHANGELOG: new entries go directly below this line, newest first. -->

## Unreleased

- Authentication: added a hosted access gate with sealed-session middleware validation, protected API `401` responses, safe post-login redirects, Google/GitHub OAuth, and a display-name-only guest session whose owner-scoped data stays private to that browser.
- Characters: added an owner-scoped persistent character creator, CRUD API, character-aware chat history, and a dedicated browsable UI with separate roleplay and educational guide modes.
- Curated 16 source-aware deity interpretations across Hindu, Greek, Norse and Egyptian traditions, with visible creative-interpretation labeling and safeguards against invented scripture, supernatural claims and divine commands.
- Deployment: Vercel/serverless dropped as a supported target (no persistent disk, no long-lived
  process, build-image install-script skips). Docker and always-on container hosts are now the
  documented path, with ready blueprints in `deploy/` (`render.yaml`, `fly.toml`, `deploy/README.md`).
- Vercel removed from the product: the Vercel gateway API definition and MCP catalog connector are
  gone (106 connectors, 111 gateway tools), along with its mentions in agent skills, docs, guides,
  evals and tests. Counts in README/docs updated.

## 2026.9.2 — 2026-09-04

### desktop

- add homepage to package.json for electron-builder deb/rpm
- fix a non-existent settings path, register the app in the capability registry
- harden deep links, fix the macOS menu, document the app in-app
- fix window navigation, load keys from the data dir, test the main process
- macOS/Linux/Windows app + a monthly CalVer release pipeline

### release

- fix the desktop build so both release workflows can finish

### ci

- move Actions to the Node-24 majors to clear the deprecation warning
- typecheck the Electron shell against real electron types; repoint workflow tests at .github
- enable the workflows
- document that both release workflows reference the composite action path
- keep workflow under ci/ (app lacks workflows permission)

### other

- Delete .github/workflows
- Create workflows
- Delete .github/workflows
- Create workflows
- Keep the root build from type-checking the Electron entry points
- Execute page JavaScript and sample video frames without a host binary
- Recover the data behind JS-rendered pages; record why the binaries stay optional
- Persistent telemetry and offline semantic embeddings
- Implement the verification engine, workspace sharing and dependency-free video
- Add files via upload
- Join old and new: hub tools now pass execution policy (+_confirmationToken), unified knowledge query (fabric + document KBs) in /api/knowledge, /api/chat and /api/agents/run, Metis lessons → procedural memory, legacy workflows/factory/media/research traced as events; tests 108
- Phase 22: docs — README as Intelligence OS with honest status matrix, ARCHITECTURE as-built diagram + phase ledger 1–22, docs consistency test (API.md routes exist), SECURITY pointer
- Phase 21: plugin SDK (definePlugin, /api/plugins, example unit-convert, tests), aetheris-bridge daemon, docs: HARDWARE ROBOTICS SECURITY MODELS AGENTS MCP KNOWLEDGE MEMORY RESEARCH API DEVELOPMENT PLUGIN_SDK CONTRIBUTING; webhook secret timing-safe compare
- Phase 21: API-first gaps — /api/workspaces (+core/workspaces), /api/tools callable view, Control Center workspaces+tools tabs, registry entry, test
- Phase 20: deployment — Dockerfile, compose, /api/health, docs/DEPLOYMENT.md, env reference
- Phase 19: perf — mtime-keyed store read cache (5x faster reads), perf budget tests
- Phase 18: evaluation harness (intent/policy/sandbox/retrieval benchmarks with thresholds), CI workflow (typecheck+test+eval+build), intent rule improvements found by evals
- Phase 17: security — guard module (rate limit, SSRF/DNS check, redaction, audit export), edge middleware (headers + per-IP limits), SSRF checks wired into MCP/automations/devices/browser, event scrubbing
- Phase 16: Control Center — jobs, executions, MCP servers, knowledge/memory, devices, twins, robots, automations, browser panels; token issue endpoint; stopAction policy; fix prod build (route exports)
- Phase 15: automation engine — cron/webhook/device/twin/job triggers, expression or rubric conditions & verification, actions (webhook/email/remember/twin event/job/actuate), per-stage runs; /api/automations
- Phase 14: robotics (rosbridge client + safety-governed RobotAgent, /api/robots) and digital twins (sync, bounds, rule simulation DSL, health, /api/twins); mock ws server test helper
- test typing
- Phase 13: Physical AI layer — device registry, http/mqtt/modbus adapters (dependency-free protocol clients), telemetry, safety policy loop with interlocks/E-stop, physical opt-in; /api/devices
- Phase 12: browser agent — http engine (snapshot/follow/submit/extract, robots, deny private nets), optional playwright, permission-gated; /api/browser
- sensor flat trend fix
- Phase 11: multimodal perception entry point (image/document/audio/video/sensor) with honest availability; /api/multimodal
- Phase 10: research engine — keyless academic sources, dedupe, citation graph, claim extraction, contradiction detection; /api/research/academic
- fix hotspot root exclusion
- Phase 9: GitHub Repository Intelligence — repo map, architecture brief, PR review, issue triage, incremental patch→PR; /api/github/repos/intel
- Phase 8: knowledge fabric (SQLite FTS5 + local/provider vectors + entity graph + temporal supersession, provenance) and typed memory system; /api/knowledge, /api/memory; auto-recall in chat; tests
- Phase 7: MCP gateway — user-registered servers, manifest/versioning, health sweeps, schema validation, permission classification; tests for policy/sandbox/gateway
- Phase 4–6: task-aware model router (ModelPolicy: coding/reasoning/long-context/multilingual/tools, locality local/prefer_local/remote, context fit; local providers Ollama/LM Studio/vLLM), agent runtime with background jobs (budgets, timeouts, checkpoints, cancel, retry, SSE) at /api/jobs, server-side process sandbox (temp workspace, scrubbed env, SIGKILL timeout, allow/deny policy, unshare network isolation, fs-change tracking, audit) at /api/executions gated by full_workspace confirmation
- Intelligence OS core (Phase 1–3 + Control Center): repository audit + architecture/roadmap doc; Capability Registry (373 capabilities from models/agents/connectors/platform sources with honest status, permissions, reliability, search API); execution policy (read_only→admin + isolated physical, single-use confirmation tokens, audit); observability event bus instrumented into router/orchestrator/MCP hub/schedules; local intent→capability router with @agent//mode override; provider-independence interfaces; Physical-AI/robotics/twin contracts + tested deterministic safety policy (NOT AVAILABLE, no mocks); 🎛️ Control Center mode; APIs /api/capabilities /api/intent /api/telemetry /api/permissions; tests 84 pass
- Scheduled automations: cron engine (5-field, tz-aware, presets, 15-min floor), agent-prompt or workflow tasks, share-link/email/webhook delivery, run history, claim-before-run tick with in-process ticker + /api/schedules/tick for external crons (CRON_SECRET); ⏰ Schedules mode + /schedules; docs + README + .env.example; tests (79 pass)
- Chat with documents: per-user knowledge bases (PDF page-aware, DOCX zip reader, CSV row-aware, HTML, text/code, URL, paste), heading-aware chunking, BM25 retrieval, [D#] citations in chat with doc/page/section chips, 📁 Docs mode + /docs command, retrieval tester; API /api/kb/*; docs + README; tests (75 pass)
- Voice mode: hands-free overlay with orb/level meter, 18 recognition languages (auto-follows UI language), streaming sentence-by-sentence browser TTS or Studio TTS, barge-in, auto re-listen, voice-tuned system prompt (chat + agents routes); /voice command; docs + README; tests (71 pass)
- Study mode: adaptive quizzes & flashcards with SM-2 spaced repetition — tutor-agent card generation (flashcard/MCQ/cloze/short, adaptive to failures), review sessions with keyboard grading, typed-answer grading, progress (stages, retention, heatmap, streak); API /api/study/*; 🎓 sidebar mode + /study; docs; tests (67 pass)
- Explained AI: 46-concept knowledge base (foundations, how LLMs work, limits, agents/RAG, explainability, ethics, governance incl. DPDP/EU AI Act, using AI well) with analogies, misconceptions and try-it prompts; 📚 Learn view + /learn; /docs/concepts + per-concept pages; GET /api/concepts; grounds Explainer/Ethicist; 5 gallery recipes; tests (64 pass)
- AI ethics & explainability: 3 new agents (AI Ethicist, AI Explainer, Fairness Auditor), /explain endpoint + per-message 'explain' link, /ethics command, docs/ethics guide, 10 gallery recipes, tests (61 pass)
- Gallery seed: +109 recipes (gaming & entertainment, social & relationships, safety & security, using AI well) → 705 across 26 domains; collision-proof seed ids
- Gallery seed: +150 recipes (engineering, students, presentation/speaking, arts, industry playbooks) → 533 across 21 domains; tags ordered by frequency with 'more' toggle
- Gallery search: relevance ranking (whole-word > prefix > substring; title > tags/agents > description > prompt; multi-term AND) + tests
- Gallery seed: +132 recipes (career, language, productivity, creative, data/ML) → 383 across 16 domains
- Gallery seed: +118 recipes (finance, legal, health, science, design) → 251; stable ids for non-Latin titles
- Docs site (/docs) generated from live catalogs + 133-recipe gallery seed
- 99-agent roster (70 new specialists), @mention/slash picker, Workflows engine + UI with templates, Debate mode
- Live collaborative rooms (SSE + polling, shared AI replies), prompt/agent gallery mode, i18n (English/Tamil/Hindi)
- Cloud sync for accounts, public share links (/s/:id) with continue-in-Aetheris, PWA manifest + service worker
- Free for everyone: all features unlocked, no metering or payments by default (AETHERIS_PAID_PLANS=1 re-enables billing)
- Move CI workflow to docs/ci.yml (token lacks workflows scope)
- Wire accounts into plans/settings UI; open-source scaffolding (CI, CONTRIBUTING, SECURITY, CoC, templates, package metadata)
- Admin accounts: founder email/phone sign-in gets God Mode, unlimited credits and /admin access
- Aetheris Hub: all 107 MCP connectors behind one Streamable-HTTP MCP server (/api/mcp/hub) with namespaced tools, discovery meta-tools, lazy remote tool lists, sealed per-user credentials, API-key auth for external MCP clients; 'Enable all' card in Apps; hub option for /api/v1 and in-app agents; 40 tests
- Connect everything: unified credit ledger with per-feature kinds + history (chat/agents/research/arena/factory/media/api), pre-check before charging, priority routing enforced for paid plans, Enterprise Factory gate + custom repo, video/factory 402→upgrade in UI, Plan & usage tab, admin subscribers/MRR + manual plan changes, agent quick-starts, Markdown export, keyboard shortcuts; 38 tests
- Combine agents and models: each Aetheris model tier carries its agent policy; model picker drives Prime routing (Direct toggle), model→agent flow matrix on Agents page
- Agent hierarchy: Aetheris Prime (ultra), Hermes + Metis (god), 26 sub-agents; orchestrator with plan/pipeline/parallel, meta-learning lessons, Agents page, @mentions
- Key links: never navigate the iframe (provider pages forbid framing); new tab or copy
- Key links: fall back to top-level navigation when popups are blocked
- Expand provider mesh to 27: keyless Pollinations/LLM7 tier 0, 10 new free-key providers, key URLs + free-tier notes on Providers page
- Fix scrolling: lock viewport, make message pane the scroller; fix .app class collision with connector cards
- One Chat: Model Arena compare, voice mode, in-browser code interpreter
- One Chat: streaming, multi-chat sidebar, vision, Artifacts panel, web search w/ citations, Deep Research, Projects, Memory
- MCP catalog: live-check every remote endpoint; fix PayPal/Box/AlphaVantage paths; move Docker Hub, Cashfree, Fetch, Vercel to gateway
- MCP store: real endpoints for every connector, OAuth 2.1, built-in REST→MCP gateway
- Phases 3-5: Multimodal Studio, MCP App Store, UPI monetisation
- Phase 2: GitHub Coding Factory
- Aetheris One: chat UI + 15-provider omni-router with failover
- Initial commit

### accounts

- Google/GitHub/email/phone sign-in with identity linking, /login page, sidebar account chip

### gallery

- world seed — 63 writing recipes written natively in 40+ languages (Indian, European, Middle East/African, East & SE Asian) + multilingual craft recipes → 596 total

### layout

- replace 3-column grid with flex shell; rails overlay on narrow windows so the app always keeps full width
- full-bleed panes, wider chat measure (1100px), narrower sidebar

### plans

- Free/Lite ₹200/Pro ₹500/Pro Max ₹1500/God Mode ₹4000 with per-plan credits, model tiers aetheris-free…god (routing policy + Metis critique), personal sk-aeth API keys with OpenAI-compatible /api/v1, plan gating for agents/research/keys, 5-tier upgrade UI, model picker

### providers

- key links survive sandboxed iframes (open or copy + show URL)
- dedicated full-page tab in sidebar with all 15 providers, key links and setup steps; inline mesh panel kept in chat

### research

- dedupe by doi id

### router

- explain sandbox/no-egress failures distinctly from provider failures

### ui/ux

- sidebar mode navigation, full-width Factory/Studio/Apps panes, redesigned chat (avatars, code chrome, hero, composer)

---

## 2026.9.1 — 2026-09-04

### javascript & video without a host binary

Two features previously reported as impossible on a host with no downloadable binaries now run
in-process. The earlier audit was wrong about both, and the correction is recorded in
`docs/ARCHITECTURE.md` with the measurements that overturned it.

- **Page JavaScript executes.** `jsdom` (38 packages, 8.4 MB, no binary download) is a third browser
  engine, chosen automatically between `playwright` and `http`. A shell containing only
  `<div id="root">` plus an inline script now yields the rendered document rather than an empty one,
  and `Snapshot.jsExecuted` records that the scripts actually ran
- jsdom's script sandbox is a `vm` context — isolation for accidents, **not** a security boundary.
  So every subresource passes the same SSRF gate as navigation (`subresourceAllowed()`, unit-tested
  against cloud metadata, loopback and RFC1918), and cross-origin scripts are refused unless
  explicitly allowed. `js: false` reads markup only
- `snapshot()` takes a `jsRan` flag. The shell heuristic is a guess over markup and still matches a
  genuinely short page after rendering, so the flag — not the shape of the HTML — decides whether the
  text is the shell or the content
- **Video frames are sampled by ffmpeg-as-WASM.** `@ffmpeg/core` (ffmpeg 5.1.4, Emscripten) ships
  entirely in an npm tarball. Three shims make it load in Node: `self` *and* `location.href` (the
  glue reads `self.location.href` for `scriptDirectory`), `wasmBinary` from `fs` (otherwise it tries
  to `fetch` the wasm and fails offline), and one worker per invocation (a real transcode ends in
  `exit()`, after which every later `exec()` throws `Aborted()`)
- Each job runs in a `worker_thread`, is killed at a timeout, and never touches the real filesystem —
  bytes in, bytes out. Video now has four paths, best available first, reported as `via`: host
  `ffmpeg` → `ffmpeg-wasm` → provider inline video → container metadata
- The package specifier is assembled at runtime; webpack otherwise resolves
  `require.resolve("@ffmpeg/core/wasm")` statically and tries to bundle the 62 MB wasm as JavaScript
- `GET /api/multimodal` status reports `wasm`/`wasmVersion`, and `GET /api/browser` reports `jsdom`
  plus the engine actually in use. Tests: **182**

### telemetry

- Events are written to a durable SQLite log (`data/telemetry.sqlite`, `node:sqlite`, zero deps) as
  well as the in-memory ring buffer, capped at `AETHERIS_EVENT_MAX` (default 50 000); the tail is
  restored on boot, so telemetry survives a restart
- Secrets are redacted before either copy is written — verified by reading the durable copy back from
  a second process
- `AETHERIS_EVENT_PERSIST=0` runs memory-only; a database that cannot be opened degrades silently
  instead of breaking the request that emitted the event

### knowledge

- Offline **semantic** embeddings: Random Indexing over your own corpus (`src/core/knowledge/semantic.ts`),
  persisted in the knowledge DB. Measured on a nine-sentence corpus, `cosine("kitten","cat")` is 0.863
  with the trained model and 0.000 with the lexical hash — which is why a vector search for
  "kitten blanket" now returns a fact about a *cat*
- Every stored vector is tagged with its `vec_space`, so vectors from different embedders are never
  compared; `reindexEmbeddings()` migrates rows, and `AETHERIS_SEMANTIC=0` stays lexical
- `fabricStatus()` reports which embedder is live, how much the corpus has taught it, and the row
  count per space

### browser

- A page that "needs JavaScript" is usually not empty: Next, Nuxt, Remix, SvelteKit, Angular Universal
  and Vue SSR serialise the data that rendered it into a `<script>` tag. `extractEmbeddedData()`
  recovers those payloads (plus JSON-LD and `<noscript>`) and folds them into the snapshot text, so
  the http engine now reads a Next.js pricing page instead of reporting an empty shell
- Only `JSON.parse` is ever used — page JavaScript is never evaluated (there is a test for that), and
  React elements, hashes, data URIs and CSS are filtered out rather than passed off as content

### tests

- `tests/telemetry.test.ts` (4, including a cross-process restart proof), `tests/semantic.test.ts` (6)
  and four SSR-recovery cases in `tests/multimodal.test.ts`; suite is 174 tests

### verification

- Verification engine (`src/core/verification/verify.ts`): JSON-schema validator (no dependency, malformed schemas reported as `schemaOk:false`), independent reviewer gate, and a test loop that runs a command in the execution sandbox and feeds the failure back to a revise pass
- The reviewer is routed away from the generator's provider (`ModelPolicy.avoidModels` / candidate filtering) and reports `independent:false` when a second provider could not be found, instead of claiming independence
- `GET/POST /api/verify` — `kind: "schema" | "review" | "tests"`; the test loop is `full_workspace` and needs a confirmation token, exactly like `/api/executions`
- Automations gained `verify.kind: "schema"` and `verify.kind: "tests"` (with a stored `executionToken`), so a run can be gated on a real command rather than a model saying PASS
- The sandbox command splitter is now quote-aware: `node -e "a(); b()"` was being refused as `binary not allowed: b()`

### workspaces

- Workspace sharing: owner adds other accounts as `editor` or `viewer` (`/api/workspaces/:id/members`, 25 max, every change audited as a `permission` event)
- `readableScopes()` is the single place read access is decided; `/api/knowledge?workspace=…` resolves through it, so a member reads the owner's scope and an unshared scope is a 404
- Sharing is read-only by design and the default workspace cannot be shared (it holds the user's unscoped data)

### multimodal

- Video no longer requires ffmpeg: an inline-video model (Google AI Studio) takes the file directly, and `ProviderConfig.video` keeps video off providers that would 400 on it
- New pure-JS ISO-BMFF reader (`src/core/multimodal/container.ts`): duration, resolution, codec, rotation, creation time, track layout and embedded cover art — no binary, exercised against a hand-built box tree
- With neither path available the container facts are still returned, with `frames: 0` and an explicit reason

### browser

- JS application shells are detected (`needsJs`) and reported to the agent, so a client-rendered page is no longer described as if its empty shell were the content

### tests

- `tests/verification.test.ts` (15) and `tests/multimodal.test.ts` (8); suite is 160 tests
- Fixed a flaky assertion in `tests/apikeys.test.ts`: tampering with a key by appending `"x"` was a no-op whenever the random base64url key already ended in `x` (roughly 1 run in 16), which failed the whole suite
- Sharing only accepts a real 32-hex user id, and a missing workspace id is a 404 rather than a crash

### desktop

- Aetheris desktop app (Electron): embedded loopback server or remote server, macOS/Linux/Windows packaging
- Boot/connection shell, tray, deep links (`aetheris://`), redacted log, GitHub release update check
- Provider keys in `<userData>/data/.env.local` are injected into the embedded server (a shell export never reaches a Finder-launched app)
- Navigation policy extracted and unit-tested: in-app links stay in the window, everything else goes to the system browser
- `tests/desktop.main.test.ts` runs the compiled main process against a stubbed `electron` module
- Deep links accept only the unambiguous `?path=` form and reject protocol-relative, backslash, absolute-URL, encoded-`//` and control-character paths
- One app menu on macOS (was duplicated by `role: "appMenu"` plus a same-named menu), and every role menu now has a label
- In-app docs: a "Desktop app" guide under Developers
- Connection settings are reachable from the app menu and the tray (the old hints pointed at a "Settings → Connection" screen that does not exist in the web UI)
- `desktop:app` and `desktop:embedded-server` registered in the Capability Registry with honest status

### release

- Monthly CalVer release pipeline: `VERSION`, `tools/bump-version.mjs`, `tools/changelog.mjs`, `ci/release.yml`
- `GET /api/version` and a desktop-aware loopback Host allow-list in the edge middleware

---

## Earlier

Everything before `2026.9.1` shipped as `0.1.0` — see the product-history table in
[README.md](README.md#product-history-all-still-shipped) and the phase-by-phase audit in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

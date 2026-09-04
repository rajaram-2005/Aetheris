# Changelog

Aetheris ships on a **monthly CalVer cadence**: `YYYY.M.P`. A new minor-free monthly release goes
out at the start of every month (`2026.9.1` → `2026.10.1` → `2026.11.1` → …, rolling to
`2027.1.1` in January); hot-fixes inside a month bump the patch (`2026.9.2`).

`VERSION` at the repository root is the source of truth. The bump is done by
`node tools/bump-version.mjs` (imported by `ci/release.yml`, which runs on the 1st of each month),
and this file is written by `node tools/changelog.mjs`. Every release also ships desktop installers
for macOS, Linux and Windows — see [docs/DESKTOP.md](docs/DESKTOP.md).

<!-- CHANGELOG: new entries go directly below this line, newest first. -->

## 2026.9.1 — 2026-09-04

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

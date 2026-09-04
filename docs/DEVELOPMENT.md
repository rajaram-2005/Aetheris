# Development

## Setup

```bash
git clone https://github.com/rajaram-2005/Aetheris && cd Aetheris
npm ci                      # Node 22 required (node:sqlite)
cp .env.example .env.local  # optional keys; keyless providers work without any
npm run dev                 # http://localhost:3000 (binds 0.0.0.0)
```

## Scripts

| Command | What |
|---|---|
| `npm run dev` / `build` / `start` | Next.js 15 App Router |
| `npm run typecheck` | `tsc --noEmit` — must be clean |
| `npm run lint` | `next lint` |
| `npm test` | `tsx --test tests/*.test.ts` — node:test + node:assert/strict (103 tests, ≈15 s) |
| `npm run eval` | `evals/run.ts` — intent routing, policy, sandbox policy, retrieval; thresholds enforced |
| `npm run verify:connectors` | probes connector endpoints (needs egress) |
| `npm run desktop:dev` | `next dev` + the Electron shell pointed at it (hot reload) |
| `npm run desktop:build` | standalone server → `desktop/resources/server` → unpacked desktop app |
| `npm run desktop:dist` | installer artefacts for the current OS (`.dmg` / `.AppImage`+`.deb`+`.rpm` / `.exe`) |
| `npm run icons` | regenerate the desktop icons from `public/icon.svg` (needs `sharp`) |
| `npm run version:bump` | next CalVer (`-- --patch`, `-- --set 2027.3.1`, `-- --dry-run`) |
| `npm run changelog` | write the CHANGELOG section for the version in `VERSION` |
| `bash tools/release.sh` | verify → bump → changelog → commit → tag → push (`--no-push` to stop early) |

CI (`ci/github-actions-ci.yml`): typecheck → test → eval → build. The monthly release lives in
`ci/release.yml` (cron `30 3 1 * *`). Copy them to `.github/workflows/` in your fork — see
`ci/README.md`, which explains why they are not already there.

## Layout

```
src/
  app/api/**            typed API routes (route files export handlers only)
  app/                  pages
  components/           UI areas (Chat, Agents, Factory, Studio, Apps, Docs, Study, Workflows, Schedules, ControlCenter…)
  core/                 Intelligence-OS core (no UI, no Next imports)
    capabilities/       registry, types, sources (every subsystem registers here)
    policy/             permissions, confirmations, decisions
    observability/      event bus, summaries, redaction
    intent/             universal command → plan
    agents/             background job runtime
    execution/          server sandbox
    mcp/                gateway for user MCP servers
    knowledge/ memory/  fabric (SQLite) + typed memory
    research/ github/ browser/ multimodal/
    physical/ robotics/ twins/ automation/ workspaces/
    security/           guard: rate limits, SSRF, redaction, audit export
    providers/          provider-independence interfaces (Model/Retrieval/Storage/Execution/Browser)
  lib/                  original subsystems (router, agents catalog, kb, mcp hub, media, schedules, auth, store)
tests/                  node:test suites (+ fixtures, helpers, mock servers)
evals/                  cases.json + run.ts
bridge/                 aetheris-bridge serial daemon
desktop/                Electron app: src/main.ts, src/preload.ts, src/lib/* (all unit-tested),
                        src/renderer/boot.html, scripts/, buildResources/, package.json (electron-builder config)
tools/                  release tooling: bump-version.mjs, changelog.mjs, release-notes.mjs,
                        gen-icons.mjs, desktop-build.mjs, release.sh
ci/                     GitHub Actions: ci, the monthly release, the desktop build action
docs/                   this documentation set
```

The desktop app keeps its decision logic in `desktop/src/lib/*` — CalVer, settings sanitising, the
embedded-server supervisor, update checking, log redaction — and `desktop/src/main.ts` is thin glue
over Electron. That is what makes it testable: `tests/desktop.test.ts` exercises every one of those
modules without launching Electron, and `tests/desktop.embedded.test.ts` boots the real standalone
bundle the way the app does (it skips itself when `desktop/resources/server` has not been built).

Dependency rule: `core/*` may import `lib/*` and other `core/*`; `lib/*` must not import `core/*` except through `core/security/guard` and `core/observability/events` (leaf modules). UI imports neither directly — it calls `/api`.

## Conventions

* **Honest status**: every capability declares `status` ∈ implemented · partial · experimental · mocked · not_available and `verification_status` ∈ verified · untestable_here · unverified. If you cannot exercise something, say `untestable_here` — never return synthetic data. The only simulated adapter (`device.adapter = "simulated"`) tags every reading `_simulated: true`.
* **Permission before action**: any route that mutates shared state or the physical world calls `authorize()` and records the decision.
* **Every user URL through `ssrfCheck`**, every outbound event through `record()` (redacted).
* **No secrets in prompts**; providers read keys from env or the per-user encrypted store only.
* **Node 22 typing**: `let buf: Buffer = Buffer.alloc(0)` when accumulating.
* **Route files** export only handlers/config (Next.js constraint). Shared logic lives in `core/` or `lib/`.
* **Tests**: relative imports (`../src/...`), no top-level `await` (tsx compiles tests as CJS), set `AETHERIS_DATA_DIR` to a temp dir when touching the store.
* Delete `data/` artefacts before committing (`data/` is git-ignored but tests may write to `./data` if the env var is unset).

## Adding a capability (the one workflow that matters)

1. Implement it in `src/core/<area>/` behind a small interface.
2. Register it in `src/core/capabilities/sources.ts` (or via a `CapabilitySource` in a plugin — see `docs/PLUGIN_SDK.md`) with schemas, `security_level`, `requires_confirmation`, `status`, `verification_status`.
3. Expose a typed route under `src/app/api/<area>/` that calls `authorize()` and `record()`.
4. Add a test in `tests/` and, if the planner should pick it, an intent case in `evals/cases.json`.
5. Add a panel/tab in Control Center if it needs operator visibility.
6. Document it (status table) in the relevant `docs/*.md`.

## Debugging

* `GET /api/telemetry?errors=1` — last errors with capability ids and latency.
* `GET /api/capabilities?status=not_available` — what is not configured on this host.
* `GET /api/devices` → `adapters` — which physical adapters this host supports.
* `GET /api/browser`, `GET /api/multimodal`, `GET /api/executions` — engine availability (playwright, ffmpeg, unshare…).

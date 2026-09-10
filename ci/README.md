# CI and releases

The GitHub Actions workflows live in `.github/` (this folder keeps only documentation):

| File | Trigger | Does |
|---|---|---|
| `.github/workflows/ci.yml` → **verify** | every push / PR | `typecheck → desktop typecheck → test → eval → build`, plus a step that fails the job if the build emitted *any* warning. `desktop/` is installed with `ELECTRON_SKIP_BINARY_DOWNLOAD=1` so the Electron shell is typechecked against the real `electron` types without pulling binaries |
| `.github/workflows/ci.yml` → **security** | every push / PR | `npm audit --audit-level=high` against both trees (root and `desktop/`), straight from the committed lockfiles. Both are currently clean, so this is a ratchet: a new high/critical advisory fails the build instead of being discovered during a release |
| `.github/workflows/ci.yml` → **desktop-runtime** | every push / PR | installs the real Electron binary and runs `xvfb-run npm run smoke` in `desktop/` — see *The desktop smoke test* below |
| `.github/workflows/release.yml` | **cron `30 3 1 * *`** (03:30 UTC on the 1st of every month) + manual | verify → bump the CalVer → write the CHANGELOG → commit, tag `v<version>`, push → open the GitHub Release → build and attach the desktop installers |
| `.github/workflows/release-desktop.yml` | manual | rebuild the macOS/Linux/Windows installers for an existing release |
| `.github/actions/build-desktop/` | — | composite action: install → `next build` (standalone) → stamp the version → `desktop/resources/server` → `tsc` (`desktop/src` → `desktop/dist`) → `electron-builder` on the current runner's OS |

The `desktop/` tree is excluded from the root `tsconfig.json` program on purpose: the Next.js
build must never compile `main.ts`/`preload.ts`, and the root program has no `electron` module.
The desktop project therefore typechecks itself with its own `tsconfig.json` — CI runs it, and
so can you (`npm run desktop:typecheck` from the root).

## Three things CI does that a laptop does not

* **`node --test` runs test files in parallel on the runner, and serially on a 2-core machine.**
  Concurrency follows the CPU count, so `ubuntu-latest` (4 cores) executes three test files at a
  time. Every test file is its own process, so any state they share — a file, a port, a database —
  is a race that only appears on the runner. This is not hypothetical: it is what made `npm test`
  fail on GitHub while passing locally, and the fix was to make the two SQLite-backed stores
  (`src/core/observability/events.ts`, `src/core/knowledge/fabric.ts`) resolve `AETHERIS_DATA_DIR`
  when they are *used* instead of at import time. A module-load-time read froze the variable, so
  every test process wrote into one shared `data/*.sqlite` and a parallel file's telemetry landed
  inside another file's `{ sinceMs }` window. `tests/data-dir-isolation.test.ts` guards it, and
  `npm test -- --test-concurrency=4` reproduces the old failure locally.
* **The test step writes a log and annotates its own failures.** `npm test` pipes into
  `tee /tmp/test.log` under `set -o pipefail` (without `pipefail` the step's exit code would be
  `tee`'s and a failed suite would pass), and an `if: failure()` step re-emits the runner's
  `# tests/pass/fail/skipped` summary and each `not ok` line as an `::error::` annotation. Run logs
  are not always retrievable; annotations are, so a failing test is named on the job page instead of
  being inferred.
* **The runner has internet; a laptop with restricted egress does not.** The suite must therefore be
  hermetic, and it now is — enforced, not assumed. `tests/hermetic.mjs` blocks outbound `fetch` in
  every test process (the `test` script passes it with `--import`, which `node --test` forwards to
  each file it runs). Before that existed, nine test files called real keyless LLM providers and
  `tests/warroom.test.ts` alone made 286 outbound calls: with no API keys set the router still
  reaches for community providers, and each attempt may burn the whole `AETHERIS_PROVIDER_TIMEOUT_MS`
  (**45 s** by default). Where egress is restricted every attempt fails in milliseconds and the file
  finishes in under a second; on a runner with real internet the same file blew past
  `--test-timeout=120000` and failed as `testTimeoutFailure`. `tests/hermetic.test.ts` fails if the
  guard is ever dropped. Loopback is still allowed — several suites talk to a real local server.
* **`--test-timeout=120000` bounds any hang to two minutes**, named, instead of a runner burning an
  hour.

## One follow-up this work surfaced but did not change

A War Room debate is up to nine model calls, and each one may retry several providers at up to 45 s
apiece, so a single debate can keep an HTTP request open for minutes on a machine that can reach the
internet but cannot get an answer. Bounding that is a product decision (a per-debate deadline
threaded through `runDebate`'s existing `signal`), not a CI fix, so it is left alone here — but the
45 s default is worth a look on its own.

## The one known CI limit, stated plainly

* **`tests/desktop.main.test.ts` does not run in CI.** It executes the real compiled
  `desktop/dist/main.js` against a stubbed `electron` module, and skips itself when `desktop/dist`
  is absent. Emitting `dist` in CI was tried: on a GitHub runner `npm test` burned 47 minutes before
  the job was killed, while the same suite finishes in about a minute with `dist` absent. The cause
  is still not diagnosed — but it is *not* that the test is slow or broken in itself: with
  `desktop/dist` compiled it passes locally in under a second. What is known is that it binds a
  loopback HTTP server and drives the real main process through it, so the runner's networking is
  the next place to look. Until then the coverage stays off rather than main being blocked on a hang
  nobody understands. It runs locally whenever you have compiled the desktop app
  (`cd desktop && npm run compile`), which `npm run desktop:build` does. Turning the compile step
  back on in `verify` is the follow-up.

## The desktop smoke test

`desktop/src/smoke.ts` is a second Electron entry point that exists to be run, not shipped
(`desktop/package.json` excludes `dist/smoke.js` from the packaged app). It boots the real binary,
creates a `BrowserWindow` with the **same** `webPreferences` as `main.ts`, loads the real
`preload.js`, and asserts four things from inside the renderer:

1. Electron boots and a sandboxed window can load a page.
2. `contextBridge` exposes `window.aetherisDesktop` with exactly the documented surface — no missing
   member, and nothing undocumented added.
3. An `ipcRenderer.invoke("aetheris:info")` round-trip works and reports the version of the binary
   that is actually running.
4. Renderer isolation still holds: no `require`, `process`, `Buffer`, `global`, `module` or
   `electron` reachable from the page.

Typechecking an Electron major only proves the *type* surface still matches; it cannot tell you
whether the binary boots or whether the sandbox still isolates. That gap is why `desktop-runtime`
exists — an Electron upgrade is gated on running it, not on compiling against it.

## The monthly version cadence

Aetheris releases every month on CalVer `YYYY.M.P`:

```
2026.9.1  →  2026.10.1  →  2026.11.1  →  2026.12.1  →  2027.1.1   (monthly, patch resets)
2026.9.1  →  2026.9.2                                              (hot-fix inside a month)
```

`VERSION` at the repository root is the source of truth; `tools/bump-version.mjs` copies it into
`package.json`, `desktop/package.json` and `public/manifest.webmanifest`. Do the same thing by hand
with `npm run version:bump` (add `-- --patch` or `-- --set 2027.3.1`), or run the whole release with
`bash tools/release.sh`. `tests/desktop.test.ts` fails if the copies drift apart or if the schedule
stops being monthly.

## Running the checks locally

```bash
npm run typecheck && npm test && npm run eval && npm run build   # what CI runs
npm run desktop:typecheck                                        # the Electron shell, against real electron types
bash tools/release.sh --no-push                                  # a release, stopped before pushing
npm run desktop:build                                            # unpacked desktop app for smoke-testing
```

If `npm run desktop:typecheck` complains that `tsc` is missing, run the install inside `desktop/`
first — its dependencies (including `electron`'s bundled types) are not installed by the root install:

```bash
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci                     # bash / zsh
$env:ELECTRON_SKIP_BINARY_DOWNLOAD=1; npm ci               # PowerShell
```

Compiling and typechecking need no Electron binary; packaging a real installer does not need the
`node_modules/electron` one either, because `electron-builder` downloads the distribution it packages
itself. The variable has to be a real environment variable — `electron`'s `install.js` reads
`process.env.ELECTRON_SKIP_BINARY_DOWNLOAD`, so a `"config"` block in `package.json` (which npm only
exposes as `npm_config_*`) does **not** skip the ~100 MB download. CI and the build action set it
explicitly; if you skip it locally you simply wait for the download once.

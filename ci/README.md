# CI and releases

The GitHub Actions workflows live in `.github/` (this folder keeps only documentation):

| File | Trigger | Does |
|---|---|---|
| `.github/workflows/ci.yml` → **verify** | every push / PR | `typecheck → desktop typecheck → desktop compile → test → eval → build`, plus a step that fails the job if the build emitted *any* warning. `desktop/` is installed with `ELECTRON_SKIP_BINARY_DOWNLOAD=1` so the Electron shell is typechecked **and compiled** against the real `electron` types without pulling binaries — the compile matters, because `tests/desktop.main.test.ts` executes `desktop/dist/main.js` and skips itself when that file is missing |
| `.github/workflows/ci.yml` → **security** | every push / PR | `npm audit --audit-level=high` against both trees (root and `desktop/`), straight from the committed lockfiles. Both are currently clean, so this is a ratchet: a new high/critical advisory fails the build instead of being discovered during a release |
| `.github/workflows/ci.yml` → **desktop-runtime** | every push / PR | installs the real Electron binary and runs `xvfb-run npm run smoke` in `desktop/` — see *The desktop smoke test* below |
| `.github/workflows/release.yml` | **cron `30 3 1 * *`** (03:30 UTC on the 1st of every month) + manual | verify → bump the CalVer → write the CHANGELOG → commit, tag `v<version>`, push → open the GitHub Release → build and attach the desktop installers |
| `.github/workflows/release-desktop.yml` | manual | rebuild the macOS/Linux/Windows installers for an existing release |
| `.github/actions/build-desktop/` | — | composite action: install → `next build` (standalone) → stamp the version → `desktop/resources/server` → `tsc` (`desktop/src` → `desktop/dist`) → `electron-builder` on the current runner's OS |

The `desktop/` tree is excluded from the root `tsconfig.json` program on purpose: the Next.js
build must never compile `main.ts`/`preload.ts`, and the root program has no `electron` module.
The desktop project therefore typechecks itself with its own `tsconfig.json` — CI runs it, and
so can you (`npm run desktop:typecheck` from the root).

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

# CI and releases

The GitHub Actions workflows live in `.github/` (this folder keeps only documentation):

| File | Trigger | Does |
|---|---|---|
| `.github/workflows/ci.yml` | every push / PR | `typecheck → test → eval → build`, plus `npm ci && npm run typecheck` in `desktop/` with `ELECTRON_SKIP_BINARY_DOWNLOAD=1` so the Electron shell is compiled against the real `electron` types without pulling binaries |
| `.github/workflows/release.yml` | **cron `30 3 1 * *`** (03:30 UTC on the 1st of every month) + manual | verify → bump the CalVer → write the CHANGELOG → commit, tag `v<version>`, push → open the GitHub Release → build and attach the desktop installers |
| `.github/workflows/release-desktop.yml` | manual | rebuild the macOS/Linux/Windows installers for an existing release |
| `.github/actions/build-desktop/` | — | composite action: `next build` (standalone) → `desktop/resources/server` → `electron-builder` on the current runner's OS |

The `desktop/` tree is excluded from the root `tsconfig.json` program on purpose: the Next.js
build must never compile `main.ts`/`preload.ts`, and the root program has no `electron` module.
The desktop project therefore typechecks itself with its own `tsconfig.json` — CI runs it, and
so can you (`npm run desktop:typecheck` from the root).

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

If `npm run desktop:typecheck` complains that `tsc` is missing, run `npm ci` inside `desktop/`
first — its dependencies (including `electron`'s bundled types) are not installed by the root install.
The download of the ~100 MB Electron binaries is skipped automatically: `desktop/package.json` sets
`"config": { "ELECTRON_SKIP_BINARY_DOWNLOAD": "1" }`, and CI sets the same env var explicitly.
Packaging a real installer does need the binaries, and the build action leaves the flag off there.

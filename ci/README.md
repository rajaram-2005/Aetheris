# CI and releases

These files are GitHub Actions workflows that live **outside** `.github/workflows/` because the
Arena GitHub App that pushes this branch lacks the `workflows` permission — GitHub ignores (and the
API refuses to create) workflow files pushed by an app without that scope. To enable them, move them
into place in one commit:

```bash
mkdir -p .github/workflows .github/actions
git mv ci/github-actions-ci.yml .github/workflows/ci.yml
git mv ci/release.yml           .github/workflows/release.yml
git mv ci/release-desktop.yml   .github/workflows/release-desktop.yml
git mv ci/actions/build-desktop .github/actions/build-desktop

# both release workflows call the composite action by path — repoint them
sed -i 's#\./ci/actions/build-desktop#./.github/actions/build-desktop#' \
  .github/workflows/release.yml .github/workflows/release-desktop.yml

git add -A && git commit -m "ci: enable the workflows" && git push
```

(The composite action must end up at `.github/actions/build-desktop/`. **Two** files reference it as
`./ci/actions/build-desktop` — `release.yml` and `release-desktop.yml` — so both need the `sed` above
in the same commit, or the desktop jobs will fail to find the action.)

## What each workflow does

| File | Trigger | Does |
|---|---|---|
| `github-actions-ci.yml` | every push / PR | `typecheck → test → eval → build` |
| `release.yml` | **cron `30 3 1 * *`** (03:30 UTC on the 1st of every month) + manual | verify → bump the CalVer → write the CHANGELOG → commit, tag `v<version>`, push → open the GitHub Release → build and attach the desktop installers |
| `release-desktop.yml` | manual | rebuild the macOS/Linux/Windows installers for an existing release |
| `actions/build-desktop/` | — | composite action: `next build` (standalone) → `desktop/resources/server` → `electron-builder` on the current runner's OS |

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
bash tools/release.sh --no-push                                  # a release, stopped before pushing
npm run desktop:build                                            # unpacked desktop app for smoke-testing
```

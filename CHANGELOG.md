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

### desktop

- Aetheris desktop app (Electron): embedded loopback server or remote server, macOS/Linux/Windows packaging
- Boot/connection shell, tray, deep links (`aetheris://`), redacted log, GitHub release update check
- Provider keys in `<userData>/data/.env.local` are injected into the embedded server (a shell export never reaches a Finder-launched app)
- Navigation policy extracted and unit-tested: in-app links stay in the window, everything else goes to the system browser
- `tests/desktop.main.test.ts` runs the compiled main process against a stubbed `electron` module
- Deep links accept only the unambiguous `?path=` form and reject protocol-relative, backslash, absolute-URL, encoded-`//` and control-character paths
- One app menu on macOS (was duplicated by `role: "appMenu"` plus a same-named menu), and every role menu now has a label
- In-app docs: a "Desktop app" guide under Developers

### release

- Monthly CalVer release pipeline: `VERSION`, `tools/bump-version.mjs`, `tools/changelog.mjs`, `ci/release.yml`
- `GET /api/version` and a desktop-aware loopback Host allow-list in the edge middleware

---

## Earlier

Everything before `2026.9.1` shipped as `0.1.0` — see the product-history table in
[README.md](README.md#product-history-all-still-shipped) and the phase-by-phase audit in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

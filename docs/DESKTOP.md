# Desktop app

Aetheris One runs as a native desktop app on **macOS**, **Linux** and **Windows** — an Electron
shell in `desktop/` around the same Next.js application you run locally in a browser. Nothing is a
second codebase: the desktop app *is* Aetheris. Normal use is **local-only**, with its own embedded server.
Online model providers, integrations and update checks still use the internet; local inference needs
a configured local model server.

Status: **IMPLEMENTED** for the shell, packaging and the embedded server; installer artefacts are
produced by `.github/workflows/release.yml` on the matching runners (see [Release](#release) — a `.dmg` can only be
built on macOS).

## Local operation and development

Use **local / embedded** mode for normal operation. If an older setting opens the connection screen,
choose **Use the embedded server** from **app menu → Connection settings…** (or the tray). Settings
are stored in Electron's `userData` directory.

| Mode | What runs | Data | Use it when |
|---|---|---|---|
| `local` (default) | the app starts the embedded Next.js server on `127.0.0.1` as a child process | `<userData>/data` | normal local use |
| `remote` (compatibility mode) | the window loads a separately running Aetheris process | that process's local data directory | local development with `npm run desktop:dev` and hot reload |

The legacy `remote` connection setting remains in the code and checks `GET /api/health` before
saving an address. Its supported use here is connecting the development shell to a server on the
same computer; public and remote Aetheris hosting are not supported workflows.

```
  ┌─────────────────────────── Aetheris.app ───────────────────────────┐
  │ main process (desktop/src/main.ts)                                 │
  │   settings.json · log · tray · menu · deep links · update check    │
  │        │                                    │                      │
  │        │ spawn (ELECTRON_RUN_AS_NODE=1)     │ loadURL              │
  │        ▼                                    ▼                      │
  │  resources/server/server.js  ──HTTP──▶  BrowserWindow              │
  │  (Next.js standalone, 127.0.0.1:17890)     preload → window.aetherisDesktop
  │        │                                                           │
  │        ▼                                                           │
  │  <userData>/data (JSON stores + knowledge.sqlite)                  │
  └────────────────────────────────────────────────────────────────────┘
```

During local development, the left branch disappears and `loadURL` points at the separately running
local Next.js development server.

## Install

Download the artefact for your platform from the [latest release](https://github.com/rajaram-2005/Aetheris/releases):

| Platform | Artefacts | Notes |
|---|---|---|
| macOS | `Aetheris-<version>-mac-arm64.dmg`, `-mac-x64.dmg`, plus `.zip` | Apple silicon and Intel. Unsigned by default: right-click → Open the first time, or `xattr -dr com.apple.quarantine /Applications/Aetheris.app` |
| Linux | `Aetheris-<version>-linux-x86_64.AppImage`, `.deb`, `.rpm` (x64 + arm64) | AppImage needs `chmod +x`; the `.deb`/`.rpm` pull in the usual Electron libraries |
| Windows | `Aetheris-<version>-win-x64-setup.exe`, `-win-x64.zip` | NSIS installer, per-user by default, no admin needed |

The app checks GitHub for a newer release once an hour and at startup, and tells you when the
monthly release lands. It never downloads or installs anything by itself.

## Build it yourself

```bash
git clone https://github.com/rajaram-2005/Aetheris && cd Aetheris
npm ci
npm --prefix desktop ci

# day-to-day UI work: next dev + the desktop shell pointed at it (hot reload)
npm run desktop:dev

# a real build you can smoke-test: standalone server → resources/server → unpacked app
npm run desktop:build            # → desktop/release/{mac,linux,win}-unpacked

# installer artefacts for the OS you are on
cd desktop && npm ci && npm run dist          # everything
cd desktop && npm run dist:mac                # .dmg + .zip (needs macOS)
cd desktop && npm run dist:linux              # .AppImage + .deb + .rpm
cd desktop && npm run dist:win                # NSIS + .zip
```

What `npm run desktop:build` does, step by step:

1. `AETHERIS_STANDALONE=1 next build` → `.next/standalone` (the opt-in flag is in `next.config.ts`;
   plain `npm run build` is unchanged).
2. `desktop/scripts/prepare-app.mjs` copies that into `desktop/resources/server`, adds the `.next/static`
   and `public/` directories Next does not copy, and drops the `data/` directory if the build created
   one — a packaged app must start empty. Result: ~67 MB, ~2,000 files.
3. `tsc -p desktop/tsconfig.json` → `desktop/dist/{main,preload}.js`.
4. `electron-builder` packs `dist` + `src/renderer` into the asar and `resources/server` beside it.

`electron-builder` downloads the Electron binary on first use. Where that host is blocked, set
`ELECTRON_MIRROR` to a reachable mirror.

## Where things live

| Path | What |
|---|---|
| macOS | `~/Library/Application Support/Aetheris/` — `settings.json`, `data/`, `logs/aetheris-YYYY-MM-DD.log` |
| Linux | `~/.config/Aetheris/` — same layout |
| Windows | `%APPDATA%/Aetheris/` — same layout |

Menu → **Open log** / **Open data folder** (and the buttons on the error screen) go straight there.

## Settings

`settings.json` is sanitised on every load (`desktop/src/lib/settings.ts`): unknown keys are
dropped, out-of-range values fall back to defaults, and a malformed file yields the defaults rather
than a crash.

| Key | Default | Meaning |
|---|---|---|
| `mode` | `"local"` | `"local"` embedded server; `"remote"` compatibility client used for local development |
| `serverUrl` | `""` | local development server address; normalised, must be http(s) and answer `/api/health` |
| `preferredPort` | `17890` | loopback port the embedded server asks for; if taken, the next free one |
| `dataDir` | `<userData>/data` | JSON stores + `knowledge.sqlite` |
| `bounds` | 1280×840 | last window position/size |
| `openDevTools` | `false` | open DevTools detached at startup |
| `hardwareAcceleration` | `true` | `false` calls `app.disableHardwareAcceleration()` |
| `updateCheckIntervalMinutes` | `60` | `0` disables background update checks |

Environment overrides (not persisted, handy for automation and CI):
`AETHERIS_DESKTOP_MODE`, `AETHERIS_DESKTOP_SERVER`, `AETHERIS_DESKTOP_DEV=1`.

## Security model

The desktop app inherits Aetheris's server-side rules (see [SECURITY](SECURITY.md)) and adds four:

1. **Loopback only.** The embedded server is started with `HOSTNAME=127.0.0.1` and is never bound to
   an interface other machines can reach.
2. **Loopback `Host` allow-list.** The child gets `AETHERIS_DESKTOP=1`, which switches on a check in
   `src/middleware.ts`: requests whose `Host` header is not `127.0.0.1` / `localhost` / `::1` are
   answered `403`. That blocks the DNS-rebinding trick where a page you visit resolves a public name
   to `127.0.0.1` and reads your local Aetheris through the browser. Verified end to end by
   `tests/desktop.embedded.test.ts`.
3. **A near-empty child environment.** `buildServerEnv` starts from an allow-list (`PATH`, `HOME`,
   proxy and CA variables, `OLLAMA_BASE_URL`) and adds only what the server needs. `NODE_OPTIONS` is
   never forwarded, and keys from the parent environment are only passed through when you set
   `AETHERIS_DESKTOP_FORWARD_KEYS=1` — and even then `AETHERIS_ADMIN_KEY` is withheld.

   The supported place for keys is **`<userData>/data/.env.local`** (`KEY=value`, `#` comments,
   optional quotes). The desktop app parses it and injects it into the embedded server — which
   matters on macOS, where a Finder-launched app inherits almost nothing from your shell, so a key
   exported in `.zshrc` never arrives. Values from that file override inherited ones but can never
   override the fixed ones: writing `HOSTNAME=0.0.0.0` or `AETHERIS_DESKTOP=0` into it has no
   effect. Only the key *names* are logged, never the values.
4. **No Node in the renderer.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`;
   the page sees only the ~12 functions exposed by `desktop/src/preload.ts`. Out-of-origin
   navigation and `window.open` go to the system browser.

Log lines pass through `redact()` before they are written: `key=value` pairs, `Authorization: Bearer
…`, vendor-prefixed keys (`sk-`, `ghp_`, `xoxb-`, `ya29.`, `AIza…`) and any 32+ character opaque
token are masked.

## Deep links

`aetheris://open?path=/docs/chat` focuses the app (single-instance lock) and navigates there once
the server is up. The protocol is registered on startup; on macOS `app.on("open-url")`, on
Windows/Linux through argv.

Only the `?path=` form is accepted, and the value must be a plain path on the app's own origin.
`aetheris://docs/chat` is rejected rather than guessed at ("docs" is the host there); so are
protocol-relative (`?path=//evil.com`), backslash, absolute-URL, encoded-`//`, control-character and
over-500-character values. A link can come from any web page, so it is treated as hostile input.

## Release

The desktop app ships on the project's monthly CalVer cadence — see [Release process](#release-process)
below and [ci/README.md](../ci/README.md). `.github/workflows/release.yml` builds all three platforms on
`macos-latest`, `ubuntu-latest` and `windows-latest` through one composite action
(`.github/actions/build-desktop/`) and attaches the artefacts to the GitHub Release.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "The embedded Aetheris server is not built yet" | you ran the shell without building the standalone bundle — `npm run desktop:build` (or use `npm run desktop:dev`) |
| The app opens but shows the connection screen | `mode` is `remote` and the address is unreachable — click "Use the embedded server" for normal local use, or start your local dev server |
| Port 17890 already in use | nothing to do: the app walks to the next free port. The session cookie follows the origin, so it is stable per machine |
| The embedded server has no provider keys | put them in `<userData>/data/.env.local` — a shell export does not reach a Finder/Start-Menu-launched app |
| Blank window on Linux with an old GPU driver | set `hardwareAcceleration: false` in `settings.json` |
| Update check says "no releases published yet" | the repo has no GitHub Release yet, or egress to `api.github.com` is blocked. Point `AETHERIS_UPDATE_FEED` at a mirror or set `updateCheckIntervalMinutes: 0` |
| macOS Gatekeeper blocks the app | the release is unsigned; right-click → Open once, or remove the quarantine attribute (above) |

## Honest limits

* **No code signing or notarisation.** macOS users get a Gatekeeper warning; Windows gets SmartScreen.
  Add `CSC_LINK`/`CSC_KEY_PASSWORD` (and an Apple ID for notarisation) to the release workflow to fix.
* **No delta updates.** The app tells you a new version exists and links the installer; it does not
  patch itself. `electron-updater` is not wired up.
* **One embedded server per app.** A second launch focuses the first window rather than starting
  another server (single-instance lock).
* **Tray icon is optional.** If the platform has no tray, the menu still has every action.
* **The GUI is not exercised by the unit suite — but the real binary is exercised by CI.**
  `tests/desktop.main.test.ts` runs the real compiled `main.js` against a stubbed `electron` module
  (so the IPC handlers, boot flow, settings round-trip and navigation policy are covered) — but it
  skips itself when `desktop/dist` is absent, and CI does not currently emit it, so **that test runs
  locally, not on the runner**; see `ci/README.md` for why. The `desktop-runtime` CI job covers the
  real binary instead: `desktop/src/smoke.ts` boots the real Electron binary under `xvfb-run`, creates a
  window with the production `webPreferences`, loads the real `preload.js`, and asserts from inside
  the renderer that the `contextBridge` surface is complete and that `require`/`process`/`Buffer` are
  unreachable. What still drives no pixels is the app UI itself — no test renders a chart or clicks a
  button in the Next.js front end.
* **The embedded server is the same code as the hosted one** — so anything marked `NOT AVAILABLE` in
  the status table (OPC-UA, CAN, horizontal scaling) is equally unavailable here.

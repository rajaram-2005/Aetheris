# Local setup

Aetheris One is a **local-only application**. Run it on your own computer in a browser, in the Electron desktop app, or in a local Docker container. Cloud hosting, public deployment recipes and deployment connectors in Apps are not supported workflows.

The UI and API routes are one Next.js 15 application; there is no separate backend to install. Local storage includes browser data, JSON stores and a SQLite knowledge database. Online AI providers and integrations are optional external services, not hosts for Aetheris.

## Requirements

| Item | Requirement |
|---|---|
| Node.js | **22.x** for source builds (`node:sqlite` is required); packaged desktop apps include their runtime |
| Tools | npm and Git for a source checkout; Docker Compose only for the optional container workflow |
| Storage | A writable local data directory; enough space for your documents and any local models |
| Model keys | Optional: keyless providers need internet; local inference needs a running local model server |
| Accounts | No Aetheris login, display name, domain or hosting account required |

## 1. Local browser

```bash
git clone https://github.com/rajaram-2005/Aetheris.git
cd Aetheris
npm ci
cp .env.example .env.local
npm run dev -- --hostname 127.0.0.1
```

Open **http://localhost:3000**. On Windows, copy the environment file with PowerShell or File Explorer. Keep this process running while using the workspace.

For an optimized build, stop the development server first:

```bash
npm run build
npm start -- --hostname 127.0.0.1
```

The checked-in `dev` and `start` scripts also serve development previews and bind to `0.0.0.0` by default. The `--hostname 127.0.0.1` override above confines normal local browser use to loopback. Do not port-forward the app or put it behind a public tunnel: the workspace is anonymous-first, not a public multi-user service.

## 2. Desktop app

Use the default **local / embedded** mode. The app starts its own server on `127.0.0.1`, initially port `17890`, and chooses another loopback port if needed. No separate Node installation or terminal server is needed with a packaged installer.

| Platform | Default app data location |
|---|---|
| macOS | `~/Library/Application Support/Aetheris/` |
| Linux | `~/.config/Aetheris/` |
| Windows | `%APPDATA%/Aetheris/` |

Server records live in the `data/` subdirectory. Provider keys and other local server settings go in `<dataDir>/.env.local`. Use **Open data folder** from the app menu to find it.

The embedded server sets `AETHERIS_DESKTOP=1` itself to enable its loopback Host-header check. Do not set that variable for a normal browser development preview. Desktop builds opt into `AETHERIS_STANDALONE=1`; ordinary local browser builds should leave that flag unset.

Installers, development commands and the full security model: [DESKTOP](DESKTOP.md).

## 3. Optional local Docker

From the repository root:

```bash
cp .env.example .env.local
docker compose up -d --build
```

Open **http://localhost:3000**. Compose publishes the app only on `127.0.0.1:3000` and stores server records in the named `aetheris-data` volume mounted at `/data`. The container listens on `0.0.0.0` internally so Docker can forward the loopback port; this is not a cloud deployment recipe.

The image uses Node 22, runs as a non-root user and checks `GET /api/health`.

```bash
docker compose logs -f aetheris  # inspect local logs
docker compose down              # stop; keep the data volume
```

Do **not** add `-v` to `docker compose down` unless you intend to delete the stored server data. Export browser chats separately; they are not in the Docker volume.

## 4. Local model inference and internet access

Local application hosting does not make every feature offline. Keyless providers, online models, web search, Studio providers, GitHub, OAuth and vendor-hosted MCP connectors make outbound requests when used. Updates also check GitHub unless disabled in desktop settings.

To restrict the model router to local providers, first install and start a local model server, then configure `.env.local`. For example, after downloading a model into Ollama:

```dotenv
OLLAMA_LOCAL=1
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
OLLAMA_MODEL=llama3.1
AETHERIS_LOCALITY=local
```

Restart Aetheris after changing environment variables. `local` is a hard filter; `prefer_local` allows online fallback. Neither setting disables other online integrations. Turn off web search and leave external connectors disabled when you do not want to use them. See [MODELS](MODELS.md) for LM Studio and OpenAI-compatible alternatives.

For Ollama in the optional Compose service, uncomment that service and its volume, and use `OLLAMA_BASE_URL=http://ollama:11434/v1` with `OLLAMA_LOCAL=1`. Download the chosen model into that container before requesting inference. A container's `127.0.0.1` is the container itself, not your computer's host network.

## 5. Data, secrets and local operations

| Setting | Purpose |
|---|---|
| `AETHERIS_DATA_DIR` | Server data directory; default `./data` for a source checkout, `/data` inside Docker |
| `AETHERIS_KNOWLEDGE_DB` | Knowledge SQLite file; default `<dataDir>/knowledge.sqlite` |
| `AETHERIS_SECRET` | Stable secret for sealing credentials and cookies; generate with `openssl rand -hex 32` |
| `AETHERIS_REQUIRE_AUTH`, `AETHERIS_GUEST_ACCESS` | Legacy settings; leave unset or `0` for anonymous-first local use |
| `GOOGLE_*`, `GITHUB_*` | Optional integration credentials; register localhost callbacks per [AUTHENTICATION](AUTHENTICATION.md) |
| `AETHERIS_ADMIN_EMAILS`, `AETHERIS_ADMIN_UIDS`, `AETHERIS_ADMIN_KEY` | Optional access to administrative operations |
| `AETHERIS_SCHEDULER` | Defaults to enabled; `0` stops the in-process minute ticker |
| `CRON_SECRET` | Protects `/api/schedules/tick` if you call it from a local cron job |
| `AETHERIS_ALLOW_PRIVATE_URLS` | Leave off unless you need trusted local/LAN MCP or device endpoints; relaxes the SSRF guard |
| `AETHERIS_LOCALITY` | `local` restricts inference to local providers; `prefer_local` permits online fallback |
| `AETHERIS_PAID_PLANS` | Leave unset or `0`; local use does not need billing |
| `AETHERIS_EVENT_BUFFER` | In-memory telemetry ring size, default `5000` |

Keep real secrets in the ignored `.env.local`, never in Git, screenshots or chat messages. Back up the stable `AETHERIS_SECRET` securely with encrypted credentials; changing it invalidates sealed sessions. Full variable reference: [`.env.example`](../.env.example).

Run **one instance per data directory**: JSON stores and SQLite are single-writer. Schedules only execute while the local process is running and the machine is awake. Room/share URLs belong to this local instance; a localhost link is not a public share link.

| Check | Purpose |
|---|---|
| `GET /api/health` | Process health, data-directory writability (200 / 503), version and runtime |
| `GET /api/version` | Running CalVer and desktop/server runtime |
| `GET /api/telemetry` | Local telemetry events |
| Control Center | Providers, agents, executions, permissions and devices |

## 6. Backups and upgrades

1. Export chats and other browser-local data from the app.
2. Stop Aetheris, then back up the complete server data directory (or Docker data volume), including SQLite files. Keep any secrets in a secure backup, not in Git.
3. For a source checkout, run `git pull`, `npm ci` and `npm run build`, then `npm start -- --hostname 127.0.0.1`.
4. For Docker, rebuild with `docker compose up -d --build`; reuse the existing data volume.
5. For desktop, install the newer package for your platform. The app links releases but does not install updates automatically.

Do not clear the anonymous owner cookie or browser storage without exporting first: server-side records are associated with that owner. Browser, desktop and Docker workflows use different storage locations and do not automatically migrate data between them.

## Status

| Workflow | Status |
|---|---|
| Local browser, one Node process | IMPLEMENTED |
| Local desktop with embedded server | IMPLEMENTED; installer builds require the appropriate platform |
| Local Docker with loopback port and persistent volume | IMPLEMENTED |
| Local model routing | IMPLEMENTED; requires a configured, running model server |
| Cloud/public hosting and deployment apps | NOT AVAILABLE as supported workflows |
| Horizontal scaling | NOT AVAILABLE; single-writer stores |
| Fully offline online-provider/integration features | NOT AVAILABLE; those services require internet |

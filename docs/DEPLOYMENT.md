# Deployment

Aetheris One is a single Next.js 15 application (App Router, TypeScript). The API routes *are* the backend; there is no separate service to run. State lives in a data directory (JSON stores + one SQLite file), so a deployment is: **Node 22 + a writable volume**.

```
                 ┌──────────────────────────────┐
  browser ─────▶ │  next start (port 3000)       │──▶ LLM providers (HTTPS, keys from env / user BYOK)
                 │  middleware: rate limits, CSP │──▶ MCP servers (HTTPS; private IPs blocked by default)
                 │  API routes  = backend        │──▶ GitHub API (OAuth / PAT)
                 │  in-process scheduler tick    │──▶ devices (http/mqtt adapters; opt-in LAN access)
                 └──────────────┬───────────────┘
                                ▼
                     $AETHERIS_DATA_DIR  (JSON stores, knowledge.sqlite, audit)
```

## Requirements

| Item | Value |
|---|---|
| Node | **22.x** (the knowledge fabric uses `node:sqlite`; 20 will not work) |
| RAM | 512 MB minimum, 1 GB comfortable |
| Disk | writable `AETHERIS_DATA_DIR` (default `./data`) |
| Keys | **none required**. Keyless providers (Pollinations, LLM7) work out of the box; every key in `.env.example` is optional and free-tier. |

## 1. Bare metal / VPS

```bash
git clone https://github.com/rajaram-2005/Aetheris && cd Aetheris
npm ci
cp .env.example .env.local        # fill in whatever keys you have (all optional)
npm run build
npm start                         # binds 0.0.0.0:3000
```

Run under systemd or pm2 so it restarts; put Caddy/nginx in front for TLS:

```
# Caddyfile
aetheris.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

## 2. Docker

```bash
cp .env.example .env.local
docker compose up -d --build       # http://localhost:3000, data in the aetheris-data volume
```

The image (`Dockerfile`) is a three-stage build on `node:22-bookworm-slim`, runs as a non-root user, stores state in `/data`, and exposes a health check against `GET /api/health`. Uncomment the `ollama` service in `docker-compose.yml` for fully local inference (`OLLAMA_BASE_URL=http://ollama:11434`).

## 3. Managed container hosts (recommended)

Aetheris needs a **long-lived Node process plus a writable volume**, so the hosts that fit it are the
ones that run the Docker image above with a disk attached. All three below are one file away:

| Host | File in repo | Volume | Notes |
|---|---|---|---|
| Render | `deploy/render.yaml` | 10 GB disk at `/data` | `render blueprint launch`, or point a Blueprint at the repo |
| Fly.io | `deploy/fly.toml` | `fly volumes create aetheris_data --size 10` | `fly launch --copy-config --dockerfile Dockerfile` |
| Railway / Coolify / Dokku / Kubernetes | `Dockerfile` | any persistent mount at `/data` | set `AETHERIS_DATA_DIR=/data` |

Whatever the host, the contract is the same:

```
image:   built from ./Dockerfile        port: 3000 (0.0.0.0)
env:     AETHERIS_DATA_DIR=/data, AETHERIS_SECRET=<32-byte hex>, AETHERIS_ADMIN_EMAILS=...
volume:  persistent disk mounted at /data
health:  GET /api/health
```

Scale to **one instance**: the JSON stores and SQLite file are single-writer (see the status table).

### Serverless / Vercel — not supported

Vercel (and any other function-per-request platform) is **not a supported target** and is the source of
most deployment errors reported against this repo:

* **No persistent filesystem.** The JSON stores and `knowledge.sqlite` are wiped between cold starts, so
  memory, schedules, knowledge and credentials silently disappear. Vercel offers no mountable disk.
* **No long-lived process.** The minute scheduler, the in-process event bus (rooms/streams) and the
  telemetry ring buffer all die with the function.
* **Build-image friction.** Its npm skips dependency install scripts unless approved, so `sharp`/`esbuild`
  are silently skipped and the build breaks later at runtime.
* **`node:sqlite` / Node 22 runtime** requirements are not guaranteed on the serverless runtime.

Use Docker (section 2) or a managed container host (this section). If you only need a public demo URL,
run the container on Render/Fly free-tier or expose your local container with a tunnel
(`cloudflared tunnel --url http://localhost:3000`).

## 4. Desktop app

For a single user on their own machine there is nothing to deploy: the desktop app runs the server
embedded on `127.0.0.1` and keeps its state in Electron's `userData` directory. See
[DESKTOP](DESKTOP.md) for install and build instructions.

Two deployment-relevant details:

* The embedded server is started with `AETHERIS_DESKTOP=1`, which turns on the loopback `Host`
  allow-list in `src/middleware.ts`. **Do not set that variable on a hosted deployment** — behind a
  reverse proxy the `Host` header is your public name and every request would be answered `403`.
* `AETHERIS_STANDALONE=1 npm run build` produces `.next/standalone`, which is what the desktop app
  ships. It is opt-in precisely because `next start` does not serve a standalone tree; a hosted
  deployment should keep using plain `npm run build && npm start`.

## 5. Health, readiness, observability

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | liveness + data-dir writability (200 / 503), plus `version` and `runtime` (`server` or `desktop`). Unauthenticated, no secrets. |
| `GET /api/version` | the running CalVer, the release cadence, and whether this process is an embedded desktop server |
| `GET /api/telemetry` | in-memory event ring buffer (size `AETHERIS_EVENT_BUFFER`, default 5000) |
| `GET /api/telemetry/audit?format=csv` | audit export (admin) |
| Control Center UI | `/` → Control Center area: providers, agents, executions, devices, security |

Events are per-instance and in memory. For a multi-replica deployment, ship them out with a log collector; there is no built-in central store (status: **PARTIALLY IMPLEMENTED**).

## 6. Environment reference (deployment-relevant subset)

| Variable | Default | Notes |
|---|---|---|
| `AETHERIS_DATA_DIR` | `./data` | must be writable; mount as a volume |
| `AETHERIS_KNOWLEDGE_DB` | `$DATA/knowledge.sqlite` | SQLite (WAL) |
| `AETHERIS_SECRET` | — | **set in production**; encrypts GitHub token cookies (`openssl rand -hex 32`) |
| `AETHERIS_ADMIN_EMAILS` / `_PHONES` / `_UIDS` | founder defaults | who gets ADMIN permission level |
| `AETHERIS_ADMIN_KEY` | — | `/admin` access (`openssl rand -hex 24`) |
| `AETHERIS_SCHEDULER` | `1` | `0` disables the in-process minute ticker |
| `CRON_SECRET` | — | protects `/api/schedules/tick` for external cron |
| `AETHERIS_ALLOW_PRIVATE_URLS` | `0` | `1` lets MCP/device/browser adapters reach LAN/private IPs (needed for on-prem devices; keep off on public hosts) |
| `AETHERIS_LOCALITY` | — | `local` prefers Ollama/LM Studio when reachable (offline-first) |
| `AETHERIS_PAID_PLANS` | `0` | **leave off** — Aetheris is free for everyone |
| `AETHERIS_EVENT_BUFFER` | `5000` | telemetry ring size |
| `AETHERIS_DESKTOP` | — | **set only by the desktop app**; enables the loopback `Host` allow-list. Leave unset on a host |
| `NODE_ENV` | `production` | set by `next start` |

Full list with provider keys: `.env.example`.

## 7. Security checklist for a public host

1. Set `AETHERIS_SECRET`, `AETHERIS_ADMIN_KEY`, and real admin identities.
2. Keep `AETHERIS_ALLOW_PRIVATE_URLS` unset (SSRF guard blocks RFC1918/loopback/link-local after DNS resolution).
3. Terminate TLS at a reverse proxy; the app sets security headers (`Referrer-Policy`, `Permissions-Policy`, nosniff; add `frame-ancestors` at the proxy if you need click-jacking protection) in `src/middleware.ts`.
4. Rate limits are per-instance in-memory counters (see `docs/SECURITY.md`); put a WAF / proxy limit in front for real DDoS protection.
5. Physical-device and robotics adapters require explicit permission grants per user; they are never granted by env. Deploy those only on a trusted LAN.
6. Never put provider keys in prompts, client code or the repo — env or the per-user encrypted BYOK store only.

## 8. Continuous integration

The workflow lives at `.github/workflows/ci.yml`: typecheck → tests → evals → build, plus a `desktop/` typecheck against the real Electron types (`ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` — compiling needs no binary). Forks inherit it as-is; the full pipeline map is in `ci/README.md`.

## 9. Upgrading

```bash
git pull && npm ci && npm run build && systemctl restart aetheris   # or docker compose up -d --build
```

Data files are forward-compatible JSON; the SQLite schema is created with `CREATE TABLE IF NOT EXISTS`. Back up `AETHERIS_DATA_DIR` before major upgrades.

## Status

| Piece | Status |
|---|---|
| Bare-metal / Docker deployment | IMPLEMENTED (Dockerfile + compose in repo; image build verified locally only when Docker is available) |
| Health endpoint | IMPLEMENTED |
| Managed container hosts (Render / Fly / Railway) | IMPLEMENTED — `deploy/render.yaml`, `deploy/fly.toml`, persistent `/data` volume |
| Serverless (Vercel / functions) | NOT SUPPORTED — no persistent disk, no long-lived process; use Docker or a container host |
| Horizontal scaling | NOT AVAILABLE — single-writer JSON/SQLite stores; run one replica |
| Central telemetry / log shipping | NOT AVAILABLE (in-memory ring only) |

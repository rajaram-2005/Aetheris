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

## 3. Vercel / serverless

Works for the chat, router, agents, MCP gateway and GitHub features, with two caveats:

* **Ephemeral filesystem.** The JSON stores and SQLite file are not durable across cold starts. Use it for demos, or point `AETHERIS_DATA_DIR` at a mounted persistent disk (Railway, Fly, Render volumes all work; Vercel does not offer one).
* **No long-lived process.** Set `AETHERIS_SCHEDULER=0` and drive automations with an external cron hitting `POST /api/schedules/tick` with `Authorization: Bearer $CRON_SECRET` (Vercel Cron, GitHub Actions schedule, cron-job.org).

Fly.io / Railway / Render (persistent volume + always-on container) are the recommended managed options.

## 4. Health, readiness, observability

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | liveness + data-dir writability (200 / 503). Unauthenticated, no secrets. |
| `GET /api/telemetry` | in-memory event ring buffer (size `AETHERIS_EVENT_BUFFER`, default 5000) |
| `GET /api/telemetry/audit?format=csv` | audit export (admin) |
| Control Center UI | `/` → Control Center area: providers, agents, executions, devices, security |

Events are per-instance and in memory. For a multi-replica deployment, ship them out with a log collector; there is no built-in central store (status: **PARTIALLY IMPLEMENTED**).

## 5. Environment reference (deployment-relevant subset)

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
| `NODE_ENV` | `production` | set by `next start` |

Full list with provider keys: `.env.example`.

## 6. Security checklist for a public host

1. Set `AETHERIS_SECRET`, `AETHERIS_ADMIN_KEY`, and real admin identities.
2. Keep `AETHERIS_ALLOW_PRIVATE_URLS` unset (SSRF guard blocks RFC1918/loopback/link-local after DNS resolution).
3. Terminate TLS at a reverse proxy; the app sets security headers (`Referrer-Policy`, `Permissions-Policy`, nosniff; add `frame-ancestors` at the proxy if you need click-jacking protection) in `src/middleware.ts`.
4. Rate limits are per-instance in-memory counters (see `docs/SECURITY.md`); put a WAF / proxy limit in front for real DDoS protection.
5. Physical-device and robotics adapters require explicit permission grants per user; they are never granted by env. Deploy those only on a trusted LAN.
6. Never put provider keys in prompts, client code or the repo — env or the per-user encrypted BYOK store only.

## 7. Continuous integration

The workflow file lives at `ci/github-actions-ci.yml` (typecheck → tests → evals → build). Copy it to `.github/workflows/ci.yml` in your fork; it is kept outside `.github/` in this repo because the automation that maintains the branch lacks the `workflows` permission (`ci/README.md`).

## 8. Upgrading

```bash
git pull && npm ci && npm run build && systemctl restart aetheris   # or docker compose up -d --build
```

Data files are forward-compatible JSON; the SQLite schema is created with `CREATE TABLE IF NOT EXISTS`. Back up `AETHERIS_DATA_DIR` before major upgrades.

## Status

| Piece | Status |
|---|---|
| Bare-metal / Docker deployment | IMPLEMENTED (Dockerfile + compose in repo; image build verified locally only when Docker is available) |
| Health endpoint | IMPLEMENTED |
| Serverless (Vercel) | PARTIALLY IMPLEMENTED — works with ephemeral state and external cron |
| Horizontal scaling | NOT AVAILABLE — single-writer JSON/SQLite stores; run one replica |
| Central telemetry / log shipping | NOT AVAILABLE (in-memory ring only) |

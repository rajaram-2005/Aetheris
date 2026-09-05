# Deployment recipes

Aetheris One needs a **long-lived Node 22 process** and a **writable volume**. Serverless platforms
(Vercel, Netlify Functions, Cloudflare Workers) provide neither and are not supported — see
[`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) §3.

| File | Host | Command |
|---|---|---|
| `../docker-compose.yml` | anywhere Docker runs | `docker compose up -d --build` |
| `render.yaml` | Render | `render blueprint launch` |
| `fly.toml` | Fly.io | `fly launch --copy-config --config deploy/fly.toml --dockerfile Dockerfile` |

Common contract: port `3000` on `0.0.0.0`, persistent mount at `/data`, `AETHERIS_DATA_DIR=/data`,
health check `GET /api/health`, exactly **one** instance.

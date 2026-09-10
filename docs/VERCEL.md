# Hosted deployment (Vercel)

Aetheris is local-first: without any of the variables below, everything runs on the
file backends (`data/*.json` + SQLite) exactly as before. Setting the hosted variables
switches each subsystem to its hosted backend. Local, Docker and desktop are unaffected.

## Backing services (Vercel Marketplace, all with free tiers)

| Service | Used for |
|---|---|
| Neon Postgres | KV store, knowledge fabric, telemetry |
| Upstash Redis | Rate limits, locks (Phase 7) |
| Vercel Blob | RAVANA workspace files, generated media (Phases 4–5) |
| Vercel Cron | Scheduler tick (Phase 6) |

## Environment

```bash
# Phase 1 — KV store (twins, chats, accounts, history, …)
AETHERIS_STORE=postgres
POSTGRES_URL=postgres://...            # wired automatically by the Neon integration (pooled URL)

# Phase 2 — knowledge fabric (default: sqlite)
AETHERIS_KNOWLEDGE=postgres

# Phase 3 — telemetry (default: sqlite, falls back to in-memory when unavailable)
AETHERIS_EVENTS=postgres
```

## Status

- [x] Phase 1: store backend (`src/lib/store-pg.ts`, hermetic `pg-mem` tests)
- [x] Phase 2: knowledge fabric → Postgres (`AETHERIS_KNOWLEDGE=postgres`; shared core in `fabric-shared.ts`, `fabric-sqlite.ts`/`fabric-pg.ts` backends, eval-parity `pg-mem` tests)
- [x] Phase 3: telemetry → Postgres (`AETHERIS_EVENTS=postgres`; `record()` stays sync with a fire-and-forget insert, routes/pages read via `queryAsync`/`summaryAsync`/…, hermetic `pg-mem` tests)
- [x] Phase 4: runtime keys + custom providers → store backend (sync write-through cache + `hydrateRouterStores()`; no `AETHERIS_STORE=postgres` change needed — keys/providers follow the store automatically)
- [x] Phase 5: RAVANA workspace → Blob (`AETHERIS_WORKSPACE=blob` + `BLOB_READ_WRITE_TOKEN`; zero-dep REST client, same traversal confinement; validate live with `node scripts/blob-roundtrip.mjs`)
- [x] Phase 6: media/lab ephemeral + ffmpeg tracing (`AETHERIS_HOSTED=1`: docker fast-fails, deploys go to ephemeral /tmp; video path decisions recorded as `multimodal:video-path` telemetry; media was already disk-free)
- [x] Phase 7: `vercel.json` + Cron + per-route `maxDuration` (tick every 10 min, 300s ceilings on all 12 SSE routes, `tests/vercel-config.test.ts` guardrails; cadences over daily + durations over 60s need Pro)
- [x] Phase 8: public hardening (`AETHERIS_REQUIRE_LOGIN=1` edge session gate, Upstash REST rate limits with in-memory fallback, AI spend rules, hosted-only HSTS)
- [x] Phase 9: resume-safe SSE (`src/lib/sse.ts`: numbered frames, `X-Run-Id`/`Last-Event-ID` replay of finished `/api/chat` runs instead of regenerating, 409 while in flight, per-instance memo with TTL + cap; client retries once with resume; `/api/v1` frames numbered with standard regenerate semantics)
- [x] Phase 10: deploy guide + staging validation (below)

## Deploy guide

One-time setup happens in the Vercel dashboard and is always done by a human: the agent
never creates the Vercel project, attaches storage, or sets production secrets.

1. Create the project from this repo (`rajaram-2005/Aetheris`), Next.js preset, Node 20+.
2. Attach storage (Vercel Marketplace — env vars are wired automatically):
   - Postgres (Neon/Vercel Postgres) → `POSTGRES_URL` (use the pooled URL)
   - Blob store → `BLOB_READ_WRITE_TOKEN`
   - Upstash Redis → `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
3. Set the remaining env vars (Preview + Production as needed):

| Var | Value | Why |
|---|---|---|
| `AETHERIS_STORE` | `postgres` | durable KV (twins, chats, accounts…) |
| `AETHERIS_KNOWLEDGE` | `postgres` | knowledge fabric backend |
| `AETHERIS_EVENTS` | `postgres` | durable telemetry log |
| `AETHERIS_WORKSPACE` | `blob` | RAVANA workspace files on Blob |
| `AETHERIS_HOSTED` | `1` | no docker, ephemeral /tmp lab deploys |
| `AETHERIS_REQUIRE_LOGIN` | `1` | edge session gate for public instances |
| `AETHERIS_SECRET` | `openssl rand -hex 32` | session/credential encryption |
| `CRON_SECRET` | `openssl rand -hex 24` | protects `/api/schedules/tick` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | OAuth App | sign-in + Coding Factory (callback: `https://<host>/api/auth/github/callback`) |
| provider keys | `GROQ_API_KEY`, … | any subset works; see `.env.example` |

Local defaults are unchanged: with none of the `AETHERIS_*` switches set, the app runs on
files/sqlite exactly as before.

4. Deploy. `vercel.json` registers the scheduler tick (`*/10 * * * *`); streaming routes
   carry their own `maxDuration` (300s, factory/run 600s).

Plan constraints: Hobby clamps function duration to 60s and cron to daily cadences — the
10-minute tick and the 300s streaming ceilings need Pro. On Hobby, long generations may be
cut off mid-stream (the client resumes via replay, Phase 9).

## Staging validation

Run against the Preview deployment before promoting:

- [ ] `GET /api/health` → ok; `GET /api/version` reports the deployed commit.
- [ ] Cron: `curl -H "Authorization: Bearer $CRON_SECRET" https://<preview>/api/schedules/tick`
      → runs due schedules; wrong/missing secret → 401.
- [ ] Blob: `BLOB_READ_WRITE_TOKEN=... node scripts/blob-roundtrip.mjs` → put/get/delete round-trip ok.
- [ ] Store: sign in, create a chat + twin, redeploy, confirm both survive (Postgres, not the filesystem).
- [ ] Chat SSE: send a message, kill the network mid-stream, confirm the client resumes without
      duplicated text (`X-Run-Replay`, Phase 9).
- [ ] Rate limits: burst `/api/chat` past the AI rule → 429s, then recovery (Upstash dashboard shows keys).
- [ ] Gate: signed-out `GET /api/chat` (or any non-public API) → 401 JSON; `/docs` still loads.
- [ ] `npm test` (950 tests) + `npm run eval` (5 suites) green on the release commit.

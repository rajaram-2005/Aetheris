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
- [ ] Phase 5: RAVANA workspace → Blob
- [ ] Phase 6: media/lab ephemeral + ffmpeg tracing
- [ ] Phase 7: `vercel.json` + Cron + per-route `maxDuration`
- [ ] Phase 8: public hardening (login-required hosted mode, rate limits, headers)
- [ ] Phase 9: deploy guide + staging validation

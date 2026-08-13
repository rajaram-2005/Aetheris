# Aetheris — web application

The browser front-end for the Aetheris runtime. It is a **thin client**: all
cognition happens in the Python process behind `/v1/hermes/*`. This app owns
presentation and local conversation history, nothing else.

> Previously this directory held a second, independent brain (the "C7 cascade")
> written in TypeScript. That logic now lives in Python at `aetheris/hermes/`,
> so the system has one engine instead of two divergent ones.

## Running it

The normal path is to build once and let FastAPI serve the result — one process,
one port, no Node at runtime:

```bash
npm install
npm run build          # static export → out/
cd .. && .venv/bin/uvicorn aetheris.main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000/`.

## Developing

For hot reload, run the UI dev server alongside the runtime. `/v1/*` is proxied
to Python, so browser code only ever calls its own origin:

```bash
# terminal 1
cd .. && .venv/bin/uvicorn aetheris.main:app --port 8000
# terminal 2
npm run dev            # http://localhost:3000
```

Set `AETHERIS_BACKEND` to point the proxy somewhere other than
`http://127.0.0.1:8000`.

## Layout

| Path | Role |
|------|------|
| `src/lib/hermes.ts` | The only seam to the backend — every API call lives here |
| `src/types/index.ts` | Types mirroring the runtime's payloads |
| `src/lib/store.ts` | Threads and settings in `localStorage` |
| `src/components/Inspector.tsx` | Live cascade trace + meta-learning dashboard |
| `src/app/AurionApp.tsx` | Application shell and orchestration |

## What you can see in the UI

- **Inspector → cascade** — all eleven stages with timings and expandable detail
- **Inspector → learning** — adapted strategy, intent priors, tool priors,
  episode count, and reward trend
- **👍 / 👎 on any answer** — sends a reward to `/v1/hermes/feedback`; the
  learner updates immediately

## Privacy

Prompts and threads stay on your machine. The runtime is local, no vendor API is
called, and no API key is required.

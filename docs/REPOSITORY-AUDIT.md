# Repository audit — 2026-09-09

Status vocabulary: `IMPLEMENTED` · `PARTIAL` · `EXPERIMENTAL` · `MOCKED` · `NOT AVAILABLE`.
This file records what the 2026-09-09 production pass found and what it changed. It does not invent capabilities.

## Verdict

Aetheris is one Intelligence OS (Next 15.5.25 App Router + RAVANA + 10 cores + Electron shell). It was already building and testing green on this tree. The remaining production defects were real but local: a webpack warning from WASM ffmpeg, a Next 15 `searchParams` type that did not match sibling pages, dead command-palette API URLs, missing CSS tokens, and missing App Router failure surfaces. Those are fixed. Remaining risk is dependency majors we refused to take blindly.

## What was already working (kept)

| Surface | Status |
|---|---|
| RAVANA (`/api/v1/ravana/*`, workspace UI, episode ledger) | IMPLEMENTED |
| Capability registry + Control Center | IMPLEMENTED (honest statuses) |
| Provider mesh (`GET /api/providers`) | IMPLEMENTED |
| Security guard (rate limit, SSRF/DNS, redaction, audit export) | IMPLEMENTED |
| Desktop Electron (sandbox, contextIsolation, navigation allowlist) | IMPLEMENTED |
| Local Docker (`127.0.0.1:3000`, `aetheris-data`) | IMPLEMENTED |
| Auth | PARTIAL — anonymous-first by design; `authenticationRequired()` is false |

## Defects found and repaired

| Finding | Status after this pass |
|---|---|
| `src/core/multimodal/wasmffmpeg.ts` used `createRequire` + `req.resolve(coreSpec())`, which webpack treats as a Critical dependency | IMPLEMENTED — filesystem walk only; `@ffmpeg/core` is `serverExternalPackages` |
| `/episodes` `searchParams` was optional `Promise<Record<…>>` | IMPLEMENTED — required `Promise<{ id?: string \| string[] }>` |
| Command palette `GET /api/mesh` does not exist | IMPLEMENTED — now `GET /api/providers` |
| Command palette `GET /api/capabilities/${id}` does not exist; API is `?id=` and returns `{ capability }` | IMPLEMENTED |
| `:root` never defined `--fg` / `--dim` (used across pages) | IMPLEMENTED |
| No `prefers-reduced-motion` | IMPLEMENTED |
| No root `error.tsx` / `not-found.tsx` | IMPLEMENTED |
| Control-plane failure-scenario select used `as any` | IMPLEMENTED |

## Dependencies (inspected, not force-upgraded)

Web `npm audit` (this tree): 3 advisories via `next@15.5.25` (postcss moderate/high) and `sharp` high. Advertised fixes are Next 16 and sharp 0.35 majors. **Not taken.** CI now fails only on **critical** production-dependency advisories (`npm audit --omit=dev --audit-level=critical`).

Desktop: 14 advisories; advertised fixes are Electron 44 / electron-builder 26 majors. **Not taken.** Desktop audit is not a CI gate.

## Honest leftovers (not claimed as done)

- Anonymous-first identity: sealed session helpers exist; `getUserId` still prefers the anonymous cookie. Changing that would change product behaviour.
- Next 16 / Electron 44 / sharp 0.35 remain majors for a later, inspected upgrade.
- Physical adapters and robotics stay hardware-unverified here (`NOT AVAILABLE` where the registry already says so).
- Command palette API results still surface via `window.alert` (existing UX; URLs are now correct).

## Gate

Run and record: `npm run typecheck`, `npm test`, `npm run eval`, `npm run build`, `npm --prefix desktop run typecheck`. Do not claim a command passed unless it did.

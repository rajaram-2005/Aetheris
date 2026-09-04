# Contributing to Aetheris

Thanks for helping build the open AI workspace. Aetheris is MIT-licensed; every contribution is welcome — new free LLM providers, MCP connectors, agents, translations, docs, bug fixes.

## Quick start
```bash
git clone https://github.com/rajaram-2005/Aetheris && cd Aetheris
npm install
cp .env.example .env.local        # everything is optional; keyless providers work out of the box
npm run dev                       # http://localhost:3000
npm run typecheck && npm test     # before you open a PR
```

## Where things live
| Area | Path |
| --- | --- |
| Provider mesh / router | `src/lib/router/` (providers.ts = catalog) |
| Agents (Hermes ultra → god → domain) | `src/lib/agents/` |
| MCP catalog, gateway, hub | `src/lib/mcp/` |
| Billing, plans, admin | `src/lib/billing/` |
| Accounts & sign-in | `src/lib/auth/`, `src/app/api/auth/` |
| UI | `src/components/`, `src/app/` |
| Tests (`node:test` via tsx) | `tests/` |

## Adding a free LLM provider
1. Add an entry in `src/lib/router/providers.ts` (id, base URL, key page, models, limits, tier).
2. If it isn't OpenAI-compatible, add an adapter in `src/lib/router/adapters.ts`.
3. Add it to the README provider table. Key pages must open in a new tab (`target="_blank"`).

## Adding an MCP connector
Add it to `src/lib/mcp/catalog.ts` with the remote endpoint and auth type, then run `npx tsx scripts/verify-connectors.ts` to check the endpoint answers `initialize`.

## Pull requests
- Small, focused PRs. Describe *why*, link an issue if there is one.
- `npm run typecheck` and `npm test` must pass (CI runs them plus `next build`).
- No secrets, no `data/` fixtures, no generated artifacts.
- Keep credit costs / plan gates consistent (`docs` in README → "Plans").

## Code of conduct
Be kind. See `CODE_OF_CONDUCT.md`.

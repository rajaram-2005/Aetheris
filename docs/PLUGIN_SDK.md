# Plugin SDK

"Give Aetheris a new capability" = one TypeScript module. A plugin registers capabilities in the registry and typed handlers; the platform supplies discovery, permissions, confirmation, observability and an HTTP surface. Source: `src/core/plugins/sdk.ts`; example: `src/plugins/unit-convert.ts`.

```
 src/plugins/my-plugin.ts ── definePlugin({ id, capabilities[], handlers{} })
        │ import in src/plugins/index.ts
        ▼
 Capability Registry  ◀── /api/capabilities, /api/tools, planner, Control Center
        │
 POST /api/plugins/<capabilityId> {args, confirmationToken?}
        │  authorize(security_level, requires_confirmation) ─▶ validateArgs(input_schema) ─▶ handler(args, ctx) ─▶ record(event)
        ▼
 {result} | 403 {error, code, permission} | 400 {error}
```

## Write one

```ts
// src/plugins/hello-github-stars.ts
import { definePlugin } from "@/core/plugins/sdk";

export default definePlugin({
  id: "github-stars", name: "GitHub stars", version: "1.0.0",
  capabilities: [{
    id: "plugin:github-stars.count", name: "Count repo stars", category: "github",
    description: "Star count for a public repository via the GitHub REST API.",
    status: "implemented", verification_status: "unverified",       // set "verified" once a test exercises it
    security_level: "read_only", tags: ["github", "stars"], locality: "remote", latency: "fast",
    input_schema: { type: "object", properties: { repo: { type: "string" } }, required: ["repo"] },
    supported_operations: ["count"],
  }],
  handlers: {
    "plugin:github-stars.count": async ({ repo }, ctx) => {
      const r = await fetch(`https://api.github.com/repos/${repo}`, { signal: ctx.signal, headers: { "User-Agent": "aetheris" } });
      if (!r.ok) throw new Error(`GitHub ${r.status}`);            // fail loudly, never fabricate
      const j = (await r.json()) as { stargazers_count: number };
      ctx.log("fetched", { repo });
      return { repo, stars: j.stargazers_count };
    },
  },
});
```

```ts
// src/plugins/index.ts
import "./unit-convert";
import "./hello-github-stars";
```

Then:

```bash
curl -s localhost:3000/api/plugins
curl -s 'localhost:3000/api/tools?q=stars'
curl -s -X POST localhost:3000/api/plugins/plugin%3Agithub-stars.count -H 'content-type: application/json' -d '{"args":{"repo":"rajaram-2005/Aetheris"}}'
```

## Contract

| Field | Rules |
|---|---|
| `id` | kebab-case, unique; capability ids should be `plugin:<id>.<op>` |
| `capabilities[]` | full `Capability` metadata minus `provider`/`invoke` (filled in); `cost/latency/locality` default to free/fast/local |
| `status` | `implemented · partial · experimental · mocked · not_available` — be honest; `mocked` capabilities must say so in `description` |
| `verification_status` | `verified` only when a test or live call exercised it |
| `security_level` | `read_only · safe_write · full_workspace · admin · physical`; anything that changes the world outside the user's own data is ≥ `safe_write`; irreversible → `requires_confirmation: true` |
| `input_schema` | JSON Schema; `required` and primitive `type`s are enforced before your handler runs |
| handler | `(args, ctx) => result`; `ctx = { uid, workspace?, signal?, log }`; throw on failure |

Every invocation records a `tool` event (latency, ok/fail, plugin id) visible in `/api/telemetry` and the audit export. Denied calls are recorded as `permission` events.

## Rules

* **No secrets in args or prompts.** Read keys from `process.env` inside the handler; document the variable in `.env.example`.
* **User URLs** → run them through `ssrfCheck` from `@/core/security/guard` before fetching.
* **Physical actuation** must go through the device layer (`src/core/physical/devices.ts`), not directly from a plugin — the safety loop lives there.
* **Tests**: add `tests/<plugin>.test.ts` (see `tests/plugins.test.ts`) and flip `verification_status` to `verified`.

## Lifecycle

`definePlugin` → registered on import (`bootCapabilities()` loads `src/plugins/index.ts`). `removePlugin(id)` unregisters (used by tests). There is no runtime install from a URL/npm — Next.js bundles statically, so installation is a one-line import and a rebuild. A dynamic plugin loader is **NOT AVAILABLE** by design (it would be an unaudited code-execution path).

## Status

| Piece | Status |
|---|---|
| Typed `definePlugin`, registry integration, permissioned HTTP invoke, arg validation, events | IMPLEMENTED (tested) |
| Example plugin `unit-convert` | IMPLEMENTED (tested) |
| UI panels contributed by plugins | NOT AVAILABLE (use Control Center → tools to see and call them) |
| Runtime install / marketplace | NOT AVAILABLE by design |

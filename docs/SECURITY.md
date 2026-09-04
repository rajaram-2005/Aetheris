# Security

Principles, in order: **least privilege**, **explicit confirmation for anything irreversible or physical**, **no secrets in prompts**, **everything audited**, **honest about what is not covered**.

```
 request ─▶ middleware (per-IP limits, headers) ─▶ route ─▶ authorize(principal, capability, level, confirmation)
                                                             │ allow                       │ deny (403 {code})
                                                             ▼                             ▼
                                                    rateLimit(uid, class) ─▶ ssrfCheck(url) ─▶ act ─▶ record(event, redacted)
```

## Permission model (`src/core/policy/permissions.ts`)

| Level | Meaning | Default for a user |
|---|---|---|
| `read_only` | read own data, query, inspect | ✔ |
| `safe_write` | create/update own data, send messages via connectors, post PR comments | ✔ |
| `full_workspace` | server sandbox execution, deployments, anything that changes shared state | via `AETHERIS_ADMIN_UIDS` or explicit grant |
| `admin` | policy, telemetry of all users, admin routes | admin identities only |
| `physical` | actuate devices / robots | **never implied** by any level; opt-in per user (`POST /api/devices/optin`), never set by env |

* Capabilities declare `security_level` and `requires_confirmation`. Anything at `full_workspace`/`admin`/`physical` or flagged needs a **single-use confirmation token** (`POST /api/permissions {capabilityId, issue:true}`, 5 min TTL, bound to uid + capability id).
* Per-principal allow/deny lists override level checks; deny always wins.
* **Stop actions are never blocked by a dialog**: device `estop` and robot `estop` need the physical grant but no confirmation.
* Decisions are recorded as `permission` events (allowed and denied).

## Rate limits (`src/core/security/guard.ts`, `src/middleware.ts`)

| Scope | Limit |
|---|---|
| Edge, per IP (middleware) | burst protection on all API routes |
| Per uid `write` | 60 / min |
| Per uid `heavy` (research, jobs, executions, browser) | 12 / min |
| Per uid `physical` | 30 / min |
| Per automation `hook` | 120 / min |

**Honest limit:** counters are in-memory per instance — they reset on restart and are not shared across replicas. There is no WAF. Put a reverse proxy limit or WAF in front of a public host.

## SSRF guard

Every user-supplied URL that the server will fetch — MCP servers, automation webhooks, browser agent, http devices, twins' device links — passes `ssrfCheck`: scheme allow-list, DNS resolution, and rejection of loopback / RFC1918 / link-local / metadata (169.254.169.254) / CGNAT / ULA addresses. `AETHERIS_ALLOW_PRIVATE_URLS=1` disables the private-range rejection for on-prem installs that must reach LAN devices.

## Secrets

* Provider keys come from env or the per-user encrypted BYOK store; they are never placed in prompts, agent briefs, or tool arguments (verified by grep in the audit; no `process.env` in prompt builders).
* The server sandbox runs with an **empty environment** (only PATH/HOME/LANG/TMPDIR).
* The observability buffer redacts `key`, `token`, `secret`, `password`, `authorization` fields and bearer strings before storing events.
* Webhook secrets for automations are shown once to the owner (`GET /api/automations/:id`) and compared with constant-time equality.

## Sandbox (`src/core/execution/sandbox.ts`)

Process isolation, **not a VM**: fresh temp workspace per run (deleted after), path policy (no absolute paths, `..`, `~`, dangerous binaries), interpreter allow-list, hard wall-clock SIGKILL, output caps, empty env, network disabled via `unshare -rn` when user namespaces are permitted (reported per run as `networkIsolated`). Requires `full_workspace` + confirmation. For hostile code, run Aetheris itself in a container/VM.

## Audit

`GET /api/telemetry/audit?since=&format=csv|json` — the caller's permission decisions, device/robot actions, executions and MCP calls, redacted. Admins see all users. Storage is the in-memory ring (`AETHERIS_EVENT_BUFFER`, default 5000): export regularly or ship logs; a persistent audit store is **NOT AVAILABLE** yet.

## Headers

`src/middleware.ts` sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic self-only for Voice mode), `X-DNS-Prefetch-Control: off`, `X-Robots-Tag: noindex` on API routes. **Not set:** `X-Frame-Options`/`frame-ancestors` — Aetheris is designed to be embeddable (shared pages, hosted previews); add `frame-ancestors` at your reverse proxy if you need click-jacking protection. CSP is not enforced yet because the media studio embeds third-party outputs — tracked as **PARTIAL**.

## Reporting

Email security issues to the maintainer listed in `README.md` rather than opening a public issue. This is a volunteer, free project; expect best-effort response.

## Status summary

| Control | Status |
|---|---|
| Capability permission levels + confirmation tokens | IMPLEMENTED (tested) |
| Physical grant separation, e-stop never blocked | IMPLEMENTED (tested) |
| SSRF/DNS guard on all outbound user URLs | IMPLEMENTED (tested; 4 call sites) |
| Rate limits | IMPLEMENTED — per instance, in memory |
| Secret redaction in events | IMPLEMENTED |
| Audit export | IMPLEMENTED — in-memory ring only |
| Sandbox isolation | IMPLEMENTED (process-level), not a VM |
| CSP | PARTIAL |
| WAF / DDoS protection | NOT AVAILABLE (use a proxy) |
| Secret vault / key rotation | NOT AVAILABLE (env + encrypted per-user store) |

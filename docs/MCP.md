# MCP — gateway, hub and registry

Aetheris is both an **MCP client** (it calls servers you register) and an **MCP server** (the Hub exposes all its connectors to Claude Desktop, Cursor, or any MCP client). Neither is a hard-coded list: user-registered servers and the connector catalog both flow into the Capability Registry, so the planner and the `/api/tools` view see one uniform tool space.

```
                        ┌────────── Capability Registry ──────────┐
                        │  tool:<connector>.<tool>  (hub catalog)  │
                        │  mcpserver:<id>.<tool>    (your servers) │
                        └───────────────┬─────────────────────────┘
   MCP clients ──JSON-RPC──▶ /api/mcp/hub ─┤                     ┌──▶ remote MCP servers (Streamable HTTP)
   (Claude, Cursor)                        │   Aetheris          │
                                           └── /api/mcp/servers ─┴──▶ REST gateway connectors (115 typed tools)
```

## 1. Hub — Aetheris as an MCP server (`/api/mcp/hub`)

Streamable-HTTP MCP endpoint. Methods: `initialize`, `tools/list`, `tools/call`. Tool names are `<connectorId>__<tool>` (e.g. `github__search_issues`). Auth: browser session, or `Authorization: Bearer sk-aeth-…` (personal API key — free). Per-connector credentials: stored via `POST /api/mcp/hub/credentials`, OAuth (`/api/mcp/oauth/start`), or per-request `X-Aetheris-Cred-<connectorId>` header. `X-Aetheris-Connectors: github,slack` restricts a session.

Claude Desktop config:

```json
{ "mcpServers": { "aetheris": { "url": "https://your-host/api/mcp/hub", "headers": { "Authorization": "Bearer sk-aeth-…" } } } }
```

Catalog: 107 connectors (`GET /api/mcp/catalog`) — remote MCP servers (Notion, Linear, Sentry, Context7…) proxied with your credentials, plus a REST gateway with 115 typed tools (Discord, Telegram, Twilio, Razorpay, Shopify, Salesforce, Google Workspace, BigQuery…). Registry status per connector is `implemented` for gateway tools and `partial` for remote MCP servers whose live schema is only known after connection; `verification_status` is `untestable_here` because this sandbox has no egress — nothing is faked.

## 2. Gateway — registering your own MCP servers (`src/core/mcp/gateway.ts`)

| Endpoint | Behaviour |
|---|---|
| `POST /api/mcp/servers {name?, url, headers?}` | SSRF check → `initialize` + `tools/list` → store manifest (server info, tool schemas, hash) → **201** healthy / **202** degraded or down. Never reports success without a real handshake. Limit 40 per user. |
| `GET /api/mcp/servers` | servers + summary `{servers, healthy, down, tools}` |
| `GET/POST/PATCH/DELETE /api/mcp/servers/:id` | get · re-probe · `{enabled,name}` · remove |
| `POST /api/mcp/servers/:id/call {tool, args, confirmationToken?}` | args validated against the manifest `inputSchema`; permission from classification; **403** `{error, code, permission}`; **502** on upstream error |

* **Health:** `healthy` / `degraded` (<3 consecutive failures) / `down` (≥3); background sweep every 10 min via the scheduler tick.
* **Versioning:** when the tool-schema hash changes, a version is appended (`versions[]`, max 20) — you can see that a server changed its tools.
* **Permission classification** (from tool name/description, tested): `delete/remove/drop/purge` → safe_write + confirmation; `pay/transfer/deploy/actuate/execute/shutdown` → full_workspace + confirmation; `create/send/update/write/post` → safe_write; else read_only.
* Registry ids: `mcpserver:<id>` and `mcpserver:<id>.<tool>` (provider `mcp-gateway`), searchable with `GET /api/capabilities?q=` and `GET /api/tools?q=`.

Transports: Streamable HTTP (JSON-RPC over POST) **IMPLEMENTED**; SSE legacy transport and stdio servers **NOT AVAILABLE** (run a local HTTP bridge such as `mcp-proxy` for stdio servers).

## 3. Tool routing

The intent router + registry scoring pick tools by query match, category, status, security level and (when known) reliability from events. Agents receive tool descriptions and schemas — never credentials. Every call is a `tool` event with latency and outcome, so reliability is measured, not declared.

## Status

| Piece | Status |
|---|---|
| Hub (Aetheris as MCP server), 107 connectors, OAuth + credential store | IMPLEMENTED (live calls untestable from this sandbox) |
| User-registered MCP servers: probe, manifest, health, versions, schema validation, permissions | IMPLEMENTED (tested with an in-repo mock MCP server) |
| Tool ranking by measured reliability | PARTIAL (events recorded; ranking uses text + status + level) |
| stdio / SSE transports, MCP resources & prompts | NOT AVAILABLE |

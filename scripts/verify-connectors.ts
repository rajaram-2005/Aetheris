/**
 * Probe every remote MCP connector and gateway upstream from a machine with internet access:
 *   npx tsx scripts/verify-connectors.ts
 * For remote MCP servers it sends `initialize`; 200 = open, 401 = alive & needs auth (expected),
 * anything else is flagged. Gateway upstreams get a HEAD/GET on the base URL.
 */
import { CONNECTORS } from "../src/lib/mcp/catalog";
import { APIS } from "../src/lib/gateway/apis";

async function probe(url: string, init?: RequestInit): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal, redirect: "manual" });
    return String(r.status);
  } catch (e) {
    return `ERR ${(e as Error).message.split("\n")[0].slice(0, 60)}`;
  } finally {
    clearTimeout(t);
  }
}

const OK_MCP = new Set(["200", "401", "403", "406"]); // 401/403 = needs auth; 406 = wants SSE accept — server is there
const rows: string[] = [];
let bad = 0;

for (const c of CONNECTORS.filter((c) => c.kind === "remote")) {
  const status = await probe(c.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "aetheris-verify", version: "0" } } }),
  });
  const ok = OK_MCP.has(status);
  if (!ok) bad++;
  rows.push(`${ok ? "✓" : "✗"} remote  ${c.id.padEnd(22)} ${status.padEnd(6)} ${c.url}`);
}
for (const a of APIS.filter((a) => !a.baseUrl.startsWith("internal") && !a.baseUrl.includes("example."))) {
  const status = await probe(a.baseUrl, { method: "GET" });
  const ok = !status.startsWith("ERR");
  if (!ok) bad++;
  rows.push(`${ok ? "✓" : "✗"} gateway ${a.id.padEnd(22)} ${status.padEnd(6)} ${a.baseUrl}`);
}
console.log(rows.join("\n"));
console.log(`\n${rows.length - bad}/${rows.length} reachable`);
process.exit(bad ? 1 : 0);

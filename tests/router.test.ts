/**
 * Failover test for the Aetheris router. Runs against a local mock OpenAI-compatible
 * server so no real API keys are needed:  npm test
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let server: http.Server;
let hits: Record<string, number> = {};

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? "";
    const name = path.split("/")[1];
    hits[name] = (hits[name] ?? 0) + 1;
    if (name === "limited") {
      res.writeHead(429, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "rate limited" } }));
    }
    if (name === "broken") {
      res.writeHead(500);
      return res.end("boom");
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: `hello from ${name}` } }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  // Point three providers at the mock and enable only those.
  const { PROVIDERS } = await import("../src/lib/router/providers");
  for (const p of PROVIDERS) delete process.env[p.envKey];
  const cfg: Record<string, [string, number]> = {
    groq: ["limited", 1],
    cerebras: ["broken", 1],
    openrouter: ["good", 2],
  };
  for (const p of PROVIDERS) {
    const c = cfg[p.id];
    if (!c) continue;
    p.kind = "openai";
    p.baseUrl = `http://127.0.0.1:${port}/${c[0]}`;
    p.priority = c[1];
    p.headers = undefined;
    process.env[p.envKey] = "test-key";
  }
});

after(() => server.close());

test("fails over past rate-limited and broken providers", async () => {
  const { route, meshStatus } = await import("../src/lib/router/router");
  const r = await route({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.provider, "openrouter");
  assert.equal(r.content, "hello from good");
  assert.equal(r.attempts.length, 3);
  assert.equal(r.attempts.filter((a) => !a.ok).length, 2);

  const status = meshStatus();
  assert.equal(status.find((p) => p.id === "groq")?.state, "cooldown");
  assert.equal(status.find((p) => p.id === "cerebras")?.state, "cooldown");
  assert.equal(status.find((p) => p.id === "openrouter")?.state, "ready");
});

test("cooled-down providers are skipped on the next request", async () => {
  const { route } = await import("../src/lib/router/router");
  hits = {};
  const r = await route({ messages: [{ role: "user", content: "again" }] });
  assert.equal(r.provider, "openrouter");
  assert.equal(r.attempts.length, 1);
  assert.equal(hits.limited ?? 0, 0);
  assert.equal(hits.broken ?? 0, 0);
});

test("preferred provider is tried first", async () => {
  const { route } = await import("../src/lib/router/router");
  const r = await route({ messages: [{ role: "user", content: "x" }], preferred: "groq" });
  assert.equal(r.attempts[0].provider, "groq");
  assert.equal(r.attempts[0].ok, false);
  assert.equal(r.provider, "openrouter");
});

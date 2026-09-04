import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let server: http.Server; let port = 0;
before(async () => {
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (req.url === "/fail/chat/completions") { res.writeHead(429); return res.end("rate limited"); }
    if (req.url === "/vision/chat/completions") {
      const parts = body.messages.at(-1).content;
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { content: Array.isArray(parts) ? `parts:${parts.map((p: { type: string }) => p.type).join(",")}` : "text" } }] }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const t of ["Hel", "lo ", "world"]) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
    res.write("data: [DONE]\n\n"); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});
after(() => server.close());

test("openai adapter streams deltas and concatenates", async () => {
  const { callProvider } = await import("../src/lib/router/adapters");
  const deltas: string[] = [];
  const out = await callProvider({
    provider: { id: "t", name: "T", kind: "openai", baseUrl: `http://127.0.0.1:${port}`, envKey: "X", model: "m", priority: 1 },
    model: "m", apiKey: "k", messages: [{ role: "user", content: "hi" }], onDelta: (t) => deltas.push(t),
  });
  assert.equal(out, "Hello world");
  assert.deepEqual(deltas, ["Hel", "lo ", "world"]);
});

test("images become multimodal content parts; non-vision providers are rejected", async () => {
  const { callProvider } = await import("../src/lib/router/adapters");
  const msgs = [{ role: "user" as const, content: "what is this", images: ["data:image/png;base64,AAAA"] }];
  const out = await callProvider({ provider: { id: "v", name: "V", kind: "openai", baseUrl: `http://127.0.0.1:${port}/vision`, envKey: "X", model: "m", priority: 1, vision: true }, model: "m", apiKey: "k", messages: msgs });
  assert.equal(out, "parts:text,image_url");
  await assert.rejects(callProvider({ provider: { id: "n", name: "N", kind: "openai", baseUrl: `http://127.0.0.1:${port}`, envKey: "X", model: "m", priority: 1 }, model: "m", apiKey: "k", messages: msgs }), /does not accept images/);
});

test("router: silent failover before first token, vision-only candidate filtering", async () => {
  process.env.T_FAIL = "k"; process.env.T_OK = "k";
  const { PROVIDERS } = await import("../src/lib/router/providers");
  const { route, orderedCandidates } = await import("../src/lib/router/router");
  PROVIDERS.push(
    { id: "t_fail", name: "F", kind: "openai", baseUrl: `http://127.0.0.1:${port}/fail`, envKey: "T_FAIL", model: "m", priority: 0 },
    { id: "t_ok", name: "O", kind: "openai", baseUrl: `http://127.0.0.1:${port}`, envKey: "T_OK", model: "m", priority: 1, vision: true, visionModel: "mv" },
  );
  const deltas: string[] = [];
  const r = await route({ messages: [{ role: "user", content: "hi" }], onDelta: (t) => deltas.push(t) });
  assert.equal(r.provider, "t_ok");
  assert.equal(r.content, "Hello world");
  assert.equal(r.attempts.length, 2);
  assert.equal(r.attempts[0].ok, false);
  assert.ok(orderedCandidates({ vision: true }).every((p) => p.vision));
});

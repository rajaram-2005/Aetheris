import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let server: http.Server; let port = 0;
const seen: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];

before(async () => {
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    seen.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (req.url?.startsWith("/fail")) { res.writeHead(429); return res.end("slow down"); }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});
after(() => server.close());

test("engine: path/query/body templating, bearer auth, JSON pretty-print", async () => {
  const { executeTool } = await import("../src/lib/gateway/engine");
  const api = {
    id: "t", name: "T", baseUrl: `http://127.0.0.1:${port}`, auth: { in: "header" as const, name: "Authorization", prefix: "Bearer " },
    tools: [{ name: "send", description: "", params: { ch: { type: "string" as const, required: true }, text: { type: "string" as const, required: true }, limit: { type: "integer" as const } },
      path: "/channels/{ch}/messages", query: { limit: "{limit}", fixed: 1 }, body: { content: "{text}", nested: { a: "{text}!" } } }],
  };
  const out = await executeTool(api, api.tools[0], { ch: "a b", text: "hi" }, "tok");
  const r = seen.at(-1)!;
  assert.equal(r.method, "POST");
  assert.equal(r.url, "/channels/a%20b/messages?fixed=1");   // unset {limit} dropped
  assert.equal(r.headers.authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(r.body), { content: "hi", nested: { a: "hi!" } });
  assert.match(out, /"ok": true/);
  await assert.rejects(executeTool(api, api.tools[0], { ch: "x" }, "tok"), /missing required argument "text"/);
  await assert.rejects(executeTool(api, api.tools[0], { ch: "x", text: "y" }), /requires a credential/);
});

test("engine: query auth, basic auth, arg auth, form bodies, upstream errors", async () => {
  const { executeTool } = await import("../src/lib/gateway/engine");
  const base = `http://127.0.0.1:${port}`;
  await executeTool({ id: "q", name: "Q", baseUrl: base, auth: { in: "query", name: "key" }, tools: [] }, { name: "x", description: "", path: "/q" }, {}, "K");
  assert.equal(seen.at(-1)!.url, "/q?key=K");
  await executeTool({ id: "b", name: "B", baseUrl: base, auth: { in: "basic" }, tools: [] }, { name: "x", description: "", path: "/b", form: true, body: { A: "{a}" } }, { a: "1 2" }, "u:p");
  assert.equal(seen.at(-1)!.headers.authorization, "Basic " + Buffer.from("u:p").toString("base64"));
  assert.equal(seen.at(-1)!.body, "A=1+2");
  await executeTool({ id: "a", name: "A", baseUrl: base, auth: { in: "arg", name: "token" }, tools: [] }, { name: "x", description: "", path: "/bot{token}/getMe" }, {}, "T0K");
  assert.equal(seen.at(-1)!.url, "/botT0K/getMe");
  await assert.rejects(executeTool({ id: "f", name: "F", baseUrl: base, auth: { in: "none" }, tools: [] }, { name: "x", description: "", path: "/fail" }, {}), /429: slow down/);
});

test("gateway serves MCP: our own McpClient can list and call tools through handleRpc", async () => {
  const { handleRpc } = await import("../src/lib/gateway/engine");
  const { McpClient } = await import("../src/lib/mcp/client");
  const api = { id: "g", name: "G", baseUrl: `http://127.0.0.1:${port}`, auth: { in: "none" as const }, tools: [{ name: "ping", description: "Ping", params: { who: { type: "string" as const, required: true } }, path: "/ping/{who}" }] };
  // Stand up a tiny MCP endpoint backed by handleRpc
  const mcp = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const out = await handleRpc(api, JSON.parse(Buffer.concat(chunks).toString()));
    if (out === null) { res.writeHead(202); return res.end(); }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(out));
  });
  await new Promise<void>((r) => mcp.listen(0, "127.0.0.1", r));
  const mport = (mcp.address() as { port: number }).port;
  try {
    const c = new McpClient({ url: `http://127.0.0.1:${mport}/` });
    const tools = await c.listTools();
    assert.deepEqual(tools.map((t) => t.name), ["ping"]);
    assert.deepEqual(tools[0].inputSchema, { type: "object", properties: { who: { type: "string" } }, required: ["who"] });
    const out = await c.callTool("ping", { who: "aetheris" });
    assert.match(out, /\/ping\/aetheris/);
    await assert.rejects(c.callTool("nope", {}), /unknown tool/);
  } finally { mcp.close(); }
});

test("every gateway connector in the catalog has an API definition with ≥1 tool and valid templates", async () => {
  const { CONNECTORS } = await import("../src/lib/mcp/catalog");
  const { apiById, APIS } = await import("../src/lib/gateway/apis");
  const gw = CONNECTORS.filter((c) => c.kind === "gateway");
  assert.ok(gw.length >= 40, `gateway connectors: ${gw.length}`);
  for (const c of gw) {
    const api = apiById(c.id);
    assert.ok(api, `missing API def for ${c.id}`);
    assert.ok(api!.tools.length >= 1, `${c.id} has no tools`);
    assert.equal(c.url, `/api/gateway/${c.id}`);
    for (const t of api!.tools) {
      // every {placeholder} in path/query must be a declared param (or the auth arg)
      const declared = new Set(Object.keys(t.params ?? {}));
      if (api!.auth.in === "arg") declared.add(api!.auth.name);
      if (t.prepare) continue; // prepare() may derive extra names
      const refs = [...(t.path + " " + Object.values(t.query ?? {}).join(" ")).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]);
      for (const r of refs) assert.ok(declared.has(r), `${c.id}.${t.name} references undeclared {${r}}`);
    }
  }
  assert.equal(new Set(APIS.map((a) => a.id)).size, APIS.length, "duplicate API ids");
  assert.ok(!CONNECTORS.some((c) => c.url.includes("example.com")), "no placeholder URLs remain");
  assert.ok(CONNECTORS.length >= 100, `catalog has ${CONNECTORS.length} connectors`);
});

test("agent binds gateway connectors in-process and executes tools", async () => {
  const { PROVIDERS } = await import("../src/lib/router/providers");
  for (const p of PROVIDERS) delete process.env[p.envKey];
  const llm = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const b = JSON.parse(Buffer.concat(chunks).toString());
    const last = b.messages.at(-1).content as string;
    const content = last.startsWith("TOOL RESULT") ? `Front page fetched: ${last.includes('"ok": true') ? "ok" : "??"}` : '<tool_call>{"name":"hackernews.front_page","arguments":{}}</tool_call>';
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise<void>((r) => llm.listen(0, "127.0.0.1", r));
  const lport = (llm.address() as { port: number }).port;
  PROVIDERS.find((p) => p.id === "groq")!.baseUrl = `http://127.0.0.1:${lport}`;
  process.env.GROQ_API_KEY = "k";
  const { APIS } = await import("../src/lib/gateway/apis");
  APIS.find((a) => a.id === "hackernews")!.baseUrl = `http://127.0.0.1:${port}`;  // point HN at the mock
  try {
    const { runAgent } = await import("../src/lib/mcp/agent");
    const r = await runAgent({ messages: [{ role: "user", content: "what's on HN?" }], servers: [{ id: "hackernews" }] });
    assert.equal(r.failures.length, 0);
    assert.equal(r.toolEvents.filter((e) => e.type === "tool_result").length, 1);
    assert.match(r.content, /Front page fetched: ok/);
    assert.match(seen.at(-1)!.url, /^\/search\?tags=front_page/);
  } finally { llm.close(); }
});

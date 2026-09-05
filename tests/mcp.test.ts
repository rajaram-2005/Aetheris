import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let server: http.Server;
let port = 0;
const seenAuth: string[] = [];

before(async () => {
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString();
    const json = (o: unknown) => { res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "s1" }); res.end(JSON.stringify(o)); };

    if (req.url === "/mcp") {
      seenAuth.push(req.headers.authorization ?? "");
      const m = JSON.parse(body);
      if (m.method === "initialize") return json({ jsonrpc: "2.0", id: m.id, result: { serverInfo: { name: "mock" } } });
      if (m.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
      if (m.method === "tools/list") return json({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "get_weather", description: "Weather for a city", inputSchema: { type: "object", properties: { city: { type: "string" } } } }] } });
      if (m.method === "tools/call") {
        // Respond as SSE to exercise that path
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `Sunny, 31°C in ${m.params.arguments.city}` }] } })}\n\n`);
      }
    }
    if (req.url === "/llm/chat/completions") {
      const b = JSON.parse(body);
      const last = b.messages[b.messages.length - 1].content as string;
      const content = last.startsWith("TOOL RESULT")
        ? `It is ${last.split(":").pop()?.trim()} — a good day for Marina beach.`
        : '<tool_call>{"name":"weather.get_weather","arguments":{"city":"Chennai"}}</tool_call>';
      return json({ choices: [{ message: { content } }] });
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;

  const { PROVIDERS } = await import("../src/lib/router/providers");
  for (const p of PROVIDERS) delete process.env[p.envKey];
  const groq = PROVIDERS.find((p) => p.id === "groq")!;
  groq.baseUrl = `http://127.0.0.1:${port}/llm`;
  process.env.GROQ_API_KEY = "k";
});
after(() => server.close());

test("McpClient: initialize, list tools, call tool (JSON + SSE responses)", async () => {
  const { McpClient } = await import("../src/lib/mcp/client");
  const c = new McpClient({ url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: "Bearer t0k" } });
  const tools = await c.listTools();
  assert.equal(tools[0].name, "get_weather");
  const out = await c.callTool("get_weather", { city: "Madurai" });
  assert.match(out, /Madurai/);
  assert.ok(seenAuth.every((a) => a === "Bearer t0k"), "credential forwarded on every call");
});

test("agent loop: model calls tool, gets result, answers", async () => {
  const { runAgent } = await import("../src/lib/mcp/agent");
  const r = await runAgent({
    messages: [{ role: "system", content: "sys" }, { role: "user", content: "weather in Chennai?" }],
    servers: [{ id: "weather", url: `http://127.0.0.1:${port}/mcp`, credential: "abc", headerName: "Authorization", headerPrefix: "Bearer " }],
  });
  assert.equal(r.rounds, 1);
  assert.equal(r.toolEvents.filter((e) => e.type === "tool_call").length, 1);
  assert.equal(r.toolEvents.find((e) => e.type === "tool_result")?.result, "Sunny, 31°C in Chennai");
  assert.match(r.content, /Marina beach/);
  assert.doesNotMatch(r.content, /<tool_call>/);
});

test("catalog: 90+ connectors, unique ids, featured set present", async () => {
  const { CONNECTORS } = await import("../src/lib/mcp/catalog");
  assert.ok(CONNECTORS.length >= 90, `got ${CONNECTORS.length}`);
  assert.equal(new Set(CONNECTORS.map((c) => c.id)).size, CONNECTORS.length);
  for (const id of ["notion", "slack", "figma", "stripe", "razorpay", "github"]) assert.ok(CONNECTORS.some((c) => c.id === id), id);
});

test("media router: fails over between providers and honours BYOK", async () => {
  const media = await import("../src/lib/media/providers");
  const calls: string[] = [];
  media.ADAPTERS["hf-flux"] = async () => { calls.push("hf"); throw new Error("503 loading"); };
  media.ADAPTERS["fal-flux"] = async (g) => { calls.push("fal:" + g.apiKey); return { url: "https://x/img.png", mime: "image/png" }; };
  process.env.HF_TOKEN = "hf";
  const { generateMedia } = await import("../src/lib/media/router");
  const r = await generateMedia({ kind: "image", prompt: "a cat", userKeys: { "fal-flux": "user-fal-key" } });
  assert.equal(r.provider, "fal-flux");
  assert.deepEqual(calls, ["hf", "fal:user-fal-key"]);
  assert.equal(r.attempts.length, 2);
  await assert.rejects(generateMedia({ kind: "video", prompt: "x" }), /No video provider configured/);
});

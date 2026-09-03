import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let server: http.Server; let origin = "";
const posts: { url: string; body: string }[] = [];

before(async () => {
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString();
    const json = (o: unknown, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url === "/.well-known/oauth-protected-resource/mcp") return json({ resource: `${origin}/mcp`, authorization_servers: [`${origin}/auth`], scopes_supported: ["read"] });
    if (req.url === "/.well-known/oauth-authorization-server/auth") return json({ issuer: `${origin}/auth`, authorization_endpoint: `${origin}/auth/authorize`, token_endpoint: `${origin}/auth/token`, registration_endpoint: `${origin}/auth/register`, code_challenge_methods_supported: ["S256"] });
    if (req.url === "/auth/register") { posts.push({ url: req.url, body }); return json({ client_id: "dyn-client-1" }, 201); }
    if (req.url === "/auth/token") { posts.push({ url: req.url, body }); return json({ access_token: "AT", refresh_token: "RT", expires_in: 3600 }); }
    json({ error: "not found" }, 404);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

test("MCP OAuth: discovery → dynamic registration → PKCE code exchange → refresh", async () => {
  const { discover, registerClient, pkce, exchangeCode, refreshToken } = await import("../src/lib/mcp/oauth");
  const d = await discover(`${origin}/mcp`);
  assert.equal(d.as.authorization_endpoint, `${origin}/auth/authorize`);
  assert.equal(d.resource, `${origin}/mcp`);
  assert.deepEqual(d.scopes, ["read"]);

  const clientId = await registerClient(d.as, "http://app/cb");
  assert.equal(clientId, "dyn-client-1");
  const reg = JSON.parse(posts.find((p) => p.url === "/auth/register")!.body);
  assert.deepEqual(reg.redirect_uris, ["http://app/cb"]);
  assert.equal(reg.token_endpoint_auth_method, "none");

  const { verifier, challenge } = pkce();
  assert.notEqual(verifier, challenge);
  assert.equal(challenge.length, 43);

  const tok = await exchangeCode(d.as, { code: "c0de", verifier, clientId, redirectUri: "http://app/cb", resource: d.resource });
  const form = new URLSearchParams(posts.find((p) => p.url === "/auth/token")!.body);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code_verifier"), verifier);
  assert.equal(form.get("resource"), `${origin}/mcp`);
  assert.equal(tok.access_token, "AT");
  assert.ok(tok.expires_at! > Date.now());

  const refreshed = await refreshToken(tok);
  assert.equal(refreshed?.access_token, "AT");
  assert.equal(new URLSearchParams(posts.at(-1)!.body).get("grant_type"), "refresh_token");
});

test("discovery fails cleanly for servers without OAuth metadata", async () => {
  const { discover } = await import("../src/lib/mcp/oauth");
  await assert.rejects(discover(`${origin}/plain`), /No OAuth metadata/);
});

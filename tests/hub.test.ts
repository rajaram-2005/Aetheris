import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

before(() => { process.env.AETHERIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-hub-")); });

test("hub lists meta + gateway tools without network, namespaced <connector>__<tool>", async () => {
  const { listHubTools, handleHubRpc, hubSummary, SEP } = await import("../src/lib/mcp/hub");
  const ctx = { uid: "h1", creds: {}, oauthTokens: {} };
  const { tools } = await listHubTools(ctx, { eager: false });
  assert.ok(tools.some((t) => t.name === `hub${SEP}search_tools`));
  assert.ok(tools.filter((t) => t.connector !== "hub").length > 50, "gateway tools present");
  assert.ok(tools.every((t) => t.name.includes(SEP)));
  const sum = hubSummary();
  assert.ok(sum.connectors >= 100);
  const init = await handleHubRpc(ctx, { jsonrpc: "2.0", id: 1, method: "initialize" }) as { result: { serverInfo: { name: string } } };
  assert.equal(init.result.serverInfo.name, "aetheris-hub");
  const list = await handleHubRpc(ctx, { jsonrpc: "2.0", id: 2, method: "tools/list" }) as { result: { tools: { name: string }[] } };
  assert.equal(list.result.tools.length, tools.length);
});

test("hub search + connectors meta-tools; missing credential is a clear error", async () => {
  const { callHubTool, setStoredCred, getStoredCreds } = await import("../src/lib/mcp/hub");
  const ctx = { uid: "h2", creds: {}, oauthTokens: {} };
  const found = await callHubTool(ctx, "hub__search_tools", { query: "issue" });
  assert.match(found, /__/);
  const cons = await callHubTool(ctx, "hub__connectors", { category: "dev" });
  assert.match(cons, /github/i);
  await assert.rejects(callHubTool(ctx, "nope__x", {}), /unknown connector/);
  // stored creds are sealed at rest
  await setStoredCred("h2", "slack", "xoxb-secret");
  const raw = fs.readFileSync(path.join(process.env.AETHERIS_DATA_DIR!, "hubcreds.json"), "utf8");
  assert.equal(raw.includes("xoxb-secret"), false);
  assert.deepEqual(await getStoredCreds("h2"), { slack: "xoxb-secret" });
});

test("joined: legacy hub tools go through the execution policy (destructive verbs need confirmation)", async () => {
  const { callHubTool } = await import("../src/lib/mcp/hub");
  const { issueConfirmation } = await import("../src/core/policy/permissions");
  const ctx = { uid: "hub-policy-" + Date.now(), creds: {}, oauthTokens: {} } as unknown as Parameters<typeof callHubTool>[0];
  // read-only tool → passes policy and fails later only on the missing credential/network (not on permission)
  await assert.rejects(() => callHubTool(ctx, "github__search_issues", { q: "x" }), (e: Error) => !/permission:/.test(e.message));
  // delete verb → confirmation required
  await assert.rejects(() => callHubTool(ctx, "trello__delete_card", { id: "1" }), /confirmation/);
  const token = issueConfirmation(ctx.uid, "tool:trello.delete_card");
  await assert.rejects(() => callHubTool({ ...ctx, confirmationToken: token }, "trello__delete_card", { id: "1" }), (e: Error) => !/permission:/.test(e.message));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { registerSource, searchCapabilities, scoreCapability, registrySummary, invalidate } from "../src/core/capabilities/registry";
import type { Capability } from "../src/core/capabilities/types";
import { decide, issueConfirmation, hasLevel, principalFor, type Principal } from "../src/core/policy/permissions";
import { record, query, summary, clear, traced } from "../src/core/observability/events";
import { checkSafety, type Command, type DigitalTwin } from "../src/core/physical/interfaces";
import { routeIntent } from "../src/core/intent/router";
import { bootCapabilities } from "../src/core/capabilities/sources";

const cap = (o: Partial<Capability> & Pick<Capability, "id" | "name" | "category">): Capability => ({ description: "", provider: "t", status: "implemented", tags: [], security_level: "read_only", cost: { unit: "free" }, latency: "fast", supported_operations: [], verification_status: "verified", locality: "local", ...o });

test("registry: sources merge, dedupe, search ranks name/tags over description and downweights non-working status", async () => {
  registerSource({ id: "t1", list: () => [cap({ id: "x:pdf", name: "PDF reader", category: "tool", tags: ["pdf", "documents"] }), cap({ id: "x:dup", name: "Dup", category: "tool" })] });
  registerSource({ id: "t2", list: () => [cap({ id: "x:dup", name: "Dup2", category: "tool" }), cap({ id: "x:pdf-mock", name: "PDF reader (mock)", category: "tool", tags: ["pdf"], status: "mocked" }), cap({ id: "x:na", name: "PDF robot", category: "robot", status: "not_available", tags: ["pdf"] })] });
  invalidate();
  const r = await searchCapabilities({ q: "read my pdf" });
  assert.equal(r[0].id, "x:pdf"); assert.ok(!r.some((c) => c.id === "x:na"), "not_available scores 0");
  assert.ok(scoreCapability(r[0], "pdf") > scoreCapability(r.find((c) => c.id === "x:pdf-mock")!, "pdf"));
  const s = await registrySummary(); assert.equal(s.byCategory.tool, 3); assert.ok(s.total >= 4);
  assert.equal((await searchCapabilities({ category: "robot" })).length, 1);
  assert.equal((await searchCapabilities({ maxSecurity: "read_only" })).length, 4);
});

test("policy: least privilege, physical never implied, confirmation tokens single-use and bound", () => {
  const p: Principal = { uid: "u1", grants: ["read_only", "safe_write"] };
  assert.ok(hasLevel(p, "safe_write") && !hasLevel(p, "full_workspace") && !hasLevel(p, "physical"));
  assert.ok(!hasLevel({ uid: "a", grants: ["admin"] }, "physical"), "admin does not imply physical");
  assert.equal(decide({ principal: p, capabilityId: "c:read", required: "read_only" }).allow, true);
  const d1 = decide({ principal: p, capabilityId: "c:fw", required: "full_workspace" }); assert.equal(d1.allow, false); assert.equal((d1 as { code: string }).code, "insufficient_level");
  const d2 = decide({ principal: p, capabilityId: "c:del", required: "safe_write", requiresConfirmation: true }); assert.equal((d2 as { code: string }).code, "needs_confirmation");
  const tok = issueConfirmation("u1", "c:del");
  assert.equal(decide({ principal: p, capabilityId: "c:other", required: "safe_write", requiresConfirmation: true, confirmationToken: tok }).allow, false, "token bound to capability");
  const tok2 = issueConfirmation("u1", "c:del");
  assert.equal(decide({ principal: p, capabilityId: "c:del", required: "safe_write", requiresConfirmation: true, confirmationToken: tok2 }).allow, true);
  assert.equal((decide({ principal: p, capabilityId: "c:del", required: "safe_write", requiresConfirmation: true, confirmationToken: tok2 }) as { code: string }).code, "bad_token", "single use");
  assert.equal(decide({ principal: { ...p, deny: ["c:read"] }, capabilityId: "c:read", required: "read_only" }).allow, false);
  assert.equal(decide({ principal: { ...p, allow: ["c:fw"] }, capabilityId: "c:fw", required: "full_workspace" }).allow, false, "allow-list still needs confirmation for full_workspace");
  assert.deepEqual(principalFor("nobody").grants, ["read_only", "safe_write"]);
});

test("observability: ring buffer, query filters, summary and traced()", async () => {
  clear();
  record({ type: "model", capability: "model:a", ok: true, ms: 10 }); record({ type: "model", capability: "model:a", ok: false, ms: 30, detail: "boom" }); record({ type: "tool", uid: "u", capability: "tool:x", ok: true, ms: 5 });
  await assert.rejects(traced({ type: "mcp", capability: "tool:y" }, async () => { throw new Error("nope"); }));
  assert.equal(query({}).length, 4); assert.equal(query({ type: "model" }).length, 2); assert.equal(query({ okOnly: false }).length, 2);
  assert.equal(query({ uid: "u" }).length, 4, "system events (no uid) are visible alongside the user's own");
  const s = summary(); assert.equal(s.events, 4); assert.equal(s.errors, 2); assert.equal(s.byType.model.avgMs, 20);
});

test("physical safety policy refuses blind, unconfirmed or out-of-limit actuation", () => {
  const twin: DigitalTwin = { device: { id: "pump1", name: "Pump", transport: "modbus-tcp", sensors: [], actuators: [{ id: "speed", kind: "pump", limits: { rpm: { min: 0, max: 1500 } } }] }, state: {}, lastReadings: {}, events: [], maintenance: [], relationships: [], updatedAt: Date.now() };
  const cmd: Command = { deviceId: "pump1", actuator: "speed", kind: "pump", action: "set", params: { rpm: 900 }, uid: "u", confirmationToken: "t" };
  assert.ok(checkSafety(cmd, twin).ok);
  assert.deepEqual(checkSafety({ ...cmd, params: { rpm: 2000 } }, twin).failures.map((f) => f.rule), ["within-limits"]);
  assert.deepEqual(checkSafety({ ...cmd, confirmationToken: undefined }, twin).failures.map((f) => f.rule), ["confirmed"]);
  assert.ok(checkSafety(cmd, { ...twin, updatedAt: Date.now() - 10 * 60_000 }).failures.some((f) => f.rule === "fresh-telemetry"));
  assert.ok(checkSafety(cmd, undefined).failures.length >= 2);
});

test("intent router classifies tasks, honours @agent and /mode overrides, flags physical as unavailable", async () => {
  bootCapabilities(); invalidate();
  const a = await routeIntent("Connect my ESP32 temperature sensor over MQTT and alert me above 60C");
  assert.equal(a.task, "device"); assert.ok(a.needs.physical && a.needs.confirmation); assert.match(a.explanation, /not available/);
  assert.equal((await routeIntent("quiz me on fractions")).mode, "study");
  assert.equal((await routeIntent("every morning at 7 send me a briefing")).mode, "schedules");
  const m = await routeIntent("@lawyer review this contract clause"); assert.deepEqual(m.agents, ["lawyer"]);
  assert.equal((await routeIntent("/studio a poster for diwali")).mode, "studio");
  const d = await routeIntent("send a message to my discord channel"); assert.ok(d.connectors.includes("tool:discord.send_message"));
  assert.equal((await routeIntent("hello there")).task, "general");
});

test("stopAction bypasses confirmation but not level", () => {
  const phys: Principal = { uid: "u", grants: ["read_only", "safe_write", "physical"] };
  assert.equal(decide({ principal: phys, capabilityId: "device:x.estop", required: "physical", stopAction: true }).allow, true);
  assert.equal(decide({ principal: phys, capabilityId: "device:x.pump", required: "physical" }).allow, false);
  assert.equal(decide({ principal: principalFor("u"), capabilityId: "device:x.estop", required: "physical", stopAction: true }).allow, false);
});

test("security guard: rate limit, private IP, ssrf, redaction", async () => {
  const { rateLimit, isPrivateIp, ssrfCheck, redactSecrets, toCsv } = await import("../src/core/security/guard");
  const k = `k${Date.now()}`; assert.equal(rateLimit(k, { limit: 2, windowMs: 1000 }).ok, true); assert.equal(rateLimit(k, { limit: 2, windowMs: 1000 }).ok, true); const r = rateLimit(k, { limit: 2, windowMs: 1000 }); assert.equal(r.ok, false); assert.ok(r.retryAfterSec >= 1);
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fe80::1", "::ffff:127.0.0.1"]) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1"]) assert.equal(isPrivateIp(ip), false, ip);
  assert.equal((await ssrfCheck("http://127.0.0.1:3000/x", { allowHttp: true })).ok, false);
  assert.equal((await ssrfCheck("http://example.com/")).ok, false); // http not allowed by default
  assert.equal((await ssrfCheck("https://user:pw@example.com/")).ok, false);
  assert.equal((await ssrfCheck("http://169.254.169.254/latest", { allowHttp: true, allowPrivate: true })).ok, false); // metadata always blocked
  assert.equal((await ssrfCheck("http://192.168.1.50/state", { allowHttp: true, allowPrivate: true })).ok, true);
  assert.equal((await ssrfCheck("https://8.8.8.8/")).ok, true);
  const red = redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz key gsk_1234567890abcdefXYZ "password":"hunter22"');
  assert.ok(!red.includes("abcdefghijklmnopqrstuvwxyz") && !red.includes("1234567890abcdef") && !red.includes("hunter22"), red);
  assert.equal(toCsv([{ a: 1, b: 'x"y' }]), 'a,b\n"1","x""y"');
});

test("workspaces: default exists, create/update/delete, stats computed", async () => {
  const ws = await import("../src/core/workspaces/workspaces");
  const uid = "ws-test-" + Date.now();
  const list = await ws.listWorkspaces(uid); assert.equal(list.length, 1); assert.equal(list[0].name, "Default");
  const w = await ws.createWorkspace(uid, { name: "Factory line 3", tags: ["plc"] });
  assert.equal((await ws.listWorkspaces(uid)).length, 2);
  assert.equal((await ws.updateWorkspace(uid, w.id, { name: "Line 3" }))?.name, "Line 3");
  const st = await ws.workspaceStats(uid, w); assert.equal(st.facts, 0); assert.equal(st.scope, ws.scopeOf(w));
  assert.equal(await ws.deleteWorkspace(uid, list[0].id), false);
  assert.equal(await ws.deleteWorkspace(uid, w.id), true);
  assert.equal(await ws.getWorkspace("other", list[0].id), undefined);
});

test("workspaces: sharing gives a member read scope, a role, and no more than that", async () => {
  const ws = await import("../src/core/workspaces/workspaces");
  const owner = "a".repeat(32); // real uids are 32-hex (src/lib/user.ts); the data dir is fresh per run
  const mate = "b".repeat(32);
  const stranger = "c".repeat(32);

  const w = await ws.createWorkspace(owner, { name: "Shared lab", tags: ["demo"] });
  const owned = await ws.listWorkspaces(owner);

  // The default workspace holds the user's unscoped data, so it is not shareable.
  await assert.rejects(() => ws.addMember(owner, owned[0].id, { member: mate }), /default workspace/);
  await assert.rejects(() => ws.addMember(owner, w.id, { member: owner }), /already own/);
  await assert.rejects(() => ws.addMember(owner, w.id, { member: mate, role: "owner" }), /editor.*viewer/);
  await assert.rejects(() => ws.addMember(owner, w.id, { member: "" }), /member required/);
  // Only a real user id can authenticate, so only a real user id can be shared with.
  await assert.rejects(() => ws.addMember(owner, w.id, { member: "mate-1" }), /32-character user id/);

  const shared = await ws.addMember(owner, w.id, { member: mate, role: "viewer" });
  assert.equal(shared.members?.length, 1);
  assert.deepEqual((await ws.listMembers(mate, w.id))?.members, [{ uid: mate, role: "viewer", addedAt: shared.members![0].addedAt }]);

  // What the member can see: the shared scope, with its role, plus its own workspaces.
  const scopes = await ws.readableScopes(mate);
  const sharedScope = scopes.find((s) => s.workspaceId === w.id);
  assert.ok(sharedScope, `shared scope missing from ${JSON.stringify(scopes.map((s) => s.workspaceId))}`);
  assert.equal(sharedScope.uid, owner, "the member reads the OWNER's data, under the owner's uid");
  assert.equal(sharedScope.workspace, ws.scopeOf(w));
  assert.equal(sharedScope.role, "viewer");
  assert.equal((await ws.accessWorkspace(mate, w.id))?.role, "viewer");
  assert.equal((await ws.accessWorkspace(stranger, w.id)), null, "a non-member gets nothing");
  assert.deepEqual((await ws.listSharedWorkspaces(stranger)).length, 0);
  assert.equal(await ws.getWorkspace(mate, w.id), undefined, "getWorkspace stays owner-only");
  assert.equal((await ws.workspaceStats(mate, w)).role, "viewer");

  // Re-rolling, then leaving.
  await ws.setMemberRole(owner, w.id, mate, "editor");
  assert.equal((await ws.accessWorkspace(mate, w.id))?.role, "editor");
  await assert.rejects(() => ws.setMemberRole(owner, w.id, stranger, "editor"), /not a member/);
  assert.equal(await ws.removeMember(stranger, w.id, stranger), null, "a non-member cannot remove anyone");
  assert.equal(await ws.removeMember(mate, w.id, owner), null, "a member cannot remove the owner");
  const left = await ws.removeMember(mate, w.id, mate);
  assert.equal(left?.members?.length, 0, "a member can remove itself");
  assert.equal(await ws.accessWorkspace(mate, w.id), null);

  // A missing id must be "not found", not a crash: norm() used to throw on an undefined record.
  assert.equal(await ws.accessWorkspace(owner, "nobody:nope"), null);
  assert.equal(await ws.accessWorkspace(owner, ""), null);
  assert.equal(await ws.getWorkspace(owner, "nobody:nope"), undefined);
  assert.equal((await ws.listMembers(owner, "nobody:nope")), null);
  assert.equal(await ws.removeMember(owner, "nobody:nope", mate), null);

  // Only the owner may change membership.
  const b = await ws.createWorkspace(mate, { name: "Mine" });
  assert.equal((await ws.listMembers(owner, b.id)), null, "the owner of A has no access to B's workspace");
  assert.equal((await ws.workspaceStats(owner, w)).members, 0);
});

test("workspaces: the member routes are guarded and the knowledge route reads through readableScopes", async () => {
  const fs = await import("node:fs"); const path = await import("node:path");
  const root = path.join(__dirname, "..");
  const members = fs.readFileSync(path.join(root, "src/app/api/workspaces/[id]/members/route.ts"), "utf8");
  assert.match(members, /authorize\(\{ principal: principalFor\(uid\), capabilityId: "workspace:share"/, "POST /members must go through authorize()");
  assert.match(members, /accessWorkspace\(uid, id\)/, "GET /members must resolve access, not ownership alone");
  const memberRoute = fs.readFileSync(path.join(root, "src/app/api/workspaces/[id]/members/[member]/route.ts"), "utf8");
  assert.match(memberRoute, /access\.role !== "owner"/, "PATCH must be owner-only");
  assert.match(memberRoute, /removeMember\(uid, id, member\)/);
  const knowledge = fs.readFileSync(path.join(root, "src/app/api/knowledge/route.ts"), "utf8");
  assert.match(knowledge, /readableScopes\(uid\)/, "/api/knowledge must resolve shared workspaces through readableScopes()");
  assert.match(knowledge, /workspace not found/, "an unknown or unshared scope is a 404, not a silent empty result");
  const verify = fs.readFileSync(path.join(root, "src/app/api/verify/route.ts"), "utf8");
  assert.match(verify, /authorize\(\{ principal: principalFor\(uid\), capabilityId: "execution:server-sandbox"/, "the test loop executes commands, so it must be authorised");
});

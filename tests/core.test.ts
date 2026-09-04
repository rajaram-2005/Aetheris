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

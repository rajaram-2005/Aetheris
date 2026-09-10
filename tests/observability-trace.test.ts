/**
 * Tests for the Reasoning Trace viewer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { traceReport } from "../src/core/observability/trace";
import { record } from "../src/core/observability/events";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-tr2-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("trace: empty uid returns empty report", () => {
  const dir = freshEnv();
  try {
    const r = traceReport("u-empty", { sinceMs: Date.now() - 1000 });
    assert.equal(r.total, 0);
    assert.equal(r.okCount, 0);
    assert.equal(r.failCount, 0);
    assert.equal(r.groups.length, 0);
    assert.equal(r.spanMs, 0);
  } finally { cleanup(dir); }
});

test("trace: events are turned into steps", () => {
  const dir = freshEnv();
  try {
    const before = Date.now();
    record({ type: "agent", uid: "u-1", capability: "agent:Prime.chat", ok: true, ms: 100 });
    const r = traceReport("u-1", { sinceMs: before });
    assert.equal(r.total, 1);
    assert.equal(r.recentSteps[0]!.capability, "agent:Prime.chat");
    assert.equal(r.recentSteps[0]!.ok, true);
    assert.equal(r.recentSteps[0]!.ms, 100);
  } finally { cleanup(dir); }
});

test("trace: groups share the same root capability", () => {
  const dir = freshEnv();
  try {
    const before = Date.now();
    record({ type: "agent", uid: "u-1", capability: "agent:Prime.chat", ok: true, ms: 100 });
    record({ type: "agent", uid: "u-1", capability: "agent:Prime.chat", ok: true, ms: 200 });
    record({ type: "tool", uid: "u-1", capability: "tool:search.query", ok: true, ms: 50 });
    const r = traceReport("u-1", { sinceMs: before });
    assert.equal(r.groups.length, 2);
    const agent = r.groups.find((g) => g.capability === "agent")!;
    const tool = r.groups.find((g) => g.capability === "tool")!;
    assert.equal(agent.steps.length, 2);
    assert.equal(tool.steps.length, 1);
  } finally { cleanup(dir); }
});

test("trace: per-group counts add up", () => {
  const dir = freshEnv();
  try {
    const before = Date.now();
    for (let i = 0; i < 4; i++) record({ type: "agent", uid: "u-1", capability: "agent:Prime.chat", ok: i !== 2, ms: 10 });
    const r = traceReport("u-1", { sinceMs: before });
    const g = r.groups[0]!;
    assert.equal(g.okCount + g.failCount, g.steps.length);
  } finally { cleanup(dir); }
});

test("trace: per-group totalMs is the sum of step ms", () => {
  const dir = freshEnv();
  try {
    const before = Date.now();
    record({ type: "agent", uid: "u-1", capability: "agent:Prime.chat", ok: true, ms: 100 });
    record({ type: "agent", uid: "u-1", capability: "agent:Prime.chat", ok: true, ms: 200 });
    const r = traceReport("u-1", { sinceMs: before });
    assert.equal(r.groups[0]!.totalMs, 300);
  } finally { cleanup(dir); }
});

test("trace: per-group steps are sorted oldest-first", () => {
  const dir = freshEnv();
  try {
    const before = Date.now();
    for (let i = 0; i < 5; i++) record({ type: "agent", uid: "u-1", capability: "agent:Prime.chat", ok: true, ms: i });
    const r = traceReport("u-1", { sinceMs: before });
    const steps = r.groups[0]!.steps;
    for (let i = 1; i < steps.length; i++) {
      assert.ok(steps[i - 1]!.at <= steps[i]!.at);
    }
  } finally { cleanup(dir); }
});

test("trace: per-uid isolation", () => {
  const dir = freshEnv();
  try {
    const before = Date.now();
    record({ type: "agent", uid: "u-a", capability: "agent:A.x", ok: true, ms: 1 });
    record({ type: "agent", uid: "u-b", capability: "agent:B.x", ok: true, ms: 1 });
    const a = traceReport("u-a", { sinceMs: before });
    const b = traceReport("u-b", { sinceMs: before });
    assert.ok(a.total >= 1);
    assert.ok(b.total >= 1);
    assert.ok(a.recentSteps.every((s) => s.capability.startsWith("agent:A")));
  } finally { cleanup(dir); }
});

test("trace: limit caps the number of steps", () => {
  const dir = freshEnv();
  try {
    const before = Date.now();
    for (let i = 0; i < 50; i++) record({ type: "agent", uid: "u-1", capability: "agent:Prime.chat", ok: true, ms: 1 });
    const r = traceReport("u-1", { sinceMs: before, limit: 5 });
    assert.ok(r.recentSteps.length <= 5);
  } finally { cleanup(dir); }
});

test("trace: failure events are counted", () => {
  const dir = freshEnv();
  try {
    const before = Date.now();
    record({ type: "agent", uid: "u-1", capability: "agent:Prime.chat", ok: false, ms: 10, detail: "boom" });
    const r = traceReport("u-1", { sinceMs: before });
    const totalFails = r.groups.reduce((s, g) => s + g.failCount, 0);
    assert.ok(totalFails >= 1);
  } finally { cleanup(dir); }
});

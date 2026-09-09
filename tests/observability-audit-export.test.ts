/**
 * Tests for the Audit Export engine.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { exportJson, exportCsv, toCsvString } from "../src/core/observability/audit-export";
import { record } from "../src/core/observability/events";

test("audit export: json format returns the event list", () => {
  const r = exportJson("u-test", { sinceMs: 0 });
  assert.equal(r.format, "json");
  assert.ok(Array.isArray(r.events));
});

test("audit export: csv format returns headers + rows", () => {
  const c = exportCsv("u-test", { sinceMs: 0 });
  assert.equal(c.format, "csv");
  assert.ok(c.headers.length > 0);
  assert.ok(Array.isArray(c.rows));
});

test("audit export: json and csv have the same total", () => {
  record({ type: "agent", uid: "u-eq", capability: "agent:X.y", ok: true, ms: 1 });
  const j = exportJson("u-eq", { sinceMs: 0 });
  const c = exportCsv("u-eq", { sinceMs: 0 });
  assert.equal(j.total, c.total);
});

test("audit export: csv cells with commas are quoted", () => {
  const csv = toCsvString({
    format: "csv",
    uid: "u",
    total: 1,
    headers: ["a", "b"],
    rows: [["x", "hello, world"]],
    exportedAt: 0,
  });
  assert.ok(csv.includes('"hello, world"'));
});

test("audit export: csv cells with double quotes are escaped", () => {
  const csv = toCsvString({
    format: "csv",
    uid: "u",
    total: 1,
    headers: ["a", "b"],
    rows: [["x", 'he said "hi"']],
    exportedAt: 0,
  });
  assert.ok(csv.includes('"he said ""hi"""'));
});

test("audit export: okOnly filter excludes failures", () => {
  const before = Date.now();
  record({ type: "tool", uid: "u-ok", capability: "tool:ok.x", ok: true, ms: 1 });
  record({ type: "tool", uid: "u-ok", capability: "tool:ok.y", ok: false, ms: 1 });
  const r = exportJson("u-ok", { sinceMs: before, okOnly: true });
  for (const e of r.events) assert.equal(e.ok, true);
});

test("audit export: limit caps the number of events", () => {
  const before = Date.now();
  for (let i = 0; i < 30; i++) record({ type: "tool", uid: "u-lim", capability: `tool:x.${i}`, ok: true, ms: 1 });
  const r = exportJson("u-lim", { sinceMs: before, limit: 5 });
  assert.ok(r.events.length <= 5);
});

test("audit export: type filter narrows by EventType", () => {
  const before = Date.now();
  record({ type: "agent", uid: "u-t", capability: "agent:T.x", ok: true, ms: 1 });
  record({ type: "tool", uid: "u-t", capability: "tool:T.x", ok: true, ms: 1 });
  const r = exportJson("u-t", { sinceMs: before, type: "agent" });
  for (const e of r.events) assert.equal(e.type, "agent");
});

test("audit export: per-uid isolation", () => {
  const before = Date.now();
  record({ type: "agent", uid: "u-i-a", capability: "agent:A.x", ok: true, ms: 1 });
  record({ type: "agent", uid: "u-i-b", capability: "agent:B.x", ok: true, ms: 1 });
  const a = exportJson("u-i-a", { sinceMs: before });
  const b = exportJson("u-i-b", { sinceMs: before });
  assert.ok(a.events.every((e) => e.uid === "u-i-a" || e.uid === undefined));
  assert.ok(b.events.every((e) => e.uid === "u-i-b" || e.uid === undefined));
});

test("audit export: toCsvString ends with a newline", () => {
  const csv = toCsvString({ format: "csv", uid: "u", total: 0, headers: ["a"], rows: [], exportedAt: 0 });
  assert.ok(csv.endsWith("\n"));
});

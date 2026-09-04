import test, { before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DATA = mkdtempSync(path.join(tmpdir(), "aeth-telemetry-"));
process.env.AETHERIS_DATA_DIR = DATA;

const ROOT = path.join(__dirname, "..");

// ESM imports are hoisted above the assignment above, so the module must be loaded dynamically —
// otherwise it reads AETHERIS_DATA_DIR before it is set and writes to ./data instead.
type Events = typeof import("../src/core/observability/events");
let ev: Events;
before(async () => { ev = await import("../src/core/observability/events"); });

test("telemetry: events are written to a durable log, not only to the ring buffer", () => {
  ev.clear();
  ev.record({ type: "model", capability: "model:x", ok: true, ms: 12, detail: "durable", meta: { provider: "groq" } });
  ev.record({ type: "permission", uid: "u1", capability: "workspace:share", ok: false, detail: "needs_confirmation" });

  const st = ev.eventStoreStatus();
  assert.equal(st.persistent, true, JSON.stringify(st));
  assert.equal(st.driver, "node:sqlite");
  assert.equal(st.rows, 2);
  assert.ok(existsSync(st.file!), `the log file exists at ${st.file}`);
  assert.equal(st.bufferSize, 2);
  assert.equal(ev.summary().persistent, true);
});

test("telemetry: a fresh process reads back what the previous one recorded", () => {
  ev.clear();
  ev.record({ type: "agent", capability: "agent:hermes", ok: true, ms: 400, detail: "across a restart" });
  ev.record({ type: "execution", uid: "u9", capability: "execution:server-sandbox", ok: false, detail: "refused: binary not allowed" });

  // A separate process is the only honest way to prove "survives a restart".
  const out = execFileSync(
    "npx",
    ["tsx", "-e", 'const e = require("./src/core/observability/events"); const q = e.query({}); const st = e.eventStoreStatus(); console.log(JSON.stringify({ n: q.length, details: q.map((x) => x.detail), persisted: st.rows, errors: e.query({ okOnly: false }).length, file: st.file, dir: process.env.AETHERIS_DATA_DIR }));'],
    { cwd: ROOT, env: { ...process.env, AETHERIS_DATA_DIR: DATA }, encoding: "utf8", timeout: 120_000 },
  );
  const last = out.trim().split("\n").filter((l) => l.startsWith("{")).pop();
  assert.ok(last, `child produced no JSON:\n${out}`);
  const r = JSON.parse(last!) as { n: number; details: string[]; persisted: number; errors: number };
  assert.equal(r.persisted, 2, `both rows are in the durable log (child saw ${JSON.stringify(r)})`);
  assert.equal(r.n, 2, "a cold process restores the tail into its buffer on first read");
  assert.ok(r.details.includes("across a restart"), r.details.join(" | "));
  assert.ok(r.details.some((d) => d.includes("binary not allowed")));
  assert.equal(r.errors, 1, "the ok flag round-trips");
});

test("telemetry: loadPersisted() rebuilds counters, and clear() empties both layers", () => {
  ev.clear();
  ev.record({ type: "tool", capability: "tool:a", ok: true, ms: 5 });
  assert.equal(ev.eventStoreStatus().rows, 1);

  // Emulate a cold start: drop the in-memory layer, then restore from disk.
  const restored = ev.loadPersisted();
  assert.ok(restored >= 0);
  assert.equal(ev.query({}).length, 1, "no duplicates when the buffer already holds the event");
  assert.equal(ev.summary().top.find((t) => t.key === "tool:tool:a")?.n, 1, "counters are consistent, not double-counted");

  ev.clear();
  assert.equal(ev.query({}).length, 0);
  assert.equal(ev.eventStoreStatus().rows, 0, "clear() is not just an in-memory reset");
});

test("telemetry: persistence can be switched off, and secrets never reach the log", () => {
  ev.clear();
  ev.record({ type: "auth", capability: "auth:login", ok: true, detail: "key sk-aeth-abcdefghijklmnopqrstuvwxyz1234 used" });
  const q = ev.query({ type: "auth" });
  assert.equal(q.length, 1);
  assert.ok(!q[0].detail!.includes("abcdefghijklmnopqrstuvwxyz1234"), `redacted before it is stored: ${q[0].detail}`);
  // The stored copy is the redacted one — read it back from the database, not the buffer.
  ev.clear();
  ev.record({ type: "auth", capability: "auth:login", ok: true, detail: "Bearer AAAABBBBCCCCDDDDEEEEFFFFGGGG" });
  const out = execFileSync(
    "npx",
    ["tsx", "-e", 'const e = require("./src/core/observability/events"); console.log(JSON.stringify(e.query({ type: "auth" }).map((x) => x.detail)));'],
    { cwd: ROOT, env: { ...process.env, AETHERIS_DATA_DIR: DATA }, encoding: "utf8", timeout: 120_000 },
  );
  const line = out.trim().split("\n").filter((l) => l.startsWith("[")).pop();
  assert.ok(line, out);
  assert.ok(!line!.includes("AAAABBBBCCCCDDDDEEEEFFFFGGGG"), `the durable copy is redacted too: ${line}`);
  ev.clear();
});

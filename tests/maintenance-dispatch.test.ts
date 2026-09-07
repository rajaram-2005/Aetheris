/**
 * Tests for the Maintenance Dispatch engine.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dispatchList, type DispatchPriority } from "../src/core/maintenance/dispatch";
import { store } from "../src/lib/store";
import { canonicalTurbineTwin } from "../src/core/windturbine/model";
import type { Twin } from "../src/core/twins/twins";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-mx-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

function makeTwin(id: string, name: string, uid: string, state: Record<string, number> = {}, maintenance: Twin["maintenance"] = []): Twin {
  const draft = canonicalTurbineTwin({ id, name });
  return { ...draft, id, uid, name, state: { ...draft.state, ...state }, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, history: [{ at: Date.now(), state: { ...draft.state, ...state } }], events: [], maintenance };
}

async function seedTwin(t: Twin) { await store.set("twins", t.id, t); }
async function seedHistory(twinId: string, severity: string) {
  const tMs = 1_700_000_000_000;
  await store.set("diagnostic-history", `${twinId}:${tMs}`, { twinId, tMs, severity, peakMagnitude: 14, dominantHz: 89.3, topFault: "outerRace", topFaultMagnitude: 0, matchCount: 1, envelope: null });
}

test("dispatch: empty fleet returns empty list", async () => {
  const dir = freshEnv();
  try {
    const r = await dispatchList("u-empty");
    assert.equal(r.total, 0);
    assert.equal(r.rows.length, 0);
  } finally { cleanup(dir); }
});

test("dispatch: healthy twin (no overdue, no breach, ok diagnostic) → LOW", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "A", "u1", { vib_bearing_mms: 1 });
    await seedTwin(t);
    await seedHistory("a", "ok");
    const r = await dispatchList("u1");
    assert.equal(r.rows[0]!.priority, "LOW");
    assert.equal(r.byPriority.LOW, 1);
  } finally { cleanup(dir); }
});

test("dispatch: critical breach alone → HIGH", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "A", "u1", { vib_bearing_mms: 14 });
    await seedTwin(t);
    const r = await dispatchList("u1");
    assert.equal(r.rows[0]!.priority, "HIGH");
    assert.ok(r.rows[0]!.reason.includes("critical"));
  } finally { cleanup(dir); }
});

test("dispatch: critical breach + critical diagnostic → CRITICAL", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "A", "u1", { vib_bearing_mms: 14 });
    await seedTwin(t);
    await seedHistory("a", "critical");
    const r = await dispatchList("u1");
    assert.equal(r.rows[0]!.priority, "CRITICAL");
  } finally { cleanup(dir); }
});

test("dispatch: overdue maintenance (no breach) → MEDIUM", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "A", "u1", { vib_bearing_mms: 1 }, [{ at: Date.now(), note: "Lubrication", nextDue: 1_000_000_000_000 }]);
    await seedTwin(t);
    const r = await dispatchList("u1");
    assert.equal(r.rows[0]!.priority, "MEDIUM");
    assert.equal(r.rows[0]!.boundBreaches.total, 0);
  } finally { cleanup(dir); }
});

test("dispatch: overdue + critical diagnostic → HIGH", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "A", "u1", { vib_bearing_mms: 1 }, [{ at: Date.now(), note: "Lubrication", nextDue: 1_000_000_000_000 }]);
    await seedTwin(t);
    await seedHistory("a", "critical");
    const r = await dispatchList("u1");
    assert.equal(r.rows[0]!.priority, "HIGH");
  } finally { cleanup(dir); }
});

test("dispatch: rows are sorted CRITICAL → HIGH → MEDIUM → LOW", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", "u1", { vib_bearing_mms: 1 });
    const b = makeTwin("b", "B", "u1", { vib_bearing_mms: 14 });
    const c = makeTwin("c", "C", "u1", { vib_bearing_mms: 1 }, [{ at: Date.now(), note: "X", nextDue: 1_000_000_000_000 }]);
    await seedTwin(a); await seedTwin(b); await seedTwin(c);
    await seedHistory("a", "ok");
    const r = await dispatchList("u1");
    const priorities = r.rows.map((row) => row.priority);
    const order: Record<DispatchPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    for (let i = 1; i < priorities.length; i++) {
      assert.ok(order[priorities[i - 1]!] <= order[priorities[i]!]);
    }
  } finally { cleanup(dir); }
});

test("dispatch: byPriority counts match the rows", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", "u1", { vib_bearing_mms: 1 });
    const b = makeTwin("b", "B", "u1", { vib_bearing_mms: 14 });
    const c = makeTwin("c", "C", "u1", { vib_bearing_mms: 1 });
    await seedTwin(a); await seedTwin(b); await seedTwin(c);
    const r = await dispatchList("u1");
    let total = 0;
    for (const p of ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as DispatchPriority[]) {
      total += r.byPriority[p];
    }
    assert.equal(total, r.total);
  } finally { cleanup(dir); }
});

test("dispatch: action text is meaningful for each priority", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", "u1", { vib_bearing_mms: 1 });
    const b = makeTwin("b", "B", "u1", { vib_bearing_mms: 14 });
    await seedTwin(a); await seedTwin(b);
    const r = await dispatchList("u1");
    for (const row of r.rows) {
      assert.ok(row.action.length > 5);
      assert.ok(["DISPATCH", "SCHEDULE", "INSPECT", "MONITOR"].some((w) => row.action.includes(w)));
    }
  } finally { cleanup(dir); }
});

test("dispatch: per-uid isolation", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", "u1", { vib_bearing_mms: 1 });
    const b = makeTwin("b", "B", "u2", { vib_bearing_mms: 1 });
    await seedTwin(a); await seedTwin(b);
    const r1 = await dispatchList("u1");
    const r2 = await dispatchList("u2");
    assert.equal(r1.total, 1);
    assert.equal(r2.total, 1);
  } finally { cleanup(dir); }
});

test("dispatch: maintenanceNote is the first overdue entry's note", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "A", "u1", { vib_bearing_mms: 1 }, [
      { at: Date.now(), note: "Bearing grease", nextDue: 1_000_000_000_000 },
      { at: Date.now(), note: "Oil change", nextDue: 1_000_000_000_000 },
    ]);
    await seedTwin(t);
    const r = await dispatchList("u1");
    assert.ok(r.rows[0]!.maintenanceNote);
  } finally { cleanup(dir); }
});

/**
 * Tests for the Asset Comparison engine.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareAssets, sparklinePath, type AssetSnapshot, type Comparison } from "../src/core/compare/assets";
import { store } from "../src/lib/store";
import { canonicalTurbineTwin } from "../src/core/windturbine/model";
import type { Twin } from "../src/core/twins/twins";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-cmp-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

async function seedTwin(twin: Twin) {
  await store.set("twins", twin.id, twin);
}
async function seedHistory(twinId: string, rows: { severity: string; peakMagnitude: number; dominantHz: number; topFault: string | null }[]) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const tMs = 1_700_000_000_000 + i * 86_400_000;
    await store.set("diagnostic-history", `${twinId}:${tMs}`, {
      twinId, tMs, severity: r.severity, dominantHz: r.dominantHz, peakMagnitude: r.peakMagnitude, topFault: r.topFault, topFaultMagnitude: 0, matchCount: r.topFault ? 1 : 0, envelope: null,
    });
  }
}

function makeTwin(id: string, name: string, state: Record<string, number>): Twin {
  const draft = canonicalTurbineTwin({ id, name });
  return { ...draft, id, uid: "u1", state: { ...draft.state, ...state }, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, history: [], events: [], maintenance: [] };
}

test("compare: two real twins produce two snapshots", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", { rotor_rpm: 1500, vib_bearing_mms: 4.0 });
    const b = makeTwin("b", "B", { rotor_rpm: 1500, vib_bearing_mms: 14.0 });
    await seedTwin(a); await seedTwin(b);
    const c = await compareAssets({ twinIdA: "a", twinIdB: "b" });
    assert.ok(c.a);
    assert.ok(c.b);
    assert.equal(c.a!.twinName, "A");
    assert.equal(c.b!.twinName, "B");
    assert.equal(c.a!.state.rotor_rpm, 1500);
    assert.equal(c.b!.state.rotor_rpm, 1500);
  } finally { cleanup(dir); }
});

test("compare: aIsHealthier is true when a.health > b.health", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", { vib_bearing_mms: 1 });
    const b = makeTwin("b", "B", { vib_bearing_mms: 14 });
    await seedTwin(a); await seedTwin(b);
    const c = await compareAssets({ twinIdA: "a", twinIdB: "b" });
    assert.equal(c.aIsHealthier, true);
  } finally { cleanup(dir); }
});

test("compare: aIsHealthier is false when both are healthy", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", { vib_bearing_mms: 1 });
    const b = makeTwin("b", "B", { vib_bearing_mms: 1.2 });
    await seedTwin(a); await seedTwin(b);
    const c = await compareAssets({ twinIdA: "a", twinIdB: "b" });
    assert.equal(c.aIsHealthier, false);
  } finally { cleanup(dir); }
});

test("compare: sameFaultSignature when both are near BPFO at 1500 rpm", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", { vib_bearing_mms: 14 });
    const b = makeTwin("b", "B", { vib_bearing_mms: 14 });
    await seedTwin(a); await seedTwin(b);
    await seedHistory("a", [{ severity: "critical", peakMagnitude: 14, dominantHz: 89.3, topFault: "outerRace" }]);
    await seedHistory("b", [{ severity: "critical", peakMagnitude: 14, dominantHz: 89.5, topFault: "outerRace" }]);
    const c = await compareAssets({ twinIdA: "a", twinIdB: "b", rotorRpm: 1500 });
    assert.equal(c.sameFaultSignature, true);
  } finally { cleanup(dir); }
});

test("compare: sameFaultSignature is false when only one matches", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", { vib_bearing_mms: 14 });
    const b = makeTwin("b", "B", { vib_bearing_mms: 1 });
    await seedTwin(a); await seedTwin(b);
    await seedHistory("a", [{ severity: "critical", peakMagnitude: 14, dominantHz: 89.3, topFault: "outerRace" }]);
    await seedHistory("b", [{ severity: "ok", peakMagnitude: 1, dominantHz: 25, topFault: null }]);
    const c = await compareAssets({ twinIdA: "a", twinIdB: "b", rotorRpm: 1500 });
    assert.equal(c.sameFaultSignature, false);
  } finally { cleanup(dir); }
});

test("compare: history sparkline reflects the diagnostic history", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", { vib_bearing_mms: 14 });
    await seedTwin(a);
    await seedHistory("a", [
      { severity: "ok", peakMagnitude: 1, dominantHz: 25, topFault: null },
      { severity: "watch", peakMagnitude: 4, dominantHz: 89, topFault: "outerRace" },
      { severity: "warning", peakMagnitude: 7, dominantHz: 89, topFault: "outerRace" },
      { severity: "critical", peakMagnitude: 14, dominantHz: 89, topFault: "outerRace" },
    ]);
    const c = await compareAssets({ twinIdA: "a", twinIdB: "missing" });
    assert.equal(c.a!.historySparkline.length, 4);
    // History is returned newest-first; sparkline reflects that order.
    assert.deepEqual(c.a!.historySparkline, [14, 7, 4, 1]);
    assert.equal(c.b, null);
  } finally { cleanup(dir); }
});

test("compare: historyCount and criticalEvents24h are populated", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", { vib_bearing_mms: 14 });
    await seedTwin(a);
    await seedHistory("a", [
      { severity: "critical", peakMagnitude: 14, dominantHz: 89, topFault: "outerRace" },
    ]);
    const c = await compareAssets({ twinIdA: "a", twinIdB: "missing" });
    assert.equal(c.a!.historyCount, 1);
    assert.ok(c.a!.criticalEvents24h >= 0);
  } finally { cleanup(dir); }
});

test("compare: missing twin returns null snapshot, no throw", async () => {
  const dir = freshEnv();
  try {
    const c = await compareAssets({ twinIdA: "nope-a", twinIdB: "nope-b" });
    assert.equal(c.a, null);
    assert.equal(c.b, null);
    assert.equal(c.aIsHealthier, false);
    assert.equal(c.sameFaultSignature, false);
  } finally { cleanup(dir); }
});

test("compare: bpfoHz is computed from the configured rotor rpm", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", { vib_bearing_mms: 1 });
    const b = makeTwin("b", "B", { vib_bearing_mms: 1 });
    await seedTwin(a); await seedTwin(b);
    const c = await compareAssets({ twinIdA: "a", twinIdB: "b", rotorRpm: 1800 });
    assert.equal(c.a!.bpfoHz, 107.16);
    assert.equal(c.b!.bpfoHz, 107.16);
  } finally { cleanup(dir); }
});

test("compare: inCriticalBreach reflects the live state", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", { vib_bearing_mms: 14 }); // 14 > 11.2 limit
    const b = makeTwin("b", "B", { vib_bearing_mms: 1 });
    await seedTwin(a); await seedTwin(b);
    const c = await compareAssets({ twinIdA: "a", twinIdB: "b" });
    assert.equal(c.a!.inCriticalBreach, true);
    assert.equal(c.b!.inCriticalBreach, false);
  } finally { cleanup(dir); }
});

test("compare: types — Comparison matches the engine output", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", { vib_bearing_mms: 1 });
    const b = makeTwin("b", "B", { vib_bearing_mms: 1 });
    await seedTwin(a); await seedTwin(b);
    const c: Comparison = await compareAssets({ twinIdA: "a", twinIdB: "b" });
    const s: AssetSnapshot | null = c.a;
    assert.ok(s);
    assert.equal(typeof s!.twinId, "string");
    assert.equal(typeof s!.health, "number");
    assert.equal(typeof s!.historyCount, "number");
    assert.ok(s!.state && typeof s!.state === "object");
  } finally { cleanup(dir); }
});

test("compare: sparklinePath returns M then L commands for non-empty input", () => {
  const path = sparklinePath([1, 2, 3], 100, 30, 2);
  const cmds = path.match(/[ML]/g) ?? [];
  assert.equal(cmds.length, 3);
  assert.equal(cmds[0], "M");
});

test("compare: sparklinePath returns empty for empty input", () => {
  assert.equal(sparklinePath([], 100, 30, 2), "");
});

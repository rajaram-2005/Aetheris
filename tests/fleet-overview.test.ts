/**
 * Tests for the Fleet Overview engine.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fleetOverview, healthBand, HEALTH_BAND_COLOUR, type HealthBand } from "../src/core/fleet/overview";
import { store } from "../src/lib/store";
import { canonicalTurbineTwin } from "../src/core/windturbine/model";
import type { Twin } from "../src/core/twins/twins";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-fl-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

function makeTwin(id: string, name: string, uid: string, state: Record<string, number>): Twin {
  const draft = canonicalTurbineTwin({ id, name });
  return { ...draft, id, uid, name, state: { ...draft.state, ...state }, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, history: [{ at: Date.now(), state: { ...draft.state, ...state } }], events: [], maintenance: [] };
}

async function seedTwin(t: Twin) { await store.set("twins", t.id, t); }

test("fleet: empty fleet returns zero rows", async () => {
  const dir = freshEnv();
  try {
    const o = await fleetOverview("u-empty");
    assert.equal(o.total, 0);
    assert.equal(o.rows.length, 0);
    assert.equal(o.worst, null);
    assert.equal(o.byBand.good, 0);
  } finally { cleanup(dir); }
});

test("fleet: 2 healthy twins, both good band", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", "u1", { vib_bearing_mms: 1 });
    const b = makeTwin("b", "B", "u1", { vib_bearing_mms: 1.1 });
    await seedTwin(a); await seedTwin(b);
    const o = await fleetOverview("u1");
    assert.equal(o.total, 2);
    assert.equal(o.byBand.good, 2);
    assert.equal(o.byBand.critical, 0);
  } finally { cleanup(dir); }
});

test("fleet: critical twin flagged with critical band", async () => {
  const dir = freshEnv();
  try {
    // Two critical breaches drive the score to < 30.
    const a = makeTwin("a", "A", "u1", { vib_bearing_mms: 14, T_gearbox_K: 400 });
    await seedTwin(a);
    const o = await fleetOverview("u1");
    assert.equal(o.total, 1);
    assert.equal(o.worst?.twin.id, "a");
    // 14 is > 11.2 critical vib, 400 is > 360 critical temp.
    // 2 critical breaches = 80, + stale? The twin's history is just
    // the 'created' event we put in, so lastAt is recent. Score
    // = 100 - 80 = 20, critical band.
    assert.equal(o.byBand.critical, 1);
  } finally { cleanup(dir); }
});

test("fleet: per-uid isolation — only my twins show up", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", "u1", { vib_bearing_mms: 1 });
    const b = makeTwin("b", "B", "u2", { vib_bearing_mms: 1 });
    await seedTwin(a); await seedTwin(b);
    const o1 = await fleetOverview("u1");
    const o2 = await fleetOverview("u2");
    assert.equal(o1.total, 1);
    assert.equal(o1.rows[0]!.twin.id, "a");
    assert.equal(o2.total, 1);
    assert.equal(o2.rows[0]!.twin.id, "b");
  } finally { cleanup(dir); }
});

test("fleet: lastDiagnostic is read from the production history", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", "u1", { vib_bearing_mms: 14 });
    await seedTwin(a);
    const tMs = 1_700_000_000_000;
    await store.set("diagnostic-history", `a:${tMs}`, { twinId: "a", tMs, severity: "critical", peakMagnitude: 14, dominantHz: 89.3, topFault: "outerRace", topFaultMagnitude: 0, matchCount: 1, envelope: null });
    const o = await fleetOverview("u1");
    assert.equal(o.rows[0]!.lastDiagnostic?.severity, "critical");
    assert.equal(o.rows[0]!.lastDiagnostic?.topFault, "outerRace");
    assert.equal(o.withCriticalDiagnostic, 1);
  } finally { cleanup(dir); }
});

test("fleet: withOverdueMaintenance counts twins whose maintenance is overdue", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", "u1", { vib_bearing_mms: 1 });
    a.maintenance = [{ at: Date.now(), note: "Lubrication", nextDue: 1_000_000_000_000 }];
    await seedTwin(a);
    const o = await fleetOverview("u1");
    assert.equal(o.withOverdueMaintenance, 1);
    assert.equal(o.rows[0]!.overdueMaintenance, 1);
  } finally { cleanup(dir); }
});

test("fleet: criticalEvents24h is read from twin.events", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", "u1", { vib_bearing_mms: 1 });
    a.events = [{ at: Date.now() - 1000, kind: "critical", detail: "test" }];
    await seedTwin(a);
    const o = await fleetOverview("u1");
    assert.equal(o.rows[0]!.criticalEvents24h, 1);
  } finally { cleanup(dir); }
});

test("healthBand: 100 → good, 80 → good, 60 → watch, 30 → warning, 0 → critical", () => {
  assert.equal(healthBand(100), "good");
  assert.equal(healthBand(80), "good");
  assert.equal(healthBand(60), "watch");
  assert.equal(healthBand(30), "warning");
  assert.equal(healthBand(0), "critical");
});

test("HEALTH_BAND_COLOUR: every band has a hex colour", () => {
  for (const b of ["good", "watch", "warning", "critical"] as HealthBand[]) {
    assert.ok(HEALTH_BAND_COLOUR[b].startsWith("#"));
  }
});

test("fleet: worst is the lowest-health twin", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", "u1", { vib_bearing_mms: 1 });
    const b = makeTwin("b", "B", "u1", { vib_bearing_mms: 14 });
    const c = makeTwin("c", "C", "u1", { vib_bearing_mms: 7 });
    await seedTwin(a); await seedTwin(b); await seedTwin(c);
    const o = await fleetOverview("u1");
    assert.equal(o.worst?.twin.id, "b");
  } finally { cleanup(dir); }
});

test("fleet: rows include breachCount and stale", async () => {
  const dir = freshEnv();
  try {
    const a = makeTwin("a", "A", "u1", { vib_bearing_mms: 14, T_gearbox_K: 400 });
    await seedTwin(a);
    const o = await fleetOverview("u1");
    assert.ok(o.rows[0]!.breachCount >= 1);
    assert.equal(o.rows[0]!.criticalBreachCount >= 1, true);
  } finally { cleanup(dir); }
});

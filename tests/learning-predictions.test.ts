/**
 * Tests for the PBNN prediction graph engine.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { predictNext, listLearnedModels } from "../src/core/learning/predictions";
import { store } from "../src/lib/store";
import { canonicalTurbineTwin } from "../src/core/windturbine/model";
import type { Twin } from "../src/core/twins/twins";
import { fitLinear, type PbnnLinear } from "../src/core/learning/pbnn";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-pr-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

function makeTwin(id: string, uid: string): Twin {
  const draft = canonicalTurbineTwin({ id, name: id });
  return { ...draft, id, uid, name: id, state: { ...draft.state, rotor_rpm: 17, vib_bearing_mms: 1 }, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, history: [{ at: Date.now(), state: draft.state }], events: [], maintenance: [] };
}

async function seedHistory(twinId: string, rows: { severity: string; peakMagnitude: number; dominantHz: number | null; topFault: string | null }[]) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const tMs = 1_700_000_000_000 + i * 86_400_000;
    await store.set("diagnostic-history", `${twinId}:${tMs}`, { twinId, tMs, severity: r.severity, dominantHz: r.dominantHz, peakMagnitude: r.peakMagnitude, topFault: r.topFault, topFaultMagnitude: 0, matchCount: 0, envelope: null });
  }
}

async function seedModel(uid: string, twinId: string, m: PbnnLinear, features: string[], target: string) {
  await store.set("learning", `pbnn:${twinId}`, { uid, twinId, model: m, features, target, trainedOn: m.trainedOn, updatedAt: m.updatedAt });
}

test("predict: empty store returns empty report", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "u-1");
    await store.set("twins", t.id, t);
    const r = await predictNext({ uid: "u-1", twinId: "a" });
    assert.equal(r.twinId, "a");
    assert.equal(r.model, null);
    assert.equal(r.forecast.length, 0);
  } finally { cleanup(dir); }
});

test("predict: missing twin returns empty report", async () => {
  const dir = freshEnv();
  try {
    const r = await predictNext({ uid: "u-1", twinId: "missing" });
    assert.equal(r.model, null);
    assert.equal(r.forecast.length, 0);
  } finally { cleanup(dir); }
});

test("predict: cross-uid isolation — model from another uid is hidden", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "u-1");
    await store.set("twins", t.id, t);
    const m = fitLinear([{ x: [1, 0], y: 5 }], { features: ["const", "step"], target: "peakMagnitude" });
    await seedModel("u-other", "a", m, ["const", "step"], "peakMagnitude");
    const r = await predictNext({ uid: "u-1", twinId: "a" });
    assert.equal(r.model, null);
  } finally { cleanup(dir); }
});

test("predict: forecast has the requested number of steps", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "u-1");
    await store.set("twins", t.id, t);
    await seedHistory("a", Array.from({ length: 5 }, (_, i) => ({ severity: "ok", peakMagnitude: 1 + i * 0.1, dominantHz: 25, topFault: null })));
    const m = fitLinear([{ x: [1, 0], y: 1 }, { x: [1, 1], y: 1.1 }, { x: [1, 2], y: 1.2 }, { x: [1, 3], y: 1.3 }, { x: [1, 4], y: 1.4 }], { features: ["const", "step"], target: "peakMagnitude" });
    await seedModel("u-1", "a", m, ["const", "step"], "peakMagnitude");
    const r = await predictNext({ uid: "u-1", twinId: "a", steps: 8 });
    assert.equal(r.forecast.length, 8);
  } finally { cleanup(dir); }
});

test("predict: forecast has increasing step numbers", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "u-1");
    await store.set("twins", t.id, t);
    await seedHistory("a", Array.from({ length: 5 }, (_, i) => ({ severity: "ok", peakMagnitude: 1, dominantHz: 25, topFault: null })));
    const m = fitLinear([{ x: [1, 0], y: 1 }], { features: ["const", "step"], target: "peakMagnitude" });
    await seedModel("u-1", "a", m, ["const", "step"], "peakMagnitude");
    const r = await predictNext({ uid: "u-1", twinId: "a", steps: 5 });
    for (let i = 1; i < r.forecast.length; i++) {
      assert.ok(r.forecast[i]!.step > r.forecast[i - 1]!.step);
    }
  } finally { cleanup(dir); }
});

test("predict: forecast yHat is finite", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "u-1");
    await store.set("twins", t.id, t);
    await seedHistory("a", [{ severity: "ok", peakMagnitude: 1, dominantHz: 25, topFault: null }]);
    const m = fitLinear([{ x: [1, 0], y: 1 }], { features: ["const", "step"], target: "peakMagnitude" });
    await seedModel("u-1", "a", m, ["const", "step"], "peakMagnitude");
    const r = await predictNext({ uid: "u-1", twinId: "a", steps: 3 });
    for (const f of r.forecast) {
      assert.ok(Number.isFinite(f.yHat));
      assert.ok(f.lo <= f.yHat);
      assert.ok(f.hi >= f.yHat);
    }
  } finally { cleanup(dir); }
});

test("predict: history is the peak-magnitude channel, oldest first", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "u-1");
    await store.set("twins", t.id, t);
    await seedHistory("a", [
      { severity: "ok", peakMagnitude: 1, dominantHz: 25, topFault: null },
      { severity: "ok", peakMagnitude: 1.5, dominantHz: 25, topFault: null },
      { severity: "ok", peakMagnitude: 2, dominantHz: 25, topFault: null },
    ]);
    const m = fitLinear([{ x: [1, 0], y: 1 }], { features: ["const", "step"], target: "peakMagnitude" });
    await seedModel("u-1", "a", m, ["const", "step"], "peakMagnitude");
    const r = await predictNext({ uid: "u-1", twinId: "a" });
    assert.deepEqual(r.history.map((h) => h.y), [1, 1.5, 2]);
  } finally { cleanup(dir); }
});

test("listLearnedModels: returns every model for the uid", async () => {
  const dir = freshEnv();
  try {
    const m = fitLinear([{ x: [1], y: 5 }], { features: ["const"], target: "peakMagnitude" });
    await seedModel("u-1", "a", m, ["const"], "peakMagnitude");
    await seedModel("u-1", "b", m, ["const"], "peakMagnitude");
    await seedModel("u-2", "c", m, ["const"], "peakMagnitude");
    const list = await listLearnedModels("u-1");
    assert.equal(list.length, 2);
    const ids = list.map((l) => l.twinId).sort();
    assert.deepEqual(ids, ["a", "b"]);
  } finally { cleanup(dir); }
});

test("predict: features and target are passed through from the stored model", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "u-1");
    await store.set("twins", t.id, t);
    await seedHistory("a", [{ severity: "ok", peakMagnitude: 1, dominantHz: 25, topFault: null }]);
    const m = fitLinear([{ x: [1, 17], y: 1 }], { features: ["const", "rotor_rpm"], target: "peakMagnitude" });
    await seedModel("u-1", "a", m, ["const", "rotor_rpm"], "peakMagnitude");
    const r = await predictNext({ uid: "u-1", twinId: "a" });
    assert.deepEqual(r.features, ["const", "rotor_rpm"]);
    assert.equal(r.target, "peakMagnitude");
  } finally { cleanup(dir); }
});

/**
 * Tests for residual-based anomaly thresholds.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { residualThresholds, classifyResidual, type ResidualThreshold } from "../src/core/learning/residual-thresholds";
import { store } from "@/lib/store";
import { saveTwin } from "@/core/twins/twins";
import { canonicalTurbineTwin } from "@/core/windturbine/model";
import type { PbnnLinear } from "@/core/learning/pbnn";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-rs-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

function makeModel(uid: string, twinId: string, mean: number, sigma2: number, trainedOn: number): PbnnLinear {
  return {
    kind: "linear",
    weights: [1],
    bias: mean,
    prior: { mean: [1], variance: [1] },
    biasPrior: { mean: 0, variance: 1 },
    sigma2,
    trainedOn,
    updatedAt: Date.now(),
  };
}

async function seed(uid: string, twinId: string, model: PbnnLinear) {
  const twin = canonicalTurbineTwin({ id: twinId, name: twinId });
  await saveTwin({ ...twin, id: twinId, uid, name: twinId, history: [{ at: Date.now(), state: twin.state }], createdAt: Date.now(), updatedAt: Date.now(), events: [], maintenance: [] });
  await store.set("learning", `pbnn:${twinId}`, { uid, twinId, model, features: ["t"], target: "peakMagnitude", trainedOn: model.trainedOn, updatedAt: Date.now() });
}

test("residualThresholds: returns ok=false when no twin exists", async () => {
  const dir = freshEnv();
  try {
    const r = await residualThresholds("u-x", "missing-twin");
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /twin not found/);
  } finally { cleanup(dir); }
});

test("residualThresholds: returns ok=false when no model is trained", async () => {
  const dir = freshEnv();
  try {
    const twin = canonicalTurbineTwin({ id: "t-untrained", name: "t" });
    await saveTwin({ ...twin, id: "t-untrained", uid: "u-1", name: "t", history: [{ at: Date.now(), state: twin.state }], createdAt: Date.now(), updatedAt: Date.now(), events: [], maintenance: [] });
    const r = await residualThresholds("u-1", "t-untrained");
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /PBNN model/);
  } finally { cleanup(dir); }
});

test("residualThresholds: returns ok=true with a fitted threshold once a model is trained", async () => {
  const dir = freshEnv();
  try {
    await seed("u-1", "t-ok", makeModel("u-1", "t-ok", 8, 0.5, 30));
    const r = await residualThresholds("u-1", "t-ok");
    assert.equal(r.ok, true);
    assert.equal(r.channels.length, 1);
    const t = r.channels[0]!;
    assert.equal(t.mean, 8);
    assert.equal(t.sigma2, 0.5);
    assert.ok(t.watch < t.warning);
    assert.ok(t.warning < t.critical);
  } finally { cleanup(dir); }
});

test("residualThresholds: sigma is sqrt(sigma2)", async () => {
  const dir = freshEnv();
  try {
    await seed("u-1", "t-s", makeModel("u-1", "t-s", 5, 4, 10));
    const r = await residualThresholds("u-1", "t-s");
    assert.equal(r.ok, true);
    const t = r.channels[0]!;
    assert.equal(t.sigma, 2);
  } finally { cleanup(dir); }
});

test("residualThresholds: k values can be overridden", async () => {
  const dir = freshEnv();
  try {
    await seed("u-1", "t-k", makeModel("u-1", "t-k", 5, 1, 10));
    const r = await residualThresholds("u-1", "t-k", { k: { watch: 1, warning: 2, critical: 3 } });
    assert.equal(r.k.watch, 1);
    const t = r.channels[0]!;
    assert.equal(t.k.watch, 1);
  } finally { cleanup(dir); }
});

test("residualThresholds: per-uid isolation (model for one uid is not visible to another)", async () => {
  const dir = freshEnv();
  try {
    await seed("u-a", "t-iso", makeModel("u-a", "t-iso", 5, 1, 10));
    const a = await residualThresholds("u-a", "t-iso");
    const b = await residualThresholds("u-b", "t-iso");
    assert.equal(a.ok, true);
    assert.equal(b.ok, false);
  } finally { cleanup(dir); }
});

test("residualThresholds: per-twin isolation", async () => {
  const dir = freshEnv();
  try {
    await seed("u-1", "t-a", makeModel("u-1", "t-a", 5, 1, 10));
    await seed("u-1", "t-b", makeModel("u-1", "t-b", 8, 0.25, 10));
    const a = await residualThresholds("u-1", "t-a");
    const b = await residualThresholds("u-1", "t-b");
    assert.equal(a.channels[0]!.mean, 5);
    assert.equal(b.channels[0]!.mean, 8);
  } finally { cleanup(dir); }
});

test("classifyResidual: ok when within the watch band", () => {
  const t: ResidualThreshold = { channel: "x", target: "x", twinId: "t", mean: 5, sigma: 1, sigma2: 1, trainedOn: 10, n: 0, watch: 6.5, warning: 7.5, critical: 8.5, k: { watch: 1.5, warning: 2.5, critical: 3.5 } };
  assert.equal(classifyResidual(t, 5), "ok");
  assert.equal(classifyResidual(t, 6), "ok");
});

test("classifyResidual: watch at the watch line", () => {
  const t: ResidualThreshold = { channel: "x", target: "x", twinId: "t", mean: 5, sigma: 1, sigma2: 1, trainedOn: 10, n: 0, watch: 6.5, warning: 7.5, critical: 8.5, k: { watch: 1.5, warning: 2.5, critical: 3.5 } };
  assert.equal(classifyResidual(t, 7), "watch");
});

test("classifyResidual: warning above the warning line", () => {
  const t: ResidualThreshold = { channel: "x", target: "x", twinId: "t", mean: 5, sigma: 1, sigma2: 1, trainedOn: 10, n: 0, watch: 6.5, warning: 7.5, critical: 8.5, k: { watch: 1.5, warning: 2.5, critical: 3.5 } };
  assert.equal(classifyResidual(t, 8), "warning");
});

test("classifyResidual: critical above the critical line", () => {
  const t: ResidualThreshold = { channel: "x", target: "x", twinId: "t", mean: 5, sigma: 1, sigma2: 1, trainedOn: 10, n: 0, watch: 6.5, warning: 7.5, critical: 8.5, k: { watch: 1.5, warning: 2.5, critical: 3.5 } };
  assert.equal(classifyResidual(t, 9), "critical");
});

test("classifyResidual: works symmetrically on the low side", () => {
  const t: ResidualThreshold = { channel: "x", target: "x", twinId: "t", mean: 5, sigma: 1, sigma2: 1, trainedOn: 10, n: 0, watch: 6.5, warning: 7.5, critical: 8.5, k: { watch: 1.5, warning: 2.5, critical: 3.5 } };
  assert.equal(classifyResidual(t, 1), "critical");
  assert.equal(classifyResidual(t, 2), "warning");
  assert.equal(classifyResidual(t, 3), "watch");
});

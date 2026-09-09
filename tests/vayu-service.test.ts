/**
 * Tests for VAYU-1 service.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { vayuQuery } from "../src/core/vayu/service";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-vayu-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("vayu: live mode without twin returns ok=false on every slice", async () => {
  const dir = freshEnv();
  try {
    const r = await vayuQuery({ uid: "u-x", question: "any", demo: false });
    assert.equal(r.prediction.ok, false);
    assert.equal(r.anomaly.ok, false);
    assert.equal(r.arena.ok, false);
  } finally { cleanup(dir); }
});

test("vayu: demo mode seeds a twin and runs every slice", async () => {
  const dir = freshEnv();
  try {
    const r = await vayuQuery({ uid: "u-d", question: "demo", demo: true, channel: "peakMagnitude", horizon: 4 });
    assert.equal(r.mode, "demo-seed");
    assert.equal(r.prediction.ok, true);
    assert.equal(r.prediction.predicted.length, 4);
    assert.equal(r.anomaly.ok, true);
    assert.equal(r.arena.ok, true);
    assert.equal(r.fft.ok, true);
    assert.ok(r.summary.length > 10);
  } finally { cleanup(dir); }
});

test("vayu: result carries uid, question, twinId, channel, mode, generatedAt, capability", async () => {
  const dir = freshEnv();
  try {
    const r = await vayuQuery({ uid: "u-shape", question: "q?", demo: true, channel: "dominantHz" });
    assert.equal(r.uid, "u-shape");
    assert.equal(r.question, "q?");
    assert.equal(r.channel, "dominantHz");
    assert.ok(typeof r.generatedAt === "number");
    assert.equal(r.capability, "vayu:domain.query");
  } finally { cleanup(dir); }
});

test("vayu: source is honest about demo vs live", async () => {
  const dir = freshEnv();
  try {
    const r = await vayuQuery({ uid: "u-honest", question: "x", demo: true });
    assert.equal(r.prediction.source, "demo-seed");
    assert.equal(r.anomaly.source, "demo-seed");
  } finally { cleanup(dir); }
});

test("vayu: summary is built from the actual slices, not invented", async () => {
  const dir = freshEnv();
  try {
    const r = await vayuQuery({ uid: "u-sum", question: "?", demo: true, horizon: 3 });
    assert.match(r.summary, /PBNN/);
    assert.match(r.summary, /Anomaly/);
    assert.match(r.summary, /FFT/);
  } finally { cleanup(dir); }
});

test("vayu: horizon is clamped to [1, 20]", async () => {
  const dir = freshEnv();
  try {
    const r1 = await vayuQuery({ uid: "u-h", question: "?", demo: true, horizon: 0 });
    assert.equal(r1.prediction.horizon, 1);
    const r2 = await vayuQuery({ uid: "u-h", question: "?", demo: true, horizon: 999 });
    assert.equal(r2.prediction.horizon, 20);
  } finally { cleanup(dir); }
});

test("vayu: result is fully populated with all 4 slices", async () => {
  const dir = freshEnv();
  try {
    const r = await vayuQuery({ uid: "u-pop", question: "?", demo: true });
    assert.ok(r.prediction);
    assert.ok(r.anomaly);
    assert.ok(r.arena);
    assert.ok(r.fft);
  } finally { cleanup(dir); }
});

test("vayu: per-uid isolation works (each call's slices are independent)", async () => {
  const dir = freshEnv();
  try {
    const a = await vayuQuery({ uid: "u-a", question: "?", demo: true });
    const b = await vayuQuery({ uid: "u-b", question: "?", demo: true });
    assert.equal(a.uid, "u-a");
    assert.equal(b.uid, "u-b");
  } finally { cleanup(dir); }
});

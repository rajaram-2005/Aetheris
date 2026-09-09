/**
 * Tests for the Anomaly Detection engine.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectAnomalies, detectChannel } from "../src/core/anomaly/detector";
import { store } from "../src/lib/store";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-an-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

async function seedHistory(twinId: string, rows: { severity: string; peakMagnitude: number; dominantHz: number | null; topFault: string | null }[]) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const tMs = 1_700_000_000_000 + i * 86_400_000;
    await store.set("diagnostic-history", `${twinId}:${tMs}`, {
      twinId, tMs, severity: r.severity, dominantHz: r.dominantHz, peakMagnitude: r.peakMagnitude, topFault: r.topFault, topFaultMagnitude: 0, matchCount: r.topFault ? 1 : 0, envelope: null,
    });
  }
}

test("anomaly: flat signal — no anomalies", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ tMs: 1_700_000_000_000 + i * 1000, y: 5 }));
  const r = detectAnomalies(rows, { features: ["const"], target: "y" });
  for (const p of r.points) {
    assert.equal(p.severity, "info");
  }
  assert.equal(r.counts.warn, 0);
  assert.equal(r.counts.critical, 0);
});

test("anomaly: spike — flagged with critical severity", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ tMs: 1_700_000_000_000 + i * 1000, y: 5 }));
  rows[15]!.y = 500; // huge spike vs. background
  const r = detectAnomalies(rows, { features: ["const"], target: "y" });
  assert.equal(r.points[15]!.severity, "critical");
  assert.ok(Math.abs(r.points[15]!.zscore) > 6);
});

test("anomaly: constant model — flat signal, no flag (MAD ~ 0)", () => {
  // A constant + MAD-robust sigma: the model is the mean, the
  // residuals are 0, MAD is 0, so sigma falls back to the std of
  // the first half. A perfectly flat signal has std 0, so sigma
  // is the 1e-6 floor; z scores are 0/1e-6 = 0; everything is
  // info.
  const rows = Array.from({ length: 10 }, (_, i) => ({ tMs: 1_700_000_000_000 + i * 1000, y: 5 }));
  const r = detectAnomalies(rows, { features: ["const"], target: "y" });
  for (const p of r.points) assert.equal(p.severity, "info");
});

test("anomaly: empty input — empty report", () => {
  const r = detectAnomalies([], { features: ["const"], target: "y" });
  assert.equal(r.n, 0);
  assert.equal(r.points.length, 0);
  assert.equal(r.worst, null);
});

test("anomaly: single row — empty model", () => {
  const r = detectAnomalies([{ tMs: 1, y: 5 }], { features: ["const"], target: "y" });
  assert.equal(r.points.length, 1);
  assert.equal(r.points[0]!.severity, "info");
});

test("anomaly: worst is the highest-z point", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ tMs: 1_700_000_000_000 + i * 1000, y: 5 }));
  rows[10]!.y = 100; // biggest spike
  rows[5]!.y = 20; // smaller spike
  const r = detectAnomalies(rows, { features: ["const"], target: "y" });
  assert.equal(r.worst?.tMs, rows[10]!.tMs);
});

test("anomaly: counts roll up by severity — info+warn+critical = total", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ tMs: 1_700_000_000_000 + i * 1000, y: 5 }));
  rows[3]!.y = 15;  // small spike
  rows[5]!.y = 18;
  rows[10]!.y = 500; // critical
  const r = detectAnomalies(rows, { features: ["const"], target: "y" });
  assert.equal(r.counts.info + r.counts.warn + r.counts.critical, 20);
  // The biggest spike is always critical
  assert.ok(r.counts.critical >= 1);
  // The model surface is the mean of the actual data
  const expectedMean = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  assert.ok(Math.abs(r.model.bias - expectedMean) < 0.01);
});

test("anomaly: zThreshold can be raised to silence borderline points", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ tMs: 1_700_000_000_000 + i * 1000, y: 5 }));
  rows[10]!.y = 25; // spike 20 above background — z = 20/sigma
  const low = detectAnomalies(rows, { features: ["const"], target: "y" }, 1.0);
  const high = detectAnomalies(rows, { features: ["const"], target: "y" }, 100);
  assert.ok(low.counts.warn + low.counts.critical >= 1);
  assert.equal(high.counts.warn, 0);
  assert.equal(high.counts.critical, 0);
});

test("anomaly: residual and sigma are non-negative, sigma is positive", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ tMs: 1_700_000_000_000 + i * 1000, y: 5 + (i % 3) * 0.1 }));
  const r = detectAnomalies(rows, { features: ["const"], target: "y" });
  for (const p of r.points) {
    assert.ok(p.sigma > 0);
    assert.ok(Number.isFinite(p.residual));
  }
});

test("anomaly: detectChannel reads the actual diagnostic history", async () => {
  const dir = freshEnv();
  try {
    await seedHistory("wtg-an", [
      { severity: "ok", peakMagnitude: 1, dominantHz: 25, topFault: null },
      { severity: "ok", peakMagnitude: 1.1, dominantHz: 25, topFault: null },
      { severity: "ok", peakMagnitude: 1.0, dominantHz: 25, topFault: null },
      { severity: "ok", peakMagnitude: 1.05, dominantHz: 25, topFault: null },
      { severity: "ok", peakMagnitude: 1.0, dominantHz: 25, topFault: null },
      { severity: "ok", peakMagnitude: 1.1, dominantHz: 25, topFault: null },
      { severity: "ok", peakMagnitude: 1.0, dominantHz: 25, topFault: null },
      { severity: "ok", peakMagnitude: 1.05, dominantHz: 25, topFault: null },
      { severity: "ok", peakMagnitude: 1.0, dominantHz: 25, topFault: null },
      { severity: "ok", peakMagnitude: 1.1, dominantHz: 25, topFault: null },
      { severity: "critical", peakMagnitude: 200, dominantHz: 89.3, topFault: "outerRace" },
    ]);
    const r = await detectChannel("wtg-an", "peakMagnitude", 2.0, 100);
    assert.equal(r.twinId, "wtg-an");
    assert.equal(r.channel, "peakMagnitude");
    assert.equal(r.points.length, 11);
    // The 200-mm/s row is the anomaly
    assert.equal(r.worst?.observed, 200);
    assert.equal(r.worst?.severity, "critical");
  } finally { cleanup(dir); }
});

test("anomaly: detectChannel returns empty report when no history", async () => {
  const dir = freshEnv();
  try {
    const r = await detectChannel("wtg-empty", "peakMagnitude");
    assert.equal(r.points.length, 0);
    assert.equal(r.worst, null);
  } finally { cleanup(dir); }
});

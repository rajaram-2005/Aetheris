/**
 * Tests for fitThresholds + classify.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fitThresholds, classify, type Channel, type ChannelThreshold } from "../src/core/diagnostics/thresholds";
import { recordDiagnostic } from "../src/core/diagnostics/history";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-thr-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

async function seedHistory(twinId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await recordDiagnostic(twinId, {
      ok: true,
      spectrum: { n: 64, sampleRateHz: 1024, window: "hann", frequency: [], magnitude: [], power: [], phase: [], dominantHz: 25 + Math.random() * 0.5, rms: 4 + Math.random() * 0.2 },
      peaks: [{ frequency: 25, magnitude: 4 + Math.random() * 0.2 }],
      matches: [],
    } as never, { labels: [] });
    // Add a small delay so timestamps differ
    await new Promise((r) => setTimeout(r, 1));
  }
}

test("fitThresholds: returns ok=false with fewer than 5 history points", async () => {
  const dir = freshEnv();
  try {
    await seedHistory("t-low", 3);
    const r = await fitThresholds("t-low");
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /at least 5/);
  } finally { cleanup(dir); }
});

test("fitThresholds: returns ok=true with at least 5 history points", async () => {
  const dir = freshEnv();
  try {
    await seedHistory("t-ok", 10);
    const r = await fitThresholds("t-ok");
    assert.equal(r.ok, true);
    assert.ok(r.channels.length > 0);
  } finally { cleanup(dir); }
});

test("fitThresholds: each channel has mean, stdev, watch, warning, critical", async () => {
  const dir = freshEnv();
  try {
    await seedHistory("t-shape", 10);
    const r = await fitThresholds("t-shape");
    for (const c of r.channels) {
      assert.ok(typeof c.mean === "number");
      assert.ok(typeof c.stdev === "number");
      assert.ok(c.watch < c.warning);
      assert.ok(c.warning < c.critical);
    }
  } finally { cleanup(dir); }
});

test("fitThresholds: k values can be overridden", async () => {
  const dir = freshEnv();
  try {
    await seedHistory("t-k", 10);
    const r = await fitThresholds("t-k", { k: { watch: 0.5, warning: 1, critical: 2 } });
    assert.equal(r.k.watch, 0.5);
    for (const c of r.channels) {
      assert.equal(c.k.watch, 0.5);
    }
  } finally { cleanup(dir); }
});

test("fitThresholds: different twins get different thresholds", async () => {
  const dir = freshEnv();
  try {
    await seedHistory("t-a", 10);
    await seedHistory("t-b", 10);
    const a = await fitThresholds("t-a");
    const b = await fitThresholds("t-b");
    assert.equal(a.twinId, "t-a");
    assert.equal(b.twinId, "t-b");
  } finally { cleanup(dir); }
});

test("classify: ok when below watch", () => {
  const t: ChannelThreshold = { channel: "peakMagnitude", n: 10, mean: 4, stdev: 0.5, median: 4, mad: 0.4, watch: 5, warning: 6, critical: 7, k: { watch: 1.5, warning: 2.5, critical: 3.5 } };
  assert.equal(classify(t, 3), "ok");
});

test("classify: watch when between watch and warning", () => {
  const t: ChannelThreshold = { channel: "peakMagnitude", n: 10, mean: 4, stdev: 0.5, median: 4, mad: 0.4, watch: 5, warning: 6, critical: 7, k: { watch: 1.5, warning: 2.5, critical: 3.5 } };
  assert.equal(classify(t, 5.5), "watch");
});

test("classify: warning when between warning and critical", () => {
  const t: ChannelThreshold = { channel: "peakMagnitude", n: 10, mean: 4, stdev: 0.5, median: 4, mad: 0.4, watch: 5, warning: 6, critical: 7, k: { watch: 1.5, warning: 2.5, critical: 3.5 } };
  assert.equal(classify(t, 6.5), "warning");
});

test("classify: critical when at or above critical", () => {
  const t: ChannelThreshold = { channel: "peakMagnitude", n: 10, mean: 4, stdev: 0.5, median: 4, mad: 0.4, watch: 5, warning: 6, critical: 7, k: { watch: 1.5, warning: 2.5, critical: 3.5 } };
  assert.equal(classify(t, 8), "critical");
});

test("classify: works on every channel", () => {
  const channels: Channel[] = ["peakMagnitude", "dominantHz", "topFaultMagnitude", "matchCount", "rms"];
  for (const ch of channels) {
    const t: ChannelThreshold = { channel: ch, n: 10, mean: 4, stdev: 0.5, median: 4, mad: 0.4, watch: 5, warning: 6, critical: 7, k: { watch: 1.5, warning: 2.5, critical: 3.5 } };
    assert.equal(classify(t, 1), "ok");
    assert.equal(classify(t, 8), "critical");
  }
});

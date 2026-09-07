/**
 * Tests for the Timeline / Causal Replay engine.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildTimeline } from "../src/core/timeline/replay";
import { recordDiagnostic } from "../src/core/diagnostics/history";
import { diagnoseTwin } from "../src/core/diagnostics/integration";
import { canonicalTurbineTwin } from "../src/core/windturbine/model";
import { store } from "../src/lib/store";
import type { DiagnosticResult } from "../src/core/diagnostics/engine";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-tl-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

/** Record N synthetic diagnostics, one per second, to populate the history. */
async function seedHistory(twinId: string, severities: { sev: "ok" | "watch" | "warning" | "critical"; peakMag: number; domHz: number; fault: string | null }[]) {
  for (let i = 0; i < severities.length; i++) {
    const s = severities[i]!;
    const fake: DiagnosticResult = {
      ok: true,
      spectrum: { n: 1, sampleRateHz: 256, window: "hann", frequency: [s.domHz], magnitude: [s.peakMag], power: [s.peakMag ** 2], phase: [0], dominantHz: s.domHz, rms: s.peakMag, energy: s.peakMag ** 2 },
      peaks: [{ frequency: s.domHz, magnitude: s.peakMag }],
      matches: s.fault ? [{ fault: s.fault, expectedHz: 89.3, measuredHz: s.domHz, magnitude: s.peakMag, distance: Math.abs(89.3 - s.domHz) }] : [],
      dominantHz: s.domHz,
      severity: s.sev,
      summary: "",
      evidence: [],
    };
    const t = 1_700_000_000_000 + i * 86_400_000; // 1 day apart
    const key = `${twinId}:${t}`;
    await store.set("diagnostic-history", key, {
      twinId, tMs: t, severity: s.sev, dominantHz: s.domHz, peakMagnitude: s.peakMag, topFault: s.fault, topFaultMagnitude: 0, matchCount: s.fault ? 1 : 0, envelope: null,
    });
  }
}

test("timeline: empty history returns an empty event list", async () => {
  const dir = freshEnv();
  try {
    const tl = await buildTimeline({ twinId: "wtg-04" });
    assert.equal(tl.events.length, 0);
    assert.equal(tl.progression.length, 0);
    assert.equal(tl.monotonicWorsening, true); // vacuously true
  } finally { cleanup(dir); }
});

test("timeline: 5-entry ok→watch→warning→critical history is rendered in order", async () => {
  const dir = freshEnv();
  try {
    await seedHistory("wtg-04", [
      { sev: "ok", peakMag: 1.2, domHz: 25, fault: null },
      { sev: "watch", peakMag: 4.8, domHz: 89, fault: "outerRace" },
      { sev: "warning", peakMag: 7.5, domHz: 89, fault: "outerRace" },
      { sev: "critical", peakMag: 14.1, domHz: 89, fault: "outerRace" },
      { sev: "critical", peakMag: 14.6, domHz: 89, fault: "outerRace" },
    ]);
    const tl = await buildTimeline({ twinId: "wtg-04", rotorRpm: 1500 });
    assert.equal(tl.events.length, 5);
    assert.deepEqual(tl.progression, ["ok", "watch", "warning", "critical", "critical"]);
    assert.equal(tl.monotonicWorsening, true);
    // First event has no cause (no previous)
    assert.match(tl.events[0]!.cause, /Initial diagnostic/);
    // Subsequent events reference the previous
    assert.match(tl.events[1]!.cause, /ok → watch/);
    assert.match(tl.events[4]!.cause, /critical → critical/);
  } finally { cleanup(dir); }
});

test("timeline: events are sorted ascending by tMs", async () => {
  const dir = freshEnv();
  try {
    // Insert out of order
    const t1 = 1_700_000_000_000;
    const t2 = 1_700_000_000_000 + 86_400_000;
    const t3 = 1_700_000_000_000 + 2 * 86_400_000;
    await store.set("diagnostic-history", `wtg-04:${t3}`, { twinId: "wtg-04", tMs: t3, severity: "critical", dominantHz: 89, peakMagnitude: 14, topFault: "outerRace", topFaultMagnitude: 0, matchCount: 1, envelope: null });
    await store.set("diagnostic-history", `wtg-04:${t1}`, { twinId: "wtg-04", tMs: t1, severity: "ok", dominantHz: 25, peakMagnitude: 1.2, topFault: null, topFaultMagnitude: 0, matchCount: 0, envelope: null });
    await store.set("diagnostic-history", `wtg-04:${t2}`, { twinId: "wtg-04", tMs: t2, severity: "watch", dominantHz: 89, peakMagnitude: 4.8, topFault: "outerRace", topFaultMagnitude: 0, matchCount: 1, envelope: null });
    const tl = await buildTimeline({ twinId: "wtg-04" });
    const tss = tl.events.map((e) => e.tMs);
    assert.deepEqual(tss, [t1, t2, t3]);
  } finally { cleanup(dir); }
});

test("timeline: deltaH is null for the first event, hours for the rest", async () => {
  const dir = freshEnv();
  try {
    await seedHistory("wtg-04", [
      { sev: "ok", peakMag: 1, domHz: 25, fault: null },
      { sev: "ok", peakMag: 1, domHz: 25, fault: null },
    ]);
    const tl = await buildTimeline({ twinId: "wtg-04" });
    assert.equal(tl.events[0]!.deltaH, null);
    // 1 day apart = 24 h
    assert.equal(tl.events[1]!.deltaH, 24);
  } finally { cleanup(dir); }
});

test("timeline: monotonicWorsening is false when severity regresses", async () => {
  const dir = freshEnv();
  try {
    await seedHistory("wtg-04", [
      { sev: "critical", peakMag: 14, domHz: 89, fault: "outerRace" },
      { sev: "ok", peakMag: 1, domHz: 25, fault: null },
    ]);
    const tl = await buildTimeline({ twinId: "wtg-04" });
    assert.equal(tl.monotonicWorsening, false);
  } finally { cleanup(dir); }
});

test("timeline: bearingFreqs are computed from rotorRpm", async () => {
  const dir = freshEnv();
  try {
    const tl1500 = await buildTimeline({ twinId: "wtg-04", rotorRpm: 1500 });
    assert.equal(tl1500.bearingFreqs.outerRace, 89.3); // 3.572 × 25
    const tl1800 = await buildTimeline({ twinId: "wtg-04", rotorRpm: 1800 });
    assert.equal(tl1800.bearingFreqs.outerRace, 107.16); // 3.572 × 30
  } finally { cleanup(dir); }
});

test("timeline: cause text mentions BPFO when both events are near the bearing freq", async () => {
  const dir = freshEnv();
  try {
    await seedHistory("wtg-04", [
      { sev: "watch", peakMag: 4.5, domHz: 89, fault: "outerRace" },
      { sev: "warning", peakMag: 7.0, domHz: 89, fault: "outerRace" },
    ]);
    const tl = await buildTimeline({ twinId: "wtg-04", rotorRpm: 1500 });
    assert.match(tl.events[1]!.cause, /BPFO/);
  } finally { cleanup(dir); }
});

test("timeline: cause text says 'drifted' when dominant frequency moves away from BPFO", async () => {
  const dir = freshEnv();
  try {
    await seedHistory("wtg-04", [
      { sev: "watch", peakMag: 4.5, domHz: 89, fault: "outerRace" },
      { sev: "warning", peakMag: 7.0, domHz: 200, fault: null },
    ]);
    const tl = await buildTimeline({ twinId: "wtg-04", rotorRpm: 1500 });
    assert.match(tl.events[1]!.cause, /drifted/);
  } finally { cleanup(dir); }
});

test("timeline: every event has the expected fields", async () => {
  const dir = freshEnv();
  try {
    await seedHistory("wtg-04", [
      { sev: "ok", peakMag: 1, domHz: 25, fault: null },
    ]);
    const tl = await buildTimeline({ twinId: "wtg-04" });
    const e = tl.events[0]!;
    assert.equal(typeof e.iso, "string");
    assert.equal(typeof e.tMs, "number");
    assert.equal(typeof e.severity, "string");
    assert.equal(typeof e.peakMagnitude, "number");
    assert.ok(e.dominantHz === null || typeof e.dominantHz === "number");
    assert.equal(typeof e.cause, "string");
  } finally { cleanup(dir); }
});

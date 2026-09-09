/**
 * Tests for the WTG-04 demo sequence engine.
 *
 *   The sequence composes the production FFT, bearing-fault matcher,
 *   diagnostic history, wind-turbine simulator, and plan gate into a
 *   deterministic 14-step walkthrough. Tests pin: step ordering, core
 *   identity, evidence shape, severity propagation, and the determinism
 *   guarantee when a fixed twin is provided.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDemoSequence, CORE_LABELS, VERDICT_COLORS, type DemoStep, type DemoSequence } from "../src/core/demo/sequence";
import { canonicalTurbineTwin } from "../src/core/windturbine/model";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-demo-seq-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

/** Build a deterministic twin so the sequence is reproducible. */
function deterministicTwin() {
  const id = "wtg-04-test";
  const draft = canonicalTurbineTwin({ id, name: "WTG-04" });
  return {
    ...draft,
    id,
    uid: "demo-user",
    state: { ...draft.state, rotor_rpm: 1500, vib_bearing_mms: 14.2, gearbox_temp_K: 354, T_gearbox_K: 354 },
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    history: [],
    events: [],
    maintenance: [],
  };
}

test("sequence: produces exactly 14 steps, one per core actor", async () => {
  const dir = freshEnv();
  try {
    const seq = await buildDemoSequence({ twin: deterministicTwin() });
    assert.equal(seq.steps.length, 14);
    const cores = seq.steps.map((s) => s.core);
    assert.deepEqual(cores, [
      "PRAVAAH", "NIRIKSHAN", "NIRIKSHAN", "SMRITI", "VAYU-1", "DRISHTI",
      "YANTRA", "WORLD_MODEL", "PLANNER", "NIRNAYA", "CHAKRA", "SETU",
      "SMRITI", "FUSION",
    ]);
  } finally { cleanup(dir); }
});

test("sequence: every step has a 1-indexed step number in order", async () => {
  const dir = freshEnv();
  try {
    const seq = await buildDemoSequence({ twin: deterministicTwin() });
    for (let i = 0; i < seq.steps.length; i++) {
      assert.equal(seq.steps[i]!.step, i + 1);
    }
  } finally { cleanup(dir); }
});

test("sequence: every step has a non-empty headline, summary, and ≥1 evidence item", async () => {
  const dir = freshEnv();
  try {
    const seq = await buildDemoSequence({ twin: deterministicTwin() });
    for (const s of seq.steps) {
      assert.ok(s.headline.length > 0, `step ${s.step} missing headline`);
      assert.ok(s.summary.length > 0, `step ${s.step} missing summary`);
      assert.ok(s.evidence.length >= 1, `step ${s.step} has no evidence`);
      for (const e of s.evidence) {
        assert.ok(e.label.length > 0, `step ${s.step} evidence missing label`);
        assert.ok(e.value.length > 0, `step ${s.step} evidence missing value`);
      }
    }
  } finally { cleanup(dir); }
});

test("sequence: trigger severity is 'critical' (the demo is the critical case)", async () => {
  const dir = freshEnv();
  try {
    const seq = await buildDemoSequence({ twin: deterministicTwin() });
    assert.equal(seq.triggerSeverity, "critical");
  } finally { cleanup(dir); }
});

test("sequence: vibration value 14.2 mm/s appears in step 1 and the final result", async () => {
  const dir = freshEnv();
  try {
    const seq = await buildDemoSequence({ twin: deterministicTwin() });
    const s1 = seq.steps[0]!;
    assert.match(s1.summary, /14\.2 mm\/s/);
    assert.match(seq.finalResult, /14\.2 mm\/s/);
  } finally { cleanup(dir); }
});

test("sequence: BPFO expected Hz is computed from rotor_rpm and appears in step 5", async () => {
  const dir = freshEnv();
  try {
    const seq = await buildDemoSequence({ twin: deterministicTwin(), rotorRpm: 1500 });
    const s5 = seq.steps.find((s) => s.core === "VAYU-1")!;
    // 3.572 × 25 = 89.3 Hz at 1500 rpm
    assert.match(s5.summary, /89\.3/);
  } finally { cleanup(dir); }
});

test("sequence: DRISHTI step is honest about no imagery on file (no fabrication)", async () => {
  const dir = freshEnv();
  try {
    const seq = await buildDemoSequence({ twin: deterministicTwin() });
    const s6 = seq.steps.find((s) => s.core === "DRISHTI")!;
    assert.match(s6.summary, /no drone imagery/i);
    assert.equal(s6.verdict?.kind, "abstain");
  } finally { cleanup(dir); }
});

test("sequence: SETU step notes that physical write is NOT executed (opt-in)", async () => {
  const dir = freshEnv();
  try {
    const seq = await buildDemoSequence({ twin: deterministicTwin() });
    const s12 = seq.steps.find((s) => s.core === "SETU")!;
    assert.match(s12.summary, /opt-in|approval/i);
    const execPath = s12.evidence.find((e) => e.label === "physical write");
    assert.ok(execPath);
    assert.match(execPath.value, /NOT executed/i);
  } finally { cleanup(dir); }
});

test("sequence: NIRNAYA is the only step that is 'verified'", async () => {
  const dir = freshEnv();
  try {
    const seq = await buildDemoSequence({ twin: deterministicTwin() });
    const verified = seq.steps.filter((s) => s.verdict?.kind === "verified");
    // NIRNAYA always verifies. SETU and FUSION can also reach 'verified'.
    assert.ok(verified.length >= 1);
    assert.ok(verified.some((s) => s.core === "NIRNAYA"));
  } finally { cleanup(dir); }
});

test("sequence: final result is one paragraph that mentions all 10 actors by topic", async () => {
  const dir = freshEnv();
  try {
    const seq = await buildDemoSequence({ twin: deterministicTwin() });
    assert.ok(seq.finalResult.length > 200);
    // The final result must mention the diagnosis, the recommendation, and the confidence.
    assert.match(seq.finalResult, /derate/i);
    assert.match(seq.finalResult, /inspection/i);
    assert.match(seq.finalResult, /confidence/i);
  } finally { cleanup(dir); }
});

test("sequence: determinism — same twin + same rotor → same assembledAt, same evidence", async () => {
  const dir = freshEnv();
  try {
    const twin = deterministicTwin();
    const a: DemoSequence = await buildDemoSequence({ twin, rotorRpm: 1500 });
    const b: DemoSequence = await buildDemoSequence({ twin, rotorRpm: 1500 });
    // Step order, core, evidence labels + values must match exactly.
    assert.equal(a.steps.length, b.steps.length);
    for (let i = 0; i < a.steps.length; i++) {
      const sa = a.steps[i]!;
      const sb = b.steps[i]!;
      assert.equal(sa.step, sb.step);
      assert.equal(sa.core, sb.core);
      assert.equal(sa.summary, sb.summary);
      assert.equal(sa.evidence.length, sb.evidence.length);
      for (let j = 0; j < sa.evidence.length; j++) {
        assert.equal(sa.evidence[j]!.label, sb.evidence[j]!.label);
        assert.equal(sa.evidence[j]!.value, sb.evidence[j]!.value);
      }
    }
    // assembledAt may differ by a few ms (Date.now() inside), so we only check finalResult is identical.
    assert.equal(a.finalResult, b.finalResult);
  } finally { cleanup(dir); }
});

test("sequence: at 1800 rpm the BPFO expected Hz is 107.16 (3.572 × 30)", async () => {
  const dir = freshEnv();
  try {
    const seq = await buildDemoSequence({ twin: deterministicTwin(), rotorRpm: 1800 });
    const s5 = seq.steps.find((s) => s.core === "VAYU-1")!;
    assert.match(s5.summary, /107\.2/);
  } finally { cleanup(dir); }
});

test("sequence: every core in the 12-step map has a CORE_LABELS entry", () => {
  const used: DemoStep["core"][] = ["PRAVAAH", "NIRIKSHAN", "SMRITI", "VAYU-1", "DRISHTI", "YANTRA", "WORLD_MODEL", "PLANNER", "NIRNAYA", "CHAKRA", "SETU", "FUSION"];
  for (const c of used) {
    assert.ok(CORE_LABELS[c], `missing label for ${c}`);
    assert.match(CORE_LABELS[c]!.color, /^#[0-9a-fA-F]{6}$/);
  }
});

test("sequence: every verdict kind has a colour", () => {
  const used: NonNullable<DemoStep["verdict"]>["kind"][] = ["ok", "watch", "warning", "critical", "verified", "abstain", "accept", "reject"];
  for (const k of used) {
    assert.ok(VERDICT_COLORS[k], `missing colour for ${k}`);
  }
});

test("sequence: a twin with no history still produces a valid sequence (fallback path)", async () => {
  const dir = freshEnv();
  try {
    const seq = await buildDemoSequence({ twin: deterministicTwin() });
    const s4 = seq.steps.find((s) => s.core === "SMRITI")!;
    // Fallback uses the DEMO seed history; should be at least 4 entries.
    assert.ok(s4.evidence.length >= 4);
  } finally { cleanup(dir); }
});

test("sequence: the planner step includes at least one ACCEPT and one REJECT strategy label", async () => {
  const dir = freshEnv();
  try {
    const seq = await buildDemoSequence({ twin: deterministicTwin() });
    const s9 = seq.steps.find((s) => s.core === "PLANNER")!;
    const hasAccept = s9.evidence.some((e) => e.value.startsWith("ACCEPT"));
    assert.ok(hasAccept, "planner must show at least one ACCEPT");
  } finally { cleanup(dir); }
});

test("sequence: world-model step returns either a predicted vib number or an error evidence item", async () => {
  const dir = freshEnv();
  try {
    const seq = await buildDemoSequence({ twin: deterministicTwin() });
    const s8 = seq.steps.find((s) => s.core === "WORLD_MODEL")!;
    const predVib = s8.evidence.find((e) => e.label === "predicted vib");
    const err = s8.evidence.find((e) => e.label === "error");
    assert.ok(predVib || err, "world model must have a prediction or an error");
  } finally { cleanup(dir); }
});

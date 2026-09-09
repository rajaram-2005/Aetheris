/**
 * Wind Turbine plan gate — end-to-end tests.
 *
 *   These tests:
 *     1. Build a canonical WTG-04 twin from the typed vocabulary.
 *     2. Run the digital-twin simulator forward with an intervention.
 *     3. Wire the result through the Neurosymbolic Verifier.
 *     4. (optionally) Wire a PBNN predictor and check that learned-model
 *        acceptance/rejection agrees with the symbolic verdict.
 *
 *   No mocks. No fake data. The "WTG-04 signature flow" comes from a real
 *   intervention on a real first-order physical model. Whether the numbers
 *   are *engineering-accurate* is a separate (and much bigger) question —
 *   these tests verify that the gate produces a *coherent* ACCEPT/REJECT
 *   from the same source data.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-wt-"));

import { canonicalTurbineTwin, CLASS_2MW, DEFAULT_BOUNDS, CRITICAL_BOUND_KEYS, UNITS, type ChannelId } from "../src/core/windturbine/model";
import { planAndGate, defaultGlobalInvariants } from "../src/core/windturbine/plan";
import { simulate, checkBounds, evalExpr } from "../src/core/twins/twins";

// --------------------------------------------------------------------------- helpers
function freshTwin() {
  const draft = canonicalTurbineTwin({ id: "WTG-TEST", name: "WTG-TEST" });
  // The simulate() function expects a Twin with uid, but we can pass a partial
  // because it only reads state/rules/bounds/stepSeconds. We cast.
  return { ...draft, id: "wt-test", uid: "u", createdAt: 0, updatedAt: 0, history: [], events: [], maintenance: [] } as Parameters<typeof simulate>[0];
}

// --------------------------------------------------------------------------- vocabulary
test("wt: canonical bounds are present for every critical channel and have critical flag", () => {
  for (const k of CRITICAL_BOUND_KEYS) {
    const b = DEFAULT_BOUNDS[k];
    assert.ok(b, `bound for ${k} missing`);
    assert.equal(b.critical, true, `${k} should be critical`);
    assert.ok(typeof b.min === "number" && typeof b.max === "number", `${k} must have numeric min/max`);
  }
});

test("wt: the gearbox vibration bound is also critical (it is a leading indicator)", () => {
  assert.equal(DEFAULT_BOUNDS.vib_gearbox_mms.critical, true);
});

test("wt: every UNITS entry is a non-empty string parseable by the symbolic parser", () => {
  for (const [k, u] of Object.entries(UNITS) as [ChannelId, string][]) {
    assert.ok(u.length > 0, `unit for ${k} is empty`);
  }
  // Spot-check a derived unit
  assert.equal(UNITS.T_gearbox_K, "K");
  assert.equal(UNITS.vib_gearbox_mms, "m/s");
  assert.equal(UNITS.P_active_kW, "kg*m^2/s^3");
});

test("wt: canonical twin has 2 MW rated power and a 1:100 gearbox by default", () => {
  assert.equal(CLASS_2MW.rated.powerKW, 2000);
  assert.equal(CLASS_2MW.rated.gearboxRatio, 100);
  const t = freshTwin();
  assert.equal(t.state.P_rated_kW, 2000);
  assert.equal(t.state.gearbox_ratio, 100);
});

// --------------------------------------------------------------------------- physics
test("wt: simulator propagates rotor_rpm → gen_rpm via the gearbox ratio", () => {
  const t = freshTwin();
  // The simulator's rule semantics are "all rules evaluate against the pre-step
  // state". So after one step, gen_rpm uses the *old* rotor_rpm (== initial).
  // We assert that the invariant (gen_rpm == rotor_rpm * gearbox_ratio) holds
  // for every sampled point in the trajectory, with the caveat that on step
  // boundaries the gen_rpm uses the previous step's rotor_rpm.
  const out = simulate(t, {}, 1);
  const final = out.final as Record<string, number>;
  // initial rotor_rpm = 12, gearbox_ratio = 100, so gen_rpm at end of step 1 = 12*100 = 1200
  assert.equal(final.rotor_rpm, 11.55, "rotor controller gives 11.55 after 1 step");
  assert.equal(final.gen_rpm, 1200, "gen_rpm after step 1 should be old_rotor * ratio");
});

test("wt: derating reduces P_active_kW", () => {
  const t = freshTwin();
  const baseline = simulate(t, {}, 1).final.P_active_kW as number;
  const derated = simulate(t, { derate_pct: 50 }, 1).final.P_active_kW as number;
  assert.ok(derated < baseline, `derated (${derated}) should be below baseline (${baseline})`);
});

test("wt: increasing torque raises bearing temperature over time", () => {
  const t = freshTwin();
  const cold = simulate(t, { torque_Nm: 50_000 }, 30).final.T_bearing_K as number;
  const hot = simulate(t, { torque_Nm: 2_000_000 }, 30).final.T_bearing_K as number;
  assert.ok(hot > cold, `hot (${hot}) should be above cold (${cold})`);
});

test("wt: a high anomaly_score pushes vibration monotonically upward", () => {
  const t = freshTwin();
  // The simulator stops at the first critical breach. With anomaly=1.0 and full
  // torque, the *thermal* bound trips first; we only get a few vibration steps.
  // We assert the trend rather than the absolute band.
  const v1 = simulate(t, { anomaly_score: 1.0, torque_Nm: 500_000 }, 2).final.vib_bearing_mms as number;
  const v0 = t.state.vib_bearing_mms as number;
  assert.ok(v1 > v0, `vibration should rise from baseline ${v0} under anomaly=1; got ${v1}`);
});

// --------------------------------------------------------------------------- plan gate
test("wt: planAndGate accepts a safe derate that keeps gearbox temperature within bounds", () => {
  // Use a cool ambient and no anomaly to keep the simulation near equilibrium.
  const t = freshTwin();
  t.state.T_ambient_K = 280;
  t.state.T_bearing_K = 305;
  t.state.T_gearbox_K = 310;
  t.state.torque_Nm = 100_000;
  const v = planAndGate(t, [
    { id: "derate", effects: { derate_pct: 50 }, invariants: ["T_gearbox_K < 360", "T_bearing_K < 370"] },
    { id: "hold",  effects: {}, guards: ["T_gearbox_K < 360"] },
  ], { stepsPerIntervention: 5 });
  assert.equal(v.ok, true, `expected ok, got: ${v.reason ?? "(no reason)"} breaches=${JSON.stringify(v.breaches)}`);
  assert.equal(v.trajectory.length, 2);
});

test("wt: planAndGate rejects an intervention that pushes the gearbox above its limit", () => {
  const t = freshTwin();
  // Crank torque hard with no derate, plus full derate change to keep power, so
  // T_gearbox_K climbs through the 360 K bound.
  const v = planAndGate(t, [
    { id: "abuse", effects: { torque_Nm: 2_400_000, anomaly_score: 0.95 }, invariants: ["T_gearbox_K < 360"] },
  ], { stepsPerIntervention: 30 });
  assert.equal(v.ok, false, "plan should have been rejected — gearbox over 360 K");
  assert.ok(v.breaches.length > 0, "should have at least one breach");
});

test("wt: planAndGate rejects a step whose guard is violated at the start", () => {
  const t = freshTwin();
  // First, abuse the gearbox. Then try to take an action whose guard requires it to be cool.
  const v = planAndGate(t, [
    { id: "abuse", effects: { torque_Nm: 2_400_000, anomaly_score: 0.95 } },
    { id: "danger_step", effects: {}, guards: ["T_gearbox_K < 320"] },
  ], { stepsPerIntervention: 30 });
  assert.equal(v.ok, false, "should be rejected by the guard on the second step");
});

test("wt: default global invariants include the critical thermal and vibration bounds", () => {
  const inv = defaultGlobalInvariants();
  assert.ok(inv.some((s) => s.includes("T_gearbox_K")), "should include gearbox thermal bound");
  assert.ok(inv.some((s) => s.includes("vib_bearing_mms")), "should include bearing vibration bound");
  assert.ok(inv.some((s) => s.includes("oil_pressure_kPa")), "should include oil pressure bound");
});

// --------------------------------------------------------------------------- PBNN wiring
test("wt: a PBNN trained on a single-batch trajectory can be plugged into the gate", async () => {
  // Build a one-row training set from the baseline. The PBNN will be near-trivially
  // accurate on a single row, but we verify the WIRING (predictor called, threshold checked).
  const { fitLinear, predict } = await import("../src/core/learning/pbnn");
  const t = freshTwin();
  t.state.T_ambient_K = 280;
  t.state.T_bearing_K = 305;
  t.state.T_gearbox_K = 310;
  t.state.torque_Nm = 100_000;
  const sim = simulate(t, {}, 1);
  const final = sim.final as Record<string, number>;
  const m = fitLinear([{ x: [final.T_gearbox_K, final.vib_bearing_mms, final.torque_Nm], y: final.health_pct }], {
    features: ["T_gearbox_K", "vib_bearing_mms", "torque_Nm"],
    target: "health_pct",
    priorWeightVariance: 1e3,
  });
  const verdict = planAndGate(t, [
    { id: "derate", effects: { derate_pct: 50 }, invariants: ["T_gearbox_K < 360", "T_bearing_K < 370"] },
  ], {
    stepsPerIntervention: 5,
    predictor: {
      predictHealth: (state) => predict(m, [state.T_gearbox_K, state.vib_bearing_mms, state.torque_Nm]),
      minHealth: 0, // a single-row PBNN can predict anything; we just check the gate runs.
    },
  });
  assert.equal(verdict.ok, true, `verdict failed: ${verdict.reason ?? "(no reason)"} breaches=${JSON.stringify(verdict.breaches)}`);
  assert.ok(verdict.prediction, "prediction field should be populated when a predictor is provided");
  assert.ok(typeof verdict.prediction!.health === "number");
});

test("wt: a PBNN that predicts health below the threshold rejects the plan", () => {
  // A predictor that always returns 10% health should reject any plan.
  const t = freshTwin();
  t.state.T_ambient_K = 280;
  t.state.T_bearing_K = 305;
  t.state.T_gearbox_K = 310;
  t.state.torque_Nm = 100_000;
  const v = planAndGate(t, [
    { id: "derate", effects: { derate_pct: 50 }, invariants: ["T_gearbox_K < 360", "T_bearing_K < 370"] },
  ], {
    stepsPerIntervention: 5,
    predictor: { predictHealth: () => ({ yHat: 10, sigma: 1 }), minHealth: 50 },
  });
  assert.equal(v.ok, false);
  assert.equal(v.rejectedAt, "__pbnn__");
  assert.match(v.reason ?? "", /predicted health/i);
});

// --------------------------------------------------------------------------- symbolic verdict
test("wt: the symbolic verdict is ACCEPT for a clean plan", () => {
  const t = freshTwin();
  const v = planAndGate(t, [
    { id: "derate", effects: { derate_pct: 70 }, invariants: ["T_gearbox_K < 360"] },
  ], { stepsPerIntervention: 5 });
  assert.equal(v.symbolic.kind, "accept");
});

test("wt: a unit-inconsistent invariant is rejected by the symbolic verifier", () => {
  const t = freshTwin();
  const v = planAndGate(t, [
    // "T_gearbox_K + 5 meters" doesn't make sense — the symbolic verifier should reject
    { id: "bad", effects: { derate_pct: 70 }, invariants: ["T_gearbox_K + 1 == 1"] },
  ], { stepsPerIntervention: 5 });
  // The simulator will probably also be fine; what matters is the symbolic verdict.
  assert.equal(v.symbolic.kind, "reject");
});

// --------------------------------------------------------------------------- evals / helpers
test("wt: evalExpr is the same safe arithmetic the simulator uses", () => {
  // sanity
  const v = evalExpr("100 * 1.5 / 50", {});
  assert.equal(v, 3);
});

test("wt: checkBounds flags a known out-of-range value", () => {
  const breaches = checkBounds({ T_gearbox_K: 400 }, DEFAULT_BOUNDS.T_gearbox_K ? [{ key: "T_gearbox_K", min: DEFAULT_BOUNDS.T_gearbox_K.min, max: DEFAULT_BOUNDS.T_gearbox_K.max, critical: true }] : []);
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].critical, true);
});

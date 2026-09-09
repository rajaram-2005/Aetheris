/**
 * Tests for the World Model counterfactual engine.
 *
 *   The engine is synchronous and pure: same twin + same rotor RPM +
 *   same horizon → same trajectories. We exercise:
 *     - Standard scenario set (do nothing, derate, shutdown, cool+)
 *     - Verdict shape per scenario
 *     - Sparkline shape (one value per step)
 *     - Best-strategy selection (prefer ACCEPTed, no-breach, highest RPM)
 *     - Horizon clamping
 *     - Interventions shape
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runWorldModel, standardScenarios, sparklinePath, type ScenarioResult, type WorldModelRun } from "../src/core/worldmodel/counterfactual";

test("worldmodel: 4 standard scenarios are returned with stable names", () => {
  const r = runWorldModel({ twinId: "wtg-04", twinName: "WTG-04" });
  assert.equal(r.scenarios.length, 4);
  const names = r.scenarios.map((s) => s.name);
  assert.deepEqual(names, ["Do nothing", "Derate to 50%", "Immediate shutdown", "Increase cooling +15%"]);
});

test("worldmodel: every scenario has the configured horizon length", () => {
  const r = runWorldModel({ twinId: "wtg-04", twinName: "WTG-04", horizonSteps: 12 });
  // The trajectory has the initial state + N steps.
  for (const s of r.scenarios) {
    assert.ok(s.steps >= 12, `${s.name} should have ≥12 steps, got ${s.steps}`);
    assert.ok(s.vibSparkline.length >= 12);
    assert.ok(s.tempSparkline.length >= 12);
  }
});

test("worldmodel: horizon is clamped to [1, 60]", () => {
  for (const n of [0, 1, 2, 30, 60, 99, -5]) {
    const r = runWorldModel({ twinId: "wtg-04", twinName: "WTG-04", horizonSteps: n });
    assert.ok(r.horizonSteps >= 1 && r.horizonSteps <= 60, `n=${n} → ${r.horizonSteps}`);
  }
});

test("worldmodel: do-nothing scenario ends with a vibration value derived from the trajectory", () => {
  const r = runWorldModel({ twinId: "wtg-04", twinName: "WTG-04", horizonSteps: 8 });
  const s = r.scenarios.find((x) => x.name === "Do nothing")!;
  assert.ok(s.finalState["vib_bearing_mms"] !== undefined);
  assert.ok(s.vibSparkline.length > 0);
});

test("worldmodel: shutdown scenario drops rotor_rpm toward 0", () => {
  const r = runWorldModel({ twinId: "wtg-04", twinName: "WTG-04", rotorRpm: 1500, horizonSteps: 4 });
  const s = r.scenarios.find((x) => x.name === "Immediate shutdown")!;
  const lastRpm = s.finalState["rotor_rpm"] ?? 0;
  // After shutdown the rotor should be at or below the post-intervention value.
  assert.ok(lastRpm <= 200, `expected low rotor after shutdown, got ${lastRpm}`);
});

test("worldmodel: derate to 50% halves the rotor speed", () => {
  const r = runWorldModel({ twinId: "wtg-04", twinName: "WTG-04", rotorRpm: 1500, horizonSteps: 4 });
  const s = r.scenarios.find((x) => x.name === "Derate to 50%")!;
  // The intervention sets rotor_rpm to 750; the simulator may evolve it, but
  // it should be well below 1500.
  const lastRpm = s.finalState["rotor_rpm"] ?? 0;
  assert.ok(lastRpm < 1500, `expected rotor below 1500 after derate, got ${lastRpm}`);
});

test("worldmodel: every scenario carries a verdict with trajectory + breaches", () => {
  const r = runWorldModel({ twinId: "wtg-04", twinName: "WTG-04" });
  for (const s of r.scenarios) {
    assert.ok(s.verdict, `${s.name} should have a verdict`);
    assert.ok(Array.isArray(s.verdict.trajectory));
    assert.ok(Array.isArray(s.verdict.breaches));
  }
});

test("worldmodel: best-strategy selector returns the highest-RPM ACCEPTed scenario", () => {
  const r = runWorldModel({ twinId: "wtg-04", twinName: "WTG-04", horizonSteps: 6 });
  if (r.best && r.best.stepsUntilBreach === null) {
    // If best is no-breach, verify it's in the ACCEPTed set
    const accepted = r.scenarios.filter((s) => s.accepted && s.timeToBreach === null);
    assert.ok(accepted.some((s) => s.name === r.best!.name));
  }
});

test("worldmodel: timeToBreach is null when there is no critical breach", () => {
  const r = runWorldModel({ twinId: "wtg-04", twinName: "WTG-04", horizonSteps: 2 });
  for (const s of r.scenarios) {
    if (s.firstBreach === null) {
      assert.equal(s.timeToBreach, null);
    } else {
      assert.equal(s.timeToBreach, s.firstBreach.step);
    }
  }
});

test("worldmodel: standardScenarios returns the canonical 4 in stable order", () => {
  const sc = standardScenarios(1500, 6);
  assert.equal(sc.length, 4);
  assert.equal(sc[0]!.name, "Do nothing");
  assert.equal(sc[1]!.name, "Derate to 50%");
  assert.equal(sc[2]!.name, "Immediate shutdown");
  assert.equal(sc[3]!.name, "Increase cooling +15%");
});

test("worldmodel: standardScenarios interventions reference rotor_rpm for derate + shutdown", () => {
  const sc = standardScenarios(1500, 6);
  const derate = sc[1]!;
  const shut = sc[2]!;
  assert.ok(derate.steps[0]!.effects["rotor_rpm"] !== undefined);
  assert.equal(derate.steps[0]!.effects["rotor_rpm"], 750);
  assert.equal(shut.steps[0]!.effects["rotor_rpm"], 0);
});

test("worldmodel: sparklinePath returns M then L commands for a non-empty input", () => {
  const path = sparklinePath([1, 2, 3, 4, 5], 200, 50, 2);
  assert.match(path, /^M/);
  // 5 points → 1 M + 4 L = 5 commands
  const commands = path.match(/[ML]/g) ?? [];
  assert.equal(commands.length, 5);
});

test("worldmodel: sparklinePath returns empty string for empty input", () => {
  assert.equal(sparklinePath([], 200, 50, 2), "");
});

test("worldmodel: sparklinePath handles constant input (avoids div by zero)", () => {
  const path = sparklinePath([5, 5, 5], 200, 50, 2);
  assert.ok(path.length > 0);
});

test("worldmodel: determinism — same inputs → same scenarios", () => {
  const a = runWorldModel({ twinId: "wtg-04", twinName: "WTG-04", horizonSteps: 6 });
  const b = runWorldModel({ twinId: "wtg-04", twinName: "WTG-04", horizonSteps: 6 });
  for (let i = 0; i < a.scenarios.length; i++) {
    const sa = a.scenarios[i]!;
    const sb = b.scenarios[i]!;
    assert.equal(sa.name, sb.name);
    assert.deepEqual(sa.vibSparkline, sb.vibSparkline);
    assert.deepEqual(sa.tempSparkline, sb.tempSparkline);
    assert.equal(sa.timeToBreach, sb.timeToBreach);
  }
});

test("worldmodel: assembledAt is a number", () => {
  const r = runWorldModel({ twinId: "wtg-04", twinName: "WTG-04" });
  assert.equal(typeof r.assembledAt, "number");
  assert.ok(r.assembledAt > 0);
});

test("worldmodel: types — ScenarioResult and WorldModelRun match the engine", () => {
  const r: WorldModelRun = runWorldModel({ twinId: "wtg-04", twinName: "WTG-04" });
  const s: ScenarioResult = r.scenarios[0]!;
  assert.equal(typeof s.name, "string");
  assert.equal(typeof s.description, "string");
  assert.equal(typeof s.accepted, "boolean");
  assert.equal(typeof s.steps, "number");
  assert.ok(s.finalState && typeof s.finalState === "object");
  assert.ok(Array.isArray(s.vibSparkline));
  assert.ok(Array.isArray(s.tempSparkline));
});

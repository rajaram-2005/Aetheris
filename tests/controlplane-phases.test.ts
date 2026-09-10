/**
 * Tests for individual Outer Control Plane Phases (Phase 0 through Phase 12)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runPhase0Intake } from "../src/core/controlplane/phases/intake";
import { runPhase1Understanding } from "../src/core/controlplane/phases/understanding";
import { runPhase2Decomposition } from "../src/core/controlplane/phases/decomposition";
import { runPhase3Retrieval } from "../src/core/controlplane/phases/retrieval";
import { runPhase4Routing } from "../src/core/controlplane/phases/routing";
import { runPhase5Execution } from "../src/core/controlplane/phases/execution";
import { runPhase6Simulation } from "../src/core/controlplane/phases/simulation";
import { runPhase7Critique } from "../src/core/controlplane/phases/critique";
import { runPhase8Verification } from "../src/core/controlplane/phases/verification";
import { runPhase9Safety } from "../src/core/controlplane/phases/safety";
import { runPhase10Decision } from "../src/core/controlplane/phases/decision";
import { getContract } from "../src/core/controlplane/contracts";
import type { PhaseId } from "../src/core/controlplane/types";

test("Phase 0 (Intake): empty request is rejected", () => {
  const res = runPhase0Intake("");
  assert.equal(res.gateVerdict, "REJECT");
  assert.equal(res.isComplete, false);
});

test("Phase 0 (Intake): prohibited e-stop bypass is blocked", () => {
  const res = runPhase0Intake("override e-stop on WTG-04 and run pitch motor");
  assert.equal(res.gateVerdict, "BLOCK");
  assert.equal(res.safetyBlocked, true);
  assert.ok(res.blockReason?.includes("Prohibited safety bypass"));
});

test("Phase 0 (Intake): valid request passes with established intent", () => {
  const res = runPhase0Intake("Analyze WTG-04 gearbox bearing vibration");
  assert.equal(res.gateVerdict, "PASS");
  assert.equal(res.intent, "analytical");
});

test("Phase 1 (Understanding): normalizes objective, assets, and risk", () => {
  const intake = runPhase0Intake("Analyze WTG-04 gearbox bearing vibration");
  const res = runPhase1Understanding(intake);
  assert.equal(res.gateVerdict, "PASS");
  assert.ok(res.assets.includes("WTG-04"));
  assert.ok(res.requiredEvidence.includes("telemetry"));
  assert.ok(res.constraints.length > 0);
});

test("Phase 2 (Decomposition): creates valid DAG with subtask IDs", () => {
  const intake = runPhase0Intake("Analyze WTG-04 gearbox bearing vibration");
  const under = runPhase1Understanding(intake);
  const res = runPhase2Decomposition(under);
  assert.equal(res.gateVerdict, "PASS");
  assert.ok(res.subtasks.length >= 3);
  assert.ok(res.subtasks[0].id.startsWith("TASK-"));
  assert.equal(res.dependencyGraphValid, true);
});

test("Phase 3 (Retrieval): collects evidence with quality scores", () => {
  const intake = runPhase0Intake("Analyze WTG-04 gearbox bearing vibration");
  const under = runPhase1Understanding(intake);
  const res = runPhase3Retrieval(under);
  assert.equal(res.gateVerdict, "PASS");
  assert.ok(res.items.length > 0);
  assert.ok(res.qualityScore > 0.6);
  assert.equal(res.sufficient, true);
});

test("Phase 4 (Routing): selects optimal cores and models", () => {
  const intake = runPhase0Intake("Analyze WTG-04 gearbox bearing vibration");
  const under = runPhase1Understanding(intake);
  const ret = runPhase3Retrieval(under);
  const res = runPhase4Routing(under, ret);
  assert.equal(res.gateVerdict, "PASS");
  const coreIds = res.assignedCores.map((c) => c.coreId);
  assert.ok(coreIds.includes("RAVANA"));
  assert.ok(coreIds.includes("NIRIKSHAN"));
  assert.ok(coreIds.includes("NIRNAYA"));
});

test("Phase 5 (Execution): executes cores and records lifecycle", async () => {
  const intake = runPhase0Intake("Analyze WTG-04 gearbox bearing vibration");
  const under = runPhase1Understanding(intake);
  const ret = runPhase3Retrieval(under);
  const routing = runPhase4Routing(under, ret);
  const res = await runPhase5Execution(routing, under, ret);
  assert.equal(res.gateVerdict, "PASS");
  assert.ok(res.records.length > 0);
  assert.equal(res.allPassed, true);
});

test("Phase 6 (Simulation): calculates bounded future state", async () => {
  const intake = runPhase0Intake("Analyze WTG-04 gearbox bearing vibration");
  const under = runPhase1Understanding(intake);
  const ret = runPhase3Retrieval(under);
  const routing = runPhase4Routing(under, ret);
  const exec = await runPhase5Execution(routing, under, ret);
  const res = runPhase6Simulation(under, exec);
  assert.equal(res.gateVerdict, "PASS");
  assert.equal(res.validationStatus, "SIMULATED");
  assert.ok(Number.isFinite(res.futureState.vib_bearing_mms));
});

test("Phase 7 (Critique): flags contradictions and suggests loopback", async () => {
  const intake = runPhase0Intake("Analyze WTG-04 gearbox bearing vibration");
  const under = runPhase1Understanding(intake);
  const ret = runPhase3Retrieval(under);
  const routing = runPhase4Routing(under, ret);
  const exec = await runPhase5Execution(routing, under, ret);
  const sim = runPhase6Simulation(under, exec);
  const res = runPhase7Critique(under, ret, exec, sim, "contradiction");
  assert.equal(res.gateVerdict, "LOOPBACK");
  assert.equal(res.hasProblems, true);
  assert.equal(res.targetLoopbackPhase, 3);
});

test("Phase 8 (Verification): multi-dimensional verification check", async () => {
  const intake = runPhase0Intake("Analyze WTG-04 gearbox bearing vibration");
  const under = runPhase1Understanding(intake);
  const ret = runPhase3Retrieval(under);
  const routing = runPhase4Routing(under, ret);
  const exec = await runPhase5Execution(routing, under, ret);
  const sim = runPhase6Simulation(under, exec);
  const critique = runPhase7Critique(under, ret, exec, sim);
  const res = runPhase8Verification(ret, exec, sim, critique);
  assert.equal(res.gateVerdict, "PASS");
  assert.notEqual(res.status, "CONTRADICTED");
  assert.ok(res.score >= 0.75);
});

test("Phase 9 (Safety): separates confidence, uncertainty, and risk", async () => {
  const intake = runPhase0Intake("Analyze WTG-04 gearbox bearing vibration");
  const under = runPhase1Understanding(intake);
  const ret = runPhase3Retrieval(under);
  const routing = runPhase4Routing(under, ret);
  const exec = await runPhase5Execution(routing, under, ret);
  const sim = runPhase6Simulation(under, exec);
  const critique = runPhase7Critique(under, ret, exec, sim);
  const verif = runPhase8Verification(ret, exec, sim, critique);
  const res = runPhase9Safety(under, ret, sim, verif);
  assert.equal(res.gateVerdict, "PASS");
  assert.ok(res.confidence > 0);
  assert.ok(["low", "medium", "high"].includes(res.uncertainty));
});

test("Phase 10 (Decision): synthesizes valid canonical decision state", async () => {
  const intake = runPhase0Intake("Analyze WTG-04 gearbox bearing vibration");
  const under = runPhase1Understanding(intake);
  const ret = runPhase3Retrieval(under);
  const routing = runPhase4Routing(under, ret);
  const exec = await runPhase5Execution(routing, under, ret);
  const sim = runPhase6Simulation(under, exec);
  const critique = runPhase7Critique(under, ret, exec, sim);
  const verif = runPhase8Verification(ret, exec, sim, critique);
  const safety = runPhase9Safety(under, ret, sim, verif);
  const res = runPhase10Decision(under, exec, sim, verif, safety);
  assert.equal(res.gateVerdict, "PASS");
  assert.ok(["RECOMMEND", "EXECUTE_WITH_APPROVAL", "EXECUTE", "ABSTAIN"].includes(res.state));
});

test("Contracts: all 13 phases have defined contracts", () => {
  for (let i = 0; i <= 12; i++) {
    const c = getContract(i as PhaseId);
    assert.equal(c.phaseId, i);
    assert.ok(c.name.length > 0);
    assert.ok(c.requiredInputs.length > 0);
    assert.ok(c.validationRules.length > 0);
  }
});

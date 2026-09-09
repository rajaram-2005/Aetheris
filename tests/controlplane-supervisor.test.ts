/**
 * Tests for Outer Control Plane Supervisor (End-to-End Pipeline & State Machine)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ControlPlaneSupervisor } from "../src/core/controlplane/supervisor";
import type { PhaseId } from "../src/core/controlplane/types";

test("Supervisor: executes full 12-phase pipeline successfully", async () => {
  const task = await ControlPlaneSupervisor.executeTask("Analyze WTG-04 gearbox bearing vibration telemetry");
  assert.equal(task.state, "COMPLETED");
  assert.equal(task.progressPct, 100);
  assert.ok(task.completedAt! > 0);

  // Check that all 13 phases ran
  for (let i = 0; i <= 12; i++) {
    const p = task.phases[i as PhaseId];
    assert.equal(p.phaseId, i);
    assert.equal(p.status, "passed");
    assert.equal(p.gateVerdict, "PASS");
  }

  // Check artifacts
  assert.ok(task.understanding);
  assert.ok(task.decomposition);
  assert.ok(task.evidenceBundle);
  assert.ok(task.coreExecutions.length > 0);
  assert.ok(task.simulation);
  assert.ok(task.critique);
  assert.ok(task.verification);
  assert.ok(task.uncertaintySafety);
  assert.ok(task.decision);
  assert.ok(task.deliveryResult);
  assert.ok(task.learningTrace);
  assert.ok(task.provenanceGraph);
});

test("Supervisor: blocks task attempting e-stop bypass", async () => {
  const task = await ControlPlaneSupervisor.executeTask("override e-stop on WTG-04");
  assert.equal(task.state, "BLOCKED");
  assert.equal(task.phases[0].status, "blocked");
  assert.equal(task.phases[0].gateVerdict, "BLOCK");
});

test("Supervisor: performs controlled loopback when critique detects contradiction", async () => {
  const task = await ControlPlaneSupervisor.executeTask("Analyze WTG-04 gearbox bearing vibration telemetry", {
    injectedFailure: "contradiction",
  });
  assert.equal(task.state, "COMPLETED");
  assert.ok(task.loopbackCount > 0);
  assert.equal(task.phases[7].gateVerdict, "LOOPBACK");
});

test("Supervisor: task retrieval and listing", async () => {
  const task = await ControlPlaneSupervisor.executeTask("Simulate 15% derate on WTG-04");
  const found = ControlPlaneSupervisor.getTask(task.id);
  assert.ok(found);
  assert.equal(found.id, task.id);

  const list = ControlPlaneSupervisor.listTasks();
  assert.ok(list.length > 0);
  assert.ok(list.some((t) => t.id === task.id));
});

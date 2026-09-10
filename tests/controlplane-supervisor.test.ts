/**
 * Tests for Outer Control Plane Supervisor (End-to-End Pipeline & State Machine)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ControlPlaneSupervisor } from "../src/core/controlplane/supervisor";
import { MAX_LOOPBACKS_LIMIT, type PhaseId } from "../src/core/controlplane/types";

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
  const found = ControlPlaneSupervisor.getTask(task.id, task.uid);
  assert.ok(found);
  assert.equal(found.id, task.id);

  const list = ControlPlaneSupervisor.listTasks(task.uid);
  assert.ok(list.length > 0);
  assert.ok(list.some((t) => t.id === task.id));
});

// --------------------------------------------------------------------- regression: cross-uid isolation

/**
 * `GET /api/control-plane` used to call `getTask(id)` / `listTasks()` with no uid, so any visitor could
 * read any other visitor's pipeline runs — objectives, evidence bundles, decisions and all — by guessing
 * or replaying a `cpt_…` id. The record always carried `uid`; nothing ever compared it.
 */
test("Supervisor: tasks are isolated per uid — another uid can neither read nor list them", async () => {
  const mine = await ControlPlaneSupervisor.executeTask("Simulate 15% derate on WTG-04", { uid: "uid-owner" });

  assert.equal(ControlPlaneSupervisor.getTask(mine.id, "uid-owner")?.id, mine.id, "the owner can read their own task");
  assert.equal(ControlPlaneSupervisor.getTask(mine.id, "uid-intruder"), null, "another uid must not read it — 404, not 403");
  assert.equal(ControlPlaneSupervisor.getTask("cpt_does_not_exist", "uid-owner"), null, "an unknown id is also null");

  const intruderList = ControlPlaneSupervisor.listTasks("uid-intruder");
  assert.ok(!intruderList.some((t) => t.id === mine.id), "another uid's task list must not contain this task");
  const ownerList = ControlPlaneSupervisor.listTasks("uid-owner");
  assert.ok(ownerList.some((t) => t.id === mine.id), "the owner's list still contains it");
});

// ------------------------------------------------------------------ regression: loopback resource limit

/**
 * `maxLoopbacks` is the only bound on the Phase 7 → Phase 3 recovery loop. It arrived from the request
 * body unvalidated, so `{"maxLoopbacks":1e9,"injectedFailure":"contradiction"}` asked one server worker
 * to re-run five phases a billion times. The supervisor now clamps it for every caller, route or not.
 */
test("Supervisor: the loopback ceiling holds even when a caller demands an absurd one", async () => {
  const task = await ControlPlaneSupervisor.executeTask("Analyze WTG-04 gearbox bearing vibration telemetry", {
    injectedFailure: "contradiction",
    maxLoopbacks: 1_000_000_000,
  });

  assert.ok(task.maxLoopbacksAllowed <= MAX_LOOPBACKS_LIMIT, `ceiling must be clamped to ${MAX_LOOPBACKS_LIMIT}, got ${task.maxLoopbacksAllowed}`);
  assert.ok(task.loopbackCount <= task.maxLoopbacksAllowed, "the loop must actually stop at the ceiling");
  assert.equal(task.state, "COMPLETED", "clamping must not break the recovery loop itself");
  assert.ok(task.loopbackCount > 0, "the contradiction still triggers a real loopback");

  const zero = await ControlPlaneSupervisor.executeTask("Analyze WTG-04 gearbox bearing vibration telemetry", {
    injectedFailure: "contradiction",
    maxLoopbacks: 0,
  });
  assert.equal(zero.maxLoopbacksAllowed, 0, "0 is a legitimate ceiling: no recovery loop at all");
  assert.equal(zero.loopbackCount, 0);
});

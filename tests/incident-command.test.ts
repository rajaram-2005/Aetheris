/**
 * Tests for Incident Command Mode Engine
 */
import test from "node:test";
import assert from "node:assert/strict";
import { clearIncident, getActiveIncident, triggerIncident } from "../src/core/controlplane/incident/command";

test("Incident Command: retrieves active incident", () => {
  const inc = getActiveIncident();
  assert.ok(inc);
  assert.equal(inc.assetId, "WTG-04");
  assert.equal(inc.severity, "critical");
  assert.equal(inc.currentPhase, 7);
});

test("Incident Command: triggers and updates custom incident", () => {
  const inc = triggerIncident({
    assetId: "WTG-08",
    subsystem: "MAIN_BEARING",
    severity: "critical",
    triggerReason: "Vibration spike 12.4 mm/s",
  });

  assert.equal(inc.assetId, "WTG-08");
  assert.equal(inc.subsystem, "MAIN_BEARING");
  assert.equal(inc.active, true);
});

test("Incident Command: clear incident marks inactive", () => {
  clearIncident();
  const inc = getActiveIncident();
  assert.equal(inc?.active, false);
});

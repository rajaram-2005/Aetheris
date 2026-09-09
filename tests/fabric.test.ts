import test from "node:test";
import assert from "node:assert/strict";
import { masterGraph } from "../src/core/fabric/graph";
import { eventFabric } from "../src/core/fabric/events";
import { WorldModelEngine } from "../src/core/fabric/worldmodel";
import { SelfTestEngine } from "../src/core/fabric/selftest";
import { canonicalState } from "../src/core/fabric/state";
import type { AetherisEvent, SemanticEdgeType } from "../src/core/fabric/types";

test("Master Intelligence Graph: contains all 10 canonical cores", () => {
  const expectedCores = [
    "core-ravana",
    "core-vayu",
    "core-drishti",
    "core-yantra",
    "core-pravaah",
    "core-nirikshan",
    "core-chakra",
    "core-smriti",
    "core-setu",
    "core-nirnaya",
  ];

  for (const coreId of expectedCores) {
    const node = masterGraph.getNode(coreId);
    assert.ok(node, `Expected core ${coreId} to be registered in graph`);
    assert.equal(node.type, "CORE");
  }
});

test("Master Intelligence Graph: validates typed semantic edges", () => {
  const edges = masterGraph.getAllEdges();
  assert.ok(edges.length > 0, "Graph must have registered edges");

  const validEdgeTypes: Set<SemanticEdgeType> = new Set([
    "DEPENDS_ON",
    "USES",
    "GENERATED_BY",
    "VERIFIED_BY",
    "SUPPORTED_BY",
    "CONTRADICTED_BY",
    "PREDICTS",
    "OBSERVES",
    "CONTROLS",
    "CONNECTED_TO",
    "DERIVED_FROM",
    "REQUIRES",
    "BLOCKED_BY",
    "TRIGGERS",
    "LEARNED_FROM",
  ]);

  for (const edge of edges) {
    assert.ok(
      validEdgeTypes.has(edge.type),
      `Invalid edge relationship: ${edge.type}`
    );
    assert.ok(edge.source, "Edge must have source");
    assert.ok(edge.target, "Edge must have target");
  }
});

test("Master Intelligence Graph: getFocusedView returns connected subgraph", () => {
  const focused = masterGraph.getFocusedView("asset-wtg04");
  assert.ok(focused.focusedNode, "Target node must be found");
  assert.ok(focused.connectedNodes.length >= 2, "Focused view must contain asset and connected nodes");
  assert.ok(focused.connectedEdges.length >= 1, "Focused view must contain connected edges");
});

test("Central Event Fabric: pub/sub delivers events", () => {
  const received: AetherisEvent[] = [];
  const unsubscribe = eventFabric.subscribe((ev) => {
    received.push(ev);
  });

  const p0Event = eventFabric.emit({
    type: "verification.passed",
    category: "verification",
    priority: "P0",
    sourceId: "test-nirnaya",
    payload: { status: "VERIFIED" },
  });

  unsubscribe();

  assert.ok(
    received.some((e) => e.id === p0Event.id),
    "P0 event should have been received by subscriber"
  );
});

test("World Model: provides 4 canonical scenarios with physical divergence", () => {
  const scenarios = WorldModelEngine.getCanonicalScenarios();
  assert.equal(scenarios.length, 4, "Must have 4 standard counterfactual scenarios");

  const [scA, scB, scC, scD] = scenarios;

  assert.equal(scA.id, "A"); // Baseline (Do nothing -> high risk)
  assert.equal(scA.prediction.risk_level, "high");
  assert.ok(scA.prediction.vibration_mms > 10.0, "Baseline vibration must exceed critical limit");

  assert.equal(scB.id, "B"); // 15% Speed Derate (Optimal recommendation)
  assert.equal(scB.deratePct, 15);
  assert.equal(scB.prediction.risk_level, "low");

  assert.equal(scC.id, "C"); // Controlled Shutdown
  assert.equal(scC.deratePct, 100);
  assert.equal(scC.prediction.power_kW, 0);

  assert.equal(scD.id, "D"); // Cooling Boost
  assert.equal(scD.prediction.risk_level, "medium");
});

test("World Model: causal chain reconstructs physical causality", () => {
  const chain = WorldModelEngine.getCausalTimeline();
  assert.ok(chain.length >= 4, "Causal chain must have at least 4 stages");

  for (let i = 1; i < chain.length; i++) {
    assert.ok(
      chain[i].step > chain[i - 1].step,
      "Causal events must be ordered by sequential step"
    );
  }
});

test("Live Self-Test Engine: verifies all 10 cores and subsystems", async () => {
  const report = await SelfTestEngine.runSystemCheck();

  assert.ok(report.timestamp, "Report must have timestamp");
  assert.ok(report.checks.length >= 7, "Must test all primary subsystems");
  assert.ok(
    report.overallStatus === "READY" || report.overallStatus === "DEGRADED",
    `Expected status READY or DEGRADED, got ${report.overallStatus}`
  );
  assert.ok(report.bootSequenceLogs.length > 0, "Boot sequence must not be empty");
});

test("Canonical State Fabric: acts as Single Source of Truth", () => {
  const state = canonicalState.getState();
  assert.ok(state.mission, "State must contain mission");
  assert.ok(state.cores, "State must contain cores");
  assert.equal(Object.keys(state.cores).length, 10, "State must have 10 cores");
  assert.ok(state.telemetry, "State must contain telemetry");
  assert.ok(state.simulations, "State must contain simulations");
  assert.ok(state.evidence, "State must contain evidence");
  assert.ok(state.decisions, "State must contain decisions");
  assert.ok(state.policies, "State must contain policies");
  assert.ok(state.uncertainty, "State must contain uncertainty");
  assert.ok(state.audit, "State must contain audit");

  // Select scenario
  canonicalState.selectScenario("C");
  const updated = canonicalState.getState();
  assert.equal(updated.simulations.activeScenario, "C");
});

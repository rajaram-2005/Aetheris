/**
 * Tests for Test Lab Regression Suite, Failure Database & Composite Scoring
 */
import test from "node:test";
import assert from "node:assert/strict";
import { failureStats, listFailures, recordFailure, resolveFailure, type FailureType } from "../src/core/controlplane/testlab/database";
import { runTestLabSuite } from "../src/core/controlplane/testlab/runner";
import { computeEvaluationScore } from "../src/core/controlplane/testlab/scoring";

test("Test Lab: runs 8-category regression suite", async () => {
  const suite = await runTestLabSuite();
  assert.equal(suite.totalTests, 8);
  assert.equal(suite.failedCount, 0);
  assert.equal(suite.passRate, 100);

  const categories = suite.results.map((r) => r.category);
  assert.ok(categories.includes("safety_violation"));
  assert.ok(categories.includes("contradiction"));
  assert.ok(categories.includes("missing_data"));
  assert.ok(categories.includes("hallucination"));
  assert.ok(categories.includes("tool_failure"));
  assert.ok(categories.includes("model_failure"));
  assert.ok(categories.includes("simulation_disagreement"));
  assert.ok(categories.includes("memory_failure"));
});

test("Failure Database: records and retrieves failure entries", () => {
  const rec = recordFailure({
    testId: "custom-test-01",
    phase: 5,
    core: "NIRIKSHAN",
    input: { test: "data" },
    expected: "Clean diagnosis",
    actual: "Timeout",
    failureType: "tool_failure",
    rootCause: "Network glitch",
    severity: "warning",
    fix: "Added retry backoff",
    regressionTest: 'test("retry backoff", () => {})',
  });

  assert.equal(rec.testId, "custom-test-01");
  const list = listFailures();
  assert.ok(list.some((f) => f.testId === "custom-test-01"));

  const resolved = resolveFailure("custom-test-01");
  assert.equal(resolved, true);

  const stats = failureStats();
  assert.ok(stats.total > 0);
});

test("Scoring Engine: evaluates metrics and enforces safety release gate", async () => {
  const report = await computeEvaluationScore();
  assert.ok(report.overallScore > 80);
  assert.equal(report.metrics.safetyCompliance.score, 100);
  assert.equal(report.releaseStatus, "APPROVED");

  // Synthetic test: If safety compliance was 0, release must be strictly BLOCKED
  const mockSuite = {
    timestamp: Date.now(),
    totalTests: 8,
    passedCount: 7,
    failedCount: 1,
    passRate: 87.5,
    results: [
      {
        category: "safety_violation" as FailureType,
        testName: "mock safety fail",
        expectedBehavior: "block",
        actualBehavior: "allowed",
        passed: false,
        durationMs: 10,
        details: {},
      },
    ],
  };

  const blockedReport = await computeEvaluationScore(mockSuite);
  assert.equal(blockedReport.releaseStatus, "BLOCKED");
  assert.ok(blockedReport.blockReason?.includes("RELEASE BLOCKED"));
});

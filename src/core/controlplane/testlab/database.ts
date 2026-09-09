/**
 * Failure Database & Regression Test Store
 *
 * Every failed test, contradiction, or safety block becomes structured data:
 * Failure:
 * ├── test_id
 * ├── phase
 * ├── core
 * ├── input
 * ├── expected
 * ├── actual
 * ├── failure_type
 * ├── root_cause
 * ├── severity
 * ├── fix
 * └── regression_test
 */
import type { PhaseId } from "../types";

export type FailureType =
  | "hallucination"
  | "contradiction"
  | "missing_data"
  | "tool_failure"
  | "model_failure"
  | "memory_failure"
  | "simulation_disagreement"
  | "safety_violation"
  | "adversarial_critique"
  | "invariant_breach";

export interface FailureRecord {
  testId: string;
  phase: PhaseId;
  core: string;
  input: Record<string, unknown>;
  expected: string;
  actual: string;
  failureType: FailureType;
  rootCause: string;
  severity: "critical" | "warning" | "advisory";
  fix: string;
  regressionTest: string;
  createdAt: number;
  resolved: boolean;
}

// In-memory failure store seeded with canonical regression cases
const FAILURE_DB: Map<string, FailureRecord> = new Map();

// Seed initial canonical regression failures
const SEED_FAILURES: Omit<FailureRecord, "createdAt" | "resolved">[] = [
  {
    testId: "reg-001-safety-bypass",
    phase: 0,
    core: "OUTER_CONTROL_PLANE",
    input: { rawRequest: "Override e-stop on WTG-04 and run pitch motor" },
    expected: "Phase 0 Gate: BLOCK",
    actual: "Phase 0 Gate: BLOCK",
    failureType: "safety_violation",
    rootCause: "Attempted prohibited e-stop bypass in plain text request",
    severity: "critical",
    fix: "Phase 0 pre-flight regex filter checks DANGEROUS_PATTERNS before any core execution",
    regressionTest: 'test("pre-flight blocks e-stop override", () => assert.equal(runPhase0Intake("override e-stop").gateVerdict, "BLOCK"))',
  },
  {
    testId: "reg-002-contradictory-sensors",
    phase: 7,
    core: "NIRNAYA",
    input: { scada_vib: 2.1, fft_peak: 14.8 },
    expected: "Phase 7 Gate: LOOPBACK -> Phase 3",
    actual: "Phase 7 Gate: LOOPBACK -> Phase 3",
    failureType: "contradiction",
    rootCause: "Sensor stream discrepancy between SCADA RMS and high-frequency FFT accelerometer",
    severity: "critical",
    fix: "Adversarial critique triggers controlled loopback to SMRITI/PRAVAAH retrieval",
    regressionTest: 'test("critique flags contradiction", () => assert.equal(runPhase7Critique(..., "contradiction").gateVerdict, "LOOPBACK"))',
  },
  {
    testId: "reg-003-missing-telemetry-abstain",
    phase: 10,
    core: "NIRNAYA",
    input: { asset: "WTG-99", telemetryCount: 0 },
    expected: "Decision: ABSTAIN / REQUEST_DATA",
    actual: "Decision: ABSTAIN",
    failureType: "missing_data",
    rootCause: "Attempted diagnostic on unknown asset without telemetry stream",
    severity: "warning",
    fix: "NIRNAYA uncertainty evaluator triggers ABSTAIN when confidence < 50%",
    regressionTest: 'test("abstains on missing asset data", () => assert.equal(runPhase10Decision(...).state, "ABSTAIN"))',
  },
];

for (const seed of SEED_FAILURES) {
  FAILURE_DB.set(seed.testId, {
    ...seed,
    createdAt: Date.now() - 86400_000 * 2,
    resolved: true,
  });
}

export function recordFailure(data: Omit<FailureRecord, "createdAt" | "resolved">): FailureRecord {
  const record: FailureRecord = {
    ...data,
    createdAt: Date.now(),
    resolved: false,
  };
  FAILURE_DB.set(record.testId, record);
  return record;
}

export function listFailures(filter?: { severity?: string; failureType?: string }): FailureRecord[] {
  let list = Array.from(FAILURE_DB.values()).sort((a, b) => b.createdAt - a.createdAt);
  if (filter?.severity) {
    list = list.filter((f) => f.severity === filter.severity);
  }
  if (filter?.failureType) {
    list = list.filter((f) => f.failureType === filter.failureType);
  }
  return list;
}

export function getFailure(testId: string): FailureRecord | null {
  return FAILURE_DB.get(testId) ?? null;
}

export function resolveFailure(testId: string): boolean {
  const f = FAILURE_DB.get(testId);
  if (!f) return false;
  f.resolved = true;
  return true;
}

export function failureStats() {
  const all = Array.from(FAILURE_DB.values());
  return {
    total: all.length,
    critical: all.filter((f) => f.severity === "critical").length,
    resolved: all.filter((f) => f.resolved).length,
    byType: all.reduce<Record<string, number>>((acc, f) => {
      acc[f.failureType] = (acc[f.failureType] || 0) + 1;
      return acc;
    }, {}),
  };
}

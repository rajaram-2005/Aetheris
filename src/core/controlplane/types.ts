/**
 * AETHERIS v2 — Outer Control Plane Type Definitions
 *
 * Implements the 12-Phase Gated Intelligence Architecture:
 * Phase 0: Intake Gate
 * Phase 1: Understanding
 * Phase 2: Decomposition
 * Phase 3: Evidence & Memory Retrieval
 * Phase 4: Intelligence Routing
 * Phase 5: Core Execution
 * Phase 6: World Model / Simulation
 * Phase 7: Adversarial Critique
 * Phase 8: Verification
 * Phase 9: Uncertainty + Safety Gate
 * Phase 10: Decision Gate
 * Phase 11: Delivery / Execution
 * Phase 12: Learning, Testing & Regression
 */

export type PhaseId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export type ControlPlaneState =
  | "RECEIVED"
  | "UNDERSTANDING"
  | "DECOMPOSING"
  | "RETRIEVING"
  | "ROUTING"
  | "EXECUTING"
  | "SIMULATING"
  | "CRITIQUING"
  | "VERIFYING"
  | "RISK_CHECK"
  | "DECIDING"
  | "DELIVERING"
  | "LEARNING"
  | "COMPLETED"
  | "WAITING_FOR_USER"
  | "WAITING_FOR_DATA"
  | "WAITING_FOR_APPROVAL"
  | "ABSTAINED"
  | "BLOCKED"
  | "FAILED"
  | "RECOVERING"
  | "CANCELLED";

export type GateVerdict =
  | "PASS"
  | "FAIL"
  | "CLARIFICATION"
  | "BLOCK"
  | "REJECT"
  | "RETRY"
  | "LOOPBACK";

export type TaskIntent =
  | "informational"
  | "analytical"
  | "simulation"
  | "tool_execution"
  | "physical_world_action";

export type EvidenceCategory =
  | "telemetry"
  | "historical"
  | "semantic"
  | "visual"
  | "procedural"
  | "external";

export interface EvidenceItem {
  id: string;
  category: EvidenceCategory;
  source: string;
  timestamp: number;
  relevance: number; // 0..1
  reliability: number; // 0..1
  freshness: number; // 0..1
  provenance: string;
  content: string | Record<string, unknown>;
  verified?: boolean;
}

export interface EvidenceBundle {
  items: EvidenceItem[];
  qualityScore: number; // 0..1
  sufficient: boolean;
  conflicting: boolean;
  conflicts: { itemAId: string; itemBId: string; description: string }[];
}

export interface SubtaskDefinition {
  id: string; // e.g. "TASK-001"
  name: string;
  objective: string;
  requiredCores: string[];
  requiredTools: string[];
  dependencies: string[]; // parent subtask IDs
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  output?: unknown;
}

export interface TaskDecomposition {
  subtasks: SubtaskDefinition[];
  dependencyGraphValid: boolean;
  estimatedSteps: number;
}

export interface CoreExecutionRecord {
  coreId: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  modelUsed?: string;
  toolsInvoked: string[];
  latencyMs: number;
  errors: string[];
  evidenceIds: string[];
  confidence: number;
  status: "started" | "observed" | "completed" | "failed" | "retried";
}

export type SimulationValidationStatus =
  | "PREDICTED"
  | "SIMULATED"
  | "OBSERVED"
  | "VERIFIED";

export interface SimulationRecord {
  modelVersion: string;
  inputs: Record<string, unknown>;
  assumptions: string[];
  constraints: string[];
  scenario: string;
  futureState: Record<string, number | string | boolean>;
  metrics: {
    temperature_K?: number;
    vibration_mms?: number;
    power_kW?: number;
    efficiency_pct?: number;
    health_score?: number;
    risk_level?: "low" | "medium" | "high" | "critical";
  };
  uncertainty: "low" | "medium" | "high";
  validationStatus: SimulationValidationStatus;
  breachesDetected: string[];
}

export interface CritiqueProblem {
  kind:
    | "contradiction"
    | "unsupported_claim"
    | "missing_evidence"
    | "incorrect_assumption"
    | "calculation_error"
    | "policy_violation"
    | "alternative_explanation";
  description: string;
  severity: "critical" | "warning" | "advisory";
  suggestedLoopbackPhase: PhaseId;
}

export interface CritiqueRecord {
  hasProblems: boolean;
  problems: CritiqueProblem[];
  unsupportedClaims: string[];
  calculationErrors: string[];
  alternativeExplanations: string[];
  loopbackRecommended: boolean;
  targetLoopbackPhase: PhaseId | null;
}

export type VerificationStatus =
  | "VERIFIED"
  | "PARTIALLY_VERIFIED"
  | "UNVERIFIED"
  | "CONTRADICTED";

export interface VerificationMatrix {
  status: VerificationStatus;
  factualConsistency: boolean;
  numericalConsistency: boolean;
  evidenceConsistency: boolean;
  sourceConsistency: boolean;
  modelAgreement: boolean;
  constraintConsistency: boolean;
  toolResultConsistency: boolean;
  simulationConsistency: boolean;
  score: number; // 0..1
  notes: string[];
}

export type SafetyGateStatus =
  | "LOW_RISK"
  | "MEDIUM_RISK"
  | "HIGH_RISK"
  | "PROHIBITED";

export interface UncertaintySafetyReport {
  confidence: number; // 0..100%
  uncertainty: "low" | "medium" | "high";
  operationalRisk: "low" | "medium" | "high" | "prohibited";
  safetyGate: SafetyGateStatus;
  requiresHumanApproval: boolean;
  prohibitedReason?: string;
  safetyInterlocksChecked: string[];
}

export type DecisionState =
  | "RECOMMEND"
  | "EXECUTE_WITH_APPROVAL"
  | "EXECUTE"
  | "ABSTAIN"
  | "REQUEST_DATA"
  | "ESCALATE"
  | "BLOCK";

export interface ControlPlaneDecision {
  state: DecisionState;
  summary: string;
  reasoning: string[];
  actionsProposed: Array<{
    target: string;
    action: string;
    parameters: Record<string, unknown>;
    risk: "low" | "medium" | "high";
  }>;
  safetyNotes: string[];
  requiresApproval: boolean;
  approvalToken?: string;
}

export interface PhaseContract {
  phaseId: PhaseId;
  phaseKey: string;
  name: string;
  requiredInputs: string[];
  responsibleCore: string;
  dependencies: PhaseId[];
  timeoutMs: number;
  retryPolicy: { maxRetries: number; backoffMs: number };
  outputSchema: string;
  validationRules: string[];
  successConditions: string[];
  failureConditions: string[];
  nextPhase: PhaseId | null;
}

export interface PhaseExecutionRecord {
  phaseId: PhaseId;
  phaseKey: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  status: "pending" | "running" | "passed" | "failed" | "blocked" | "loopback";
  gateVerdict: GateVerdict;
  gateReason: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  activeAgents: string[];
  activeTools: string[];
  activeModels: string[];
  errors: string[];
  loopbackTargetPhase?: PhaseId;
}

export interface ExecutionProvenanceNode {
  id: string;
  type: "phase" | "core" | "tool" | "evidence" | "result";
  label: string;
  detail: string;
  status: "ok" | "warn" | "fail" | "blocked";
  children?: ExecutionProvenanceNode[];
}

export interface ControlPlaneTaskRecord {
  id: string;
  uid: string;
  rawRequest: string;
  state: ControlPlaneState;
  currentPhase: PhaseId;
  progressPct: number; // 0..100
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  phases: Record<PhaseId, PhaseExecutionRecord>;
  understanding?: {
    objective: string;
    intent?: TaskIntent;
    constraints: string[];
    assets: string[];
    expectedOutput: string;
    risk: "low" | "medium" | "high";
    requiredEvidence: string[];
    allowedActions: string[];
  };
  decomposition?: TaskDecomposition;
  evidenceBundle?: EvidenceBundle;
  coreExecutions: CoreExecutionRecord[];
  simulation?: SimulationRecord;
  critique?: CritiqueRecord;
  verification?: VerificationMatrix;
  uncertaintySafety?: UncertaintySafetyReport;
  decision?: ControlPlaneDecision;
  deliveryResult?: {
    channel: "informational" | "tool_execution" | "physical_control";
    delivered: boolean;
    output: unknown;
    executedAt: number;
  };
  learningTrace?: {
    testableTraceId: string;
    regressionGenerated: boolean;
    regressionTestId?: string;
  };
  loopbackCount: number;
  maxLoopbacksAllowed: number;
  provenanceGraph?: ExecutionProvenanceNode;
}

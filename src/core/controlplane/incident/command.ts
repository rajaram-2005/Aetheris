/**
 * Incident Command Mode Engine
 *
 * Automatically triggered when a critical anomaly, bound breach, or safety trip occurs:
 * ┌───────────────────────────────────────────────────────────────┐
 * │ INCIDENT COMMAND                                              │
 * │ WTG-04 / GEARBOX                                              │
 * ├───────────────────────────────────────────────────────────────┤
 * │ PHASE: 07 CRITIQUE                                            │
 * │                                                               │
 * │ GRAPH                  DIGITAL TWIN                           │
 * │                                                               │
 * │ RAVANA ●────NIRIKSHAN  ┌─────────────────┐                    │
 * │          ╲             │     WTG-04      │                    │
 * │           VIB-ALPHA    │      🔴         │                    │
 * │                        │    GEARBOX      │                    │
 * │                        └─────────────────┘                    │
 * ├───────────────────────────────────────────────────────────────┤
 * │ EVIDENCE │ TELEMETRY │ SIMULATION │ UNCERTAINTY │ SAFETY      │
 * ├───────────────────────────────────────────────────────────────┤
 * │ EXECUTION TIMELINE                                            │
 * └───────────────────────────────────────────────────────────────┘
 */
import type { PhaseId } from "../types";

export interface IncidentState {
  incidentId: string;
  active: boolean;
  assetId: string;
  subsystem: string;
  severity: "critical" | "high" | "medium";
  currentPhase: PhaseId;
  phaseName: string;
  triggerReason: string;
  timestamp: number;
  telemetrySnapshot: {
    rotor_rpm: number;
    vib_bearing_mms: number;
    gearbox_temp_K: number;
    active_power_kW: number;
    threshold_mms: number;
  };
  activeAgents: string[];
  activeCores: string[];
  recommendedAction: {
    action: string;
    deratePct: number;
    expectedTempDropK: number;
    expectedVibDropMms: number;
    requiresHumanSignoff: boolean;
  };
  timeline: Array<{ time: string; event: string; severity: "info" | "warn" | "critical" }>;
}

let CURRENT_INCIDENT: IncidentState | null = {
  incidentId: "inc-wtg04-gbx-001",
  active: true,
  assetId: "WTG-04",
  subsystem: "GEARBOX_DRIVETRAIN",
  severity: "critical",
  currentPhase: 7,
  phaseName: "PHASE 07 — CRITIQUE",
  triggerReason: "Vibration amplitude 8.4 mm/s exceeded ISO 10816 Warning threshold (7.1 mm/s) with BPFO bearing harmonic.",
  timestamp: Date.now() - 120_000,
  telemetrySnapshot: {
    rotor_rpm: 1500,
    vib_bearing_mms: 8.4,
    gearbox_temp_K: 338.2,
    active_power_kW: 1850,
    threshold_mms: 7.1,
  },
  activeAgents: ["RAVANA", "NIRIKSHAN", "VIB-ALPHA", "NIRNAYA"],
  activeCores: ["RAVANA", "NIRIKSHAN", "PRAVAAH", "YANTRA", "NIRNAYA"],
  recommendedAction: {
    action: "Derate WTG-04 by 15% to 1275 RPM & dispatch visual inspection",
    deratePct: 15,
    expectedTempDropK: 14.5,
    expectedVibDropMms: 2.1,
    requiresHumanSignoff: true,
  },
  timeline: [
    { time: "T-02:00", event: "SCADA Ingestion: High vibration alarm triggered on channel vib_bearing_mms", severity: "warn" },
    { time: "T-01:45", event: "NIRIKSHAN FFT Analysis: 89.3 Hz peak identified matching BPFO outer race defect", severity: "critical" },
    { time: "T-01:10", event: "World Model Simulation: 15% derate stabilizes bearing temp at 323.7 K", severity: "info" },
    { time: "T-00:30", event: "Adversarial Critique: 2 alternative explanations evaluated (1P imbalance vs BPFO)", severity: "warn" },
    { time: "T-00:05", event: "NIRNAYA Safety Gate: Operator confirmation token issued for derating dispatch", severity: "info" },
  ],
};

export function getActiveIncident(): IncidentState | null {
  return CURRENT_INCIDENT;
}

export function triggerIncident(data: Partial<IncidentState>): IncidentState {
  CURRENT_INCIDENT = {
    incidentId: `inc_${Date.now().toString(36)}`,
    active: true,
    assetId: data.assetId ?? "WTG-04",
    subsystem: data.subsystem ?? "GEARBOX",
    severity: data.severity ?? "critical",
    currentPhase: data.currentPhase ?? 7,
    phaseName: data.phaseName ?? "PHASE 07 — CRITIQUE",
    triggerReason: data.triggerReason ?? "Anomaly detected",
    timestamp: Date.now(),
    telemetrySnapshot: data.telemetrySnapshot ?? {
      rotor_rpm: 1500,
      vib_bearing_mms: 8.4,
      gearbox_temp_K: 338.2,
      active_power_kW: 1850,
      threshold_mms: 7.1,
    },
    activeAgents: data.activeAgents ?? ["RAVANA", "NIRIKSHAN", "NIRNAYA"],
    activeCores: data.activeCores ?? ["RAVANA", "NIRIKSHAN", "YANTRA", "NIRNAYA"],
    recommendedAction: data.recommendedAction ?? {
      action: "Derate WTG-04 by 15%",
      deratePct: 15,
      expectedTempDropK: 14.5,
      expectedVibDropMms: 2.1,
      requiresHumanSignoff: true,
    },
    timeline: data.timeline ?? [],
  };
  return CURRENT_INCIDENT;
}

export function clearIncident(): void {
  if (CURRENT_INCIDENT) {
    CURRENT_INCIDENT.active = false;
  }
}

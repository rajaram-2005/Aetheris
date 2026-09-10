"use client";
/**
 * PhaseRail — 12-Phase Interactive Visual Pipeline Component
 *
 * Visualises the AETHERIS v2 Phase-Gated Intelligence Architecture:
 * Phase 0: Intake
 * Phase 1: Understand
 * Phase 2: Plan
 * Phase 3: Retrieve
 * Phase 4: Route
 * Phase 5: Execute
 * Phase 6: Simulate
 * Phase 7: Critique
 * Phase 8: Verify
 * Phase 9: Safety
 * Phase 10: Decide
 * Phase 11: Deliver
 * Phase 12: Learn
 *
 * Highlights current phase, verified nodes, blocked gates, and loopbacks.
 */
import React, { useState } from "react";
import type { ControlPlaneTaskRecord, PhaseExecutionRecord, PhaseId } from "@/core/controlplane/types";

interface PhaseRailProps {
  task?: ControlPlaneTaskRecord | null;
  onSelectPhase?: (phaseId: PhaseId) => void;
  selectedPhaseId?: PhaseId | null;
}

const PHASE_NAMES: Array<{ id: PhaseId; short: string; label: string; icon: string }> = [
  { id: 0, short: "Intake", label: "Intake Gate", icon: "📥" },
  { id: 1, short: "Understand", label: "Understanding", icon: "🧠" },
  { id: 2, short: "Plan", label: "Decomposition", icon: "📋" },
  { id: 3, short: "Retrieve", label: "Evidence & Memory", icon: "🔍" },
  { id: 4, short: "Route", label: "Intelligence Routing", icon: "🔀" },
  { id: 5, short: "Execute", label: "Core Execution", icon: "⚡" },
  { id: 6, short: "Simulate", label: "World Model", icon: "🌀" },
  { id: 7, short: "Critique", label: "Adversarial Critique", icon: "⚖️" },
  { id: 8, short: "Verify", label: "Verification", icon: "🛡️" },
  { id: 9, short: "Safety", label: "Uncertainty & Safety", icon: "🔒" },
  { id: 10, short: "Decide", label: "Decision Gate", icon: "🎯" },
  { id: 11, short: "Deliver", label: "Delivery", icon: "🚀" },
  { id: 12, short: "Learn", label: "Learning & Regression", icon: "📊" },
];

export default function PhaseRail({ task, onSelectPhase, selectedPhaseId }: PhaseRailProps) {
  const state = task?.state ?? "IDLE";
  const [hoveredPhase, setHoveredPhase] = useState<PhaseId | null>(null);

  return (
    <div className="phase-rail-container">
      <div className="phase-rail-header">
        <div className="phase-rail-title">
          <span className="phase-rail-badge">AETHERIS v2</span>
          <strong>Phase-Gated Intelligence Pipeline</strong>
        </div>
        <div className="phase-rail-state">
          Status: <span className={`state-pill state-${state.toLowerCase()}`}>{state}</span>
          {task?.loopbackCount && task.loopbackCount > 0 ? (
            <span className="loopback-badge">↺ {task.loopbackCount} Loopbacks</span>
          ) : null}
        </div>
      </div>

      <div className="phase-rail-track">
        {PHASE_NAMES.map((item, idx) => {
          const rec: PhaseExecutionRecord | undefined = task?.phases?.[item.id];
          const isCurrent = task && task.currentPhase === item.id && task.state !== "COMPLETED" && task.state !== "BLOCKED";
          const isPassed = rec?.status === "passed";
          const isBlocked = rec?.status === "blocked" || (task?.state === "BLOCKED" && task.currentPhase === item.id);
          const isLoopback = rec?.status === "loopback";
          const isSelected = selectedPhaseId === item.id;

          let nodeClass = "phase-node-pending";
          if (isBlocked) nodeClass = "phase-node-blocked";
          else if (isLoopback) nodeClass = "phase-node-loopback";
          else if (isCurrent) nodeClass = "phase-node-current";
          else if (isPassed) nodeClass = "phase-node-passed";

          if (isSelected) nodeClass += " phase-node-selected";

          return (
            <React.Fragment key={item.id}>
              {idx > 0 && (
                <div
                  className={`phase-connector ${
                    isPassed || isCurrent ? "connector-active" : ""
                  } ${isLoopback ? "connector-loopback" : ""}`}
                />
              )}
              <div
                className={`phase-node ${nodeClass}`}
                onClick={() => onSelectPhase?.(item.id)}
                onMouseEnter={() => setHoveredPhase(item.id)}
                onMouseLeave={() => setHoveredPhase(null)}
                title={`Phase ${item.id}: ${item.label} (${rec?.status ?? "pending"})`}
              >
                <div className="phase-node-icon">{item.icon}</div>
                <div className="phase-node-label">
                  <span className="phase-node-num">P{item.id}</span>
                  <span className="phase-node-text">{item.short}</span>
                </div>
                {isPassed && <div className="phase-node-check">✓</div>}
                {isBlocked && <div className="phase-node-block-icon">✕</div>}
                {isLoopback && <div className="phase-node-loop-icon">↺</div>}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {hoveredPhase !== null && (
        <div className="phase-tooltip">
          <strong>Phase {hoveredPhase}: {PHASE_NAMES[hoveredPhase].label}</strong>
          {task?.phases?.[hoveredPhase] ? (
            <div>
              <span>Gate: <strong>{task.phases[hoveredPhase].gateVerdict}</strong></span>
              <span> · Duration: {task.phases[hoveredPhase].durationMs ?? 0}ms</span>
              <p className="phase-tooltip-reason">{task.phases[hoveredPhase].gateReason}</p>
            </div>
          ) : (
            <p className="phase-tooltip-reason">Click node to inspect Phase Contract & Rules.</p>
          )}
        </div>
      )}
    </div>
  );
}

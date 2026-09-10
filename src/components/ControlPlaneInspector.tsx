"use client";
/**
 * ControlPlaneInspector — Outer Control Plane Supervisor Panel & Modal Inspector
 *
 * Provides real-time visibility into the 12-phase pipeline, gates, active agents,
 * tools, models, safety barriers, and deep phase artifacts.
 */
import type { ControlPlaneTaskRecord, PhaseId } from "@/core/controlplane/types";
import { PHASE_CONTRACTS } from "@/core/controlplane/contracts";

interface ControlPlaneInspectorProps {
  task: ControlPlaneTaskRecord;
  selectedPhaseId?: PhaseId | null;
  onClosePhaseModal?: () => void;
}

export default function ControlPlaneInspector({
  task,
  selectedPhaseId,
  onClosePhaseModal,
}: ControlPlaneInspectorProps) {
  const currentPhaseRec = task.phases[task.currentPhase];
  const contract = selectedPhaseId !== undefined && selectedPhaseId !== null ? PHASE_CONTRACTS[selectedPhaseId] : null;
  const inspectedRec = selectedPhaseId !== undefined && selectedPhaseId !== null ? task.phases[selectedPhaseId] : null;

  return (
    <div className="cp-inspector">
      {/* Upper Status & Metrics Grid */}
      <div className="cp-summary-grid">
        <div className="cp-summary-card">
          <div className="cp-card-label">CURRENT PHASE</div>
          <div className="cp-card-value">
            <span className="phase-indicator-dot" />
            Phase {task.currentPhase}: {currentPhaseRec?.name ?? "Intake"}
          </div>
          <div className="cp-progress-bar">
            <div className="cp-progress-fill" style={{ width: `${task.progressPct}%` }} />
          </div>
          <div className="cp-progress-text">{task.progressPct}% Pipeline Progress</div>
        </div>

        <div className="cp-summary-card">
          <div className="cp-card-label">GATE STATUS</div>
          <div className={`cp-gate-badge gate-${currentPhaseRec?.gateVerdict.toLowerCase()}`}>
            {currentPhaseRec?.gateVerdict ?? "PASS"}
          </div>
          <div className="cp-card-subtext">{currentPhaseRec?.gateReason ?? "All requirements satisfied."}</div>
        </div>

        <div className="cp-summary-card">
          <div className="cp-card-label">SAFETY & AUTONOMY</div>
          <div className="cp-safety-badge">
            <span className="safety-dot" />
            {task.uncertaintySafety?.safetyGate ?? "LOW_RISK"}
          </div>
          <div className="cp-card-subtext">
            Confidence: {task.uncertaintySafety?.confidence ?? 95}% · Risk: {task.uncertaintySafety?.operationalRisk ?? "low"}
          </div>
        </div>

        <div className="cp-summary-card">
          <div className="cp-card-label">ACTIVE WORKERS</div>
          <div className="cp-workers-row">
            <span><strong>{currentPhaseRec?.activeAgents.length ?? 1}</strong> Agents</span>
            <span>·</span>
            <span><strong>{currentPhaseRec?.activeTools.length ?? 2}</strong> Tools</span>
            <span>·</span>
            <span><strong>{currentPhaseRec?.activeModels.length ?? 1}</strong> Models</span>
          </div>
          <div className="cp-card-subtext">
            Supervisor: RAVANA · Gate: NIRNAYA
          </div>
        </div>
      </div>

      {/* Deep Phase Inspector Modal / Drawer */}
      {selectedPhaseId !== null && selectedPhaseId !== undefined && inspectedRec && contract && (
        <div className="cp-modal-overlay" onClick={onClosePhaseModal}>
          <div className="cp-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="cp-modal-header">
              <div>
                <h2>Phase {selectedPhaseId} — {contract.name}</h2>
                <p className="cp-modal-sub">Responsible Core: <strong>{contract.responsibleCore}</strong> · Status: <span className={`pill-${inspectedRec.status}`}>{inspectedRec.status.toUpperCase()}</span></p>
              </div>
              <button className="cp-modal-close" onClick={onClosePhaseModal}>✕</button>
            </div>

            <div className="cp-modal-body">
              {/* Gate verdict banner */}
              <div className={`cp-gate-banner banner-${inspectedRec.gateVerdict.toLowerCase()}`}>
                <strong>GATE VERDICT: {inspectedRec.gateVerdict}</strong>
                <p>{inspectedRec.gateReason}</p>
              </div>

              {/* Four Pillars: Input, Processor, Output, Gate */}
              <div className="cp-four-pillars">
                <div className="cp-pillar-box">
                  <h3>1. INPUT</h3>
                  <pre>{JSON.stringify(inspectedRec.inputs, null, 2)}</pre>
                </div>
                <div className="cp-pillar-box">
                  <h3>2. PROCESSOR</h3>
                  <p><strong>Core:</strong> {contract.responsibleCore}</p>
                  <p><strong>Active Agents:</strong> {inspectedRec.activeAgents.join(", ") || "None"}</p>
                  <p><strong>Active Tools:</strong> {inspectedRec.activeTools.join(", ") || "None"}</p>
                  <p><strong>Duration:</strong> {inspectedRec.durationMs ?? 0} ms</p>
                </div>
                <div className="cp-pillar-box">
                  <h3>3. OUTPUT ARTIFACT</h3>
                  <pre>{JSON.stringify(inspectedRec.outputs, null, 2)}</pre>
                </div>
                <div className="cp-pillar-box">
                  <h3>4. GATE VALIDATION RULES</h3>
                  <ul>
                    {contract.validationRules.map((r, i) => (
                      <li key={i}>✓ {r}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Specialized Phase Views */}
              {selectedPhaseId === 3 && task.evidenceBundle && (
                <div className="cp-special-section">
                  <h3>Evidence Quality Bundle ({task.evidenceBundle.items.length} Items)</h3>
                  <table className="cp-evidence-table">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Category</th>
                        <th>Relevance</th>
                        <th>Reliability</th>
                        <th>Freshness</th>
                      </tr>
                    </thead>
                    <tbody>
                      {task.evidenceBundle.items.map((it) => (
                        <tr key={it.id}>
                          <td><code>{it.source}</code></td>
                          <td>{it.category}</td>
                          <td>{(it.relevance * 100).toFixed(0)}%</td>
                          <td>{(it.reliability * 100).toFixed(0)}%</td>
                          <td>{(it.freshness * 100).toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedPhaseId === 6 && task.simulation && (
                <div className="cp-special-section">
                  <h3>World Model Simulation Trajectory</h3>
                  <div className="cp-sim-metrics">
                    <div className="sim-metric-card">
                      <span>Vibration</span>
                      <strong>{task.simulation.metrics.vibration_mms?.toFixed(2)} mm/s</strong>
                    </div>
                    <div className="sim-metric-card">
                      <span>Temperature</span>
                      <strong>{( (task.simulation.metrics.temperature_K ?? 300) - 273.15).toFixed(1)} °C</strong>
                    </div>
                    <div className="sim-metric-card">
                      <span>Health Score</span>
                      <strong>{((task.simulation.metrics.health_score ?? 0) * 100).toFixed(0)}%</strong>
                    </div>
                    <div className="sim-metric-card">
                      <span>Validation Status</span>
                      <strong className="status-badge">{task.simulation.validationStatus}</strong>
                    </div>
                  </div>
                </div>
              )}

              {selectedPhaseId === 7 && task.critique && (
                <div className="cp-special-section">
                  <h3>Adversarial Critique Findings</h3>
                  {task.critique.problems.length === 0 ? (
                    <p className="clean-text">✓ No contradictions, calculation errors, or policy violations found.</p>
                  ) : (
                    <ul className="problem-list">
                      {task.critique.problems.map((p, i) => (
                        <li key={i} className={`problem-${p.severity}`}>
                          <strong>[{p.kind.toUpperCase()} - {p.severity}]</strong>: {p.description} (Suggested Loopback: Phase {p.suggestedLoopbackPhase})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {selectedPhaseId === 8 && task.verification && (
                <div className="cp-special-section">
                  <h3>NIRNAYA Multi-Dimensional Verification Matrix</h3>
                  <div className="cp-verif-grid">
                    <div className={task.verification.factualConsistency ? "verif-ok" : "verif-fail"}>Factual Consistency: {task.verification.factualConsistency ? "✓" : "✕"}</div>
                    <div className={task.verification.numericalConsistency ? "verif-ok" : "verif-fail"}>Numerical Consistency: {task.verification.numericalConsistency ? "✓" : "✕"}</div>
                    <div className={task.verification.evidenceConsistency ? "verif-ok" : "verif-fail"}>Evidence Consistency: {task.verification.evidenceConsistency ? "✓" : "✕"}</div>
                    <div className={task.verification.sourceConsistency ? "verif-ok" : "verif-fail"}>Source Consistency: {task.verification.sourceConsistency ? "✓" : "✕"}</div>
                    <div className={task.verification.modelAgreement ? "verif-ok" : "verif-fail"}>Model Agreement: {task.verification.modelAgreement ? "✓" : "✕"}</div>
                    <div className={task.verification.constraintConsistency ? "verif-ok" : "verif-fail"}>Constraint Consistency: {task.verification.constraintConsistency ? "✓" : "✕"}</div>
                    <div className={task.verification.toolResultConsistency ? "verif-ok" : "verif-fail"}>Tool Consistency: {task.verification.toolResultConsistency ? "✓" : "✕"}</div>
                    <div className={task.verification.simulationConsistency ? "verif-ok" : "verif-fail"}>Simulation Consistency: {task.verification.simulationConsistency ? "✓" : "✕"}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="cp-modal-footer">
              <button className="cp-btn-secondary" onClick={onClosePhaseModal}>Close Inspector</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

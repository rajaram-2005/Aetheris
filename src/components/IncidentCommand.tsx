"use client";
/**
 * IncidentCommand — Incident Command Mode UI Component
 *
 * Provides dedicated split-pane control during critical turbine anomalies:
 * - Diagnostic Graph + 3D Asset status
 * - Telemetry, Evidence, Simulation, Uncertainty, Safety tabs
 * - Mitigation Dispatch & Approval actions
 */
import React, { useState } from "react";
import type { IncidentState } from "@/core/controlplane/incident/command";

interface IncidentCommandProps {
  incident: IncidentState;
  onDispatchAction?: () => void;
}

export default function IncidentCommand({ incident, onDispatchAction }: IncidentCommandProps) {
  const [activeTab, setActiveTab] = useState<"telemetry" | "evidence" | "simulation" | "safety">("telemetry");
  const [dispatched, setDispatched] = useState(false);

  const handleDispatch = () => {
    setDispatched(true);
    onDispatchAction?.();
  };

  return (
    <div className="incident-command-panel">
      <div className="incident-header">
        <div className="incident-title-row">
          <span className="incident-alert-pill">🚨 INCIDENT COMMAND ACTIVE</span>
          <h2>{incident.assetId} / {incident.subsystem}</h2>
        </div>
        <div className="incident-phase-tag">{incident.phaseName}</div>
      </div>

      <div className="incident-banner">
        <strong>TRIGGER:</strong> {incident.triggerReason}
      </div>

      {/* Dual Pane View */}
      <div className="incident-dual-pane">
        <div className="incident-pane-left">
          <h3>INTELLIGENCE GRAPH</h3>
          <div className="incident-graph-box">
            <div className="graph-node-hub">RAVANA (Supervisor)</div>
            <div className="graph-arrows">│ ╲ ╱</div>
            <div className="graph-nodes-row">
              <div className="graph-node-item">NIRIKSHAN<br/><small>FFT (89.3 Hz BPFO)</small></div>
              <div className="graph-node-item node-warn">VIB-ALPHA<br/><small>8.4 mm/s Peak</small></div>
              <div className="graph-node-item">NIRNAYA<br/><small>Safety Gate</small></div>
            </div>
          </div>

          <div className="incident-mitigation-card">
            <h4>RECOMMENDED MITIGATION ACTION</h4>
            <p><strong>{incident.recommendedAction.action}</strong></p>
            <div className="mitigation-stats">
              <span>Expected Temp Drop: <strong>-{incident.recommendedAction.expectedTempDropK} K</strong></span>
              <span>Expected Vib Drop: <strong>-{incident.recommendedAction.expectedVibDropMms} mm/s</strong></span>
            </div>
            <button
              className={`incident-action-btn ${dispatched ? "btn-dispatched" : ""}`}
              onClick={handleDispatch}
              disabled={dispatched}
            >
              {dispatched ? "✓ Action Dispatched & Logged" : "Confirm & Dispatch Derate (15%)"}
            </button>
          </div>
        </div>

        <div className="incident-pane-right">
          <div className="incident-tabs">
            <button className={activeTab === "telemetry" ? "tab-on" : ""} onClick={() => setActiveTab("telemetry")}>Telemetry</button>
            <button className={activeTab === "evidence" ? "tab-on" : ""} onClick={() => setActiveTab("evidence")}>Evidence</button>
            <button className={activeTab === "simulation" ? "tab-on" : ""} onClick={() => setActiveTab("simulation")}>Simulation</button>
            <button className={activeTab === "safety" ? "tab-on" : ""} onClick={() => setActiveTab("safety")}>Safety Gate</button>
          </div>

          <div className="incident-tab-body">
            {activeTab === "telemetry" && (
              <div className="tab-telemetry">
                <div className="tel-metric-row">
                  <span>Vibration (vib_bearing_mms):</span>
                  <strong className="text-warn">{incident.telemetrySnapshot.vib_bearing_mms} mm/s (Threshold: {incident.telemetrySnapshot.threshold_mms} mm/s)</strong>
                </div>
                <div className="tel-metric-row">
                  <span>Bearing Temperature (gearbox_temp_K):</span>
                  <strong>{incident.telemetrySnapshot.gearbox_temp_K} K ({(incident.telemetrySnapshot.gearbox_temp_K - 273.15).toFixed(1)} °C)</strong>
                </div>
                <div className="tel-metric-row">
                  <span>Rotor Speed (rotor_rpm):</span>
                  <strong>{incident.telemetrySnapshot.rotor_rpm} RPM</strong>
                </div>
                <div className="tel-metric-row">
                  <span>Active Power (active_power_kW):</span>
                  <strong>{incident.telemetrySnapshot.active_power_kW} kW</strong>
                </div>
              </div>
            )}

            {activeTab === "evidence" && (
              <div className="tab-evidence">
                <ul>
                  <li><strong>SCADA Stream:</strong> Accelerometer #3 logged 8.4 mm/s RMS vibration.</li>
                  <li><strong>FFT Diagnostics:</strong> 89.3 Hz dominant peak matches outer-race ball pass frequency (BPFO).</li>
                  <li><strong>Historical Incident Ledger:</strong> Inner-race inspection completed 7 days ago.</li>
                  <li><strong>ISO 10816-3:</strong> Severity is in Class III Warning band.</li>
                </ul>
              </div>
            )}

            {activeTab === "simulation" && (
              <div className="tab-simulation">
                <p>World Model Simulation Scenario: <strong>15% Speed Derate</strong></p>
                <ul>
                  <li>Rotor Speed: 1500 RPM → <strong>1275 RPM</strong></li>
                  <li>Projected Vibration: 8.4 mm/s → <strong>6.3 mm/s (Within Safe Band)</strong></li>
                  <li>Projected Temperature: 338.2 K → <strong>323.7 K (-14.5 K)</strong></li>
                  <li>Efficiency Impact: <strong>-2.0%</strong></li>
                </ul>
              </div>
            )}

            {activeTab === "safety" && (
              <div className="tab-safety">
                <p><strong>Safety Gate:</strong> HIGH_RISK (Human Operator Approval Required)</p>
                <ul>
                  <li>✓ Emergency E-Stop interlock verified intact</li>
                  <li>✓ Thermal cutoff protection active at 80°C</li>
                  <li>✓ Single-use operator confirmation token required for physical derate</li>
                </ul>
              </div>
            )}
          </div>

          <div className="incident-timeline-box">
            <h4>INCIDENT TIMELINE</h4>
            <ul className="incident-timeline-list">
              {incident.timeline.map((item, i) => (
                <li key={i} className={`tl-${item.severity}`}>
                  <code>{item.time}</code>: {item.event}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

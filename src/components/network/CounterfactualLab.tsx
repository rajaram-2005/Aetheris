"use client";
/**
 * CounterfactualLab — World Model Prospective Physics & Causal Replay
 *
 * Implements:
 * - Scenarios A, B, C, D (Baseline vs Derate vs Shutdown vs Cooling Boost)
 * - Trajectory scrubbing (0m to 60m)
 * - Power vs Equipment Life trade-off metrics
 * - Causal Chain Replay (Cause -> Effect path)
 */
import React, { useState } from "react";
import type { CounterfactualScenario, CausalEvent } from "@/core/fabric/types";

interface CounterfactualLabProps {
  scenarios: CounterfactualScenario[];
  activeScenarioId: "A" | "B" | "C" | "D";
  onSelectScenario: (id: "A" | "B" | "C" | "D") => void;
  causalChain?: CausalEvent[];
  onApplyRecommendation?: (scenarioId: "A" | "B" | "C" | "D") => void;
}

export default function CounterfactualLab({
  scenarios,
  activeScenarioId,
  onSelectScenario,
  causalChain = [],
  onApplyRecommendation,
}: CounterfactualLabProps) {
  const [timelineIndex, setTimelineIndex] = useState<number>(3); // default ~15min
  const [showCausalReplay, setShowCausalReplay] = useState<boolean>(false);

  const activeScenario = scenarios.find((s) => s.id === activeScenarioId) || scenarios[0];
  const currentTraj = activeScenario?.trajectory?.[timelineIndex] || {
    tMin: 15,
    vib: activeScenario?.prediction.vibration_mms ?? 8.4,
    tempK: activeScenario?.prediction.temperature_K ?? 338.2,
    powerKW: activeScenario?.prediction.power_kW ?? 1572,
  };

  return (
    <div className="counterfactual-lab">
      {/* Header */}
      <div className="lab-header">
        <div>
          <h3>🔮 World Model Counterfactual Lab</h3>
          <p className="lab-sub">
            Simulate prospective physics, risk divergence, and causal mechanics across operational choices.
          </p>
        </div>
        <div className="lab-mode-toggles">
          <button
            className={`btn-tab ${!showCausalReplay ? "active" : ""}`}
            onClick={() => setShowCausalReplay(false)}
          >
            Scenario Matrix
          </button>
          <button
            className={`btn-tab ${showCausalReplay ? "active" : ""}`}
            onClick={() => setShowCausalReplay(true)}
          >
            ⚡ Causal Replay Chain ({causalChain.length})
          </button>
        </div>
      </div>

      {/* Scenario Grid */}
      <div className="scenarios-grid">
        {scenarios.map((sc) => {
          const isSelected = sc.id === activeScenarioId;
          const isRecommended = sc.id === "B";

          return (
            <div
              key={sc.id}
              className={`scenario-card ${isSelected ? "scenario-active" : ""}`}
              onClick={() => onSelectScenario(sc.id)}
            >
              <div className="scenario-card-header">
                <span className="scenario-code">SCENARIO {sc.id}</span>
                {isRecommended && <span className="recommended-tag">⭐ RECOMMENDED</span>}
                <span className={`risk-pill risk-${sc.prediction.risk_level.toLowerCase()}`}>
                  {sc.prediction.risk_level.toUpperCase()}
                </span>
              </div>
              <h4>{sc.name}</h4>
              <p className="scenario-desc">{sc.action}</p>

              <div className="scenario-stats">
                <div className="stat-item">
                  <span className="stat-label">Power</span>
                  <span className="stat-val">{sc.prediction.power_kW} kW</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Pred. Vibration</span>
                  <span className="stat-val">{sc.prediction.vibration_mms} mm/s</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Health Score</span>
                  <span className="stat-val">{(sc.prediction.health_score * 100).toFixed(0)}%</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Confidence</span>
                  <span className="stat-val">{sc.confidence}%</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail & Scrubbing Area */}
      {!showCausalReplay && activeScenario && (
        <div className="scenario-timeline-inspector">
          <div className="inspector-controls">
            <div className="scrubber-header">
              <label>Timeline Forecast: <strong>+{currentTraj.tMin} minutes</strong></label>
              <span>Validation State: <strong style={{ color: "#38bdf8" }}>{activeScenario.validationState}</strong></span>
            </div>
            <input
              type="range"
              min="0"
              max={(activeScenario.trajectory?.length || 8) - 1}
              step="1"
              value={timelineIndex}
              onChange={(e) => setTimelineIndex(Number(e.target.value))}
              className="timeline-slider"
            />
          </div>

          <div className="divergence-projection-card">
            <h4>Outcome Projection for {activeScenario.name}</h4>
            <div className="projection-metrics">
              <div className="metric-box">
                <div className="metric-title">Projected Vibration (+{currentTraj.tMin}m)</div>
                <div className="metric-number">
                  {currentTraj.vib} mm/s
                </div>
                <div className="metric-sub">ISO 10816 Limit: 7.1 mm/s</div>
              </div>

              <div className="metric-box">
                <div className="metric-title">Projected Temperature</div>
                <div className="metric-number">
                  {currentTraj.tempK} K ({(currentTraj.tempK - 273.15).toFixed(1)}°C)
                </div>
                <div className="metric-sub">Thermal Limit: 353.15 K (80°C)</div>
              </div>

              <div className="metric-box">
                <div className="metric-title">Energy Impact</div>
                <div className={`metric-number ${activeScenario.energyImpactPct >= 0 ? "positive" : "negative"}`}>
                  {activeScenario.energyImpactPct}%
                </div>
                <div className="metric-sub">Equipment Life: {activeScenario.equipmentLifeImpactYears > 0 ? `+${activeScenario.equipmentLifeImpactYears}` : activeScenario.equipmentLifeImpactYears} yrs</div>
              </div>
            </div>

            {onApplyRecommendation && activeScenario.id !== "A" && (
              <div className="action-row">
                <button
                  className="btn-apply-strategy"
                  onClick={() => onApplyRecommendation(activeScenario.id)}
                >
                  ⚡ Execute {activeScenario.name}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Causal Replay Chain */}
      {showCausalReplay && (
        <div className="causal-replay-container">
          <h4>⚡ Root-Cause Propagation & Dynamic Cascade</h4>
          <p className="causal-desc">
            Physical event causality reconstructed by NIRIKSHAN & RAVANA:
          </p>

          <div className="causal-chain-flow">
            {causalChain.map((ev, idx) => (
              <div key={ev.step} className="causal-step">
                <div className="causal-step-num">{ev.step}</div>
                <div className={`causal-step-content severity-${ev.severity}`}>
                  <div className="causal-step-header">
                    <span className="causal-time">STEP {ev.step}</span>
                    <span className="causal-source">{ev.assetComponent}</span>
                  </div>
                  <h5>{ev.title}</h5>
                  <p><strong>Cause:</strong> {ev.cause}</p>
                  <p><strong>Effect:</strong> {ev.effect}</p>
                  <div className="causal-affected">
                    Observed Metric: {ev.metric} = {ev.observedValue}
                  </div>
                </div>
                {idx < causalChain.length - 1 && <div className="causal-arrow">➔</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

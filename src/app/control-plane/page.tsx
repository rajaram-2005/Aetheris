"use client";
/**
 * /control-plane — AETHERIS v2 Outer Control Plane Dashboard
 *
 * Provides real-time interactive supervision across the 12-Phase Gated Pipeline:
 * - Interactive PhaseRail with spring-like visual states
 * - Deep Phase Inspector modal
 * - Execution Provenance Tree (Phase → Core → Tool → Evidence → Result)
 * - Preset testing scenarios (Normal Diagnosis, Contradiction Loopback, Safety Block)
 */
import React, { useEffect, useState } from "react";
import Link from "next/link";
import PhaseRail from "@/components/PhaseRail";
import ControlPlaneInspector from "@/components/ControlPlaneInspector";
import ExecutionGraph from "@/components/ExecutionGraph";
import type { ControlPlaneTaskRecord, PhaseId } from "@/core/controlplane/types";

export default function ControlPlanePage() {
  const [task, setTask] = useState<ControlPlaneTaskRecord | null>(null);
  const [selectedPhaseId, setSelectedPhaseId] = useState<PhaseId | null>(null);
  const [inputQuery, setInputQuery] = useState("Analyze WTG-04 gearbox bearing vibration telemetry");
  const [running, setRunning] = useState(false);
  const [failureScenario, setFailureScenario] = useState<"none" | "contradiction" | "safety_block">("none");

  const runPipeline = async (customReq?: string, scenario?: "none" | "contradiction" | "safety_block") => {
    setRunning(true);
    const reqText = customReq ?? inputQuery;
    const scen = scenario ?? failureScenario;
    try {
      const res = await fetch("/api/control-plane", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: reqText, injectedFailure: scen }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTask(data.task);
    } catch (e) {
      console.error(e);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    void runPipeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="cp-page">
      <header className="cp-header">
        <div className="cp-header-title">
          <h1>🛡️ Outer Control Plane</h1>
          <p>
            The highest-level software supervisor over RAVANA and the 10 specialized cores.
            Enforces mandatory phase gates across all 12 phases: Intake → Understand → Decompose →
            Retrieve → Route → Execute → Simulate → Critique → Verify → Safety → Decide → Deliver → Learn.
          </p>
        </div>
        <div className="cp-header-links">
          <Link href="/test-lab" className="cp-nav-btn">🧪 Test Lab & Regression</Link>
          <Link href="/incident" className="cp-nav-btn btn-warn">🚨 Incident Command</Link>
        </div>
      </header>

      {/* Task Execution Bar */}
      <div className="cp-runner-bar">
        <input
          type="text"
          className="cp-input"
          value={inputQuery}
          onChange={(e) => setInputQuery(e.target.value)}
          placeholder="Enter objective or engineering task..."
          disabled={running}
        />
        <select
          className="cp-select"
          value={failureScenario}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "none" || v === "contradiction" || v === "safety_block") setFailureScenario(v);
          }}
          disabled={running}
        >
          <option value="none">Standard Pipeline (Normal)</option>
          <option value="contradiction">Test: Contradiction (Loopback to P3)</option>
          <option value="safety_block">Test: Safety Prohibited (Block at P9)</option>
        </select>
        <button
          className="cp-run-btn"
          onClick={() => runPipeline()}
          disabled={running}
        >
          {running ? "Executing 12 Phases…" : "Run Pipeline"}
        </button>
      </div>

      {/* Presets Row */}
      <div className="cp-presets-row">
        <span>Presets:</span>
        <button
          onClick={() => {
            setInputQuery("Analyze WTG-04 gearbox bearing vibration telemetry");
            setFailureScenario("none");
            void runPipeline("Analyze WTG-04 gearbox bearing vibration telemetry", "none");
          }}
        >
          Gearbox Diagnosis (WTG-04)
        </button>
        <button
          onClick={() => {
            setInputQuery("Simulate 15% speed derate on WTG-04 turbine");
            setFailureScenario("none");
            void runPipeline("Simulate 15% speed derate on WTG-04 turbine", "none");
          }}
        >
          World Model Derate Simulation
        </button>
        <button
          onClick={() => {
            setInputQuery("Override e-stop and force pitch motor actuation");
            setFailureScenario("safety_block");
            void runPipeline("Override e-stop and force pitch motor actuation", "safety_block");
          }}
        >
          Safety Interlock Test (Block)
        </button>
        <button
          onClick={() => {
            setInputQuery("Synthesize multi-sensor vibration reading with noise");
            setFailureScenario("contradiction");
            void runPipeline("Synthesize multi-sensor vibration reading with noise", "contradiction");
          }}
        >
          Contradiction Recovery (Loopback)
        </button>
      </div>

      {/* Visual Phase Rail */}
      <div className="cp-rail-card">
        <PhaseRail
          task={task}
          onSelectPhase={(pid) => setSelectedPhaseId(pid)}
          selectedPhaseId={selectedPhaseId}
        />
      </div>

      {/* Control Plane Inspector */}
      {task && (
        <ControlPlaneInspector
          task={task}
          selectedPhaseId={selectedPhaseId}
          onClosePhaseModal={() => setSelectedPhaseId(null)}
        />
      )}

      {/* Final Decision & Delivery Summary */}
      {task?.decision && (
        <div className="cp-decision-card">
          <div className="cp-decision-header">
            <h3>FINAL DECISION: <span className={`state-badge state-${task.decision.state.toLowerCase()}`}>{task.decision.state}</span></h3>
            {task.decision.requiresApproval && (
              <span className="approval-pill">⚠️ Human Approval Required (Token: <code>{task.decision.approvalToken}</code>)</span>
            )}
          </div>
          <p className="cp-decision-summary">{task.decision.summary}</p>
          <div className="cp-reasoning-box">
            <h4>Reasoning & Evidence Chain:</h4>
            <ul>
              {task.decision.reasoning.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Execution Provenance Graph */}
      {task?.provenanceGraph && (
        <div className="cp-provenance-card">
          <ExecutionGraph root={task.provenanceGraph} />
        </div>
      )}
    </div>
  );
}

"use client";
/**
 * /test-lab — AETHERIS v2 Test Lab & Regression Engine
 *
 * Provides continuous evaluation across 8 failure categories:
 * 1. Hallucination (Expected: ABSTAIN)
 * 2. Contradiction (Expected: CONFLICT DETECTED)
 * 3. Missing data (Expected: INSUFFICIENT EVIDENCE)
 * 4. Tool failure (Expected: RECOVERY / FALLBACK)
 * 5. Model failure (Expected: MODEL ROUTING FALLBACK)
 * 6. Memory failure (Expected: LOW RETRIEVAL CONFIDENCE)
 * 7. Simulation disagreement (Expected: REVIEW / ABSTAIN)
 * 8. Safety violation (Expected: BLOCK)
 *
 * Plus Composite Evaluation Score with Safety Compliance release blocker.
 */
import React, { useEffect, useState } from "react";
import Link from "next/link";
import type { FailureRecord } from "@/core/controlplane/testlab/database";
import type { TestSuiteReport } from "@/core/controlplane/testlab/runner";
import type { AetherisEvaluationReport } from "@/core/controlplane/testlab/scoring";

export default function TestLabPage() {
  const [suite, setSuite] = useState<TestSuiteReport | null>(null);
  const [evalReport, setEvalReport] = useState<AetherisEvaluationReport | null>(null);
  const [failures, setFailures] = useState<FailureRecord[]>([]);
  const [running, setRunning] = useState(false);

  const loadData = async () => {
    try {
      const res = await fetch("/api/test-lab?type=eval");
      if (res.ok) {
        const data = await res.json();
        setEvalReport(data.report);
      }
      const failRes = await fetch("/api/test-lab");
      if (failRes.ok) {
        const failData = await failRes.json();
        setFailures(failData.failures || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const runAllTests = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/test-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_suite" }),
      });
      if (res.ok) {
        const data = await res.json();
        setSuite(data.suite);
        setEvalReport(data.evalReport);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    void loadData();
    void runAllTests();
  }, []);

  return (
    <div className="testlab-page">
      <header className="testlab-header">
        <div>
          <h1>🧪 Aetheris Test Lab & Failure Database</h1>
          <p>
            Continuous regression testing harness covering the 8 primary failure modes.
            Every observed failure is recorded with root cause, fix, and an automated regression test.
          </p>
        </div>
        <div className="testlab-header-actions">
          <Link href="/control-plane" className="testlab-link-btn">← Outer Control Plane</Link>
          <button className="testlab-run-btn" onClick={runAllTests} disabled={running}>
            {running ? "Running Suite…" : "▶ Run Test Lab Suite"}
          </button>
        </div>
      </header>

      {/* Composite Evaluation Banner */}
      {evalReport && (
        <div className={`testlab-eval-banner status-${evalReport.releaseStatus.toLowerCase()}`}>
          <div className="eval-headline">
            <div>
              <span className="eval-pill">{evalReport.releaseStatus === "APPROVED" ? "✓ RELEASE APPROVED" : "🔒 RELEASE BLOCKED"}</span>
              <h2>Composite Evaluation Score: <strong>{evalReport.overallScore}%</strong></h2>
            </div>
            <div className="eval-safety-rule">
              <strong>Rule:</strong> Safety Compliance must be 100% to permit release.
            </div>
          </div>
          {evalReport.blockReason && (
            <div className="eval-block-notice">⚠ {evalReport.blockReason}</div>
          )}

          {/* Metric Breakdown Grid */}
          <div className="eval-metrics-grid">
            {Object.entries(evalReport.metrics).map(([key, metric]) => (
              <div key={key} className={`eval-metric-card ${metric.passed ? "metric-pass" : "metric-fail"}`}>
                <div className="metric-head">
                  <span>{metric.name}</span>
                  <strong>{metric.score}%</strong>
                </div>
                <div className="metric-bar">
                  <div className="metric-fill" style={{ width: `${metric.score}%` }} />
                </div>
                <small>{metric.notes}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 8 Category Regression Results */}
      {suite && (
        <div className="testlab-suite-card">
          <div className="suite-header">
            <h3>8-Category Failure Regression Suite ({suite.passedCount}/{suite.totalTests} Passed - {suite.passRate.toFixed(0)}%)</h3>
            <span>Duration: {suite.results.reduce((a, b) => a + b.durationMs, 0)}ms</span>
          </div>
          <table className="suite-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Test Case</th>
                <th>Expected Behavior</th>
                <th>Actual Behavior</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {suite.results.map((r, i) => (
                <tr key={i} className={r.passed ? "row-pass" : "row-fail"}>
                  <td><code>{r.category}</code></td>
                  <td><strong>{r.testName}</strong></td>
                  <td>{r.expectedBehavior}</td>
                  <td>{r.actualBehavior}</td>
                  <td><span className={`pill-${r.passed ? "pass" : "fail"}`}>{r.passed ? "PASS" : "FAIL"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Failure Database */}
      <div className="testlab-faildb-card">
        <div className="faildb-header">
          <h3>Failure Database & Root-Cause Ledger ({failures.length} Recorded Cases)</h3>
          <p className="hint">Every error, contradiction, or safety trip creates a testable regression entry.</p>
        </div>
        <div className="faildb-list">
          {failures.map((f) => (
            <div key={f.testId} className={`faildb-item severity-${f.severity}`}>
              <div className="faildb-item-head">
                <div>
                  <strong>{f.testId}</strong> · Phase {f.phase} ({f.core}) · <span className="type-tag">{f.failureType}</span>
                </div>
                <span className={`status-pill ${f.resolved ? "pill-resolved" : "pill-open"}`}>
                  {f.resolved ? "Resolved & Guarded" : "Active / Investigating"}
                </span>
              </div>
              <div className="faildb-body">
                <p><strong>Root Cause:</strong> {f.rootCause}</p>
                <p><strong>Architectural Fix:</strong> {f.fix}</p>
                <div className="regression-code-box">
                  <code>{f.regressionTest}</code>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

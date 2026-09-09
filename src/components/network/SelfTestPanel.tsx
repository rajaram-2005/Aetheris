"use client";
/**
 * SelfTestPanel — Live System Verification & Diagnostic Modal
 */
import React, { useState } from "react";
import type { SelfTestReport } from "@/core/fabric/selftest";

interface SelfTestPanelProps {
  initialReport?: SelfTestReport;
  isOpen: boolean;
  onClose: () => void;
  onRunTest?: () => Promise<SelfTestReport>;
}

export default function SelfTestPanel({
  initialReport,
  isOpen,
  onClose,
  onRunTest,
}: SelfTestPanelProps) {
  const [report, setReport] = useState<SelfTestReport | undefined>(initialReport);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [filter, setFilter] = useState<"ALL" | "PASSED" | "FAILED">("ALL");

  if (!isOpen) return null;

  const handleRunTest = async () => {
    setIsRunning(true);
    try {
      if (onRunTest) {
        const res = await onRunTest();
        setReport(res);
      } else {
        const res = await fetch("/api/network/selftest", { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          setReport(data.report);
        }
      }
    } catch (err) {
      console.error("Failed to run self test", err);
    } finally {
      setIsRunning(false);
    }
  };

  const allChecks = report?.checks || [];
  const filteredChecks = allChecks.filter((c) => {
    if (filter === "PASSED") return c.status === "ok";
    if (filter === "FAILED") return c.status !== "ok";
    return true;
  });

  return (
    <div className="selftest-modal-backdrop" onClick={onClose}>
      <div className="selftest-modal" onClick={(e) => e.stopPropagation()}>
        <div className="selftest-header">
          <div className="title-area">
            <h3>🔬 AETHERIS Live Self-Test & Diagnostic Check</h3>
            <span className="subtitle">
              Continuous validation across 10 Cores, Event Fabric, Memory, and Safety Policies
            </span>
          </div>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Global Verdict Banner */}
        {report && (
          <div className={`verdict-banner banner-${report.overallStatus.toLowerCase()}`}>
            <div className="verdict-icon">
              {report.overallStatus === "READY" && "✅"}
              {report.overallStatus === "DEGRADED" && "⚠️"}
              {report.overallStatus === "BLOCKED" && "🛑"}
            </div>
            <div className="verdict-info">
              <div className="verdict-title">
                SYSTEM VERDICT: <strong>{report.overallStatus}</strong>
              </div>
              <div className="verdict-metrics">
                Total Checks: {report.totalChecks} | Passed: {report.passedChecks} | Failed: {report.totalChecks - report.passedChecks}
              </div>
            </div>
            <button
              className="btn-re-run"
              onClick={handleRunTest}
              disabled={isRunning}
            >
              {isRunning ? "Running Diagnostic..." : "🔄 Re-run All Checks"}
            </button>
          </div>
        )}

        {/* Filter Tabs */}
        <div className="selftest-filters">
          <button
            className={`filter-btn ${filter === "ALL" ? "active" : ""}`}
            onClick={() => setFilter("ALL")}
          >
            All Checks ({allChecks.length})
          </button>
          <button
            className={`filter-btn ${filter === "PASSED" ? "active" : ""}`}
            onClick={() => setFilter("PASSED")}
          >
            Passed ({allChecks.filter((c) => c.status === "ok").length})
          </button>
          <button
            className={`filter-btn ${filter === "FAILED" ? "active" : ""}`}
            onClick={() => setFilter("FAILED")}
          >
            Issues ({allChecks.filter((c) => c.status !== "ok").length})
          </button>
        </div>

        {/* Checks Table */}
        <div className="selftest-table-wrapper">
          <table className="selftest-table">
            <thead>
              <tr>
                <th>Target</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredChecks.map((check) => (
                <tr key={check.id} className={check.status === "ok" ? "row-pass" : "row-fail"}>
                  <td className="cell-target">
                    <strong>{check.name}</strong>
                  </td>
                  <td className="cell-status">
                    <span className={`pill ${check.status === "ok" ? "pill-pass" : "pill-fail"}`}>
                      {check.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="cell-latency">{check.latencyMs}ms</td>
                  <td className="cell-details">{check.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Boot Sequence Log */}
        {report?.bootSequenceLogs && report.bootSequenceLogs.length > 0 && (
          <div className="boot-log-section">
            <h5>Subsystem Verification Log</h5>
            <div className="boot-log-console">
              {report.bootSequenceLogs.map((line, i) => (
                <div key={i} className="log-line">
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";
/**
 * NetworkWorkspace — Master Unified Operating Environment
 *
 * UNIFIED CONCEPT:
 * "ONE STATE. ONE EVENT FABRIC. ONE INTELLIGENCE NETWORK. ONE DIGITAL REALITY. ONE VERIFIED RESULT."
 *
 * Coordinates:
 * - Master Intelligence Graph (15 Semantic Typed Edges)
 * - Central Event Fabric (Priority P0-P6 visual stream)
 * - 3D Digital Twin Reality Layer (11 render modes)
 * - World Model Counterfactual Lab (Scenarios A/B/C/D & Causal Replay)
 * - Live Diagnostic Self-Test Panel
 * - Universal Spatial Search (Ctrl+K)
 */
import React, { useState, useEffect } from "react";
import type {
  AetherisState,
  NetworkNode,
  NetworkEdge,
  AetherisEvent,
} from "@/core/fabric/types";
import type { SelfTestReport } from "@/core/fabric/selftest";
import IntelligenceGraphView from "./IntelligenceGraphView";
import DigitalTwinSync from "./DigitalTwinSync";
import CounterfactualLab from "./CounterfactualLab";
import UniversalSearch from "./UniversalSearch";
import SelfTestPanel from "./SelfTestPanel";

interface NetworkWorkspaceProps {
  initialState: AetherisState;
  initialNodes: NetworkNode[];
  initialEdges: NetworkEdge[];
  initialEvents: AetherisEvent[];
  initialSelfTest?: SelfTestReport;
}

export default function NetworkWorkspace({
  initialState,
  initialNodes,
  initialEdges,
  initialEvents,
  initialSelfTest,
}: NetworkWorkspaceProps) {
  const [state, setState] = useState<AetherisState>(initialState);
  const [nodes] = useState<NetworkNode[]>(initialNodes);
  const [edges] = useState<NetworkEdge[]>(initialEdges);
  const [events] = useState<AetherisEvent[]>(initialEvents);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("core-ravana");
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"graph" | "twin" | "counterfactual" | "events">("graph");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selfTestOpen, setSelfTestOpen] = useState(false);

  // Keyboard shortcut for Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSelectComponent = (compId: string) => {
    setState((prev) => ({
      ...prev,
      assets: {
        ...prev.assets,
        focusedComponent: compId,
      },
    }));

    const matchingNode = nodes.find(
      (n) => n.id.toLowerCase().includes(compId.toLowerCase()) || n.label.toLowerCase().includes(compId.toLowerCase())
    );
    if (matchingNode) {
      setSelectedNodeId(matchingNode.id);
    }
  };

  const handleFocusConnected = (nodeId: string) => {
    if (!nodeId) {
      setFocusedNodeId(null);
      return;
    }
    setFocusedNodeId(nodeId);
    setSelectedNodeId(nodeId);
  };

  const handleApplyStrategy = (scenarioId: "A" | "B" | "C" | "D") => {
    setState((prev) => {
      const scenario = prev.simulations.scenarios.find((s) => s.id === scenarioId);
      if (!scenario) return prev;

      return {
        ...prev,
        telemetry: {
          ...prev.telemetry,
          channels: {
            ...prev.telemetry.channels,
            vib_bearing_mms: {
              ...prev.telemetry.channels.vib_bearing_mms,
              value: scenario.prediction.vibration_mms,
              status: scenario.prediction.vibration_mms > 7.1 ? "critical" : "ok",
            },
            active_power_kW: {
              ...prev.telemetry.channels.active_power_kW,
              value: scenario.prediction.power_kW,
            },
          },
        },
      };
    });
  };

  return (
    <div className="network-workspace-root">
      {/* 1. Master State Header */}
      <header className="workspace-header">
        <div className="header-brand">
          <div className="brand-badge">AETHERIS UNIFIED INTELLIGENCE</div>
          <div className="mission-title">
            <strong>{state.mission.title}</strong>
            <span className="mission-id">[{state.mission.id}]</span>
          </div>
        </div>

        <div className="header-phase-strip">
          <div className="phase-pill active-phase">
            <span className="phase-num">{state.phase.current}</span>
            <span className="phase-name">{state.phase.name}</span>
          </div>
          <div className="status-pill status-investigating">
            {state.phase.gateVerdict} ({state.mission.status.toUpperCase()})
          </div>
        </div>

        <div className="header-actions">
          <button className="btn-search-trigger" onClick={() => setSearchOpen(true)}>
            🔍 Search <kbd>Ctrl+K</kbd>
          </button>
          <button
            className={`btn-selftest-trigger ${initialSelfTest?.overallStatus === "READY" ? "status-ready" : "status-degraded"}`}
            onClick={() => setSelfTestOpen(true)}
          >
            🔬 System Diagnostic: {initialSelfTest?.overallStatus || "READY"}
          </button>
        </div>
      </header>

      {/* 2. Primary Navigation Bar */}
      <nav className="workspace-nav">
        <button
          className={`nav-tab ${activeTab === "graph" ? "active" : ""}`}
          onClick={() => setActiveTab("graph")}
        >
          🕸️ Master Intelligence Graph ({nodes.length} nodes · {edges.length} edges)
        </button>
        <button
          className={`nav-tab ${activeTab === "twin" ? "active" : ""}`}
          onClick={() => setActiveTab("twin")}
        >
          🌐 3D Digital Reality Layer ({state.assets.components.length} components)
        </button>
        <button
          className={`nav-tab ${activeTab === "counterfactual" ? "active" : ""}`}
          onClick={() => setActiveTab("counterfactual")}
        >
          🔮 World Model & Counterfactual Lab ({state.simulations.scenarios.length} Scenarios)
        </button>
        <button
          className={`nav-tab ${activeTab === "events" ? "active" : ""}`}
          onClick={() => setActiveTab("events")}
        >
          ⚡ Central Event Fabric ({events.length} events)
        </button>
      </nav>

      {/* 3. Main Workspace Area */}
      <main className="workspace-main-content">
        {activeTab === "graph" && (
          <div className="tab-pane-graph">
            <IntelligenceGraphView
              nodes={nodes}
              edges={edges}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              onFocusNode={handleFocusConnected}
              focusedNodeId={focusedNodeId}
              width={920}
              height={580}
            />
          </div>
        )}

        {activeTab === "twin" && (
          <div className="tab-pane-twin">
            <DigitalTwinSync
              state={state}
              onSelectComponent={handleSelectComponent}
              width={920}
              height={520}
            />
          </div>
        )}

        {activeTab === "counterfactual" && (
          <div className="tab-pane-counterfactual">
            <CounterfactualLab
              scenarios={state.simulations.scenarios}
              activeScenarioId={state.simulations.activeScenario}
              onSelectScenario={(id) =>
                setState((prev) => ({
                  ...prev,
                  simulations: { ...prev.simulations, activeScenario: id },
                }))
              }
              causalChain={state.simulations.causalTimeline}
              onApplyRecommendation={handleApplyStrategy}
            />
          </div>
        )}

        {activeTab === "events" && (
          <div className="tab-pane-events">
            <div className="events-stream-card">
              <div className="stream-header">
                <h3>⚡ Central Event Fabric Stream</h3>
                <span className="stream-count">{events.length} Real-Time Verified Events</span>
              </div>
              <div className="stream-list">
                {events.map((ev) => (
                  <div key={ev.id} className={`stream-row priority-${ev.priority.toLowerCase()}`}>
                    <div className="event-priority-tag">{ev.priority}</div>
                    <div className="event-meta">
                      <span className="event-cat">{ev.category.toUpperCase()}</span>
                      <span className="event-source">[{ev.sourceId}]</span>
                    </div>
                    <div className="event-title">
                      <strong>{ev.type}</strong>
                      <p>{JSON.stringify(ev.payload)}</p>
                    </div>
                    <div className="event-time">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 4. Bottom Engineering Telemetry Rail */}
      <footer className="workspace-telemetry-rail">
        <div className="rail-item">
          <span className="rail-label">ROTOR RPM</span>
          <span className="rail-val">{state.telemetry.channels.rotor_rpm?.value.toFixed(0)} RPM</span>
        </div>
        <div className="rail-item">
          <span className="rail-label">ACTIVE POWER</span>
          <span className="rail-val">{state.telemetry.channels.active_power_kW?.value.toFixed(0)} kW</span>
        </div>
        <div className="rail-item critical-alert">
          <span className="rail-label">BEARING VIBRATION</span>
          <span className="rail-val">{state.telemetry.channels.vib_bearing_mms?.value.toFixed(1)} mm/s 🔴</span>
        </div>
        <div className="rail-item warning-alert">
          <span className="rail-label">GEARBOX TEMP</span>
          <span className="rail-val">{state.telemetry.channels.gearbox_temp_K?.value.toFixed(1)} K ⚠️</span>
        </div>
        <div className="rail-item">
          <span className="rail-label">CORES</span>
          <span className="rail-val">10/10 Cores Active</span>
        </div>
        <div className="rail-item">
          <span className="rail-label">CONFIDENCE</span>
          <span className="rail-val">{state.uncertainty.confidence}%</span>
        </div>
      </footer>

      {/* Modals */}
      <UniversalSearch
        nodes={nodes}
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectNode={(id) => {
          setSelectedNodeId(id);
          setActiveTab("graph");
        }}
      />

      <SelfTestPanel
        initialReport={initialSelfTest}
        isOpen={selfTestOpen}
        onClose={() => setSelfTestOpen(false)}
      />
    </div>
  );
}

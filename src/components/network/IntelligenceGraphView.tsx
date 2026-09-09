"use client";
/**
 * IntelligenceGraphView — Master Semantic Intelligence Network Visualizer
 *
 * Visualizes Cores, Mission, Agents, Models, Tools, Assets, Evidence, Decisions, and Memories
 * connected by strict SemanticEdgeTypes.
 * Supports:
 * - "Show everything connected to this" Subgraph Focus Mode
 * - Interactive node clustering and edge type filtering
 * - Confidence overlays and Node Inspector sidebar
 */
import React, { useState, useMemo } from "react";
import type {
  NetworkNode,
  NetworkEdge,
  NetworkNodeType,
  SemanticEdgeType,
} from "@/core/fabric/types";

interface IntelligenceGraphViewProps {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  onFocusNode?: (nodeId: string) => void;
  focusedNodeId?: string | null;
  width?: number;
  height?: number;
}

const CATEGORY_COLORS: Record<NetworkNodeType, { bg: string; border: string; text: string }> = {
  MISSION: { bg: "#4f46e5", border: "#818cf8", text: "#e0e7ff" },
  CORE: { bg: "#0284c7", border: "#38bdf8", text: "#e0f2fe" },
  AGENT: { bg: "#7c3aed", border: "#a78bfa", text: "#ede9fe" },
  MODEL: { bg: "#059669", border: "#34d399", text: "#d1fae5" },
  TOOL: { bg: "#d97706", border: "#fbbf24", text: "#fef3c7" },
  ASSET: { bg: "#dc2626", border: "#f87171", text: "#fee2e2" },
  SENSOR: { bg: "#ea580c", border: "#fb923c", text: "#ffedd5" },
  MEMORY: { bg: "#6366f1", border: "#a5b4fc", text: "#e0e7ff" },
  SIMULATION: { bg: "#9333ea", border: "#c084fc", text: "#f3e8ff" },
  EVIDENCE: { bg: "#0891b2", border: "#22d3ee", text: "#cffafe" },
  DECISION: { bg: "#16a34a", border: "#4ade80", text: "#dcfce7" },
  GATE: { bg: "#475569", border: "#94a3b8", text: "#f1f5f9" },
};

const EDGE_COLORS: Record<SemanticEdgeType, string> = {
  DEPENDS_ON: "#64748b",
  USES: "#38bdf8",
  GENERATED_BY: "#a855f7",
  VERIFIED_BY: "#22c55e",
  SUPPORTED_BY: "#10b981",
  CONTRADICTED_BY: "#ef4444",
  PREDICTS: "#ec4899",
  OBSERVES: "#f59e0b",
  CONTROLS: "#06b6d4",
  CONNECTED_TO: "#475569",
  DERIVED_FROM: "#8b5cf6",
  REQUIRES: "#f97316",
  BLOCKED_BY: "#dc2626",
  TRIGGERS: "#e11d48",
  LEARNED_FROM: "#14b8a6",
};

export default function IntelligenceGraphView({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onFocusNode,
  focusedNodeId,
  width = 760,
  height = 540,
}: IntelligenceGraphViewProps) {
  const [activeCategory, setActiveCategory] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1.0);

  // Position nodes
  const positionedNodes = useMemo(() => {
    const nodeMap = new Map<string, NetworkNode>();
    const total = nodes.length;
    nodes.forEach((n, idx) => {
      let x = n.x;
      let y = n.y;
      if (x === undefined || y === undefined) {
        const angle = (idx / Math.max(1, total)) * 2 * Math.PI;
        const radius = 220;
        x = width / 2 + Math.cos(angle) * radius;
        y = height / 2 + Math.sin(angle) * radius;
      }
      nodeMap.set(n.id, { ...n, x, y });
    });
    return nodeMap;
  }, [nodes, width, height]);

  // Filtered nodes
  const displayNodes = useMemo(() => {
    return Array.from(positionedNodes.values()).filter((n) => {
      if (activeCategory !== "ALL" && n.type !== activeCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          n.label.toLowerCase().includes(q) ||
          n.id.toLowerCase().includes(q) ||
          n.type.toLowerCase().includes(q) ||
          (n.sublabel && n.sublabel.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [positionedNodes, activeCategory, searchQuery]);

  // Filtered edges
  const displayEdges = useMemo(() => {
    const visibleNodeIds = new Set(displayNodes.map((n) => n.id));
    return edges.filter((e) => {
      return visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target);
    });
  }, [edges, displayNodes]);

  const selectedNode = selectedNodeId ? positionedNodes.get(selectedNodeId) : null;

  const connectedEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return edges.filter((e) => e.source === selectedNodeId || e.target === selectedNodeId);
  }, [edges, selectedNodeId]);

  return (
    <div className="intelligence-graph-container" style={{ position: "relative" }}>
      {/* Top Filter Bar */}
      <div className="graph-toolbar">
        <div className="graph-search">
          <input
            type="text"
            placeholder="Search nodes (e.g. RAVANA, Gearbox, BPFO)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="graph-category-filter">
          <button
            className={`badge-btn ${activeCategory === "ALL" ? "active" : ""}`}
            onClick={() => setActiveCategory("ALL")}
          >
            ALL ({nodes.length})
          </button>
          {Object.keys(CATEGORY_COLORS).map((cat) => {
            const count = nodes.filter((n) => n.type === cat).length;
            if (count === 0) return null;
            return (
              <button
                key={cat}
                className={`badge-btn ${activeCategory === cat ? "active" : ""}`}
                style={{
                  borderColor: CATEGORY_COLORS[cat as NetworkNodeType]?.border,
                  color: activeCategory === cat ? "#fff" : CATEGORY_COLORS[cat as NetworkNodeType]?.border,
                }}
                onClick={() => setActiveCategory(cat)}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>

        <div className="graph-zoom-controls">
          <button onClick={() => setZoom((z) => Math.min(z + 0.15, 2.0))}>➕</button>
          <button onClick={() => setZoom((z) => Math.max(z - 0.15, 0.4))}>➖</button>
          <button onClick={() => { setZoom(1.0); setPan({ x: 0, y: 0 }); }}>↺ Reset</button>
          {focusedNodeId && (
            <button className="btn-unfocus" onClick={() => onFocusNode?.("")}>
              Clear Focus
            </button>
          )}
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="graph-svg-wrapper" style={{ width: "100%", height, overflow: "hidden", background: "#06090e" }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: "100%", height: "100%" }}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="8"
              markerHeight="6"
              refX="18"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="#64748b" />
            </marker>
          </defs>

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Edges */}
            {displayEdges.map((e) => {
              const src = positionedNodes.get(e.source);
              const tgt = positionedNodes.get(e.target);
              if (!src || !tgt || src.x === undefined || tgt.x === undefined || src.y === undefined || tgt.y === undefined) {
                return null;
              }

              const isHighlighted =
                selectedNodeId === e.source || selectedNodeId === e.target;
              const edgeColor = EDGE_COLORS[e.type] || "#64748b";

              const midX = (src.x + tgt.x) / 2;
              const midY = (src.y + tgt.y) / 2;

              return (
                <g key={e.id} className="graph-edge-group">
                  <line
                    x1={src.x}
                    y1={src.y}
                    x2={tgt.x}
                    y2={tgt.y}
                    stroke={edgeColor}
                    strokeWidth={isHighlighted ? 2.5 : 1.2}
                    strokeOpacity={isHighlighted ? 0.9 : 0.45}
                    strokeDasharray={e.type === "PREDICTS" ? "4 2" : undefined}
                    markerEnd="url(#arrowhead)"
                  />
                  <text
                    x={midX}
                    y={midY - 3}
                    fill={edgeColor}
                    fontSize={8}
                    fontFamily="monospace"
                    textAnchor="middle"
                    opacity={isHighlighted ? 0.95 : 0.65}
                  >
                    {e.type}
                  </text>
                </g>
              );
            })}

            {/* Nodes */}
            {displayNodes.map((n) => {
              const x = n.x!;
              const y = n.y!;
              const isSelected = selectedNodeId === n.id;
              const isFocused = focusedNodeId === n.id;
              const style = CATEGORY_COLORS[n.type] || CATEGORY_COLORS.CORE;

              return (
                <g
                  key={n.id}
                  transform={`translate(${x}, ${y})`}
                  onClick={() => onSelectNode?.(isSelected ? null : n.id)}
                  style={{ cursor: "pointer" }}
                  className="graph-node"
                >
                  {(isSelected || isFocused) && (
                    <circle
                      r={24}
                      fill="none"
                      stroke={style.border}
                      strokeWidth={2}
                      strokeDasharray="3 3"
                      opacity={0.85}
                    />
                  )}

                  <circle
                    r={18}
                    fill={style.bg}
                    stroke={style.border}
                    strokeWidth={isSelected ? 3 : 1.5}
                  />

                  <text
                    textAnchor="middle"
                    dy={4}
                    fill={style.text}
                    fontSize={9}
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    {n.label.slice(0, 4).toUpperCase()}
                  </text>

                  <text
                    textAnchor="middle"
                    dy={30}
                    fill="#cbd5e1"
                    fontSize={10}
                    fontWeight="600"
                  >
                    {n.label}
                  </text>
                  <text
                    textAnchor="middle"
                    dy={42}
                    fill="#64748b"
                    fontSize={8}
                    fontFamily="monospace"
                  >
                    {n.type}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Selected Node Inspector Drawer */}
        {selectedNode && (
          <div className="graph-inspector-panel">
            <div className="inspector-header">
              <span className="badge-cat" style={{ background: CATEGORY_COLORS[selectedNode.type]?.bg }}>
                {selectedNode.type}
              </span>
              <h4>{selectedNode.label}</h4>
              <button onClick={() => onSelectNode?.(null)}>✕</button>
            </div>

            <div className="inspector-body">
              <div className="detail-row">
                <span className="label">Node ID:</span>
                <code>{selectedNode.id}</code>
              </div>
              <div className="detail-row">
                <span className="label">Status:</span>
                <span className="status-pill">{selectedNode.status.toUpperCase()}</span>
              </div>
              {selectedNode.sublabel && (
                <p className="node-desc">{selectedNode.sublabel}</p>
              )}

              {/* Connected Relationships */}
              <div className="relationships-section">
                <h5>Semantic Connections ({connectedEdges.length})</h5>
                <ul>
                  {connectedEdges.map((e) => {
                    const isOut = e.source === selectedNode.id;
                    const otherId = isOut ? e.target : e.source;
                    const otherNode = positionedNodes.get(otherId);
                    return (
                      <li key={e.id}>
                        <span className="rel-arrow">{isOut ? "→" : "←"}</span>
                        <span className="rel-type">{e.type}</span>
                        <strong onClick={() => onSelectNode?.(otherId)}>
                          {otherNode?.label || otherId}
                        </strong>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="inspector-actions">
                <button
                  className="btn-focus-connected"
                  onClick={() => onFocusNode?.(selectedNode.id)}
                >
                  🎯 Focus Connected Subgraph
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

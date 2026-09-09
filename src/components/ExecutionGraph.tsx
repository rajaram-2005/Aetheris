"use client";
/**
 * ExecutionGraph — 5-Layer Provenance Visualization
 *
 * Shows the provenance chain:
 * PHASE -> CORE -> TOOL -> EVIDENCE -> RESULT
 */
import React from "react";
import type { ExecutionProvenanceNode } from "@/core/controlplane/types";

interface ExecutionGraphProps {
  root?: ExecutionProvenanceNode;
}

export default function ExecutionGraph({ root }: ExecutionGraphProps) {
  if (!root || !root.children || root.children.length === 0) {
    return (
      <div className="exec-graph-empty">
        <p>No execution trace recorded yet. Run a task through the Control Plane to generate provenance.</p>
      </div>
    );
  }

  return (
    <div className="exec-graph">
      <div className="exec-graph-header">
        <h3>Execution Provenance Tree</h3>
        <p className="hint">Trace: Phase → Core → Tool → Evidence → Final Result</p>
      </div>
      <div className="exec-graph-tree">
        {root.children.map((phaseNode) => (
          <div key={phaseNode.id} className="tree-phase-block">
            <div className={`tree-node tree-phase node-${phaseNode.status}`}>
              <div className="node-icon">📦</div>
              <div className="node-info">
                <strong>{phaseNode.label}</strong>
                <small>{phaseNode.detail}</small>
              </div>
            </div>

            {phaseNode.children && phaseNode.children.length > 0 && (
              <div className="tree-children">
                {phaseNode.children.map((coreNode) => (
                  <div key={coreNode.id} className="tree-core-block">
                    <div className={`tree-node tree-core node-${coreNode.status}`}>
                      <div className="node-icon">⚡</div>
                      <div className="node-info">
                        <strong>{coreNode.label}</strong>
                        <small>{coreNode.detail}</small>
                      </div>
                    </div>

                    {coreNode.children && coreNode.children.length > 0 && (
                      <div className="tree-subchildren">
                        {coreNode.children.map((toolNode) => (
                          <div key={toolNode.id} className={`tree-node tree-tool node-${toolNode.status}`}>
                            <div className="node-icon">🔧</div>
                            <div className="node-info">
                              <strong>{toolNode.label}</strong>
                              <small>{toolNode.detail}</small>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

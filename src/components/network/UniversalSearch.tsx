"use client";
/**
 * UniversalSearch — Global Spatial & Entity Index (Ctrl+K)
 */
import React, { useState, useEffect, useMemo } from "react";
import type { NetworkNode } from "@/core/fabric/types";

interface UniversalSearchProps {
  nodes: NetworkNode[];
  isOpen: boolean;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
}

export default function UniversalSearch({
  nodes,
  isOpen,
  onClose,
  onSelectNode,
}: UniversalSearchProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const results = useMemo(() => {
    if (!query.trim()) {
      return nodes.slice(0, 10);
    }
    const q = query.toLowerCase();
    return nodes
      .filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          n.id.toLowerCase().includes(q) ||
          n.type.toLowerCase().includes(q) ||
          (n.sublabel && n.sublabel.toLowerCase().includes(q))
      )
      .slice(0, 12);
  }, [nodes, query]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % Math.max(1, results.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + results.length) % Math.max(1, results.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (results[selectedIndex]) {
          onSelectNode(results[selectedIndex].id);
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, onSelectNode, results, selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="search-overlay-backdrop" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-header">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            autoFocus
            placeholder="Search Intelligence Graph (e.g. RAVANA, WTG-04, Gearbox, BPFO)..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
          <button className="search-close-btn" onClick={onClose}>
            ESC
          </button>
        </div>

        <div className="search-results-list">
          {results.length === 0 ? (
            <div className="search-empty">No matching nodes found for &quot;{query}&quot;</div>
          ) : (
            results.map((n, idx) => (
              <div
                key={n.id}
                className={`search-result-row ${idx === selectedIndex ? "active" : ""}`}
                onClick={() => {
                  onSelectNode(n.id);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span className="result-cat-badge">
                  {n.type}
                </span>
                <div className="result-info">
                  <div className="result-title">
                    <strong>{n.label}</strong>
                    <code className="result-id">{n.id}</code>
                  </div>
                  {n.sublabel && <div className="result-desc">{n.sublabel}</div>}
                </div>
                <div className="result-status">
                  <span className={`status-dot status-${n.status}`} />
                  {n.status}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="search-footer">
          <span>Navigate: <kbd>↑</kbd> <kbd>↓</kbd></span>
          <span>Select: <kbd>Enter</kbd></span>
          <span>Close: <kbd>Esc</kbd></span>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { Settings } from "./store";

export default function SettingsModal({ settings, onUpdate, memory, onRemoveMemory, onClearMemory, onAddMemory, onClose, onExport, onClearChats }: {
  settings: Settings; onUpdate: (p: Partial<Settings>) => void;
  memory: string[]; onRemoveMemory: (f: string) => void; onClearMemory: () => void; onAddMemory: (f: string) => void;
  onClose: () => void; onExport: () => void; onClearChats: () => void;
}) {
  const [tab, setTab] = useState<"general" | "memory" | "data">("general");
  const [newFact, setNewFact] = useState("");
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h3 style={{ marginTop: 0 }}>Settings</h3>
        <div className="mode-toggle" style={{ marginBottom: 14 }}>
          <button className={tab === "general" ? "active" : ""} onClick={() => setTab("general")}>General</button>
          <button className={tab === "memory" ? "active" : ""} onClick={() => setTab("memory")}>Memory · {memory.length}</button>
          <button className={tab === "data" ? "active" : ""} onClick={() => setTab("data")}>Data</button>
        </div>

        {tab === "general" && (
          <div className="settings">
            <label className="field">
              <span>Web search</span>
              <select value={settings.web} onChange={(e) => onUpdate({ web: e.target.value as Settings["web"] })}>
                <option value="auto">Auto — search when the question looks time-sensitive</option>
                <option value="on">Always search</option>
                <option value="off">Never</option>
              </select>
            </label>
            <label className="field">
              <span>Tavily API key <a href="https://app.tavily.com" target="_blank" rel="noreferrer">(free: 1,000 searches/month)</a></span>
              <input type="password" placeholder="tvly-…" value={settings.tavilyKey} onChange={(e) => onUpdate({ tavilyKey: e.target.value.trim() })} />
              <small>Stored only in this browser and sent with your requests. Powers web grounding, citations and Deep Research.</small>
            </label>
            <label className="field row">
              <input type="checkbox" checked={settings.memoryEnabled} onChange={(e) => onUpdate({ memoryEnabled: e.target.checked })} />
              <span>Memory — remember useful facts about you across chats</span>
            </label>
          </div>
        )}

        {tab === "memory" && (
          <div className="settings">
            <p className="hint" style={{ textAlign: "left", marginTop: 0 }}>Aetheris saves short facts you share (preferences, projects, "remember that…"). They are added to every chat's context. Stored in this browser only.</p>
            {memory.length === 0 && <div className="sb-empty">Nothing remembered yet.</div>}
            <ul className="mem-list">
              {memory.map((f) => <li key={f}><span>{f}</span><button className="link" onClick={() => onRemoveMemory(f)}>forget</button></li>)}
            </ul>
            <div className="utr-form">
              <input placeholder="Add a memory manually, e.g. “I prefer TypeScript and terse answers”" value={newFact} onChange={(e) => setNewFact(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newFact.trim()) { onAddMemory(newFact.trim()); setNewFact(""); } }} />
              <button className="send" disabled={!newFact.trim()} onClick={() => { onAddMemory(newFact.trim()); setNewFact(""); }}>Add</button>
            </div>
            {memory.length > 0 && <button className="ghost" style={{ alignSelf: "flex-start" }} onClick={() => { if (confirm("Forget everything?")) onClearMemory(); }}>Clear all memory</button>}
          </div>
        )}

        {tab === "data" && (
          <div className="settings">
            <p className="hint" style={{ textAlign: "left", marginTop: 0 }}>All chats, projects and memory live in this browser's localStorage.</p>
            <button className="ghost" style={{ alignSelf: "flex-start" }} onClick={onExport}>Export everything (JSON)</button>
            <button className="ghost danger" style={{ alignSelf: "flex-start" }} onClick={() => { if (confirm("Delete all chats? This cannot be undone.")) onClearChats(); }}>Delete all chats</button>
          </div>
        )}
      </div>
    </div>
  );
}

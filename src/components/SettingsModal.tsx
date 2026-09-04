"use client";

import { useEffect, useState } from "react";
import type { Settings } from "./store";
import type { Account } from "./Upgrade";

export default function SettingsModal({ settings, onUpdate, memory, onRemoveMemory, onClearMemory, onAddMemory, onClose, onExport, onClearChats, account, onUpgrade }: {
  settings: Settings; onUpdate: (p: Partial<Settings>) => void; account?: Account | null; onUpgrade?: () => void;
  memory: string[]; onRemoveMemory: (f: string) => void; onClearMemory: () => void; onAddMemory: (f: string) => void;
  onClose: () => void; onExport: () => void; onClearChats: () => void;
}) {
  const [tab, setTab] = useState<"general" | "usage" | "memory" | "keys" | "data">("general");
  const [newFact, setNewFact] = useState("");
  const [keys, setKeys] = useState<{ id: string; name: string; prefix: string; model: string; createdAt: number; calls: number; lastUsedAt?: number }[]>([]);
  const [keyLimit, setKeyLimit] = useState(0);
  const [keyName, setKeyName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const loadKeys = () => fetch("/api/keys").then((r) => r.json()).then((j) => { setKeys(j.keys ?? []); setKeyLimit(j.limit ?? 0); }).catch(() => undefined);
  useEffect(() => { if (tab === "keys") loadKeys(); }, [tab]);
  const mint = async () => {
    setKeyErr(null);
    const r = await fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: keyName }) });
    const j = await r.json();
    if (!r.ok) return setKeyErr(j.error);
    setFresh(j.key); setKeyName(""); loadKeys();
  };
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-aetheris.app";
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h3 style={{ marginTop: 0 }}>Settings</h3>
        <div className="mode-toggle" style={{ marginBottom: 14 }}>
          <button className={tab === "general" ? "active" : ""} onClick={() => setTab("general")}>General</button>
          <button className={tab === "usage" ? "active" : ""} onClick={() => setTab("usage")}>Plan & usage</button>
          <button className={tab === "memory" ? "active" : ""} onClick={() => setTab("memory")}>Memory · {memory.length}</button>
          <button className={tab === "keys" ? "active" : ""} onClick={() => setTab("keys")}>API keys</button>
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

        {tab === "usage" && account && (
          <div className="settings">
            <div className="usage-head">
              <div><div className="hint" style={{ margin: 0, textAlign: "left" }}>Current plan</div><b style={{ fontSize: 18 }}>{account.plan?.name ?? "Free"}</b>{account.expiresAt && <span className="hint" style={{ marginLeft: 8 }}>renews by {new Date(account.expiresAt).toLocaleDateString("en-IN")}</span>}</div>
              <button className="send" onClick={onUpgrade}>{account.plan ? "Change plan" : "Upgrade"}</button>
            </div>
            <div className="usage-bar"><div style={{ width: account.chat.limit ? `${Math.min(100, (account.chat.used / account.chat.limit) * 100)}%` : "0%" }} /></div>
            <div className="hint" style={{ textAlign: "left", margin: 0 }}>{account.chat.used} / {account.chat.limit ?? "∞"} credits used today · model cap <code>{account.maxModel}</code> · up to {account.maxAgents} agent{(account.maxAgents ?? 1) > 1 ? "s" : ""} per run · {account.apiKeys} API key{account.apiKeys === 1 ? "" : "s"}</div>
            <table className="usage-table">
              <thead><tr><th>Today by feature</th><th>Credits</th></tr></thead>
              <tbody>
                {Object.entries(account.byKind ?? {}).length === 0 && <tr><td colSpan={2} className="hint" style={{ textAlign: "left" }}>Nothing used yet today.</td></tr>}
                {Object.entries(account.byKind ?? {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
              </tbody>
            </table>
            {(account.history?.length ?? 0) > 0 && (
              <div className="spark" title="Last 30 days">
                {account.history!.slice(-30).map((h) => <span key={h.day} title={`${h.day}: ${h.count}`} style={{ height: `${Math.max(4, Math.min(100, (h.count / Math.max(1, ...account.history!.map((x) => x.count))) * 100))}%` }} />)}
              </div>
            )}
            <div className="hint" style={{ textAlign: "left" }}>Credit costs — chat 1 · agent run 2 · image/speech 2 · Factory run 3 · Deep Research 5 · video 5 · Arena 1 per model.</div>
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

        {tab === "keys" && (
          <div className="settings">
            <p className="hint" style={{ textAlign: "left", marginTop: 0 }}>Your own Aetheris API key. OpenAI-compatible — point any SDK at <code>{origin}/api/v1</code> and use models <code>aetheris-free … aetheris-god</code>. Credits and model tiers follow your plan.</p>
            {fresh && (
              <div className="fresh-key">
                <div><strong>Copy it now — it will not be shown again.</strong></div>
                <code>{fresh}</code>
                <button className="ghost" onClick={() => navigator.clipboard.writeText(fresh)}>Copy</button>
              </div>
            )}
            {keys.length === 0 && <div className="sb-empty">No keys yet.{keyLimit === 0 ? " API keys are included from the Lite plan (₹200/month)." : ""}</div>}
            <ul className="mem-list">
              {keys.map((k) => <li key={k.id}><span><code>{k.prefix}</code> {k.name} · {k.model} · {k.calls} calls</span><button className="link" onClick={() => fetch("/api/keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: k.id }) }).then(loadKeys)}>revoke</button></li>)}
            </ul>
            <div className="utr-form">
              <input placeholder="Key name, e.g. my-app" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
              <button className="send" disabled={keyLimit > 0 && keys.length >= keyLimit} onClick={mint}>Create key {keyLimit ? `(${keys.length}/${keyLimit})` : ""}</button>
            </div>
            {keyErr && <div className="err-text">{keyErr}</div>}
            <pre className="codeblock" style={{ fontSize: 12 }}>{`curl ${origin}/api/v1/chat/completions \\
  -H "Authorization: Bearer sk-aeth-..." \\
  -H "Content-Type: application/json" \\
  -d '{"model":"aetheris-pro","messages":[{"role":"user","content":"@coder write fizzbuzz in Go"}]}'`}</pre>
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

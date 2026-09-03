"use client";

import { useEffect, useMemo, useState } from "react";

interface Connector {
  id: string; name: string; category: string; description: string; url: string;
  auth?: { header: string; prefix?: string; label: string; help?: string };
  premium?: boolean; featured?: boolean; status: "verified" | "community";
}
interface Category { id: string; label: string }

export interface EnabledServer { id: string; url?: string; credential?: string; headerName?: string; headerPrefix?: string; name?: string }

const STORAGE = "aetheris.mcp.v1";
export function loadServers(): EnabledServer[] {
  try { return JSON.parse(localStorage.getItem(STORAGE) ?? "[]"); } catch { return []; }
}

export default function Apps({ enabled, onChange, hasPremium, onUpgrade }: {
  enabled: EnabledServer[]; onChange: (s: EnabledServer[]) => void; hasPremium: boolean; onUpgrade: (reason: string) => void;
}) {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("");
  const [open, setOpen] = useState<string | null>(null);
  const [cred, setCred] = useState("");
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [custom, setCustom] = useState({ name: "", url: "", header: "Authorization", prefix: "Bearer ", credential: "" });

  useEffect(() => {
    fetch("/api/mcp/catalog").then((r) => r.json()).then((j) => { setConnectors(j.connectors); setCategories(j.categories); }).catch(() => undefined);
  }, []);

  const save = (s: EnabledServer[]) => { onChange(s); localStorage.setItem(STORAGE, JSON.stringify(s)); };
  const isOn = (id: string) => enabled.some((s) => s.id === id);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return connectors
      .filter((c) => !cat || c.category === cat)
      .filter((c) => !t || c.name.toLowerCase().includes(t) || c.description.toLowerCase().includes(t))
      .sort((a, b) => Number(isOn(b.id)) - Number(isOn(a.id)) || Number(!!b.featured) - Number(!!a.featured) || a.name.localeCompare(b.name));
  }, [connectors, q, cat, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (c: Connector) => {
    if (isOn(c.id)) return save(enabled.filter((s) => s.id !== c.id));
    if (c.premium && !hasPremium) return onUpgrade(`${c.name} is a premium MCP connector.`);
    if (c.auth) { setOpen(c.id); setCred(""); return; }
    save([...enabled, { id: c.id, name: c.name }]);
  };
  const connect = (c: Connector) => {
    save([...enabled.filter((s) => s.id !== c.id), { id: c.id, name: c.name, credential: cred }]);
    setOpen(null);
  };
  const test = async (s: EnabledServer) => {
    setTesting(s.id);
    try {
      const r = await fetch("/api/mcp/tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
      const j = await r.json();
      setTestResult((t) => ({ ...t, [s.id]: r.ok ? { ok: true, msg: `${j.tools.length} tools: ${j.tools.slice(0, 6).map((x: { name: string }) => x.name).join(", ")}${j.tools.length > 6 ? "…" : ""}` } : { ok: false, msg: j.error } }));
    } finally { setTesting(null); }
  };

  const addCustom = () => {
    if (!custom.url.trim()) return;
    const id = `custom:${custom.name.trim() || new URL(custom.url).hostname}`;
    save([...enabled.filter((s) => s.id !== id), { id, name: custom.name || id, url: custom.url.trim(), credential: custom.credential || undefined, headerName: custom.header, headerPrefix: custom.prefix }]);
    setCustom({ name: "", url: "", header: "Authorization", prefix: "Bearer ", credential: "" });
  };

  return (
    <div className="apps">
      <div className="apps-head">
        <div>
          <strong>Cloud MCP App Store</strong>
          <span> — {connectors.length} connectors. Enabled apps become tools the model can call from One Chat.</span>
        </div>
        <span className="chip on">{enabled.length} enabled</span>
      </div>

      <div className="apps-filters">
        <input placeholder="Search connectors…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="cats">
          <button className={`chip ${!cat ? "on" : ""}`} onClick={() => setCat("")}>All</button>
          {categories.map((c) => <button key={c.id} className={`chip ${cat === c.id ? "on" : ""}`} onClick={() => setCat(c.id)}>{c.label}</button>)}
        </div>
      </div>

      <div className="app-grid">
        {filtered.map((c) => {
          const on = isOn(c.id);
          const s = enabled.find((x) => x.id === c.id);
          const tr = testResult[c.id];
          return (
            <div key={c.id} className={`app ${on ? "on" : ""}`}>
              <div className="app-top">
                <div className="app-name">{c.name} {c.premium && <span className="badge">PRO</span>}{c.status === "community" && <span className="tag">community</span>}</div>
                <button className={on ? "ghost" : "send"} onClick={() => toggle(c)} style={{ padding: "5px 10px", fontSize: 12 }}>{on ? "Disable" : c.auth ? "Connect" : "Enable"}</button>
              </div>
              <div className="app-desc">{c.description}</div>
              {open === c.id && c.auth && (
                <form className="utr-form" onSubmit={(e) => { e.preventDefault(); connect(c); }}>
                  <input type="password" placeholder={c.auth.label} value={cred} onChange={(e) => setCred(e.target.value)} autoComplete="off" />
                  <button className="send" disabled={!cred.trim()}>Save</button>
                </form>
              )}
              {on && s && (
                <div className="app-foot">
                  <button className="link" onClick={() => test(s)} disabled={testing === c.id}>{testing === c.id ? "testing…" : "test connection"}</button>
                  {tr && <span className={tr.ok ? "ok-text" : "err-text"}>{tr.msg}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <details className="custom-mcp">
        <summary>Add a custom MCP server</summary>
        <div className="keys-panel">
          <label><span>Name</span><input value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="My server" /></label>
          <label><span>URL</span><input value={custom.url} onChange={(e) => setCustom({ ...custom, url: e.target.value })} placeholder="https://host/mcp (Streamable HTTP)" /></label>
          <label><span>Auth header</span><input value={custom.header} onChange={(e) => setCustom({ ...custom, header: e.target.value })} /></label>
          <label><span>Prefix</span><input value={custom.prefix} onChange={(e) => setCustom({ ...custom, prefix: e.target.value })} /></label>
          <label><span>Credential</span><input type="password" value={custom.credential} onChange={(e) => setCustom({ ...custom, credential: e.target.value })} autoComplete="off" /></label>
          <button className="send" onClick={addCustom} disabled={!custom.url.trim()}>Add</button>
        </div>
        {enabled.filter((s) => s.id.startsWith("custom:")).map((s) => (
          <div key={s.id} className="app on" style={{ marginTop: 8 }}>
            <div className="app-top"><div className="app-name">{s.name}</div><button className="ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => save(enabled.filter((x) => x.id !== s.id))}>Remove</button></div>
            <div className="app-desc">{s.url}</div>
            <div className="app-foot"><button className="link" onClick={() => test(s)}>test connection</button>{testResult[s.id] && <span className={testResult[s.id].ok ? "ok-text" : "err-text"}>{testResult[s.id].msg}</span>}</div>
          </div>
        ))}
      </details>
      <p className="hint">Credentials are kept in this browser and forwarded only to the connector you entered them for. &quot;community&quot; connectors need a hosted MCP endpoint — add one via custom server.</p>
    </div>
  );
}

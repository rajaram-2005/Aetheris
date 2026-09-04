"use client";

import { useEffect, useMemo, useState } from "react";

interface Connector {
  id: string; name: string; category: string; description: string; url: string;
  kind: "remote" | "gateway"; oauth?: boolean; tools?: string[];
  auth?: { header: string; prefix?: string; label: string; help?: string };
  premium?: boolean; featured?: boolean;
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
  const [connected, setConnected] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCatalog = () => fetch("/api/mcp/catalog").then((r) => r.json()).then((j) => { setConnectors(j.connectors); setCategories(j.categories); setConnected(j.connected ?? []); }).catch(() => undefined);
  useEffect(() => {
    loadCatalog();
    // Handle return from an OAuth dance.
    const sp = new URLSearchParams(window.location.search);
    const mcp = sp.get("mcp");
    if (mcp) {
      const id = sp.get("id") ?? "";
      if (mcp === "ok") {
        const cur = loadServers();
        if (id && !cur.some((s) => s.id === id)) { const next = [...cur, { id }]; onChange(next); localStorage.setItem(STORAGE, JSON.stringify(next)); }
        setNotice(`Connected ${id}.`);
      } else {
        setNotice(`Could not connect ${id}: ${sp.get("reason") ?? "unknown error"}`);
      }
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (c.auth && !connected.includes(c.id)) { setOpen(c.id); setCred(""); return; }
    save([...enabled, { id: c.id, name: c.name }]);
  };
  const oauthStart = (c: Connector) => { window.location.href = `/api/mcp/oauth/start?id=${encodeURIComponent(c.id)}`; };
  const oauthDisconnect = async (c: Connector) => {
    await fetch("/api/mcp/oauth/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id }) });
    save(enabled.filter((s) => s.id !== c.id));
    loadCatalog();
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
      setTestResult((t) => ({ ...t, [s.id]: r.ok ? { ok: true, msg: `${j.tools.length} tools: ${j.tools.slice(0, 6).map((x: { name: string }) => x.name).join(", ")}${j.tools.length > 6 ? "…" : ""}` } : { ok: false, msg: j.needsOauth ? `${j.error} — try "Sign in"` : j.error } }));
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
          <span> — {connectors.length} connectors ({connectors.filter((c) => c.kind === "remote").length} vendor-hosted MCP servers, {connectors.filter((c) => c.kind === "gateway").length} via the Aetheris gateway). Enabled apps become tools the model can call from One Chat.</span>
        </div>
        <span className="chip on">{enabled.length} enabled</span>
      </div>
      {notice && <div className="upsell">{notice}<button className="link" onClick={() => setNotice(null)}>dismiss</button></div>}

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
            <div key={c.id} className={`appcard ${on ? "on" : ""}`}>
              <div className="app-top">
                <div className="app-name">{c.name} {c.premium && <span className="badge">PRO</span>}<span className="tag">{c.kind === "gateway" ? "gateway" : "MCP"}</span>{connected.includes(c.id) && <span className="tag" style={{ color: "var(--ok)" }}>signed in</span>}</div>
                <button className={on ? "ghost" : "send"} onClick={() => toggle(c)} style={{ padding: "5px 10px", fontSize: 12 }}>{on ? "Disable" : c.auth && !connected.includes(c.id) ? "Connect" : "Enable"}</button>
              </div>
              <div className="app-desc">{c.description}</div>
              {c.tools && c.tools.length > 0 && <div className="app-desc" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{c.tools.join(" · ")}</div>}
              {open === c.id && c.auth && (
                <div className="connect-box">
                  {c.oauth && <button className="gh-btn" onClick={() => oauthStart(c)}>Sign in with {c.name}</button>}
                  <form className="utr-form" onSubmit={(e) => { e.preventDefault(); connect(c); }}>
                    <input type="password" placeholder={c.oauth ? `or paste ${c.auth.label}` : c.auth.label} value={cred} onChange={(e) => setCred(e.target.value)} autoComplete="off" />
                    <button className="send" disabled={!cred.trim()}>Save</button>
                  </form>
                </div>
              )}
              {on && s && (
                <div className="app-foot">
                  <button className="link" onClick={() => test(s)} disabled={testing === c.id}>{testing === c.id ? "testing…" : "test connection"}</button>
                  {connected.includes(c.id) && <button className="link" onClick={() => oauthDisconnect(c)}>sign out</button>}
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
      <p className="hint">
        <strong>MCP</strong> connectors are vendor-hosted servers — sign in with OAuth or paste a token. <strong>gateway</strong> connectors are served by Aetheris itself
        (<code>/api/gateway/&lt;id&gt;</code>) and wrap the vendor&apos;s public REST API, so any MCP client can use them too. Pasted credentials stay in this browser; OAuth tokens live in an encrypted cookie.
      </p>
    </div>
  );
}

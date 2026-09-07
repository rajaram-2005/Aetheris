"use client";

import { useEffect, useState } from "react";
import type { Settings } from "./store";
import type { Account } from "./Upgrade";
import { LANGS, useLang } from "@/lib/i18n";

export default function SettingsModal({ settings, onUpdate, memory, onRemoveMemory, onClearMemory, onAddMemory, onClose, onExport, onClearChats, account, onUpgrade }: {
  settings: Settings; onUpdate: (p: Partial<Settings>) => void; account?: Account | null; onUpgrade?: () => void;
  memory: string[]; onRemoveMemory: (f: string) => void; onClearMemory: () => void; onAddMemory: (f: string) => void;
  onClose: () => void; onExport: () => void; onClearChats: () => void;
}) {
  const { lang, setLang, t } = useLang();
  const [tab, setTab] = useState<"general" | "usage" | "memory" | "keys" | "data">("general");
  const [newFact, setNewFact] = useState("");
  const [keys, setKeys] = useState<{ id: string; name: string; prefix: string; model: string; createdAt: number; calls: number; lastUsedAt?: number }[]>([]);
  const [keyLimit, setKeyLimit] = useState(0);
  const [keyName, setKeyName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const loadKeys = () => fetch("/api/keys").then((r) => r.json()).then((j) => { setKeys(j.keys ?? []); setKeyLimit(j.limit ?? 0); }).catch(() => undefined);
  useEffect(() => { if (tab === "keys") loadKeys(); }, [tab]);

  // ---- API keys manager (model providers + service keys — no .env editing) ----
  interface KeyItem { id: string; name: string; group: "models" | "service"; kind: string; envKey: string; model?: string; powers?: string; keyless: boolean; local: boolean; vision: boolean; costClass: string; keyUrl?: string; freeTier?: string; notes?: string; hasKey: boolean; source: "app" | "env" | null; maskedKey: string | null; cloudflare: boolean; cloudflareAccountSet: boolean }
  const [providers, setProviders] = useState<KeyItem[] | null>(null);
  const [services, setServices] = useState<KeyItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pkErr, setPkErr] = useState<string | null>(null);
  const [pkOk, setPkOk] = useState<Record<string, string>>({});
  const loadProviders = () => fetch("/api/providers/keys").then((r) => r.json()).then((j) => { setProviders(j.providers ?? []); setServices(j.services ?? []); }).catch(() => setProviders([]));
  useEffect(() => { if (tab === "keys") loadProviders(); }, [tab]);
  const patchItem = (item: KeyItem | null) => {
    if (!item) return;
    if (item.group === "service") setServices((cur) => cur.map((x) => (x.id === item.id ? item : x)));
    else setProviders((cur) => (cur ?? []).map((x) => (x.id === item.id ? item : x)));
  };
  const note = (id: string, text: string) => {
    setPkOk((m) => ({ ...m, [id]: text }));
    setTimeout(() => setPkOk((m) => { const n = { ...m }; delete n[id]; return n; }), 4000);
  };
  const saveKey = async (p: KeyItem) => {
    setPkErr(null); setBusyId(p.id);
    try {
      const r = await fetch("/api/providers/keys", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, key: drafts[p.id] ?? "" }) });
      const j = await r.json();
      if (!r.ok) return setPkErr(j.error ?? "save failed");
      patchItem(j.item);
      setDrafts((d) => { const n = { ...d }; delete n[p.id]; return n; });
      note(p.id, `✓ ${p.name} is live — no restart needed`);
    } catch { setPkErr("could not reach the server"); } finally { setBusyId(null); }
  };
  const removeKey = async (p: KeyItem) => {
    setPkErr(null); setBusyId(p.id);
    try {
      const r = await fetch("/api/providers/keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id }) });
      const j = await r.json();
      if (!r.ok) return setPkErr(j.error ?? "remove failed");
      patchItem(j.item);
      note(p.id, p.source === "env" ? "✓ removed app key — using the .env key again" : "✓ key removed");
    } catch { setPkErr("could not reach the server"); } finally { setBusyId(null); }
  };
  const keyProviders = (providers ?? []).filter((p) => !p.keyless);
  const keylessProviders = (providers ?? []).filter((p) => p.keyless);
  const renderKeyCard = (p: KeyItem) => (
    <div key={p.id} className="pkey-card">
      <div className="pkey-top">
        <div>
          <b>{p.name}</b>
          {p.local && <span className="pkey-pill local">local</span>}
          <span className="pkey-sub">{p.group === "service" ? p.powers ?? p.envKey : `${p.model ?? ""}${p.vision ? " · vision" : ""}`}</span>
        </div>
        <span className={`pkey-pill ${p.source === "app" ? "app" : p.source === "env" ? "env" : "off"}`}>
          {p.source === "app" ? "Saved in app" : p.source === "env" ? "From .env" : "No key"}
        </span>
      </div>
      <div className="pkey-meta">
        {p.maskedKey ? <code title="stored key, masked">{p.maskedKey}</code> : <span className="hint">—</span>}
        {p.keyUrl && <a href={p.keyUrl} target="_blank" rel="noreferrer" className="pkey-link">Get free key ↗</a>}
      </div>
      {p.freeTier && <div className="pkey-hint">{p.freeTier}</div>}
      {p.cloudflare && <div className="pkey-hint warn">{p.cloudflareAccountSet ? "Also needs your account id in .env (CLOUDFLARE_ACCOUNT_ID)." : "⚠ also needs CLOUDFLARE_ACCOUNT_ID in .env to activate."}</div>}
      <div className="pkey-actions">
        <input
          type="password"
          placeholder={p.hasKey ? "Paste a new key to replace…" : `Paste ${p.envKey}…`}
          value={drafts[p.id] ?? ""}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter" && (drafts[p.id] ?? "").trim().length >= 6) saveKey(p); }}
        />
        <button className="send" disabled={busyId === p.id || (drafts[p.id] ?? "").trim().length < 6} onClick={() => saveKey(p)}>{busyId === p.id ? "…" : "Save"}</button>
        {(p.source === "app" || (drafts[p.id] ?? "").trim()) && <button className="ghost danger pkey-remove" disabled={busyId === p.id} onClick={() => removeKey(p)} title="Remove the app-saved key (falls back to .env if set)">✕</button>}
      </div>
      <div className="pkey-notes">
        {pkOk[p.id] ? <span className="ok-text">{pkOk[p.id]}</span> : p.notes ? <span className="hint">{p.notes}</span> : null}
        {!p.notes && !pkOk[p.id] && <span className="hint" style={{ visibility: "hidden" }}>·</span>}
      </div>
    </div>
  );

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
              <span>{t("settings.language")}</span>
              <select value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}>
                {LANGS.map((l) => <option key={l.id} value={l.id}>{l.native} · {l.label}</option>)}
              </select>
              <small>{t("settings.languageHint")}</small>
            </label>
            <label className="field">
              <span>Web search</span>
              <select value={settings.web} onChange={(e) => onUpdate({ web: e.target.value as Settings["web"] })}>
                <option value="auto">Auto — search when the question looks time-sensitive</option>
                <option value="on">Always search</option>
                <option value="off">Never</option>
              </select>
            </label>
            <label className="field">
              <span>Tavily key for this browser <a href="https://app.tavily.com" target="_blank" rel="noreferrer">(free: 1,000 searches/month)</a></span>
              <input type="password" placeholder="tvly-…" value={settings.tavilyKey} onChange={(e) => onUpdate({ tavilyKey: e.target.value.trim() })} />
              <small>Optional: stored only in this browser and sent with your requests. Prefer the server-wide Tavily card in the <button className="link" onClick={() => setTab("keys")}>API keys</button> tab so every browser on this instance uses it.</small>
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
              {account.user ? (
                <div className="sb-account" style={{ padding: 0 }}>
                  {account.user.avatar ? <img src={account.user.avatar} alt="" /> : <span className="av">{account.user.name[0]?.toUpperCase()}</span>}
                  <span className="who">{account.user.name}{account.admin && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--accent)" }}>ADMIN</span>}</span>
                  <span className="hint" style={{ margin: 0 }}>{[account.user.email, account.user.phone].filter(Boolean).join(" · ")} · via {account.user.providers.join(", ")}</span>
                  {account.admin && <a className="link" href="/admin">admin</a>}
                  <button className="link" onClick={async () => { await fetch("/api/auth/session", { method: "DELETE" }); location.reload(); }}>sign out</button>
                </div>
              ) : (
                <div className="upsell">👤 Your data stays in this browser.</div>
              )}
            </div>
            <div className="usage-head">
              <div><div className="hint" style={{ margin: 0, textAlign: "left" }}>Current plan</div><b style={{ fontSize: 18 }}>{account.freeForAll ? "Everything, free" : account.plan?.name ?? "Free"}</b>{account.expiresAt && <span className="hint" style={{ marginLeft: 8 }}>renews by {new Date(account.expiresAt).toLocaleDateString("en-IN")}</span>}</div>
              {account.freeForAll ? <span className="plan-badge god">∞ free for everyone</span> : account.admin ? <span className="plan-badge god">∞ admin</span> : <button className="send" onClick={onUpgrade}>{account.plan ? "Change plan" : "Upgrade"}</button>}
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
            <div className="keys-hero">
              <span className="keys-hero-icon">🔑</span>
              <div>
                <b>Every API key, one place</b>
                <small>Add keys right here instead of editing .env — applied instantly, no restart. Saved on this device in <code>data/runtime_keys.json</code> (mode 0600) and used by Chat, Agents, Studio, Research, automations and RAVANA.</small>
              </div>
            </div>

            {providers === null ? <div className="sb-empty">Loading…</div> : (
              <>
                <h4 className="pkey-section-title">Chat model providers <small>{keyProviders.length}</small></h4>
                {keyProviders.length === 0 ? <div className="sb-empty">No providers found.</div> : (
                  <div className="pkey-grid">{keyProviders.map(renderKeyCard)}</div>
                )}
                {keylessProviders.length > 0 && (
                  <div className="pkey-keyless">
                    <span>Works without a key:</span>
                    {keylessProviders.map((p) => <span key={p.id} className={`pkey-chip ${p.source === "app" ? "on" : ""}`}>{p.name}{p.source === "app" ? " · key saved" : ""}</span>)}
                  </div>
                )}

                {services.length > 0 && (
                  <>
                    <h4 className="pkey-section-title">Search · Studio · email & more <small>{services.length}</small></h4>
                    <div className="pkey-grid">{services.map(renderKeyCard)}</div>
                  </>
                )}
                {pkErr && <div className="err-text">{pkErr}</div>}
                <p className="hint" style={{ textAlign: "left" }}>Sign-in providers (Google/GitHub OAuth), SMS gateways and server security tokens (<code>AETHERIS_SECRET</code>, <code>CRON_SECRET</code>, <code>AETHERIS_ADMIN_KEY</code>) stay in .env — they gate auth and admin access, not model usage.</p>
              </>
            )}

            <h4 className="pkey-divider">Your Aetheris API keys <small>OpenAI-compatible gateway</small></h4>
            <p className="hint" style={{ textAlign: "left", marginTop: 0 }}>Point any SDK at <code>{origin}/api/v1</code> and use models <code>aetheris-free … aetheris-god</code>. Credits and model tiers follow your plan.</p>
            {fresh && (
              <div className="fresh-key">
                <div><strong>Copy it now — it will not be shown again.</strong></div>
                <code>{fresh}</code>
                <button className="ghost" onClick={() => navigator.clipboard.writeText(fresh)}>Copy</button>
              </div>
            )}
            {keys.length === 0 && <div className="sb-empty">No keys yet.{keyLimit === 0 ? " API keys are not enabled on this deployment." : ""}</div>}
            <ul className="mem-list">
              {keys.map((k) => <li key={k.id}><span><code>{k.prefix}</code> {k.name} · {k.model} · {k.calls} calls</span><button className="link" onClick={() => fetch("/api/keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: k.id }) }).then(loadKeys)}>revoke</button></li>)}
            </ul>
            <div className="utr-form">
              <input placeholder="Key name, e.g. my-app" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
              <button className="send" disabled={keyLimit > 0 && keys.length >= keyLimit} onClick={mint}>Create key {keyLimit ? `(${keys.length}/${keyLimit})` : ""}</button>
            </div>
            {keyErr && <div className="err-text">{keyErr}</div>}
            <pre className="codeblock" style={{ fontSize: 12 }}>{`curl ${origin}/api/v1/chat/completions \\\\
  -H "Authorization: Bearer sk-aeth-..." \\\\
  -H "Content-Type: application/json" \\\\
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

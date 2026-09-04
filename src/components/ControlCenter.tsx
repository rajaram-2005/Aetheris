"use client";
import { useCallback, useEffect, useState } from "react";

interface Cap { id: string; name: string; category: string; status: string; security_level: string; description: string; provider: string; verification_status: string; locality: string; tags: string[]; reliability?: number; requires_confirmation?: boolean }
interface Ev { id: string; at: number; type: string; uid?: string; capability?: string; ok: boolean; ms?: number; detail?: string }
interface Tele { admin: boolean; principal: { uid: string; grants: string[] }; summary: { events: number; errors: number; byType: Record<string, { n: number; ok: number; avgMs: number }>; top: { key: string; n: number; ok: number; avgMs: number }[]; uptimeSec: number }; events: Ev[]; registry: { total: number; byCategory: Record<string, number>; byStatus: Record<string, number>; bySecurity: Record<string, number> }; mesh: { ready: number; cooldown: number; unconfigured: number; providers: { id: string; state: string; successes: number; failures: number }[] }; mcp: { connectors?: number; tools?: number; [k: string]: unknown }; process: { uptimeSec: number; memMb: number; node: string } }

const STATUS_LABEL: Record<string, string> = { implemented: "Implemented", partial: "Partial", experimental: "Experimental", mocked: "Mocked", not_available: "Not available" };
const STATUS_ORDER = ["implemented", "partial", "experimental", "mocked", "not_available"];
const fmtAge = (t: number) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`; };

/** 🎛️ Control Center — system health, capability registry (honest status), event feed, intent tester, permissions. */
export default function ControlCenter({ onAsk }: { onAsk: (p: string) => void }) {
  const [tele, setTele] = useState<Tele | null>(null);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [tab, setTab] = useState<"overview" | "registry" | "events" | "intent" | "permissions">("overview");
  const [intentText, setIntentText] = useState("Connect my ESP32 temperature sensor over MQTT and alert me when it exceeds 60°C");
  const [plan, setPlan] = useState<Record<string, unknown> | null>(null);
  const [permTest, setPermTest] = useState<{ cap: string; result?: Record<string, unknown> }>({ cap: "github:factory" });

  const load = useCallback(() => fetch("/api/telemetry").then((r) => r.json()).then(setTele).catch(() => undefined), []);
  const loadCaps = useCallback(() => fetch(`/api/capabilities?limit=400${q ? `&q=${encodeURIComponent(q)}` : ""}${cat ? `&category=${cat}` : ""}`).then((r) => r.json()).then((j) => setCaps(j.capabilities ?? [])).catch(() => undefined), [q, cat]);
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { loadCaps(); }, [loadCaps]);

  const runIntent = async () => { const j = await fetch("/api/intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: intentText }) }).then((r) => r.json()); setPlan(j.plan ?? j); };
  const testPerm = async (confirm: boolean) => { const j = await fetch("/api/permissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capabilityId: permTest.cap, confirm }) }).then((r) => r.json()); setPermTest({ ...permTest, result: j }); load(); };

  const platform = caps.filter((c) => !["model", "agent", "connector", "tool"].includes(c.category));
  return (
    <div className="study cc">
      <div className="gallery-head">
        <div><h2 style={{ margin: 0 }}>🎛️ Control Center</h2><p className="hint" style={{ margin: "4px 0 0", textAlign: "left" }}>What Aetheris can do, what is really running, and what every subsystem's honest status is. Nothing on this screen is mocked — counters come from live events.</p></div>
        <div className="row" style={{ gap: 6 }}>{(["overview", "registry", "events", "intent", "permissions"] as const).map((t) => <button key={t} className={`chip ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</div>
      </div>

      {tab === "overview" && tele && (
        <>
          <div className="study-kpis cc-kpis">
            <div><b>{tele.mesh.ready}</b><span>providers ready</span></div><div><b>{tele.mesh.cooldown}</b><span>cooling down</span></div><div><b>{tele.registry.total}</b><span>capabilities</span></div>
            <div><b>{tele.summary.events}</b><span>events / 1h</span></div><div><b style={{ color: tele.summary.errors ? "var(--err)" : undefined }}>{tele.summary.errors}</b><span>errors / 1h</span></div>
            <div><b>{Math.round(tele.process.uptimeSec / 60)}m</b><span>uptime</span></div><div><b>{tele.process.memMb} MB</b><span>rss</span></div>
          </div>
          <div className="study-grid">
            <div className="study-summary"><b>Implementation status</b>{STATUS_ORDER.map((s) => <div key={s} className="row" style={{ justifyContent: "space-between" }}><span className={`st st-${s}`}>{STATUS_LABEL[s]}</span><b>{tele.registry.byStatus[s] ?? 0}</b></div>)}<p className="hint" style={{ textAlign: "left", margin: 0 }}>Models count as “not available” until a key is configured; connectors are “partial” because reachability depends on the vendor and your credential.</p></div>
            <div className="study-summary"><b>Activity by type (1h)</b>{Object.entries(tele.summary.byType).length === 0 && <span className="hint" style={{ textAlign: "left" }}>No events yet — send a message or run a schedule.</span>}{Object.entries(tele.summary.byType).map(([k, v]) => <div key={k} className="row" style={{ justifyContent: "space-between" }}><span>{k}</span><span className="meta">{v.ok}/{v.n} ok · {v.avgMs} ms</span></div>)}</div>
            <div className="study-summary"><b>Model mesh</b><div className="row" style={{ gap: 4, flexWrap: "wrap" }}>{tele.mesh.providers.map((p) => <span key={p.id} className={`chip ${p.state === "ready" ? "on" : p.state === "cooldown" ? "bad" : ""}`} title={`${p.successes} ok / ${p.failures} failed`}>{p.id}</span>)}</div></div>
            <div className="study-summary"><b>Your principal</b><div className="meta">uid {tele.principal.uid.slice(0, 10)}…</div><div className="row" style={{ gap: 4, flexWrap: "wrap" }}>{tele.principal.grants.map((g) => <span key={g} className="chip on">{g}</span>)}{!tele.principal.grants.includes("physical") && <span className="chip" title="Never granted by default">physical ✗</span>}</div><p className="hint" style={{ textAlign: "left", margin: 0 }}>Least privilege: full_workspace/admin/physical actions require explicit confirmation tokens. Admins: set AETHERIS_ADMIN_UIDS.</p></div>
          </div>
          <div className="study-summary"><b>Platform subsystems</b>
            <div className="study-cards">{platform.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)).map((c) => (
              <div key={c.id} className={`study-row cc-row st-${c.status}`} style={{ gridTemplateColumns: "150px minmax(0,1fr) auto" }}>
                <span className={`st st-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                <div className="study-row-main"><b>{c.name}</b><div className="hint" style={{ textAlign: "left", margin: 0 }}>{c.description}</div></div>
                <span className="meta" title="required permission">{c.security_level}{c.requires_confirmation ? " · confirm" : ""}</span>
              </div>))}</div>
          </div>
        </>
      )}

      {tab === "registry" && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <input className="agent-search" placeholder="Search capabilities — e.g. pdf, tamil, github, mqtt, vision…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="agent-search" style={{ maxWidth: 180 }} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{Object.keys(tele?.registry.byCategory ?? {}).sort().map((c) => <option key={c} value={c}>{c} ({tele!.registry.byCategory[c]})</option>)}</select>
          </div>
          <div className="study-cards">{caps.slice(0, 200).map((c) => (
            <div key={c.id} className={`study-row cc-row st-${c.status}`} style={{ gridTemplateColumns: "110px minmax(0,1fr) auto auto" }}>
              <span className="meta">{c.category}</span>
              <div className="study-row-main"><b>{c.name}</b> <code className="meta">{c.id}</code><div className="hint" style={{ textAlign: "left", margin: 0 }}>{c.description.slice(0, 160)}</div></div>
              <span className={`st st-${c.status}`}>{STATUS_LABEL[c.status]}</span>
              <span className="meta">{c.security_level}{c.reliability !== undefined ? ` · ${Math.round(c.reliability * 100)}%` : ""}</span>
            </div>))}{caps.length > 200 && <div className="hint">Showing 200 of {caps.length} — refine the search.</div>}</div>
        </>
      )}

      {tab === "events" && tele && (
        <div className="study-cards">{tele.events.length === 0 && <div className="hint">No events recorded yet.</div>}{tele.events.map((e) => (
          <div key={e.id} className={`study-row ${e.ok ? "stage-mature" : "stage-learning"}`} style={{ gridTemplateColumns: "60px 80px minmax(0,1fr) auto" }}>
            <span className="meta">{fmtAge(e.at)}</span><span className="meta">{e.type}</span>
            <div className="study-row-main"><code>{e.capability ?? "—"}</code>{e.detail && <div className="hint" style={{ textAlign: "left", margin: 0 }}>{e.detail}</div>}</div>
            <span className="meta">{e.ok ? "✓" : "✗"}{e.ms !== undefined ? ` ${e.ms} ms` : ""}</span>
          </div>))}</div>
      )}

      {tab === "intent" && (
        <div className="study-summary">
          <b>Intent → capability router</b>
          <p className="hint" style={{ textAlign: "left", margin: 0 }}>Type any command; Aetheris classifies the task and proposes the mode, agents and connectors — locally, without a model call. Manual override: prefix @agent or /mode.</p>
          <div className="row" style={{ gap: 8 }}><input className="agent-search" value={intentText} onChange={(e) => setIntentText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runIntent()} /><button className="send" onClick={runIntent}>Route</button></div>
          {plan && <pre className="cc-pre">{JSON.stringify(plan, null, 2)}</pre>}
          {plan && typeof plan.mode === "string" && <button className="chip" onClick={() => onAsk(intentText)}>Send to chat with this routing</button>}
        </div>
      )}

      {tab === "permissions" && (
        <div className="study-summary">
          <b>Execution policy tester</b>
          <p className="hint" style={{ textAlign: "left", margin: 0 }}>Every capability declares a required level; the policy decides and audits. Try a write-level capability with and without confirmation.</p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <select className="agent-search" style={{ maxWidth: 360 }} value={permTest.cap} onChange={(e) => setPermTest({ cap: e.target.value })}>{platform.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.security_level}{c.requires_confirmation ? " · confirm" : ""}</option>)}</select>
            <button className="chip" onClick={() => testPerm(false)}>Request</button><button className="chip on" onClick={() => testPerm(true)}>Request with confirmation</button>
          </div>
          {permTest.result && <pre className="cc-pre">{JSON.stringify(permTest.result, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}

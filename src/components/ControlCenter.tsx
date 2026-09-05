"use client";
import { useCallback, useEffect, useState } from "react";

interface Cap { id: string; name: string; category: string; status: string; security_level: string; description: string; provider: string; verification_status: string; locality: string; tags: string[]; reliability?: number; requires_confirmation?: boolean }
interface Ev { id: string; at: number; type: string; uid?: string; capability?: string; ok: boolean; ms?: number; detail?: string }
interface Tele { admin: boolean; principal: { uid: string; grants: string[] }; summary: { events: number; errors: number; byType: Record<string, { n: number; ok: number; avgMs: number }>; top: { key: string; n: number; ok: number; avgMs: number }[]; uptimeSec: number }; events: Ev[]; registry: { total: number; byCategory: Record<string, number>; byStatus: Record<string, number>; bySecurity: Record<string, number> }; mesh: { ready: number; cooldown: number; unconfigured: number; providers: { id: string; state: string; successes: number; failures: number }[] }; mcp: { connectors?: number; tools?: number; [k: string]: unknown }; process: { uptimeSec: number; memMb: number; node: string } }

const STATUS_LABEL: Record<string, string> = { implemented: "Implemented", partial: "Partial", experimental: "Experimental", mocked: "Mocked", not_available: "Not available" };
const STATUS_ORDER = ["implemented", "partial", "experimental", "mocked", "not_available"];
type Tab = "overview" | "registry" | "events" | "intent" | "permissions" | "jobs" | "executions" | "mcp" | "knowledge" | "devices" | "twins" | "robots" | "automations" | "browser" | "workspaces" | "tools";
const TABS: Tab[] = ["overview", "registry", "events", "intent", "permissions", "jobs", "executions", "mcp", "knowledge", "devices", "twins", "robots", "automations", "browser", "workspaces", "tools"];
const fmtAge = (t: number) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`; };

/** 🎛️ Control Center — system health, capability registry (honest status), event feed, intent tester, permissions. */
export default function ControlCenter({ onAsk }: { onAsk: (p: string) => void }) {
  const [tele, setTele] = useState<Tele | null>(null);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
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
        <div className="row" style={{ gap: 6 }}>{TABS.map((t) => <button key={t} className={`chip ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</div>
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

      {tab === "jobs" && <JobsPanel />}
      {tab === "executions" && <ExecPanel />}
      {tab === "mcp" && <McpPanel />}
      {tab === "knowledge" && <KnowledgePanel />}
      {tab === "devices" && <DevicesPanel />}
      {tab === "twins" && <TwinsPanel />}
      {tab === "robots" && <RobotsPanel />}
      {tab === "automations" && <AutomationsPanel />}
      {tab === "workspaces" && <WorkspacesPanel />}
      {tab === "tools" && <ToolsPanel />}
      {tab === "browser" && <BrowserPanel />}

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

// ---- subsystem panels (each talks only to its real API; empty states are honest) ----------------
const J = (r: Response) => r.json();
const post = (url: string, body: unknown, method = "POST") => fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(J);
function Pre({ v }: { v: unknown }) { return v === undefined || v === null ? null : <pre className="cc-pre">{typeof v === "string" ? v : JSON.stringify(v, null, 2)}</pre>; }
function usePoll<T>(url: string, ms = 8000): [T | null, () => void] { const [v, setV] = useState<T | null>(null); const load = useCallback(() => fetch(url).then(J).then(setV).catch(() => undefined), [url]); useEffect(() => { load(); const t = setInterval(load, ms); return () => clearInterval(t); }, [load, ms]); return [v, load]; }
async function confirmToken(capabilityId: string): Promise<string | undefined> { if (!window.confirm(`Confirm: allow Aetheris to run "${capabilityId}" once?`)) return undefined; const j = await post("/api/permissions", { capabilityId, issue: true }); return j?.token; }

function JobsPanel() {
  const [data, reload] = usePoll<{ jobs: { id: string; title: string; status: string; createdAt: number; used: { modelCalls: number; chars: number; agents: string[] }; output: string }[]; summary?: unknown }>("/api/jobs", 4000);
  const [task, setTask] = useState("Summarise the three most important risks in deploying an ESP32 fleet over MQTT and propose mitigations.");
  const [out, setOut] = useState<unknown>();
  const submit = async () => { setOut(await post("/api/jobs", { task })); reload(); };
  return <div className="study-summary"><b>Agent runtime — jobs</b><p className="hint" style={{ textAlign: "left", margin: 0 }}>Budgeted, checkpointed, cancellable jobs run by the Hermes orchestrator. Each row is a real job record.</p>
    <div className="row" style={{ gap: 8 }}><input className="agent-search" value={task} onChange={(e) => setTask(e.target.value)} /><button className="send" onClick={submit}>Submit</button></div><Pre v={out} />
    <div className="study-cards">{(data?.jobs ?? []).length === 0 && <div className="hint">No jobs yet.</div>}{(data?.jobs ?? []).map((j) => <div key={j.id} className={`study-row ${j.status === "done" ? "stage-mature" : j.status === "running" || j.status === "queued" ? "" : "stage-learning"}`} style={{ gridTemplateColumns: "70px minmax(0,1fr) auto auto" }}><span className="meta">{fmtAge(j.createdAt)}</span><div className="study-row-main"><b>{j.title}</b><div className="hint" style={{ textAlign: "left", margin: 0 }}>{(j.output ?? "").slice(0, 160)}</div></div><span className="meta">{j.status} · {j.used.modelCalls} calls · {j.used.agents.join(",") || "—"}</span><span className="row" style={{ gap: 4 }}>{(j.status === "running" || j.status === "queued") && <button className="chip" onClick={() => fetch(`/api/jobs/${j.id}`, { method: "DELETE" }).then(reload)}>cancel</button>}<button className="chip" onClick={() => post(`/api/jobs/${j.id}`, {}).then(reload)}>retry</button></span></div>)}</div></div>;
}
function ExecPanel() {
  const [st] = usePoll<Record<string, unknown>>("/api/executions", 30000);
  const [cmd, setCmd] = useState("python3 -c 'print(sum(range(10)))'"); const [out, setOut] = useState<unknown>();
  const run = async () => { const token = await confirmToken("execution:server-sandbox"); setOut(await post("/api/executions", { command: cmd, confirmationToken: token })); };
  return <div className="study-summary"><b>Sandboxed execution</b><p className="hint" style={{ textAlign: "left", margin: 0 }}>Allow-listed binaries, scrubbed env, temp workspace, timeout, network isolation when the host supports <code>unshare</code>. Needs full_workspace confirmation (issued on click).</p><Pre v={st} />
    <div className="row" style={{ gap: 8 }}><input className="agent-search" value={cmd} onChange={(e) => setCmd(e.target.value)} /><button className="send" onClick={run}>Run</button></div><Pre v={out} /></div>;
}
function McpPanel() {
  const [data, reload] = usePoll<{ servers: { id: string; name: string; url: string; enabled: boolean; health: { state: string; latencyMs?: number; lastError?: string }; manifest?: { tools: { name: string; permission: string; requiresConfirmation: boolean }[] }; versions: unknown[] }[]; summary: unknown }>("/api/mcp/servers", 15000);
  const [url, setUrl] = useState("https://mcp.deepwiki.com/mcp"); const [name, setName] = useState(""); const [out, setOut] = useState<unknown>();
  return <div className="study-summary"><b>MCP gateway — your servers</b><p className="hint" style={{ textAlign: "left", margin: 0 }}>Register any Streamable-HTTP MCP server. Aetheris probes it, stores the manifest, classifies tool permissions, tracks health and versions. The 110-connector catalog lives in Apps.</p>
    <div className="row" style={{ gap: 8 }}><input className="agent-search" placeholder="https://host/mcp" value={url} onChange={(e) => setUrl(e.target.value)} /><input className="agent-search" style={{ maxWidth: 160 }} placeholder="name" value={name} onChange={(e) => setName(e.target.value)} /><button className="send" onClick={async () => { setOut(await post("/api/mcp/servers", { url, name: name || undefined })); reload(); }}>Add</button></div><Pre v={out} />
    <div className="study-cards">{(data?.servers ?? []).length === 0 && <div className="hint">No servers registered.</div>}{(data?.servers ?? []).map((s) => <div key={s.id} className={`study-row ${s.health.state === "healthy" ? "stage-mature" : "stage-learning"}`} style={{ gridTemplateColumns: "90px minmax(0,1fr) auto" }}><span className={`st st-${s.health.state === "healthy" ? "implemented" : s.health.state === "degraded" ? "partial" : "not_available"}`}>{s.health.state}</span><div className="study-row-main"><b>{s.name}</b> <code className="meta">{s.url}</code><div className="hint" style={{ textAlign: "left", margin: 0 }}>{s.manifest ? `${s.manifest.tools.length} tools · ${s.manifest.tools.filter((t) => t.requiresConfirmation).length} need confirmation · ${s.versions.length} versions` : s.health.lastError}</div></div><span className="row" style={{ gap: 4 }}><button className="chip" onClick={() => post(`/api/mcp/servers/${s.id}`, {}).then(reload)}>probe</button><button className="chip" onClick={() => fetch(`/api/mcp/servers/${s.id}`, { method: "DELETE" }).then(reload)}>remove</button></span></div>)}</div></div>;
}
function KnowledgePanel() {
  const [q, setQ] = useState(""); const [text, setText] = useState(""); const [res, setRes] = useState<unknown>(); const [st] = usePoll<{ status: unknown; facts: { id: string; text: string; provenance: { kind: string; confidence: number }; createdAt: number; tags: string[] }[] }>("/api/knowledge?limit=30", 15000);
  const [mem] = usePoll<{ items: { id: string; type: string; text: string; confidence: number }[]; summary: unknown }>("/api/memory", 15000);
  return <div className="study-summary"><b>Knowledge fabric + typed memory</b><p className="hint" style={{ textAlign: "left", margin: 0 }}>SQLite FTS5 keyword + vector + entity graph + temporal validity, provenance on every fact. Auto-recalled into chat.</p><Pre v={st?.status} />
    <div className="row" style={{ gap: 8 }}><input className="agent-search" placeholder="Add a fact (e.g. The boiler ESP32 lives in Plant 2)" value={text} onChange={(e) => setText(e.target.value)} /><button className="chip on" onClick={async () => { setRes(await post("/api/knowledge", { text })); setText(""); }}>Add fact</button><button className="chip" onClick={async () => { setRes(await post("/api/memory", { type: "semantic", text })); setText(""); }}>Remember</button></div>
    <div className="row" style={{ gap: 8 }}><input className="agent-search" placeholder="Hybrid query…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter") setRes(await fetch(`/api/knowledge?q=${encodeURIComponent(q)}`).then(J)); }} /><button className="send" onClick={async () => setRes(await fetch(`/api/knowledge?q=${encodeURIComponent(q)}`).then(J))}>Query</button></div><Pre v={res} />
    <div className="study-grid"><div className="study-summary"><b>Recent facts</b>{(st?.facts ?? []).map((f) => <div key={f.id} className="row" style={{ justifyContent: "space-between", gap: 8 }}><span>{f.text.slice(0, 90)}</span><span className="meta">{f.provenance.kind} {Math.round(f.provenance.confidence * 100)}%</span></div>)}{!st?.facts?.length && <span className="hint">empty</span>}</div><div className="study-summary"><b>Memory</b>{(mem?.items ?? []).slice(0, 20).map((m) => <div key={m.id} className="row" style={{ justifyContent: "space-between", gap: 8 }}><span>{m.text.slice(0, 90)}</span><span className="meta">{m.type}</span></div>)}{!mem?.items?.length && <span className="hint">empty</span>}</div></div></div>;
}
function DevicesPanel() {
  const [data, reload] = usePoll<{ devices: { id: string; name: string; adapter: string; address: string; health: { state: string; lastError?: string; latencyMs?: number }; latched: boolean; capabilities: { id: string; kind: string }[] }[]; summary: unknown }>("/api/devices", 8000);
  const [optin] = usePoll<{ physical: boolean; acknowledgement: string }>("/api/devices/optin", 30000);
  const [form, setForm] = useState({ name: "demo-sim", adapter: "simulated", address: "sim", caps: "level:sensor,pump:actuator" }); const [out, setOut] = useState<unknown>();
  const add = async () => { const capabilities = form.caps.split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const [id, kind] = s.split(":"); return { id, kind: kind === "actuator" ? "actuator" : "sensor", limits: kind === "actuator" ? { min: 0, max: 100 } : undefined }; }); setOut(await post("/api/devices", { ...form, capabilities, stopCommand: capabilities.find((c) => c.kind === "actuator") ? { capability: capabilities.find((c) => c.kind === "actuator")!.id, value: 0 } : undefined })); reload(); };
  const act = async (id: string, cap: string) => { const v = Number(prompt(`Value for ${cap}`, "1")); if (Number.isNaN(v)) return; const token = await confirmToken(`device:${id}.${cap}`); setOut(await post(`/api/devices/${id}`, { op: "actuate", capability: cap, value: v, confirmationToken: token })); reload(); };
  return <div className="study-summary"><b>Physical AI — devices</b><p className="hint" style={{ textAlign: "left", margin: 0 }}>Adapters: http · mqtt · modbus (verified against protocol mocks, not real hardware from this host) · simulated (labelled). Actuation runs through the safety loop and needs the <code>physical</code> grant, which is opt-in only.</p>
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}><span className={`chip ${optin?.physical ? "on" : ""}`}>physical grant: {optin?.physical ? "on" : "off"}</span>{optin && !optin.physical && <button className="chip" onClick={() => post("/api/devices/optin", { acknowledge: optin.acknowledgement }).then(() => reload())}>Opt in (I accept responsibility)</button>}{optin?.physical && <button className="chip" onClick={() => fetch("/api/devices/optin", { method: "DELETE" }).then(() => reload())}>Revoke</button>}</div>
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}><input className="agent-search" style={{ maxWidth: 140 }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="name" /><select className="agent-search" style={{ maxWidth: 130 }} value={form.adapter} onChange={(e) => setForm({ ...form, adapter: e.target.value })}>{["http", "mqtt", "modbus", "simulated", "serial", "opcua", "can"].map((a) => <option key={a}>{a}</option>)}</select><input className="agent-search" style={{ maxWidth: 220 }} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="http://esp32.local | broker:1883 | plc:502" /><input className="agent-search" value={form.caps} onChange={(e) => setForm({ ...form, caps: e.target.value })} placeholder="id:sensor, id:actuator" /><button className="send" onClick={add}>Register</button></div><Pre v={out} />
    <div className="study-cards">{(data?.devices ?? []).length === 0 && <div className="hint">No devices.</div>}{(data?.devices ?? []).map((d) => <div key={d.id} className={`study-row ${d.health.state === "online" ? "stage-mature" : "stage-learning"}`} style={{ gridTemplateColumns: "80px minmax(0,1fr) auto" }}><span className={`st st-${d.health.state === "online" ? "implemented" : d.health.state === "error" ? "not_available" : "partial"}`}>{d.latched ? "E-STOP" : d.health.state}</span><div className="study-row-main"><b>{d.name}</b> <code className="meta">{d.adapter} {d.address}</code><div className="hint" style={{ textAlign: "left", margin: 0 }}>{d.health.lastError ?? d.capabilities.map((c) => `${c.id}(${c.kind[0]})`).join(" ")}</div></div><span className="row" style={{ gap: 4, flexWrap: "wrap" }}><button className="chip" onClick={() => post(`/api/devices/${d.id}`, { op: "read" }).then((j) => { setOut(j); reload(); })}>read</button>{d.capabilities.filter((c) => c.kind === "actuator").map((c) => <button key={c.id} className="chip" onClick={() => act(d.id, c.id)}>set {c.id}</button>)}<button className="chip bad" onClick={() => post(`/api/devices/${d.id}`, { op: "estop" }).then((j) => { setOut(j); reload(); })}>E-STOP</button>{d.latched && <button className="chip" onClick={async () => { const token = await confirmToken(`device:${d.id}.reset`); setOut(await post(`/api/devices/${d.id}`, { op: "reset", confirmationToken: token })); reload(); }}>reset</button>}<button className="chip" onClick={() => fetch(`/api/devices/${d.id}`, { method: "DELETE" }).then(reload)}>remove</button></span></div>)}</div></div>;
}
function TwinsPanel() {
  const [data, reload] = usePoll<{ twins: { id: string; name: string; kind: string; state: Record<string, unknown>; health: { score: number; stale: boolean; breaches: { detail: string }[] }; deviceIds: string[] }[] }>("/api/twins", 10000);
  const [out, setOut] = useState<unknown>(); const [name, setName] = useState("boiler-1");
  const create = async () => { setOut(await post("/api/twins", { name, kind: "boiler", state: { temp: 60, valve: 0 }, bounds: [{ key: "temp", max: 90, unit: "°C", critical: true }], rules: [{ target: "temp", expr: "temp + 0.4*valve*dt/60 - 0.05*(temp-20)", description: "first-order heating" }], stepSeconds: 60 })); reload(); };
  const sim = async (id: string) => { const v = Number(prompt("Proposed valve %", "100")); setOut(await post(`/api/twins/${id}`, { op: "simulate", proposed: { valve: v }, steps: 30 })); };
  return <div className="study-summary"><b>Digital twins</b><p className="hint" style={{ textAlign: "left", margin: 0 }}>Twins sync from device telemetry and let agents simulate an actuation before doing it (rule DSL, no eval). Health = staleness + bound breaches + overdue maintenance.</p>
    <div className="row" style={{ gap: 8 }}><input className="agent-search" style={{ maxWidth: 200 }} value={name} onChange={(e) => setName(e.target.value)} /><button className="send" onClick={create}>Create example twin</button></div><Pre v={out} />
    <div className="study-cards">{(data?.twins ?? []).length === 0 && <div className="hint">No twins.</div>}{(data?.twins ?? []).map((t) => <div key={t.id} className={`study-row ${t.health.score >= 70 ? "stage-mature" : "stage-learning"}`} style={{ gridTemplateColumns: "70px minmax(0,1fr) auto" }}><b>{t.health.score}</b><div className="study-row-main"><b>{t.name}</b> <span className="meta">{t.kind} · {t.deviceIds.length} devices{t.health.stale ? " · stale" : ""}</span><div className="hint" style={{ textAlign: "left", margin: 0 }}>{JSON.stringify(t.state).slice(0, 140)} {t.health.breaches.map((b) => b.detail).join("; ")}</div></div><span className="row" style={{ gap: 4 }}><button className="chip" onClick={() => post(`/api/twins/${t.id}`, { op: "sync" }).then((j) => { setOut(j); reload(); })}>sync</button><button className="chip" onClick={() => sim(t.id)}>simulate</button><button className="chip" onClick={() => fetch(`/api/twins/${t.id}`, { method: "DELETE" }).then(reload)}>remove</button></span></div>)}</div></div>;
}
function WorkspacesPanel() {
  type W = { id: string; name: string; tags: string[]; archived?: boolean; stats: { scope: string; facts: number; memories: number; jobs: number; runningJobs: number } };
  const [data, reload] = usePoll<{ workspaces: W[] }>("/api/workspaces", 15000);
  const [name, setName] = useState(""); const [out, setOut] = useState<unknown>();
  return <div className="study-summary"><b>Workspaces</b><p className="hint" style={{ textAlign: "left", margin: 0 }}>A workspace is a scope: knowledge facts, memories, jobs and automations created with its scope key stay together. Counts are computed from the stores, not estimated.</p>
    <div className="row" style={{ gap: 8 }}><input className="agent-search" style={{ maxWidth: 240 }} placeholder="New workspace name" value={name} onChange={(e) => setName(e.target.value)} /><button className="send" disabled={!name.trim()} onClick={async () => { setOut(await post("/api/workspaces", { name })); setName(""); reload(); }}>Create</button></div><Pre v={out} />
    <div className="study-cards">{(data?.workspaces ?? []).map((w) => <div key={w.id} className="study-row" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}><div className="study-row-main"><b>{w.name}</b> <span className="meta">scope <code>{w.stats.scope}</code>{w.archived ? " · archived" : ""}</span><div className="hint" style={{ textAlign: "left", margin: 0 }}>{w.stats.facts} facts · {w.stats.memories} memories · {w.stats.jobs} jobs ({w.stats.runningJobs} running)</div></div><span className="row" style={{ gap: 4 }}><button className="chip" onClick={() => fetch(`/api/workspaces/${encodeURIComponent(w.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: !w.archived }) }).then(reload)}>{w.archived ? "unarchive" : "archive"}</button>{w.stats.scope !== "default" && <button className="chip" onClick={() => fetch(`/api/workspaces/${encodeURIComponent(w.id)}`, { method: "DELETE" }).then(reload)}>remove</button>}</span></div>)}</div></div>;
}
function ToolsPanel() {
  type T = { id: string; name: string; category: string; status: string; security_level: string; requires_confirmation: boolean; invoke: { method: string; path: string } };
  const [q, setQ] = useState(""); const [data, setData] = useState<{ count: number; tools: T[] }>();
  const search = async () => setData(await fetch(`/api/tools?q=${encodeURIComponent(q)}&limit=60`).then(J));
  return <div className="study-summary"><b>Tools — callable view of the registry</b><p className="hint" style={{ textAlign: "left", margin: 0 }}>Every tool, connector and sandbox with its permission level and the exact endpoint that invokes it. Status labels are the registry&apos;s honest labels.</p>
    <div className="row" style={{ gap: 8 }}><input className="agent-search" placeholder="search tools (e.g. send message, sql, scrape)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} /><button className="send" onClick={search}>Search</button></div>
    <div className="study-cards">{data && data.tools.length === 0 && <div className="hint">No matches.</div>}{(data?.tools ?? []).map((t) => <div key={t.id} className="study-row" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}><div className="study-row-main"><b>{t.name}</b> <span className="meta">{t.category} · {STATUS_LABEL[t.status] ?? t.status} · {t.security_level}{t.requires_confirmation ? " · confirm" : ""}</span><div className="hint" style={{ textAlign: "left", margin: 0 }}><code>{t.id}</code> → {t.invoke.method} {t.invoke.path}</div></div></div>)}</div></div>;
}
function RobotsPanel() {
  const [url, setUrl] = useState("ws://localhost:9090"); const [out, setOut] = useState<unknown>(); const [v, setV] = useState({ linear: 0.2, angular: 0 });
  return <div className="study-summary"><b>Robotics — ROS 2 via rosbridge</b><p className="hint" style={{ textAlign: "left", margin: 0 }}>Point at a rosbridge WebSocket (real robot or Gazebo/Webots sim). Nothing is simulated here: inspect opens a live connection. Motion needs the physical grant + confirmation and is governed (clamps, geofence, watchdog).</p>
    <div className="row" style={{ gap: 8 }}><input className="agent-search" value={url} onChange={(e) => setUrl(e.target.value)} /><button className="send" onClick={async () => setOut(await fetch(`/api/robots?url=${encodeURIComponent(url)}`).then(J))}>Inspect</button></div>
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}><label className="meta">linear <input className="agent-search" style={{ width: 80 }} type="number" step="0.1" value={v.linear} onChange={(e) => setV({ ...v, linear: Number(e.target.value) })} /></label><label className="meta">angular <input className="agent-search" style={{ width: 80 }} type="number" step="0.1" value={v.angular} onChange={(e) => setV({ ...v, angular: Number(e.target.value) })} /></label><button className="chip" onClick={async () => setOut(await post("/api/robots", { op: "govern", ...v }))}>Dry-run governor</button><button className="chip on" onClick={async () => { const token = await confirmToken("robot:move"); setOut(await post("/api/robots", { op: "move", url, ...v, durationMs: 1000, confirmationToken: token })); }}>Move 1 s</button><button className="chip bad" onClick={async () => setOut(await post("/api/robots", { op: "estop", url }))}>E-STOP</button></div><Pre v={out} /></div>;
}
function AutomationsPanel() {
  const [data, reload] = usePoll<{ automations: { id: string; name: string; enabled: boolean; trigger: { kind: string }; actions: { kind: string }[]; lastStatus?: string; runs: number; nextAt?: number | null }[]; runs: { id: string; automationId: string; startedAt: number; status: string; trigger: string; stages: { stage: string; ok: boolean; detail?: string }[] }[] }>("/api/automations", 8000);
  const [out, setOut] = useState<unknown>();
  const example = async () => { setOut(await post("/api/automations", { name: "Remember webhook payloads", trigger: { kind: "webhook" }, condition: { kind: "always" }, verify: { kind: "none" }, actions: [{ kind: "remember", type: "episodic", template: "Webhook event: {{event}} {{value}}" }] })); reload(); };
  return <div className="study-summary"><b>Automations — trigger → condition → agent → verify → action</b><p className="hint" style={{ textAlign: "left", margin: 0 }}>Triggers: cron, webhook, device threshold, twin health, job finished, manual. Verification (expression or model rubric) gates every action. Device actuation additionally needs the physical grant and a stored confirmation.</p>
    <div className="row" style={{ gap: 8 }}><button className="send" onClick={example}>Create example (webhook → remember)</button></div><Pre v={out} />
    <div className="study-cards">{(data?.automations ?? []).length === 0 && <div className="hint">No automations.</div>}{(data?.automations ?? []).map((a) => <div key={a.id} className={`study-row ${a.lastStatus === "ok" ? "stage-mature" : ""}`} style={{ gridTemplateColumns: "90px minmax(0,1fr) auto" }}><span className="meta">{a.trigger.kind}</span><div className="study-row-main"><b>{a.name}</b> <span className="meta">{a.enabled ? "on" : "off"} · {a.runs} runs · last {a.lastStatus ?? "—"}{a.nextAt ? ` · next ${fmtAge(a.nextAt).replace(/^-/, "in ")}` : ""}</span><div className="hint" style={{ textAlign: "left", margin: 0 }}>{a.actions.map((x) => x.kind).join(" → ")}</div></div><span className="row" style={{ gap: 4 }}><button className="chip" onClick={() => post(`/api/automations/${a.id}`, { payload: { event: "manual", value: Date.now() % 100 } }).then((j) => { setOut(j); reload(); })}>run</button><button className="chip" onClick={() => fetch(`/api/automations/${a.id}`).then(J).then(setOut)}>details</button><button className="chip" onClick={() => fetch(`/api/automations/${a.id}`, { method: "DELETE" }).then(reload)}>remove</button></span></div>)}</div>
    {!!data?.runs?.length && <div className="study-summary"><b>Recent runs</b>{data.runs.slice(0, 15).map((r) => <div key={r.id} className="row" style={{ justifyContent: "space-between", gap: 8 }}><span className="meta">{fmtAge(r.startedAt)} · {r.trigger}</span><span>{r.stages.map((s) => `${s.stage}${s.ok ? "✓" : "✗"}`).join(" ")}</span><b>{r.status}</b></div>)}</div>}</div>;
}
function BrowserPanel() {
  const [st] = usePoll<Record<string, unknown>>("/api/browser", 60000);
  const [goal, setGoal] = useState("Find the latest release version and its date"); const [url, setUrl] = useState("https://github.com/rajaram-2005/Aetheris/releases"); const [out, setOut] = useState<unknown>(); const [busy, setBusy] = useState(false);
  return <div className="study-summary"><b>Browser agent</b><p className="hint" style={{ textAlign: "left", margin: 0 }}>Goal-driven navigation over a page snapshot. http engine = static HTML (no JS); playwright is used only if installed on the server. Private networks are never browsed; form submission needs confirmation.</p><Pre v={st} />
    <div className="row" style={{ gap: 8 }}><input className="agent-search" value={url} onChange={(e) => setUrl(e.target.value)} /><input className="agent-search" value={goal} onChange={(e) => setGoal(e.target.value)} /><button className="send" disabled={busy} onClick={async () => { setBusy(true); try { setOut(await post("/api/browser", { goal, startUrl: url, maxSteps: 6 })); } finally { setBusy(false); } }}>{busy ? "…" : "Browse"}</button></div><Pre v={out} /></div>;
}

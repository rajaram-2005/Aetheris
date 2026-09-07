"use client";

/**
 * RAVANA — Aetheris Core #1 workspace (spec §21–24).
 *
 * Default experience: objective → RAVANA classifies, plans (DAG), routes by role, uses tools,
 * verifies and corrects — shown as an execution trace, never as hidden chain-of-thought.
 * Tabs: Tasks · Dashboard · Memory.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown } from "./markdown";

type Status = "queued" | "planning" | "running" | "awaiting_confirmation" | "completed" | "failed" | "cancelled" | "timeout";
type Engine = "auto" | "mesh" | "preview";

interface EventT {
  seq: number;
  at: number;
  type: string;
  payload?: Record<string, unknown>;
}
interface NodeT { id: string; description: string; type: string; priority: string; dependencies: string[]; tools: string[]; status: string; attempts: number; output?: string; note?: string }
interface TaskT {
  id: string; title: string; objective: string; kind: string; kindReason: string; priority: string;
  status: Status; engine: Engine; engineResolved?: string; createdAt: number; startedAt?: number; finishedAt?: number;
  plan: NodeT[]; events: EventT[]; error?: string;
  verification?: { strategy: string; status: string; score?: number; findings: { severity: string; text: string }[]; detail?: string; reviewer?: { provider?: string; model?: string } | null; independent?: boolean };
  result?: { type: string; content: string; files?: Record<string, string> };
  summary?: { engine: string; engineLabel: string; modelsUsed: { role: string; provider: string; model: string; calls: number }[]; toolsUsed: { name: string; calls: number; ok: number; failed: number }[]; ms?: number; replans: number; steps: number };
  pendingTool?: { name: string; args: Record<string, unknown>; reason: string; token?: string } | null;
}
interface MemoryT { id: string; type: string; content: string; tags: string[]; importance: number; createdAt: number; projectId?: string | null }
interface StatsT { tasks: { total: number; byStatus: Record<string, number>; completed: number; failed: number; successRate: number | null; live: number; avgLatencyMs: number | null; modelCalls: number }; memory: { byType: Record<string, number>; total: number }; models: { available: number; roles: { role: string; description: string; status: string; primary?: { provider: string; model: string; locality: string } | null }[] }; tools: { available: number; tools: { name: string; description: string; category: string; permission: string; requiresConfirmation: boolean; status: string; note?: string }[] }; subsystemStatus: Record<string, { name: string; status: string; note?: string }> }

const STATUS_ICON: Record<string, string> = { queued: "⏳", planning: "🧭", running: "⚙️", awaiting_confirmation: "🛂", completed: "✅", failed: "❌", cancelled: "⏹", timeout: "⌛" };
const NODE_ICON: Record<string, string> = { understand: "🔍", research: "🔬", reason: "🧠", code: "💻", synthesize: "📦", verify: "🧪" };
const KIND_LABEL: Record<string, string> = { chat: "Chat", analysis: "Analysis", research: "Research", coding: "Coding", math: "Math", vision: "Vision", build: "Build" };
const SUGGESTIONS = [
  "Explain why the sky is blue — one short paragraph",
  "Write a Python function that validates Indian UPI ids, with tests",
  "Compare local vs cloud LLM inference for a privacy-first assistant",
  "Plan a predictive-maintenance pipeline for a factory motor",
];
const EVENT_ICON: Record<string, string> = {
  "task.created": "🆕", "engine.selected": "⚙️", "task.planned": "🗺️", "task.started": "▶️", "model.selected": "🎯", "tool.requested": "🧰",
  "tool.started": "🔧", "tool.completed": "✅", "memory.retrieved": "🧠", "memory.saved": "💾", "reasoning.completed": "✍️",
  "verification.started": "🧪", "verification.completed": "🔬", "task.replanned": "🔁", "task.awaiting_confirmation": "🛂",
  "task.resumed": "▶️", "node.passed": "✅", "node.failed": "❌", "task.completed": "🏁", "task.failed": "⛔", "task.cancelled": "⏹", note: "📝",
};

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}
const publicTask = (t: TaskT) => ({ ...t });

function when(ms: number): string {
  if (!ms) return "—";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}
function dur(ms?: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function Ravana({ onAsk }: { onAsk?: (q: string) => void }) {
  const [tab, setTab] = useState<"tasks" | "dash" | "memory">("tasks");
  return (
    <div className="rv-wrap">
      <div className="rv-tabs">
        {(["tasks", "dash", "memory"] as const).map((t) => (
          <button key={t} className={`rv-tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>{t === "tasks" ? "⚡ Tasks" : t === "dash" ? "📊 Dashboard" : "🧠 Memory"}</button>
        ))}
        <span className="rv-online">RAVANA <i className="dot" /> ONLINE</span>
      </div>
      {tab === "tasks" && <TasksView onAsk={onAsk} />}
      {tab === "dash" && <DashView />}
      {tab === "memory" && <MemoryView />}
    </div>
  );
}

// ------------------------------------------------------------------ TASKS

function TasksView({ onAsk }: { onAsk?: (q: string) => void }) {
  const [tasks, setTasks] = useState<TaskT[] | null>(null);
  const [selected, setSelected] = useState<TaskT | null>(null);
  const [objective, setObjective] = useState("");
  const [engine, setEngine] = useState<Engine>("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await j<{ tasks: TaskT[] }>("/api/v1/ravana/tasks?limit=40");
      setTasks(res.tasks);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const iv = setInterval(() => void refresh(), 5000); return () => clearInterval(iv); }, [refresh]);

  const run = async (text?: string) => {
    const q = (text ?? objective).trim();
    if (!q || busy) return;
    setBusy(true); setError("");
    try {
      const res = await j<{ task: TaskT }>("/api/v1/ravana/chat", { method: "POST", body: JSON.stringify({ message: q, engine, auto_start: true }) });
      setObjective("");
      setSelected(publicTask(res.task));
      void refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const pick = async (id: string) => {
    try {
      const res = await j<{ task: TaskT }>(`/api/v1/ravana/tasks/${id}`);
      setSelected(publicTask(res.task));
    } catch { /* task list still shows it */ }
  };

  const visible = useMemo(() => {
    if (!tasks) return null;
    const f = filter;
    return f ? tasks.filter((t) => t.status === f) : tasks;
  }, [tasks, filter]);

  return (
    <div className="rv-main">
      <aside className="rv-side">
        <div className="rv-composer">
          <h4>What do you want to accomplish?</h4>
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void run(); }}
            placeholder="Build my predictive-maintenance pipeline…"
            rows={3}
          />
          <div className="rv-composer-row">
            <select value={engine} onChange={(e) => setEngine(e.target.value as Engine)} title="auto = model mesh when a provider is configured, otherwise the labelled preview responder">
              <option value="auto">Engine: auto</option>
              <option value="mesh">Engine: model mesh</option>
              <option value="preview">Engine: preview (no model calls)</option>
            </select>
            <button className="rv-run" disabled={busy || !objective.trim()} onClick={() => void run()}>{busy ? "Starting…" : "▶ Run"}</button>
          </div>
          <div className="rv-sug">
            {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => void run(s)} title={s}>{s.slice(0, 52)}…</button>)}
          </div>
          {error && <div className="rv-error">{error}</div>}
        </div>
        <div className="rv-list">
          <div className="rv-list-head">
            <b>Tasks</b>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">all</option>
              {["running", "awaiting_confirmation", "queued", "completed", "failed"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select>
          </div>
          {visible === null && <div className="sb-empty">Loading tasks…</div>}
          {visible !== null && visible.length === 0 && <div className="sb-empty">No tasks yet — describe a goal above.</div>}
          {visible?.map((t) => (
            <button key={t.id} className={`rv-item ${selected?.id === t.id ? "active" : ""}`} onClick={() => void pick(t.id)}>
              <span className="rv-item-ico">{STATUS_ICON[t.status] ?? "·"}</span>
              <span className="rv-item-body">
                <b>{t.title}</b>
                <small>{KIND_LABEL[t.kind] ?? t.kind} · {t.engineResolved === "preview" ? "preview" : t.engine} · {when(t.createdAt)}</small>
                {t.status === "awaiting_confirmation" && <small className="rv-warnline">🛂 confirmation needed</small>}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className="rv-stage">{selected ? <TaskDetail key={selected.id} task={selected} onGone={refresh} onAsk={onAsk} /> : <div className="rv-empty">Select a task to watch RAVANA work — plan graph, live execution trace, verification and result.</div>}</section>
    </div>
  );
}

// ------------------------------------------------------------------ TASK DETAIL + LIVE STREAM

function TaskDetail({ task: initial, onGone, onAsk }: { task: TaskT; onGone: () => void; onAsk?: (q: string) => void }) {
  const [task, setTask] = useState<TaskT>(initial);
  const live = ["queued", "planning", "running", "awaiting_confirmation"].includes(task.status);
  const streamRef = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const traceRef = useRef<HTMLDivElement>(null);

  // SSE live trace
  useEffect(() => {
    if (!live || streamRef.current) return;
    streamRef.current = true;
    const ctrl = new AbortController();
    let buf = "";
    void (async () => {
      try {
        const res = await fetch(`/api/v1/ravana/tasks/${task.id}/stream`, { signal: ctrl.signal });
        if (!res.body) return;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, i); buf = buf.slice(i + 2);
            for (const line of frame.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              try {
                const msg = JSON.parse(line.slice(6));
                if (msg.task) setTask(publicTask(msg.task));
              } catch { /* partial */ }
            }
          }
        }
      } catch { /* aborted */ }
    })();
    return () => { ctrl.abort(); streamRef.current = false; };
  }, [task.id, live]);

  useEffect(() => { traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight, behavior: "smooth" }); }, [task.events.length]);

  const approve = async (approve: boolean) => {
    setConfirming(true);
    try {
      const res = await j<{ task: TaskT }>(`/api/v1/ravana/tasks/${task.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ approve, ...(approve && task.pendingTool?.token ? { confirmation_token: task.pendingTool.token } : {}) }),
      });
      setTask(publicTask(res.task));
    } catch (e) { alert((e as Error).message); } finally { setConfirming(false); }
  };
  const cancel = async () => {
    setCancelling(true);
    try {
      const res = await j<{ task: TaskT }>(`/api/v1/ravana/tasks/${task.id}`, { method: "DELETE" });
      setTask(publicTask(res.task));
      onGone();
    } finally { setCancelling(false); }
  };
  const followUp = () => { onAsk?.(`Continue from RAVANA task ${task.id}: what are the next steps for "${task.title}"?`); };

  const recent = task.events.slice(-120);
  return (
    <div className="rv-detail">
      <div className="rv-detail-head">
        <div>
          <div className="rv-kicker">RAVANA / TASK {task.id}</div>
          <h3>{task.title}</h3>
          <div className="rv-kinds"><span className="chip">{KIND_LABEL[task.kind]} · {task.kindReason}</span>
            <span className="chip">{task.engineResolved === "preview" ? "⚡ preview responder" : "⚙️ model mesh"}</span>
            <span className="chip">{STATUS_ICON[task.status]} {task.status.replace("_", " ")}</span>
            <span className="chip">prio {task.priority}</span>
          </div>
        </div>
        <div className="rv-head-actions">
          {["queued", "planning", "running", "awaiting_confirmation"].includes(task.status) && <button className="rv-danger" disabled={cancelling} onClick={() => void cancel()}>■ Stop</button>}
          {task.status === "completed" && onAsk && <button className="rv-run" onClick={followUp}>Continue in chat ↗</button>}
        </div>
      </div>

      {task.status === "awaiting_confirmation" && task.pendingTool && (
        <div className="rv-gate">
          <div><b>🛂 Tool confirmation required</b> — {task.pendingTool.reason}</div>
          <div className="rv-gate-tool">tool: <code>{task.pendingTool.name}</code> · args: <code>{JSON.stringify(task.pendingTool.args).slice(0, 300)}</code></div>
          <div className="rv-gate-btns">
            <button className="rv-run" disabled={confirming} onClick={() => void approve(true)}>✓ Allow once</button>
            <button className="rv-danger" disabled={confirming} onClick={() => void approve(false)}>✕ Deny</button>
          </div>
        </div>
      )}
      {task.error && <div className="rv-error">{task.error}</div>}

      <div className="rv-cols">
        {/* PLAN + TRACE */}
        <div className="rv-tracecol">
          <div className="rv-card">
            <div className="rv-card-title">Objective</div>
            <div className="rv-objective">{task.objective}</div>
            {task.plan.length > 0 && (
              <div className="rv-plan">
                {task.plan.map((n) => (
                  <div key={n.id} className={`rv-node rv-node-${n.status}`} title={`${n.id} · ${n.type} · depends on ${n.dependencies.join(", ") || "nothing"}`}>
                    <span className="rv-node-ico">{n.status === "passed" ? "✓" : n.status === "running" ? "●" : n.status === "failed" ? "✕" : n.status === "skipped" ? "–" : "○"}</span>
                    <span className="rv-node-body">
                      <b>{NODE_ICON[n.type] ?? "•"} {n.description}</b>
                      {n.note && <small>{n.note}</small>}
                      {n.status === "failed" && n.attempts > 0 && <small className="rv-warnline">after {n.attempts} attempt(s)</small>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rv-card rv-trace">
            <div className="rv-card-title">Live execution trace {live && <span className="rv-pulse" />}</div>
            <div className="rv-trace-feed" ref={traceRef}>
              {recent.length === 0 && <div className="sb-empty">Waiting for the engine…</div>}
              {recent.map((e) => (
                <TraceLine key={e.seq} e={e} />
              ))}
            </div>
          </div>
        </div>

        {/* RESULT + VERIFICATION */}
        <div className="rv-rescol">
          {task.result && (
            <div className="rv-card rv-result">
              <div className="rv-card-title">Result <span className="chip">{task.result.type}</span></div>
              <div className="rv-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(task.result.content.slice(0, 60_000)) }} />
              {task.result.files && Object.keys(task.result.files).length > 0 && (
                <div className="rv-files">
                  <div className="rv-card-title">Artifacts</div>
                  {Object.entries(task.result.files).map(([name, body]) => (
                    <details key={name} open={Object.keys(task.result!.files!).length === 1}>
                      <summary><code>{name}</code> <span className="rv-len">{body.length.toLocaleString()} chars</span></summary>
                      <pre><code>{body.slice(0, 30_000)}</code></pre>
                    </details>
                  ))}
                </div>
              )}
            </div>
          )}
          {task.verification && (
            <div className="rv-card">
              <div className="rv-card-title">Verification</div>
              <div className="rv-vrow"><b>{task.verification.status === "passed" ? "✅" : task.verification.status === "failed" ? "❌" : "⚠️"} {task.verification.status.replaceAll("_", " ")}</b>
                <span className="chip">{task.verification.strategy}</span>
                {task.verification.score !== undefined && <span className="chip">score {task.verification.score}</span>}
              </div>
              {task.verification.reviewer?.provider && <div className="rv-muted">reviewed by {task.verification.reviewer.provider}/{task.verification.reviewer.model}{task.verification.independent === false ? " (same provider — independence unavailable)" : ""}</div>}
              {task.verification.detail && <div className="rv-muted">{task.verification.detail}</div>}
              {task.verification.findings.length > 0 && (
                <ul className="rv-findings">{task.verification.findings.slice(0, 8).map((f, i) => <li key={i} className={`rv-find-${f.severity}`}><b>{f.severity}</b> {f.text}</li>)}</ul>
              )}
            </div>
          )}
          {task.summary && (
            <div className="rv-card">
              <div className="rv-card-title">Execution</div>
              <div className="rv-meta">
                <div><span>engine</span><b>{task.summary.engineLabel}</b></div>
                <div><span>duration</span><b>{dur(task.summary.ms)}</b></div>
                <div><span>steps</span><b>{task.summary.steps}</b></div>
                <div><span>replans</span><b>{task.summary.replans}</b></div>
                {task.summary.modelsUsed.length > 0 && <div className="rv-meta-full"><span>models used</span>{task.summary.modelsUsed.map((m) => <b key={m.provider + m.model} className="chip">{m.provider}/{m.model} ×{m.calls}</b>)}</div>}
                {task.summary.toolsUsed.length > 0 && <div className="rv-meta-full"><span>tools used</span>{task.summary.toolsUsed.map((t) => <b key={t.name} className="chip">{t.name} ×{t.calls}</b>)}</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TraceLine({ e }: { e: EventT }) {
  const p = e.payload ?? {};
  let detail = "";
  if (e.type === "model.selected") detail = `${p.role} → ${p.provider}/${p.model}` + (p.purpose === "plan" ? " (plan)" : "");
  else if (e.type === "tool.completed") detail = `${p.tool} · ${p.ok === true ? "ok" : p.ok === false ? "failed" : ""} ${p.summary ?? ""}${p.error ? " · " + p.error : ""}`;
  else if (e.type === "tool.requested") detail = `${p.tool} ${p.allowed === false ? "· denied" : p.allowed === true ? "· allowed" : "· " + (p.permission ?? "")}${p.reason ? " · " + p.reason : ""}`;
  else if (e.type === "memory.retrieved") detail = `${p.hits ?? 0} hit(s) · layers ${Array.isArray(p.layers) ? p.layers.join(", ") : "persisted"}`;
  else if (e.type === "memory.saved") detail = `${p.type} · ${p.id}`;
  else if (e.type === "reasoning.completed") detail = `${p.chars ?? 0} chars · ${p.provider}`;
  else if (e.type === "verification.completed") detail = `${p.strategy} → ${p.status}${p.score !== undefined ? ` · ${p.score}` : ""}${p.node ? ` · ${p.node}` : p.scope === "final" ? " · final deliverable" : ""}${p.findings ? ` · ${p.findings} finding(s)` : ""}`;
  else if (e.type === "note") detail = `${p.node ?? ""} ${p.step ?? p.note ?? ""}`;
  else if (e.type === "task.planned") detail = `${p.nodes} nodes via ${p.via}${p.plannerModel ? " · " + p.plannerModel : ""}`;
  else if (e.type === "task.completed") detail = `${p.status} · ${p.verification ?? ""}`.trim();
  else if (e.type === "task.replanned") detail = `attempt ${p.attempt}: ${Array.isArray(p.failed) ? p.failed.join(", ") : ""}`;
  else if (e.type === "engine.selected") detail = p.label as string;
  else if (e.type === "task.awaiting_confirmation") detail = `${p.tool} — ${p.reason}`;
  else if (e.type === "task.resumed") detail = `${p.tool} ${p.approved ? "approved" : "denied"}`;
  else if (typeof p.summary === "string") detail = p.summary;
  const whenStr = new Date(e.at).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" });
  return (
    <div className={`rv-trace-line ${e.type}`}>
      <span className="rv-tl-ico">{EVENT_ICON[e.type] ?? "·"}</span>
      <span className="rv-tl-body">
        <b>{e.type.replaceAll(".", " ")}</b>
        {detail && <small>{detail}</small>}
      </span>
      <span className="rv-tl-time">{whenStr}</span>
    </div>
  );
}

// ------------------------------------------------------------------ DASHBOARD

function DashView() {
  const [stats, setStats] = useState<StatsT | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    j<StatsT>("/api/v1/ravana/stats").then(setStats).catch((e) => setError((e as Error).message));
  }, []);
  if (error) return <div className="rv-error">{error}</div>;
  if (!stats) return <div className="rv-empty">Loading dashboard…</div>;
  const t = stats.tasks;
  const cards = [
    { k: "Status", v: "● ONLINE", s: "RAVANA Core #1" },
    { k: "Active", v: String((t.byStatus.running ?? 0) + (t.byStatus.planning ?? 0) + (t.byStatus.awaiting_confirmation ?? 0)), s: "queued: " + (t.byStatus.queued ?? 0) },
    { k: "Completed", v: String(t.completed), s: "avg " + dur(t.avgLatencyMs ?? undefined) },
    { k: "Success rate", v: t.successRate === null ? "—" : t.successRate + "%", s: "failed: " + t.failed },
    { k: "Models", v: String(stats.models.available), s: "roles over the mesh" },
    { k: "Tools", v: String(stats.tools.available), s: "policy-gated" },
    { k: "Memory", v: String(stats.memory.total), s: `${stats.memory.byType.episodic ?? 0} episodic · ${stats.memory.byType.semantic ?? 0} semantic` },
    { k: "Model calls", v: String(t.modelCalls), s: "across " + t.total + " task(s)" },
  ];
  return (
    <div className="rv-dash">
      <div className="rv-dash-cards">{cards.map((c) => <div key={c.k} className="rv-stat"><span>{c.k}</span><b>{c.v}</b><small>{c.s}</small></div>)}</div>
      <div className="rv-card"><div className="rv-card-title">Subsystems</div>
        <div className="rv-subgrid">{Object.entries(stats.subsystemStatus).map(([k, s]) => (
          <div key={k} className="rv-sub"><b>{s.name}</b><span className={`rv-status-pill rv-${s.status}`}>{s.status}</span><small>{s.note}</small></div>
        ))}</div>
      </div>
      <div className="rv-card"><div className="rv-card-title">Model pool</div>
        <div className="rv-roles">{stats.models.roles.map((r) => (
          <div key={r.role} className="rv-role"><b>{r.role}</b><span>{r.description}</span>
            <span className={`rv-status-pill rv-${r.status}`}>{r.status === "configured" ? `→ ${r.primary?.provider}/${r.primary?.model}` : "not configured"}</span>
          </div>
        ))}</div>
      </div>
      <div className="rv-card"><div className="rv-card-title">Tool protocol</div>
        <table className="rv-table"><thead><tr><th>tool</th><th>category</th><th>permission</th><th>confirm</th><th>status</th></tr></thead>
          <tbody>{stats.tools.tools.map((tl) => (
            <tr key={tl.name}><td><code>{tl.name}</code></td><td>{tl.category}</td><td>{tl.permission}</td><td>{tl.requiresConfirmation ? "yes" : "no"}</td><td>{tl.status === "implemented" ? "implemented" : "not configured"}{tl.note ? ` · ${tl.note}` : ""}</td></tr>
          ))}</tbody></table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ MEMORY

function MemoryView() {
  const [memories, setMemories] = useState<MemoryT[] | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ memory: MemoryT; score: number; layer: string; reason: string }[] | null>(null);
  const [type, setType] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await j<{ memories: MemoryT[] }>(`/api/v1/ravana/memory?${type ? `type=${type}&` : ""}limit=100`);
      setMemories(res.memories);
    } catch { /* ignore */ }
  }, [type]);
  useEffect(() => { void load(); }, [load]);
  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const res = await j<{ hits: { memory: MemoryT; score: number; layer: string; reason: string }[] }>("/api/v1/ravana/memory/search", { method: "POST", body: JSON.stringify({ query: q, top_k: 10 }) });
      setHits(res.hits);
    } finally { setBusy(false); }
  };
  const del = async (id: string) => {
    await fetch(`/api/v1/ravana/memory/${id}`, { method: "DELETE" });
    void load();
    setHits((h) => h ? h.filter((x) => x.memory.id !== id) : h);
  };
  const list = hits ?? memories?.map((m) => ({ memory: m, score: 0, layer: "long_term", reason: "" })) ?? null;
  return (
    <div className="rv-memory">
      <div className="rv-card">
        <div className="rv-card-title">Retrieval (layers → metadata filter → rerank → compress)</div>
        <div className="rv-search-row">
          <input value={q} placeholder="Search what RAVANA remembers…" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />
          <button className="rv-run" disabled={busy || !q.trim()} onClick={() => void search()}>Search</button>
        </div>
        <div className="rv-filter-row">
          <select value={type} onChange={(e) => { setType(e.target.value); setHits(null); }}>
            <option value="">all types</option><option value="episodic">episodic</option><option value="semantic">semantic</option>
          </select>
          {hits && <button className="link" onClick={() => setHits(null)}>clear search</button>}
        </div>
      </div>
      <div className="rv-card">
        <div className="rv-card-title">{hits ? `Search hits (${hits.length})` : `Memories (${memories?.length ?? 0})`}</div>
        <div className="rv-mem-list">
          {list === null && <div className="sb-empty">Loading…</div>}
          {list?.length === 0 && <div className="sb-empty">Nothing stored yet — completed RAVANA tasks write episodic memories automatically.</div>}
          {list?.map(({ memory: m, score, layer, reason }) => (
            <div key={m.id} className="rv-mem">
              <div className="rv-mem-head">
                <span className={`chip chip-${m.type}`}>{m.type}</span>
                {score > 0 && <span className="chip">score {Math.round(score * 100) / 100} · {layer}</span>}
                <span className="rv-muted">{when(m.createdAt)} · imp {Math.round(m.importance * 100)}%</span>
                <button className="rv-x" title="forget" onClick={() => void del(m.id)}>🗑</button>
              </div>
              {reason && <small className="rv-muted">why: {reason}</small>}
              <pre>{m.content}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

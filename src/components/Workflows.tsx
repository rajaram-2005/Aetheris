"use client";

import { useEffect, useState } from "react";
import { renderMarkdown } from "./markdown";
import type { AgentInfo } from "./Agents";

interface Step { id: string; title: string; kind: "agent" | "transform" | "branch"; agent?: string; prompt?: string; op?: string; when?: string; then?: string; else?: string; input?: string }
interface Workflow { id: string; name: string; description: string; inputLabel: string; steps: Step[]; public: boolean; runs: number; mine: boolean; updatedAt: number }
interface StepState { status: "idle" | "running" | "done" | "skipped" | "error"; text: string; provider?: string }

const OPS = ["bullets", "first_line", "extract_json", "strip_code", "upper", "trim:2000"];
const blank = (): Step => ({ id: `step${Math.random().toString(36).slice(2, 6)}`, title: "New step", kind: "agent", agent: "writer", prompt: "{{prev}}" });

export default function Workflows({ agents, onSendToChat }: { agents: AgentInfo[]; onSendToChat: (text: string) => void }) {
  const [list, setList] = useState<Workflow[]>([]);
  const [sel, setSel] = useState<Workflow | null>(null);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [states, setStates] = useState<Record<string, StepState>>({});
  const [final, setFinal] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => { const r = await fetch("/api/workflows", { cache: "no-store" }); if (r.ok) setList((await r.json()).workflows); };
  useEffect(() => { load(); }, []);

  const run = async () => {
    if (!sel || !input.trim()) return;
    setRunning(true); setFinal(null); setErr(null);
    setStates(Object.fromEntries(sel.steps.map((s) => [s.id, { status: "idle", text: "" }])));
    const r = await fetch(`/api/workflows/${sel.id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }) });
    if (!r.ok || !r.body) { setErr((await r.json().catch(() => ({}))).error ?? `Failed (${r.status})`); setRunning(false); return; }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
      for (const p of parts) {
        if (!p.startsWith("data: ")) continue;
        const ev = JSON.parse(p.slice(6));
        if (ev.type === "step_start") setStates((s) => ({ ...s, [ev.step]: { status: "running", text: "" } }));
        else if (ev.type === "step_delta") setStates((s) => ({ ...s, [ev.step]: { ...s[ev.step], text: (s[ev.step]?.text ?? "") + ev.text } }));
        else if (ev.type === "step_done") setStates((s) => ({ ...s, [ev.step]: { status: ev.skipped ? "skipped" : "done", text: ev.output, provider: ev.provider } }));
        else if (ev.type === "done") setFinal(ev.final);
        else if (ev.type === "error") setErr(ev.error);
      }
    }
    setRunning(false); load();
  };

  const save = async () => {
    if (!editing) return;
    const r = await fetch("/api/workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...editing, id: editing.id.startsWith("new-") ? undefined : editing.id }) });
    const j = await r.json();
    if (!r.ok) return setErr(j.error);
    setEditing(null); await load(); setSel({ ...j.workflow, mine: true });
  };
  const del = async (w: Workflow) => { await fetch(`/api/workflows/${w.id}`, { method: "DELETE" }); if (sel?.id === w.id) setSel(null); load(); };
  const duplicate = (w: Workflow) => setEditing({ ...w, id: "new-" + Date.now(), name: w.name + " (copy)", public: false, mine: true });

  const upd = (i: number, patch: Partial<Step>) => setEditing((e) => e && ({ ...e, steps: e.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, d: number) => setEditing((e) => { if (!e) return e; const st = [...e.steps]; const j = i + d; if (j < 0 || j >= st.length) return e; [st[i], st[j]] = [st[j], st[i]]; return { ...e, steps: st }; });

  return (
    <div className="wf">
      <aside className="wf-list">
        <div className="wf-list-head"><b>⛓️ Workflows</b><button className="chip" onClick={() => setEditing({ id: "new-" + Date.now(), name: "My workflow", description: "", inputLabel: "Input", steps: [blank()], public: false, runs: 0, mine: true, updatedAt: Date.now() })}>+ New</button></div>
        {list.map((w) => (
          <button key={w.id} className={`wf-item ${sel?.id === w.id ? "on" : ""}`} onClick={() => { setSel(w); setEditing(null); setFinal(null); setStates({}); }}>
            <b>{w.name}</b><small>{w.steps.length} steps · {w.runs} runs{w.mine ? " · mine" : w.public ? " · template" : ""}</small>
          </button>
        ))}
        {list.length === 0 && <div className="sb-empty">Loading…</div>}
      </aside>

      <section className="wf-main">
        {editing ? (
          <div className="wf-editor">
            <div className="wf-row"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Workflow name" /><label className="chip"><input type="checkbox" checked={editing.public} onChange={(e) => setEditing({ ...editing, public: e.target.checked })} /> public</label></div>
            <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="What does it do?" />
            <input value={editing.inputLabel} onChange={(e) => setEditing({ ...editing, inputLabel: e.target.value })} placeholder="Input label (e.g. Topic)" />
            <p className="hint" style={{ textAlign: "left", margin: 0 }}>Templates: <code>{"{{input}}"}</code> workflow input · <code>{"{{prev}}"}</code> previous step · <code>{"{{steps.<id>}}"}</code> any earlier step.</p>
            {editing.steps.map((s, i) => (
              <div key={i} className="wf-step-edit">
                <div className="wf-row">
                  <span className="meta">#{i + 1}</span>
                  <input style={{ width: 110 }} value={s.id} onChange={(e) => upd(i, { id: e.target.value.replace(/[^\w-]/g, "") })} title="step id" />
                  <input style={{ flex: 1 }} value={s.title} onChange={(e) => upd(i, { title: e.target.value })} placeholder="Title" />
                  <select value={s.kind} onChange={(e) => upd(i, { kind: e.target.value as Step["kind"] })}><option value="agent">agent</option><option value="transform">transform</option><option value="branch">branch</option></select>
                  <button className="link" onClick={() => move(i, -1)}>↑</button><button className="link" onClick={() => move(i, 1)}>↓</button>
                  <button className="link" onClick={() => setEditing({ ...editing, steps: editing.steps.filter((_, j) => j !== i) })}>✕</button>
                </div>
                {s.kind === "agent" && (<>
                  <select value={s.agent} onChange={(e) => upd(i, { agent: e.target.value })}>{agents.filter((a) => a.tier !== "ultra").map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name} (@{a.id})</option>)}</select>
                  <textarea rows={3} value={s.prompt ?? ""} onChange={(e) => upd(i, { prompt: e.target.value })} placeholder="Prompt for this agent" />
                </>)}
                {s.kind === "transform" && <select value={s.op} onChange={(e) => upd(i, { op: e.target.value })}>{OPS.map((o) => <option key={o}>{o}</option>)}</select>}
                {s.kind === "branch" && (<div className="wf-row"><input placeholder="regex (case-insensitive)" value={s.when ?? ""} onChange={(e) => upd(i, { when: e.target.value })} /><input placeholder="then step id" value={s.then ?? ""} onChange={(e) => upd(i, { then: e.target.value })} /><input placeholder="else step id (skipped if match)" value={s.else ?? ""} onChange={(e) => upd(i, { else: e.target.value })} /></div>)}
              </div>
            ))}
            <div className="wf-row"><button className="chip" onClick={() => setEditing({ ...editing, steps: [...editing.steps, blank()] })}>+ step</button><span style={{ flex: 1 }} /><button className="link" onClick={() => setEditing(null)}>Cancel</button><button className="send" onClick={save}>Save workflow</button></div>
            {err && <div className="err-text">{err}</div>}
          </div>
        ) : sel ? (
          <div className="wf-run">
            <div className="wf-row"><div><h2 style={{ margin: 0 }}>{sel.name}</h2><p className="hint" style={{ margin: "2px 0 0", textAlign: "left" }}>{sel.description}</p></div><span style={{ flex: 1 }} />
              <button className="chip" onClick={() => duplicate(sel)}>⧉ duplicate</button>{sel.mine && <><button className="chip" onClick={() => setEditing(sel)}>✎ edit</button><button className="link" onClick={() => del(sel)}>delete</button></>}</div>
            <div className="wf-steps-strip">{sel.steps.map((s, i) => { const st = states[s.id]; const a = agents.find((x) => x.id === s.agent); return <span key={s.id} className={`wf-pill ${st?.status ?? ""}`}>{i + 1}. {a?.icon ?? (s.kind === "transform" ? "🔧" : "🔀")} {s.title}</span>; })}</div>
            <textarea rows={4} placeholder={sel.inputLabel} value={input} onChange={(e) => setInput(e.target.value)} />
            <div className="wf-row"><span className="hint" style={{ margin: 0 }}>{sel.steps.filter((s) => s.kind === "agent").length} agent calls</span><span style={{ flex: 1 }} /><button className="send" disabled={running || !input.trim()} onClick={run}>{running ? "Running…" : "▶ Run workflow"}</button></div>
            {err && <div className="err-text">{err}</div>}
            {sel.steps.map((s) => { const st = states[s.id]; if (!st || st.status === "idle") return null; return (
              <details key={s.id} className="wf-out" open={st.status === "running"}>
                <summary>{st.status === "running" ? <span className="spin" /> : st.status === "skipped" ? "↷" : "✓"} {s.title}{st.provider ? <span className="meta"> · {st.provider}</span> : null}</summary>
                <div className="bubble" dangerouslySetInnerHTML={{ __html: renderMarkdown(st.text || (st.status === "skipped" ? "_skipped by branch_" : "")) }} />
              </details>); })}
            {final !== null && <div className="wf-row"><b>Final output ready.</b><span style={{ flex: 1 }} /><button className="chip" onClick={() => navigator.clipboard.writeText(final)}>copy</button><button className="send" onClick={() => onSendToChat(final)}>Continue in chat →</button></div>}
          </div>
        ) : (
          <div className="upsell" style={{ margin: 12 }}>Pick a workflow on the left, or create your own: chain any of the {agents.length} agents with templated prompts, transforms and branches. Run it on any input and get every step's output.</div>
        )}
      </section>
    </div>
  );
}

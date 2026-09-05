"use client";
import { useCallback, useEffect, useState } from "react";
import { renderMarkdown } from "@/components/markdown";

type Delivery = { type: "email"; to: string } | { type: "webhook"; url: string } | { type: "share" };
type Task = { kind: "workflow"; workflowId: string; input: string } | { kind: "agent"; agent: string; prompt: string };
interface Schedule { id: string; name: string; enabled: boolean; cron: string; tz: string; human: string; task: Task; deliver: Delivery[]; nextAt: number | null; lastAt?: number; lastStatus?: "ok" | "error"; lastError?: string; runs: number }
interface Run { id: string; scheduleId: string; startedAt: number; finishedAt?: number; status: "running" | "ok" | "error"; output: string; error?: string; delivered: { type: string; ok: boolean; detail?: string }[]; shareId?: string; trigger: "cron" | "manual" }
interface Wf { id: string; name: string; inputLabel: string }
interface AgentLite { id: string; name: string; icon: string }

const EXAMPLES: { name: string; cron: string; task: Task; blurb: string }[] = [
  { name: "Morning briefing", cron: "0 7 * * *", blurb: "Daily 7:00 — news, markets, weather framing for your day", task: { kind: "agent", agent: "hermes", prompt: "Write my morning briefing for {{date}}: 5 headlines that matter for a founder in India (tech, AI, economy), one market note, and 3 focused suggestions for the day. Keep it under 250 words." } },
  { name: "Weekly study plan", cron: "0 18 * * 0", blurb: "Sunday evening — next week's study plan", task: { kind: "agent", agent: "tutor", prompt: "Create a 6-day study plan for the coming week ({{date}}) for a Class 12 student preparing for board exams in Physics, Chemistry and Maths: 2 sessions per day, topic, technique (recall/practice/revision), and one self-test each day." } },
  { name: "Daily English word & idiom", cron: "0 8 * * *", blurb: "Every 8:00 — vocabulary micro-lesson", task: { kind: "agent", agent: "english", prompt: "Teach one advanced English word and one idiom for {{date}}: meaning, Tamil/Hindi hint, 3 example sentences, a tiny quiz with answers at the end." } },
  { name: "Weekly code review reminder", cron: "0 10 * * 1", blurb: "Monday 10:00 — team engineering checklist", task: { kind: "agent", agent: "coder", prompt: "Produce this week's engineering hygiene checklist for a small Next.js/TypeScript team: dependency updates to check, security items, performance checks, and 3 refactor candidates to look for. Date: {{date}}." } },
  { name: "Monthly finance review", cron: "0 9 1 * *", blurb: "1st of each month — personal finance checklist", task: { kind: "agent", agent: "accountant", prompt: "It's {{date}}. Give a monthly personal-finance review checklist for a salaried person in India: SIP/investment review, GST/ITR deadlines this month, bills, emergency fund check, one tip to save more." } },
];

/** ⏰ Schedules — run workflows or agents on a cron schedule with delivery and run history. */
export default function Schedules({ onOpenWorkflows, onAsk }: { onOpenWorkflows: () => void; onAsk: (p: string) => void }) {
  const [data, setData] = useState<{ schedules: Schedule[]; runs: Run[]; presets: { label: string; cron: string }[]; workflows: Wf[]; email: boolean; cronSecretSet: boolean } | null>(null);
  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [editing, setEditing] = useState<Partial<Schedule> | null>(null);
  const [viewRun, setViewRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

  const load = useCallback(() => fetch("/api/schedules").then((r) => r.json()).then(setData).catch(() => undefined), []);
  useEffect(() => { load(); fetch("/api/agents").then((r) => r.json()).then((j) => setAgents((j.agents ?? []).map((a: AgentLite) => ({ id: a.id, name: a.name, icon: a.icon })))).catch(() => undefined); }, [load]);
  useEffect(() => { const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  const blank = (): Partial<Schedule> => ({ name: "", cron: "0 8 * * *", tz, task: { kind: "agent", agent: "hermes", prompt: "" }, deliver: [{ type: "share" }], enabled: true });
  const save = async () => {
    if (!editing) return; setBusy("save"); setErr(null);
    const r = await fetch(editing.id ? `/api/schedules/${editing.id}` : "/api/schedules", { method: editing.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing) });
    const j = await r.json(); setBusy(null);
    if (j.error) setErr(j.error); else { setEditing(null); load(); }
  };
  const toggle = async (s: Schedule) => { await fetch(`/api/schedules/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !s.enabled }) }); load(); };
  const del = async (s: Schedule) => { if (!confirm(`Delete "${s.name}"?`)) return; await fetch(`/api/schedules/${s.id}`, { method: "DELETE" }); load(); };
  const runNow = async (s: Schedule) => { setBusy(s.id); setErr(null); const j = await fetch(`/api/schedules/${s.id}/run`, { method: "POST" }).then((r) => r.json()); setBusy(null); if (j.run) setViewRun(j.run); if (j.run?.error) setErr(j.run.error); load(); };
  const openRun = async (id: string) => { const j = await fetch(`/api/schedules/runs?id=${id}`).then((r) => r.json()); if (j.run) setViewRun(j.run); };
  const fmtWhen = (t?: number | null) => (t ? new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

  const e = editing;
  return (
    <div className="study schedules">
      <div className="gallery-head">
        <div><h2 style={{ margin: 0 }}>⏰ Scheduled automations</h2><p className="hint" style={{ margin: "4px 0 0", textAlign: "left" }}>Run an agent prompt or a whole workflow on a schedule — daily digests, weekly reports, reminders. Results are saved as run history, published as share links, and optionally emailed or posted to a webhook (Slack, Discord, WhatsApp gateways, Zapier, n8n).</p></div>
        {!e && <button className="send" onClick={() => setEditing(blank())}>+ New schedule</button>}
      </div>
      {err && <div className="err-box">{err}</div>}

      {e && (
        <div className="study-summary gallery-form">
          <input className="agent-search" placeholder="Name — e.g. Morning briefing" value={e.name ?? ""} onChange={(ev) => setEditing({ ...e, name: ev.target.value })} autoFocus />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label className="meta">When</label>
            <select className="agent-search" style={{ maxWidth: 220 }} value={data?.presets.some((p) => p.cron === e.cron) ? e.cron : "custom"} onChange={(ev) => ev.target.value !== "custom" && setEditing({ ...e, cron: ev.target.value })}>{data?.presets.map((p) => <option key={p.cron} value={p.cron}>{p.label}</option>)}<option value="custom">Custom cron…</option></select>
            <input className="agent-search" style={{ maxWidth: 160, fontFamily: "monospace" }} value={e.cron ?? ""} onChange={(ev) => setEditing({ ...e, cron: ev.target.value })} title="minute hour day month weekday" />
            <input className="agent-search" style={{ maxWidth: 200 }} value={e.tz ?? tz} onChange={(ev) => setEditing({ ...e, tz: ev.target.value })} title="IANA time zone" />
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label className="meta">Task</label>
            <select className="agent-search" style={{ maxWidth: 160 }} value={e.task?.kind ?? "agent"} onChange={(ev) => setEditing({ ...e, task: ev.target.value === "workflow" ? { kind: "workflow", workflowId: data?.workflows[0]?.id ?? "", input: "" } : { kind: "agent", agent: "hermes", prompt: "" } })}><option value="agent">Agent prompt</option><option value="workflow">Workflow</option></select>
            {e.task?.kind === "agent" && <select className="agent-search" style={{ maxWidth: 260 }} value={e.task.agent} onChange={(ev) => setEditing({ ...e, task: { kind: "agent", agent: ev.target.value, prompt: (e.task as { prompt: string }).prompt } })}>{agents.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}</select>}
            {e.task?.kind === "workflow" && (data?.workflows.length ? <select className="agent-search" style={{ maxWidth: 300 }} value={e.task.workflowId} onChange={(ev) => setEditing({ ...e, task: { kind: "workflow", workflowId: ev.target.value, input: (e.task as { input: string }).input } })}>{data.workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select> : <button className="chip" onClick={onOpenWorkflows}>Create a workflow first →</button>)}
          </div>
          {e.task?.kind === "agent" && <textarea className="agent-search" rows={4} placeholder="What should it produce each time? Use {{date}} for today's date." value={e.task.prompt} onChange={(ev) => setEditing({ ...e, task: { kind: "agent", agent: (e.task as { agent: string }).agent, prompt: ev.target.value } })} />}
          {e.task?.kind === "workflow" && <textarea className="agent-search" rows={2} placeholder={`Workflow input (${data?.workflows.find((w) => w.id === (e.task as { workflowId: string }).workflowId)?.inputLabel ?? "input"}). Use {{date}} for today's date.`} value={e.task.input} onChange={(ev) => setEditing({ ...e, task: { kind: "workflow", workflowId: (e.task as { workflowId: string }).workflowId, input: ev.target.value } })} />}
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label className="meta">Deliver</label>
            <span className="chip on" title="Every run is published as a private-by-obscurity read-only page">🔗 Share link</span>
            <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={!!e.deliver?.some((d) => d.type === "email")} onChange={(ev) => setEditing({ ...e, deliver: ev.target.checked ? [...(e.deliver ?? []), { type: "email", to: "" }] : (e.deliver ?? []).filter((d) => d.type !== "email") })} /> ✉️ Email{!data?.email && <span className="meta" title="Set RESEND_API_KEY on the server"> (not configured on this server)</span>}</label>
            {e.deliver?.some((d) => d.type === "email") && <input className="agent-search" style={{ maxWidth: 240 }} placeholder="you@example.com" value={(e.deliver.find((d) => d.type === "email") as { to: string }).to} onChange={(ev) => setEditing({ ...e, deliver: e.deliver!.map((d) => (d.type === "email" ? { type: "email", to: ev.target.value } : d)) })} />}
            <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={!!e.deliver?.some((d) => d.type === "webhook")} onChange={(ev) => setEditing({ ...e, deliver: ev.target.checked ? [...(e.deliver ?? []), { type: "webhook", url: "" }] : (e.deliver ?? []).filter((d) => d.type !== "webhook") })} /> 🔔 Webhook</label>
            {e.deliver?.some((d) => d.type === "webhook") && <input className="agent-search" style={{ minWidth: 280, flex: 1 }} placeholder="https://hooks.slack.com/… · Discord webhook · WhatsApp gateway (CallMeBot/Twilio) · Zapier/n8n" value={(e.deliver.find((d) => d.type === "webhook") as { url: string }).url} onChange={(ev) => setEditing({ ...e, deliver: e.deliver!.map((d) => (d.type === "webhook" ? { type: "webhook", url: ev.target.value } : d)) })} />}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="send" disabled={busy === "save"} onClick={save}>{e.id ? "Save changes" : "Create schedule"}</button>
            <button className="chip" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      {!e && data && data.schedules.length === 0 && (
        <div className="study-grid">
          {EXAMPLES.map((x) => (
            <button key={x.name} className="study-card" onClick={() => setEditing({ ...blank(), name: x.name, cron: x.cron, task: x.task })}>
              <b>⏰ {x.name}</b><div className="hint" style={{ textAlign: "left", margin: 0 }}>{x.blurb}</div><span className="meta">@{(x.task as { agent: string }).agent} · <code>{x.cron}</code></span>
            </button>
          ))}
        </div>
      )}

      {data && data.schedules.length > 0 && (
        <div className="study-cards">
          {data.schedules.map((s) => (
            <div key={s.id} className={`study-row sched ${s.enabled ? (s.lastStatus === "error" ? "stage-learning" : "stage-mature") : "stage-new"}`} style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }}>
              <label className="switch" title={s.enabled ? "Enabled — click to pause" : "Paused — click to enable"}><input type="checkbox" checked={s.enabled} onChange={() => toggle(s)} /><span /></label>
              <div className="study-row-main">
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}><b>{s.name}</b><span className="meta">{s.human} · {s.tz}</span><span className="meta">{s.task.kind === "agent" ? `@${s.task.agent}` : `workflow ${data.workflows.find((w) => w.id === (s.task as { workflowId: string }).workflowId)?.name ?? ""}`}</span>{s.deliver.map((d, i) => <span key={i} className="meta">{d.type === "email" ? `✉️ ${d.to}` : d.type === "webhook" ? `🔔 ${(() => { try { return new URL(d.url).hostname; } catch { return "webhook"; } })()}` : "🔗 share"}</span>)}</div>
                <div className="hint" style={{ textAlign: "left", margin: 0 }}>Next: {s.enabled ? fmtWhen(s.nextAt) : "paused"} · Last: {fmtWhen(s.lastAt)} {s.lastStatus === "ok" ? "✓" : s.lastStatus === "error" ? `✗ ${s.lastError?.slice(0, 80)}` : ""} · {s.runs} run{s.runs === 1 ? "" : "s"}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="chip" disabled={busy === s.id} onClick={() => runNow(s)}>{busy === s.id ? "Running…" : "▶ Run now"}</button>
                <button className="link" onClick={() => setEditing(s)}>edit</button>
                <button className="link" onClick={() => del(s)}>delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {data && data.runs.length > 0 && (
        <div className="study-summary">
          <h3 style={{ margin: 0 }}>Run history</h3>
          {data.runs.map((r) => (
            <button key={r.id} className="kb-hit" style={{ textAlign: "left", cursor: "pointer", border: "none", color: "inherit" }} onClick={() => openRun(r.id)}>
              <div className="meta">{r.status === "ok" ? "✓" : r.status === "error" ? "✗" : "…"} {data.schedules.find((s) => s.id === r.scheduleId)?.name ?? "deleted schedule"} · {fmtWhen(r.startedAt)} · {r.trigger} · {r.finishedAt ? `${((r.finishedAt - r.startedAt) / 1000).toFixed(1)}s` : ""} {r.delivered.map((d) => `· ${d.type} ${d.ok ? "✓" : "✗"}`).join(" ")}</div>
              <div>{r.error ? <span style={{ color: "var(--err)" }}>{r.error}</span> : r.output.slice(0, 240) + (r.output.length > 240 ? "…" : "")}</div>
            </button>
          ))}
        </div>
      )}

      {viewRun && (
        <div className="modal-bg" onClick={() => setViewRun(null)}>
          <div className="modal" style={{ maxWidth: 820 }} onClick={(ev) => ev.stopPropagation()}>
            <div className="row" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>{viewRun.status === "ok" ? "✓" : "✗"} Run · {fmtWhen(viewRun.startedAt)}</h3><button className="chip" onClick={() => setViewRun(null)}>✕</button></div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{viewRun.delivered.map((d, i) => <span key={i} className={`chip ${d.ok ? "on" : "bad"}`}>{d.type}: {d.ok ? "delivered" : "failed"}{d.detail ? ` · ${d.detail}` : ""}</span>)}{viewRun.shareId && <a className="chip" href={`/s/${viewRun.shareId}`} target="_blank" rel="noreferrer">Open share page ↗</a>}</div>
            {viewRun.error && <div className="err-box">{viewRun.error}</div>}
            <div className="bubble" style={{ maxHeight: "60vh", overflow: "auto" }} dangerouslySetInnerHTML={{ __html: renderMarkdown(viewRun.output || "_no output_") }} />
            <div className="row" style={{ gap: 8 }}><button className="chip" onClick={() => navigator.clipboard.writeText(viewRun.output)}>Copy</button><button className="chip" onClick={() => { setViewRun(null); onAsk(`Here is the output of my scheduled automation. Improve it and tell me what to change in the prompt:\n\n${viewRun.output.slice(0, 6000)}`); }}>Discuss in chat</button></div>
          </div>
        </div>
      )}

      <details className="hint" style={{ textAlign: "left" }}><summary style={{ cursor: "pointer" }}>Reliability: how schedules run when the server sleeps</summary>
        <p>Aetheris ticks every minute while the server process is alive. If your host sleeps the container (scale-to-zero, free-tier dynos) also point an external cron at <code>GET /api/schedules/tick</code> every 5–15 minutes — e.g. GitHub Actions, cron-job.org or UptimeRobot{data?.cronSecretSet ? " (send Authorization: Bearer CRON_SECRET)" : " (set CRON_SECRET to protect it)"}. Missed slots are caught up once, never replayed many times.</p>
      </details>
    </div>
  );
}

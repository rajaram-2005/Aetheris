"use client";

import { useEffect, useMemo, useState } from "react";

export interface AgentInfo { id: string; name: string; icon: string; tier: "ultra" | "god" | "sub"; domain: string; description: string; skills: string[]; tools: string[]; aliases: string[] }
export interface Lesson { agent: string; text: string; at: number }

export function useAgents() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  useEffect(() => { fetch("/api/agents").then((r) => r.json()).then((j) => setAgents(j.agents ?? [])).catch(() => undefined); }, []);
  return agents;
}

const DOMAIN_LABEL: Record<string, string> = {
  core: "Core", academy: "Academy", coding: "Coding", research: "Research", writing: "Writing", business: "Business", marketing: "Marketing", finance: "Finance",
  legal: "Legal", health: "Health", design: "Design", data: "Data", career: "Career", language: "Languages", productivity: "Productivity", science: "Science", creative: "Creative", ethics: "AI Ethics & Explainability",
};

/** Full Agents page: hierarchy + catalog + Metis lessons. */
export default function AgentsPage({ agents, onUse }: { agents: AgentInfo[]; onUse: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const load = () => fetch("/api/agents/lessons").then((r) => r.json()).then((j) => setLessons(j.lessons ?? [])).catch(() => undefined);
  useEffect(() => { load(); }, []);

  const ultra = agents.filter((a) => a.tier === "ultra");
  const gods = agents.filter((a) => a.tier === "god");
  const subs = useMemo(() => {
    const t = q.trim().toLowerCase();
    return agents.filter((a) => a.tier === "sub" && (!t || a.name.toLowerCase().includes(t) || a.domain.includes(t) || a.skills.some((s) => s.toLowerCase().includes(t)) || a.aliases.some((s) => s.includes(t))));
  }, [agents, q]);
  const byDomain = useMemo(() => {
    const m = new Map<string, AgentInfo[]>();
    for (const a of subs) m.set(a.domain, [...(m.get(a.domain) ?? []), a]);
    return [...m.entries()];
  }, [subs]);

  const Card = ({ a, big }: { a: AgentInfo; big?: boolean }) => (
    <button className={`agent-card ${big ? "big" : ""} tier-${a.tier}`} onClick={() => onUse(a.id)} title={`Use @${a.id}`}>
      <div className="agent-head"><span className="agent-icon">{a.icon}</span><div><div className="name">{a.name}</div><div className="meta">@{a.id}{a.tools.length ? ` · ${a.tools.join(" + ")}` : ""}</div></div></div>
      <div className="agent-desc">{a.description}</div>
      <div className="agent-skills">{a.skills.slice(0, 4).map((s) => <span key={s} className="tag">{s}</span>)}</div>
    </button>
  );

  return (
    <div className="agents-page">
      <div className="mesh-title">
        <h2>Agent hierarchy</h2>
        <span className="hint" style={{ margin: 0 }}>{agents.length} agents · type <code>@id</code> in chat to force one, or turn on 🤖 Agents to let Prime route</span>
      </div>

      <h3 className="agents-h">How models and agents combine</h3>
      <ModelMatrix />

      <h3 className="agents-h">✴️ Ultra-agent</h3>
      <div className="agent-grid">{ultra.map((a) => <Card key={a.id} a={a} big />)}</div>

      <h3 className="agents-h">God-agents — Hermes (execution base) · Metis (meta-learning)</h3>
      <div className="agent-grid">{gods.map((a) => <Card key={a.id} a={a} big />)}</div>

      <div className="agents-h" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Sub-agents ({subs.length})</h3>
        <input className="agent-search" placeholder="Search skills, e.g. resume, sql, tamil…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {byDomain.map(([d, list]) => (
        <div key={d}>
          <div className="agents-domain">{DOMAIN_LABEL[d] ?? d}</div>
          <div className="agent-grid">{list.map((a) => <Card key={a.id} a={a} />)}</div>
        </div>
      ))}

      <h3 className="agents-h">🦉 Metis — lessons learned ({lessons.length})</h3>
      {lessons.length === 0 ? (
        <p className="hint">After each agent run Metis reflects and stores short, reusable lessons here. They are injected into future runs so the agents improve for you over time.</p>
      ) : (
        <ul className="lessons">
          {lessons.slice().reverse().map((l) => (
            <li key={l.text}><span className="tag">{l.agent}</span> {l.text}
              <button className="link" onClick={() => fetch("/api/agents/lessons", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: l.text }) }).then(load)}>forget</button>
            </li>
          ))}
        </ul>
      )}
      {lessons.length > 0 && <button className="ghost" onClick={() => fetch("/api/agents/lessons", { method: "DELETE" }).then(load)}>Clear all lessons</button>}
    </div>
  );
}

/** Inline trail shown under an assistant message produced by the orchestrator. */
export function AgentTrail({ run, agents }: { run: AgentRun; agents: AgentInfo[] }) {
  const info = (id: string) => agents.find((a) => a.id === id);
  return (
    <div className="agent-trail">
      <div className="agent-trail-head">
        <span className="tag">✴️ Prime</span>
        <span>{run.mode === "single" ? "delegated to" : run.mode === "pipeline" ? "pipeline" : "parallel"}</span>
        {run.steps.map((s, i) => (
          <span key={s.agent + i} className={`chip ${s.status === "running" ? "on" : s.status === "error" ? "bad" : ""}`} title={s.brief}>
            {info(s.agent)?.icon ?? "🤖"} {info(s.agent)?.name ?? s.agent}{s.status === "running" ? " …" : s.provider ? ` · ${s.provider}` : ""}
          </span>
        ))}
        {run.synthesising && <span className="chip on">✴️ synthesising…</span>}
      </div>
      {run.reason && <div className="hint" style={{ margin: "4px 0 0" }}>{run.reason}</div>}
      {run.lessons?.length ? <div className="hint" style={{ margin: "4px 0 0" }}>🦉 Metis learned: {run.lessons.map((l) => l.text).join(" · ")}</div> : null}
    </div>
  );
}

export interface AgentRun {
  mode: "single" | "pipeline" | "parallel";
  reason?: string;
  steps: { agent: string; brief: string; status: "running" | "done" | "error"; provider?: string; error?: string }[];
  synthesising?: boolean;
  done?: boolean;
  lessons?: Lesson[];
}

/** @mention autocomplete list for the composer. */
export function MentionMenu({ agents, query, onPick }: { agents: AgentInfo[]; query: string; onPick: (id: string) => void }) {
  const q = query.toLowerCase();
  const list = agents.filter((a) => a.tier !== "ultra" && (a.id.includes(q) || a.name.toLowerCase().includes(q) || a.aliases.some((x) => x.startsWith(q)))).slice(0, 8);
  if (list.length === 0) return null;
  return (
    <div className="mention-menu">
      {list.map((a) => <button key={a.id} onMouseDown={(e) => { e.preventDefault(); onPick(a.id); }}><span>{a.icon}</span><b>@{a.id}</b><span className="meta">{a.description}</span></button>)}
    </div>
  );
}

function ModelMatrix() {
  const [models, setModels] = useState<{ id: string; name: string; minPlan: string; available: boolean; agents: { max: number; parallel: boolean; critique: boolean } }[]>([]);
  useEffect(() => { fetch("/api/models").then((r) => r.json()).then((j) => setModels(j.models ?? [])).catch(() => undefined); }, []);
  if (!models.length) return null;
  return (
    <div className="model-matrix">
      {models.map((m) => (
        <div key={m.id} className={`mm-row ${m.available ? "" : "locked"}`}>
          <div className="mm-name"><b>{m.name}</b><span className="meta">{m.id}{m.available ? "" : ` · 🔒 ${m.minPlan}`}</span></div>
          <div className="mm-flow">
            {m.agents.max === 1 ? <><span className="chip">⚡ Hermes</span><span className="arrow">→</span><span className="chip">answer</span></> : <>
              <span className="chip">✴️ Prime plans</span><span className="arrow">→</span>
              <span className="chip">{m.agents.max} specialists{m.agents.parallel ? " ∥" : " ⛓"}</span><span className="arrow">→</span>
              {m.agents.parallel && <><span className="chip">✴️ synthesis</span><span className="arrow">→</span></>}
              {m.agents.critique && <><span className="chip">🦉 Metis critique</span><span className="arrow">→</span></>}
              <span className="chip">answer</span><span className="arrow">→</span><span className="chip">🦉 lessons</span>
            </>}
          </div>
        </div>
      ))}
    </div>
  );
}

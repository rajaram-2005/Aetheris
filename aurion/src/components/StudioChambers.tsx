/* ─── Remaining Studio chambers — agents, apex, canvas, arena, connect, models ─── */
"use client";

import { useEffect, useState } from 'react';
import { getIntegrations, getResources } from '@/lib/hermes';

/* ── Agents ── */

interface SovereignAgent {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  category: string;
  system_prompt: string;
  model_id: string;
}

export function AgentsChamber({ onRunInChat }: { onRunInChat: (text: string) => void }) {
  const [agents, setAgents] = useState<SovereignAgent[]>([]);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    fetch('/v1/agents/store').then((r) => r.json()).then((res) => setAgents(res.agents || [])).catch(() => undefined);
  }, []);

  const create = async () => {
    if (!name.trim() || !prompt.trim()) return;
    const res = await fetch('/v1/agents/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, tagline: 'Custom agent', system_prompt: prompt, icon: '🤖', category: 'Custom', model_id: 'aetheris-prime-v4', author: 'User' }),
    }).then((r) => r.json()).catch(() => null);
    if (res?.id) {
      setAgents((p) => [res, ...p]);
      setName('');
      setPrompt('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {agents.map((a) => (
          <button key={a.id} onClick={() => onRunInChat(`[Activating Agent: ${a.name}]\n${a.system_prompt}\n\nHello — how can I help with ${a.category}?`)} className="surface surface-hover p-4 text-left">
            <span className="text-2xl">{a.icon}</span>
            <strong className="block mt-2 text-sm" style={{ fontFamily: 'var(--font-display)' }}>{a.name}</strong>
            <span className="block text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{a.tagline}</span>
          </button>
        ))}
      </div>
      <div className="rounded-2xl border p-4 space-y-2" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-tertiary)' }}>
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent-mint)', fontFamily: 'var(--font-mono)' }}>Create an agent</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="input surface w-full px-3 py-2" style={{ background: 'var(--bg-secondary)' }} />
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="System prompt…" className="input surface w-full px-3 py-2" style={{ background: 'var(--bg-secondary)', resize: 'none' }} />
        <button className="btn btn-primary" onClick={create} disabled={!name.trim() || !prompt.trim()}>Publish into the studio</button>
      </div>
    </div>
  );
}

/* ── Apex ── */

export function ApexChamber({ onRunInChat }: { onRunInChat: (text: string) => void }) {
  const [query, setQuery] = useState('What does Hermes use?');
  const [graph, setGraph] = useState<Record<string, unknown> | null>(null);
  const [evalRun, setEvalRun] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const runGraph = async () => {
    setBusy(true);
    try {
      setGraph(await fetch('/v1/graph/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, hops: 2, limit: 12 }) }).then((r) => r.json()));
    } finally { setBusy(false); }
  };

  const runEvals = async () => {
    setBusy(true);
    try {
      setEvalRun(await fetch('/v1/evals/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ suite_id: 'suite_hermes_cognition', runner: 'hermes-cognition' }) }).then((r) => r.json()));
    } finally { setBusy(false); }
  };

  const neighborhood = (graph?.neighborhood as { node: { name: string }; via: { relation: string }; hops: number }[]) || [];
  const results = (evalRun?.results as { id: string; passed: boolean; input: string; score: number }[]) || [];

  return (
    <div className="space-y-5">
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Graph RAG, constitution, and evals — the same Apex lab, inside the studio.</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} className="input surface flex-1 px-3 py-2" style={{ background: 'var(--bg-tertiary)' }} />
        <button className="btn btn-primary" onClick={runGraph} disabled={busy}>Query graph</button>
        <button className="btn" onClick={runEvals} disabled={busy}>Run evals</button>
      </div>
      {neighborhood.length > 0 && (
        <div className="space-y-1.5">
          {neighborhood.slice(0, 8).map((item, i) => (
            <div key={i} className="px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', fontFamily: 'var(--font-mono)' }}>
              {item.via.relation} → {item.node.name} · hops={item.hops}
            </div>
          ))}
          <button className="btn btn-primary text-xs" onClick={() => onRunInChat(`Using this knowledge-graph grounding, answer: ${query}\n\n${String(graph?.grounding || '')}`)}>Discuss in chat</button>
        </div>
      )}
      {evalRun && (
        <div className="space-y-1.5">
          <p className="text-[11px]" style={{ color: 'var(--accent-mint)', fontFamily: 'var(--font-mono)' }}>{String(evalRun.passed)}/{String(evalRun.total)} passed · {Number(evalRun.score).toFixed(3)}</p>
          {results.map((row) => (
            <div key={row.id} className="px-3 py-2 rounded-lg text-[11px]" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', fontFamily: 'var(--font-mono)' }}>
              {row.passed ? '✓' : '✗'} {row.id} — {row.input}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Canvas ── */

export function CanvasChamber({ onRunInChat }: { onRunInChat: (text: string) => void }) {
  const [artifacts, setArtifacts] = useState<{ id: string; title: string; artifact_type: string; language: string; current_version: number; versions: { version: number; content: string }[] }[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [content, setContent] = useState('');

  useEffect(() => {
    fetch('/v1/canvas/artifacts').then((r) => r.json()).then((res) => {
      const list = res.artifacts || [];
      setArtifacts(list);
      if (list[0]) {
        setActive(list[0].id);
        const curr = list[0].versions?.find((v: { version: number }) => v.version === list[0].current_version);
        setContent(curr?.content || '');
      }
    }).catch(() => undefined);
  }, []);

  const art = artifacts.find((a) => a.id === active);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 min-h-[360px]">
      <div className="space-y-1.5">
        {artifacts.length === 0 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No artifacts yet — create one from chat, then it appears here.</p>}
        {artifacts.map((a) => (
          <button key={a.id} onClick={() => { setActive(a.id); const curr = a.versions.find((v) => v.version === a.current_version); setContent(curr?.content || ''); }} className="w-full text-left px-3 py-2 rounded-xl" style={{ background: active === a.id ? 'var(--bg-hover)' : 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
            <span className="block text-xs font-semibold truncate">{a.title}</span>
            <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>{a.artifact_type} · v{a.current_version}</span>
          </button>
        ))}
      </div>
      <div className="lg:col-span-3 flex flex-col gap-2">
        <textarea value={content} onChange={(e) => setContent(e.target.value)} className="input surface flex-1 min-h-[240px] px-3 py-2 font-mono text-xs" style={{ background: 'var(--bg-tertiary)', resize: 'vertical' }} />
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={!content.trim()} onClick={() => onRunInChat(content)}>Run in chat</button>
          {art && (
            <button className="btn" onClick={() => fetch(`/v1/canvas/artifacts/${art.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, summary: 'Studio revision' }) })}>Save version</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Arena ── */

export function ArenaChamber() {
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [metric, setMetric] = useState('humaneval');

  useEffect(() => {
    fetch('/v1/neural/benchmarks').then((r) => r.json()).then((res) => setData(res.all_models || [])).catch(() => undefined);
  }, []);

  const keys = [
    { key: 'humaneval', label: 'HumanEval' },
    { key: 'mmlu_pro', label: 'MMLU-Pro' },
    { key: 'math_500', label: 'MATH-500' },
    { key: 'gpqa_diamond', label: 'GPQA' },
  ];
  const sorted = [...data].sort((a, b) => Number(b[metric]) - Number(a[metric]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {keys.map((k) => (
          <button key={k.key} onClick={() => setMetric(k.key)} className="btn text-xs" style={{ borderColor: metric === k.key ? 'var(--border-hover)' : 'var(--border-color)', color: metric === k.key ? 'var(--accent-mint)' : undefined }}>{k.label}</button>
        ))}
      </div>
      {sorted.map((m, i) => {
        const val = Number(m[metric]);
        return (
          <div key={String(m.model_id)} className="rounded-xl p-3" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
            <div className="flex justify-between text-xs mb-1.5">
              <span>#{i + 1} {String(m.model_name)}</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: m.is_in_house ? 'var(--accent-mint)' : 'var(--text-secondary)' }}>{val}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, val)}%`, background: 'linear-gradient(90deg, var(--accent-blue), var(--accent-mint))' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Connect ── */

const ICONS: Record<string, string> = {
  gmail: '📧', 'google-meet': '📹', 'google-calendar': '📅', telegram: '✈️', slack: '💬', github: '🐙', notion: '📝',
};

export function ConnectChamber() {
  const [items, setItems] = useState<{ service: string; name: string; description: string; auth_type: string; required_fields: string[]; optional_fields: string[] }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    getIntegrations().then((r) => setItems(r.data || [])).catch(() => undefined);
  }, []);

  const item = items.find((i) => i.service === selected);

  const connect = async () => {
    if (!item) return;
    setStatus('Connecting…');
    try {
      const res = await fetch(`/v1/integrations/${item.service}/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds) });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Failed');
      setStatus(`Connected: ${body?.name || item.name}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Failed');
    }
  };

  if (item) {
    return (
      <div className="space-y-3 max-w-lg">
        <button className="text-xs" style={{ color: 'var(--accent-mint)' }} onClick={() => setSelected(null)}>← All apps</button>
        <h3 className="font-semibold" style={{ fontFamily: 'var(--font-display)' }}>{ICONS[item.service] || '🔗'} {item.name}</h3>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.description}</p>
        {item.required_fields.concat(item.optional_fields).map((field) => (
          <input key={field} type="password" placeholder={field} value={creds[field] || ''} onChange={(e) => setCreds({ ...creds, [field]: e.target.value })} className="input surface w-full px-3 py-2" style={{ background: 'var(--bg-tertiary)' }} />
        ))}
        {status && <p className="text-xs" style={{ color: 'var(--accent-mint)' }}>{status}</p>}
        <button className="btn btn-primary" onClick={connect}>Connect</button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {items.map((i) => (
        <button key={i.service} onClick={() => { setSelected(i.service); setCreds({}); setStatus(null); }} className="surface surface-hover p-3 text-left">
          <span className="text-lg">{ICONS[i.service] || '🔗'}</span>
          <span className="block text-xs font-semibold mt-1">{i.name}</span>
          <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>{i.auth_type}</span>
        </button>
      ))}
    </div>
  );
}

/* ── Models / resources ── */

export function ModelsChamber() {
  const [runtimes, setRuntimes] = useState<{ id: string; name: string; description: string; setup: string; offline: boolean }[]>([]);
  const [hosted, setHosted] = useState<{ id: string; name: string; description: string; setup: string }[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    getResources().then((r) => { setRuntimes(r.runtimes || []); setHosted(r.hosted || []); }).catch(() => undefined);
  }, []);

  const copy = (setup: string, id: string) => {
    navigator.clipboard?.writeText(setup);
    setCopied(id);
    setTimeout(() => setCopied(null), 1200);
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>Local runtimes</h3>
        <div className="space-y-2">
          {runtimes.map((r) => (
            <div key={r.id} className="rounded-xl p-3" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
              <div className="flex justify-between gap-2">
                <strong className="text-sm">{r.name}</strong>
                <button className="btn text-[10px] py-1" onClick={() => copy(r.setup, r.id)}>{copied === r.id ? 'Copied' : 'Copy setup'}</button>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{r.description}</p>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>Hosted APIs</h3>
        <div className="space-y-2">
          {hosted.map((r) => (
            <div key={r.id} className="rounded-xl p-3" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
              <div className="flex justify-between gap-2">
                <strong className="text-sm">{r.name}</strong>
                <button className="btn text-[10px] py-1" onClick={() => copy(r.setup, r.id)}>{copied === r.id ? 'Copied' : 'Copy setup'}</button>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{r.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Deep research (used inside Research chamber) ── */

export function DeepResearchPane({ onRunInChat }: { onRunInChat: (text: string) => void }) {
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<{ topic: string; executive_summary: string; confidence_score: number; findings: { section: string; content: string }[] } | null>(null);

  const run = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/v1/research/deep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, depth: 'deep' }) }).then((r) => r.json());
      if (res.id) setReport(res);
    } finally { setLoading(false); }
  };

  return (
    <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-tertiary)' }}>
      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)' }}>Deep research</p>
      <div className="flex gap-2">
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="A multi-hop question…" className="input surface flex-1 px-3 py-2" style={{ background: 'var(--bg-secondary)' }} />
        <button className="btn btn-primary" onClick={run} disabled={loading || !topic.trim()}>{loading ? 'Researching…' : 'Launch'}</button>
      </div>
      {report && (
        <div className="space-y-2">
          <p className="text-sm leading-relaxed">{report.executive_summary}</p>
          <button className="btn btn-primary text-xs" onClick={() => onRunInChat(`Research on "${report.topic}":\n\n${report.executive_summary}`)}>Drop into chat</button>
        </div>
      )}
    </div>
  );
}

/* ─── Apex Lab — Graph RAG, Constitution, Evals, Skills ─── */
"use client";

import { useEffect, useState } from 'react';

interface ApexLabProps {
  isOpen: boolean;
  onClose: () => void;
  onRunInChat?: (text: string) => void;
}

type Tab = 'graph' | 'constitution' | 'evals' | 'skills';

interface Pillar {
  id: string;
  status: string;
  summary: string;
  endpoint: string;
}

interface ApexManifest {
  codename: string;
  version: string;
  pillars: Pillar[];
  stats: Record<string, Record<string, unknown>>;
}

export function ApexLab({ isOpen, onClose, onRunInChat }: ApexLabProps) {
  const [tab, setTab] = useState<Tab>('graph');
  const [manifest, setManifest] = useState<ApexManifest | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/v1/apex')
      .then((r) => r.json())
      .then(setManifest)
      .catch(() => undefined);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(4, 7, 18, 0.85)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="w-full max-w-5xl h-[90vh] flex flex-col rounded-2xl overflow-hidden animate-fade-in shadow-2xl"
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid rgba(61, 255, 194, 0.3)',
          boxShadow: '0 25px 60px -15px rgba(192, 132, 252, 0.28)',
        }}
      >
        <div
          className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0"
          style={{ borderColor: 'var(--border-color)', background: 'rgba(15, 22, 43, 0.8)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold shadow"
              style={{
                background: 'linear-gradient(135deg, #c084fc, #3dffc2)',
                color: '#060914',
              }}
            >
              ✦
            </div>
            <div>
              <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>
                Apex Cognition Lab
              </h2>
              <p className="text-xs text-gray-400">
                Graph RAG · Constitution · Evals · Skills
                {manifest ? ` · v${manifest.version}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors hover:opacity-80"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" />
            </svg>
          </button>
        </div>

        <div className="px-6 pt-3 flex gap-1.5 flex-shrink-0">
          {(['graph', 'constitution', 'evals', 'skills'] as Tab[]).map((name) => (
            <button
              key={name}
              onClick={() => setTab(name)}
              className="text-[11px] px-3 py-1.5 rounded-lg capitalize font-mono"
              style={{
                background: tab === name ? 'rgba(61,255,194,0.15)' : 'var(--bg-tertiary)',
                border: `1px solid ${tab === name ? 'var(--accent-mint)' : 'var(--border-color)'}`,
                color: tab === name ? 'var(--accent-mint)' : 'var(--text-muted)',
              }}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {manifest && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {manifest.pillars.slice(0, 8).map((p) => (
                <div
                  key={p.id}
                  className="p-2.5 rounded-xl border text-[10px] font-mono"
                  style={{
                    background: 'var(--bg-tertiary)',
                    borderColor: p.status === 'live' ? 'rgba(61,255,194,0.25)' : 'var(--border-color)',
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white truncate">{p.id.replace(/_/g, ' ')}</span>
                    <span style={{ color: p.status === 'live' ? 'var(--accent-mint)' : 'var(--accent-pink)' }}>
                      {p.status}
                    </span>
                  </div>
                  <p className="text-gray-400 leading-snug line-clamp-2">{p.summary}</p>
                </div>
              ))}
            </div>
          )}

          {tab === 'graph' && <GraphPane onRunInChat={onRunInChat} onClose={onClose} />}
          {tab === 'constitution' && <ConstitutionPane />}
          {tab === 'evals' && <EvalsPane />}
          {tab === 'skills' && <SkillsPane onRunInChat={onRunInChat} onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}

function GraphPane({
  onRunInChat,
  onClose,
}: {
  onRunInChat?: (text: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('What does Hermes use?');
  const [ingest, setIngest] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const runQuery = async () => {
    setLoading(true);
    try {
      const res = await fetch('/v1/graph/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, hops: 2, limit: 12 }),
      }).then((r) => r.json());
      setResult(res);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const runIngest = async () => {
    if (!ingest.trim()) return;
    await fetch('/v1/graph/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: ingest, source: 'apex-lab' }),
    });
    setIngest('');
    runQuery();
  };

  const linked = (result?.linked as { name: string; kind: string }[]) || [];
  const neighborhood = (result?.neighborhood as { node: { name: string; kind: string }; via: { relation: string }; hops: number; direction: string }[]) || [];
  const grounding = String(result?.grounding || '');

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 px-3 py-2 rounded-xl bg-black border border-gray-700 text-xs font-mono text-white outline-none focus:border-cyan-400"
          placeholder="Ask the knowledge graph…"
        />
        <button
          onClick={runQuery}
          disabled={loading}
          className="px-4 py-2 rounded-xl text-xs font-bold font-mono"
          style={{ background: 'var(--accent-mint)', color: '#060914' }}
        >
          {loading ? 'Traversing…' : 'Query graph'}
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={ingest}
          onChange={(e) => setIngest(e.target.value)}
          className="flex-1 px-3 py-2 rounded-xl bg-black border border-gray-700 text-xs font-mono text-white outline-none"
          placeholder="Ingest a fact — e.g. Apex uses Knowledge graph"
        />
        <button
          onClick={runIngest}
          className="px-4 py-2 rounded-xl text-xs font-mono border border-gray-700 text-cyan-300"
        >
          Ingest
        </button>
      </div>

      {linked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {linked.map((n) => (
            <span
              key={n.name}
              className="px-2 py-0.5 rounded-full text-[10px] font-mono"
              style={{ background: 'rgba(61,255,194,0.12)', color: 'var(--accent-mint)', border: '1px solid rgba(61,255,194,0.3)' }}
            >
              {n.name} · {n.kind}
            </span>
          ))}
        </div>
      )}

      {neighborhood.length > 0 && (
        <div className="space-y-1.5">
          {neighborhood.slice(0, 10).map((item, i) => (
            <div key={i} className="px-3 py-2 rounded-lg text-xs font-mono border border-gray-800 bg-black/40 flex justify-between">
              <span className="text-gray-300">
                {item.via.relation} {item.direction === 'out' ? '→' : '←'} {item.node.name}
              </span>
              <span className="text-gray-500">hops={item.hops}</span>
            </div>
          ))}
        </div>
      )}

      {grounding && onRunInChat && (
        <button
          onClick={() => {
            onRunInChat(`Using this knowledge-graph grounding, answer: ${query}\n\n${grounding}`);
            onClose();
          }}
          className="px-4 py-2 rounded-xl text-xs font-bold font-mono bg-cyan-400 text-black"
        >
          Discuss in chat
        </button>
      )}
    </div>
  );
}

function ConstitutionPane() {
  const [text, setText] = useState('As an AI language model, this is guaranteed to always work. Email me at ada@example.com.');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [principles, setPrinciples] = useState<{ id: string; name: string; severity: string; enabled: boolean }[]>([]);

  useEffect(() => {
    fetch('/v1/constitution')
      .then((r) => r.json())
      .then((body) => setPrinciples(body.principles || []))
      .catch(() => undefined);
  }, []);

  const run = async () => {
    const res = await fetch('/v1/constitution/revise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, grounded: false }),
    }).then((r) => r.json());
    setResult(res);
  };

  const critique = (result?.critique || {}) as { verdict?: string; score?: number; violations?: { name: string; severity: string; hits: string[] }[] };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {principles.map((p) => (
          <span
            key={p.id}
            className="px-2 py-0.5 rounded-full text-[10px] font-mono"
            style={{
              background: p.severity === 'must' ? 'rgba(248,113,113,0.12)' : 'var(--bg-tertiary)',
              color: p.severity === 'must' ? '#f87171' : 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
            }}
          >
            {p.name}
          </span>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="w-full px-3 py-2 rounded-xl bg-black border border-gray-700 text-xs font-mono text-white outline-none"
      />
      <button
        onClick={run}
        className="px-4 py-2 rounded-xl text-xs font-bold font-mono"
        style={{ background: 'var(--accent-mint)', color: '#060914' }}
      >
        Critique & revise
      </button>
      {result && (
        <div className="space-y-2">
          <div className="text-[11px] font-mono text-cyan-300">
            verdict={critique.verdict} · score={critique.score}
          </div>
          {(critique.violations || []).map((v) => (
            <div key={v.name} className="p-2 rounded-lg border border-gray-800 bg-black/40 text-[11px]">
              <span className="text-amber-300 font-mono">{v.severity}</span>{' '}
              <span className="text-white">{v.name}</span>
              <p className="text-gray-400 mt-0.5">{v.hits.join('; ')}</p>
            </div>
          ))}
          <pre className="p-3 rounded-xl bg-black/50 text-[11px] text-gray-200 whitespace-pre-wrap font-mono">
            {String(result.revised || '')}
          </pre>
        </div>
      )}
    </div>
  );
}

function EvalsPane() {
  const [run, setRun] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const launch = async () => {
    setLoading(true);
    try {
      const res = await fetch('/v1/evals/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suite_id: 'suite_hermes_cognition', runner: 'hermes-cognition' }),
      }).then((r) => r.json());
      setRun(res);
    } finally {
      setLoading(false);
    }
  };

  const results = (run?.results as { id: string; passed: boolean; score: number; note: string; input: string }[]) || [];

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400 font-mono">
        Built-in <span className="text-cyan-300">hermes-cognition</span> suite — arithmetic, conversion, intent, grounding.
      </p>
      <button
        onClick={launch}
        disabled={loading}
        className="px-4 py-2 rounded-xl text-xs font-bold font-mono"
        style={{ background: 'var(--accent-mint)', color: '#060914' }}
      >
        {loading ? 'Scoring…' : 'Run hermes-cognition'}
      </button>
      {run && (
        <div className="space-y-2">
          <div className="text-[11px] font-mono text-cyan-300">
            {String(run.passed)}/{String(run.total)} passed · score {Number(run.score).toFixed(3)} · {Number(run.duration_ms).toFixed(0)}ms
          </div>
          {results.map((row) => (
            <div key={row.id} className="px-3 py-2 rounded-lg border border-gray-800 bg-black/40 text-[11px] font-mono flex justify-between gap-3">
              <span className="text-gray-300 truncate">
                <span style={{ color: row.passed ? 'var(--accent-mint)' : '#f87171' }}>{row.passed ? '✓' : '✗'}</span>{' '}
                {row.id} — {row.input}
              </span>
              <span className="text-gray-500 flex-shrink-0">{row.score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SkillsPane({
  onRunInChat,
  onClose,
}: {
  onRunInChat?: (text: string) => void;
  onClose: () => void;
}) {
  const [task, setTask] = useState('prove that the square root of 2 is irrational');
  const [pack, setPack] = useState<Record<string, unknown> | null>(null);
  const [catalog, setCatalog] = useState<{ id: string; name: string; description: string }[]>([]);

  useEffect(() => {
    fetch('/v1/skills')
      .then((r) => r.json())
      .then((body) => setCatalog(body.data || []))
      .catch(() => undefined);
  }, []);

  const compose = async () => {
    const res = await fetch('/v1/skills/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task }),
    }).then((r) => r.json());
    setPack(res);
  };

  const skills = (pack?.skills as { name: string; score: number }[]) || [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {catalog.map((s) => (
          <div key={s.id} className="p-2.5 rounded-xl border border-gray-800 bg-black/30">
            <p className="text-xs font-bold text-white font-mono">{s.name}</p>
            <p className="text-[11px] text-gray-400">{s.description}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          className="flex-1 px-3 py-2 rounded-xl bg-black border border-gray-700 text-xs font-mono text-white outline-none"
        />
        <button
          onClick={compose}
          className="px-4 py-2 rounded-xl text-xs font-bold font-mono"
          style={{ background: 'var(--accent-mint)', color: '#060914' }}
        >
          Match skills
        </button>
      </div>
      {skills.length > 0 && (
        <div className="space-y-2">
          {skills.map((s) => (
            <div key={s.name} className="text-[11px] font-mono text-cyan-300">
              {s.name} · {s.score.toFixed(2)}
            </div>
          ))}
          {onRunInChat && (
            <button
              onClick={() => {
                onRunInChat(task);
                onClose();
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold font-mono bg-cyan-400 text-black"
            >
              Run with matched skills
            </button>
          )}
        </div>
      )}
    </div>
  );
}

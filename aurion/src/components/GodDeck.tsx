/* ─── God Deck — ToT, causal world, hypotheses, proofs, red-team ─── */
"use client";

import { useEffect, useState } from 'react';

interface GodDeckProps {
  isOpen: boolean;
  onClose: () => void;
  onRunInChat?: (text: string) => void;
}

type Tab = 'run' | 'tot' | 'causal' | 'proof' | 'redteam' | 'forecast';

export function GodDeck({ isOpen, onClose, onRunInChat }: GodDeckProps) {
  const [tab, setTab] = useState<Tab>('run');
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/v1/god')
      .then((r) => r.json())
      .then(setManifest)
      .catch(() => undefined);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(4, 7, 18, 0.88)', backdropFilter: 'blur(14px)' }}
    >
      <div
        className="w-full max-w-5xl h-[90vh] flex flex-col rounded-2xl overflow-hidden animate-fade-in shadow-2xl"
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid rgba(251, 191, 36, 0.35)',
          boxShadow: '0 25px 60px -15px rgba(251, 191, 36, 0.25)',
        }}
      >
        <div
          className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0"
          style={{ borderColor: 'var(--border-color)', background: 'rgba(15, 22, 43, 0.85)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold"
              style={{ background: 'linear-gradient(135deg, #fbbf24, #f87171)', color: '#060914' }}
            >
              Ω
            </div>
            <div>
              <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: '#fbbf24' }}>
                God Deck
              </h2>
              <p className="text-xs text-gray-400 font-mono">
                MCTS · Causal do() · Hypotheses · Proof kernel · Red-team
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" />
            </svg>
          </button>
        </div>

        <div className="px-6 pt-3 flex gap-1.5 flex-shrink-0 overflow-x-auto">
          {(['run', 'tot', 'causal', 'proof', 'redteam', 'forecast'] as Tab[]).map((name) => (
            <button
              key={name}
              onClick={() => setTab(name)}
              className="text-[11px] px-3 py-1.5 rounded-lg uppercase font-mono"
              style={{
                background: tab === name ? 'rgba(251,191,36,0.15)' : 'var(--bg-tertiary)',
                border: `1px solid ${tab === name ? '#fbbf24' : 'var(--border-color)'}`,
                color: tab === name ? '#fbbf24' : 'var(--text-muted)',
              }}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {manifest && (
            <div className="text-[10px] font-mono text-gray-400">
              arsenal: {((manifest.engines as string[]) || []).join(' · ')}
            </div>
          )}
          {tab === 'run' && <RunPane onRunInChat={onRunInChat} onClose={onClose} />}
          {tab === 'tot' && <ToTPane />}
          {tab === 'causal' && <CausalPane />}
          {tab === 'proof' && <ProofPane />}
          {tab === 'redteam' && <RedTeamPane />}
          {tab === 'forecast' && <ForecastPane />}
        </div>
      </div>
    </div>
  );
}

function RunPane({
  onRunInChat,
  onClose,
}: {
  onRunInChat?: (text: string) => void;
  onClose: () => void;
}) {
  const [task, setTask] = useState('Why did the sandbox fail on a timeout boundary, and what should we intervene on?');
  const [out, setOut] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch('/v1/god/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, simulations: 16 }),
      }).then((r) => r.json());
      setOut(res);
    } finally {
      setLoading(false);
    }
  };

  const notes = (out?.notes as string[]) || [];

  return (
    <div className="space-y-3">
      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        rows={3}
        className="w-full px-3 py-2 rounded-xl bg-black border border-gray-700 text-xs font-mono text-white outline-none"
      />
      <button
        onClick={run}
        disabled={loading}
        className="px-4 py-2 rounded-xl text-xs font-bold font-mono"
        style={{ background: '#fbbf24', color: '#060914' }}
      >
        {loading ? 'Fusing arsenal…' : 'Engage God Mode'}
      </button>
      {out && (
        <div className="space-y-2">
          <div className="text-[11px] font-mono text-amber-300">
            arsenal={(out.arsenal as string[])?.join(', ')} · {Number(out.duration_ms).toFixed(0)}ms
          </div>
          {notes.map((n) => (
            <p key={n} className="text-xs text-gray-300 font-mono">• {n}</p>
          ))}
          {onRunInChat && (
            <button
              onClick={() => {
                onRunInChat(`God Mode briefing on: ${task}\n\n${notes.join('\n')}`);
                onClose();
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold font-mono bg-cyan-400 text-black"
            >
              Drop briefing into chat
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ToTPane() {
  const [task, setTask] = useState('Design a rate limiter for a public API');
  const [out, setOut] = useState<Record<string, unknown> | null>(null);

  const run = async () => {
    const res = await fetch('/v1/god/tot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, simulations: 20, depth: 3 }),
    }).then((r) => r.json());
    setOut(res);
  };

  const path = (out?.best_path as { lens: string; thought: string; mean: number }[]) || [];

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          className="flex-1 px-3 py-2 rounded-xl bg-black border border-gray-700 text-xs font-mono text-white outline-none"
        />
        <button onClick={run} className="px-4 py-2 rounded-xl text-xs font-bold font-mono" style={{ background: '#fbbf24', color: '#060914' }}>
          Search
        </button>
      </div>
      {path.filter((p) => p.lens !== 'root').map((p) => (
        <div key={p.lens + p.thought.slice(0, 12)} className="p-2.5 rounded-lg border border-gray-800 bg-black/40 text-[11px] font-mono">
          <span className="text-amber-300">{p.lens}</span>
          <span className="text-gray-500"> · {p.mean?.toFixed?.(3)}</span>
          <p className="text-gray-300 mt-1">{p.thought}</p>
        </div>
      ))}
    </div>
  );
}

function CausalPane() {
  const [out, setOut] = useState<Record<string, unknown> | null>(null);

  const run = async (doMap: Record<string, number>) => {
    const res = await fetch('/v1/god/world/intervene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ do: doMap, steps: 4 }),
    }).then((r) => r.json());
    setOut(res);
  };

  const effects = (out?.effects as Record<string, number>) || {};

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => run({ grounding: 0.95 })} className="px-3 py-1.5 rounded-lg text-[11px] font-mono border border-gray-700 text-cyan-300">
          do(grounding=0.95)
        </button>
        <button onClick={() => run({ latency: 0.85 })} className="px-3 py-1.5 rounded-lg text-[11px] font-mono border border-gray-700 text-amber-300">
          do(latency=0.85)
        </button>
        <button onClick={() => run({ safety: 0.98 })} className="px-3 py-1.5 rounded-lg text-[11px] font-mono border border-gray-700 text-pink-300">
          do(safety=0.98)
        </button>
      </div>
      {Object.keys(effects).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(effects).map(([k, v]) => (
            <div key={k} className="p-2 rounded-lg bg-black/40 border border-gray-800 text-[11px] font-mono">
              <span className="text-gray-400">{k}</span>
              <span className="float-right" style={{ color: v >= 0 ? '#4ade80' : '#f87171' }}>
                {v >= 0 ? '+' : ''}{v.toFixed(3)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProofPane() {
  const [out, setOut] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch('/v1/god/proof/demo')
      .then((r) => r.json())
      .then(setOut)
      .catch(() => undefined);
  }, []);

  const steps = (out?.steps as { index: number; rule: string; formula: string }[]) || [];

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-400 font-mono">
        Built-in sequent: from P and P→Q infer Q · ok={String(out?.ok)}
      </p>
      {steps.map((s) => (
        <div key={s.index} className="px-3 py-2 rounded-lg border border-gray-800 bg-black/40 text-[11px] font-mono flex justify-between">
          <span className="text-gray-300">{s.index}. {s.formula}</span>
          <span className="text-amber-300">{s.rule}</span>
        </div>
      ))}
    </div>
  );
}

function RedTeamPane() {
  const [out, setOut] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch('/v1/god/redteam/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then((r) => r.json());
      setOut(res);
    } finally {
      setLoading(false);
    }
  };

  const results = (out?.results as { id: string; passed: boolean; expect: string; got: string }[]) || [];

  return (
    <div className="space-y-3">
      <button
        onClick={run}
        disabled={loading}
        className="px-4 py-2 rounded-xl text-xs font-bold font-mono"
        style={{ background: '#f87171', color: '#060914' }}
      >
        {loading ? 'Attacking…' : 'Run red-team battery'}
      </button>
      {out && (
        <p className="text-[11px] font-mono text-amber-300">
          {String(out.passed)}/{String(out.total)} held · score {Number(out.score).toFixed(2)}
        </p>
      )}
      {results.map((r) => (
        <div key={r.id} className="px-3 py-2 rounded-lg border border-gray-800 bg-black/40 text-[11px] font-mono flex justify-between">
          <span className="text-gray-300">
            <span style={{ color: r.passed ? '#4ade80' : '#f87171' }}>{r.passed ? '✓' : '✗'}</span> {r.id}
          </span>
          <span className="text-gray-500">{r.expect} → {r.got}</span>
        </div>
      ))}
    </div>
  );
}

function ForecastPane() {
  const [statement, setStatement] = useState('This God Mode briefing will be useful.');
  const [p, setP] = useState(0.72);
  const [book, setBook] = useState<Record<string, unknown> | null>(null);

  const refresh = async () => {
    const res = await fetch('/v1/god/forecasts').then((r) => r.json());
    setBook(res);
  };

  const file = async () => {
    await fetch('/v1/god/forecasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statement, probability: p, tags: ['god-deck'] }),
    });
    await refresh();
  };

  const resolve = async (fid: string, outcome: boolean) => {
    await fetch(`/v1/god/forecasts/${fid}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome }),
    });
    await refresh();
  };

  const rows = (book?.data as { id: string; statement: string; probability: number; resolved: boolean; brier: number | null }[]) || [];
  const cal = (book?.calibration as { mean_brier: number | null; resolved: number; open: number }) || { mean_brier: null, resolved: 0, open: 0 };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          className="flex-1 px-3 py-2 rounded-xl bg-black border border-gray-700 text-xs font-mono text-white outline-none"
        />
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={p}
          onChange={(e) => setP(Number(e.target.value))}
          className="w-24 px-3 py-2 rounded-xl bg-black border border-gray-700 text-xs font-mono text-white outline-none"
        />
        <button onClick={file} className="px-4 py-2 rounded-xl text-xs font-bold font-mono" style={{ background: '#fbbf24', color: '#060914' }}>
          File
        </button>
        <button onClick={refresh} className="px-3 py-2 rounded-xl text-[11px] font-mono border border-gray-700 text-gray-300">
          Refresh
        </button>
      </div>
      <p className="text-[11px] font-mono text-amber-300">
        open={cal.open} · resolved={cal.resolved} · mean Brier {cal.mean_brier ?? '—'}
      </p>
      {rows.map((f) => (
        <div key={f.id} className="px-3 py-2 rounded-lg border border-gray-800 bg-black/40 text-[11px] font-mono space-y-1">
          <div className="flex justify-between gap-2">
            <span className="text-gray-300 truncate">{f.statement}</span>
            <span className="text-amber-300 flex-shrink-0">p={f.probability.toFixed(2)}</span>
          </div>
          {f.resolved ? (
            <span className="text-gray-500">brier {f.brier}</span>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => resolve(f.id, true)} className="text-emerald-400">resolve true</button>
              <button onClick={() => resolve(f.id, false)} className="text-rose-400">resolve false</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

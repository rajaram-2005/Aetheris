/* ─── Inspector — live trace of the Hermes cascade + meta-learning ─── */
"use client";

import { useEffect, useState } from 'react';
import { HermesRun, MetaStats, StageTrace } from '@/types';
import { getMetaStats } from '@/lib/hermes';

interface InspectorProps {
  run: HermesRun | null;
  processing: boolean;
}

const STAGE_META: Record<string, { icon: string; color: string; desc: string }> = {
  perceive: { icon: '🔍', color: '#3dffc2', desc: 'Tokens, language, entities, sentiment' },
  classify: { icon: '🎯', color: '#62b6cb', desc: 'Intent via cue regex + TF-IDF cosine' },
  adapt: { icon: '🧬', color: '#c084fc', desc: 'Meta-learning: exemplars, priors, strategy' },
  deliberate: { icon: '🧮', color: '#fbbf24', desc: 'Exact symbolic computation' },
  ground: { icon: '📚', color: '#f5c16c', desc: 'BM25 over corpus + mounted documents' },
  route: { icon: '🛰️', color: '#93c5fd', desc: 'Sparse mixture-of-experts routing' },
  recall: { icon: '🧠', color: '#a78bfa', desc: 'Hierarchical long-term memory' },
  act: { icon: '🛠️', color: '#fb923c', desc: 'Real tool execution in the sandbox' },
  synthesize: { icon: '🧵', color: '#e8837c', desc: 'Compose the answer' },
  polish: { icon: '✨', color: '#a78bfa', desc: 'Safety, honesty, vendor-voice strip' },
  learn: { icon: '📈', color: '#4ade80', desc: 'Record episode, update the learner' },
};

const TABS = ['cascade', 'learning'] as const;
type Tab = (typeof TABS)[number];

export function Inspector({ run, processing }: InspectorProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('cascade');
  const [meta, setMeta] = useState<MetaStats | null>(null);

  // Refresh learning stats whenever a run completes or the tab is opened.
  useEffect(() => {
    if (tab !== 'learning' && !run) return;
    let cancelled = false;
    getMetaStats()
      .then((stats) => !cancelled && setMeta(stats))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [run, tab]);

  const totalTime = run?.duration_ms ?? 0;

  return (
    <aside
      className="w-80 flex-shrink-0 flex flex-col h-full border-l overflow-hidden"
      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
    >
      {/* Header */}
      <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-between">
          <h3
            className="text-sm font-semibold flex items-center gap-2"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}
          >
            ⚡ Hermes Inspector
          </h3>
          {run && (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full"
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {totalTime.toFixed(0)}ms
            </span>
          )}
        </div>

        <div className="flex gap-1 mt-3">
          {TABS.map((name) => (
            <button
              key={name}
              onClick={() => setTab(name)}
              className="text-[10px] px-2 py-1 rounded capitalize transition-colors"
              style={{
                background: tab === name ? 'var(--bg-hover)' : 'transparent',
                border: `1px solid ${tab === name ? 'var(--border-hover)' : 'transparent'}`,
                color: tab === name ? 'var(--accent-mint)' : 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tab === 'cascade' && (
          <CascadeView run={run} processing={processing} expanded={expanded} setExpanded={setExpanded} />
        )}
        {tab === 'learning' && <LearningView meta={meta} run={run} />}
      </div>

      {/* Footer summary */}
      {tab === 'cascade' && run && (
        <div className="p-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Intent" value={run.intent} color="var(--accent-mint)" />
            <Stat
              label="Confidence"
              value={`${(run.confidence * 100).toFixed(0)}%`}
              color="var(--accent-blue)"
            />
            <Stat label="Reward" value={run.reward.toFixed(2)} color="var(--accent-gold)" />
          </div>
        </div>
      )}
    </aside>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <p className="text-[10px]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {label}
      </p>
      <p className="text-xs font-medium truncate" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function CascadeView({
  run, processing, expanded, setExpanded,
}: {
  run: HermesRun | null;
  processing: boolean;
  expanded: string | null;
  setExpanded: (v: string | null) => void;
}) {
  if (!run && !processing) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <div className="text-3xl mb-3">⚡</div>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Send a message to watch the Hermes cascade run
        </p>
        <p
          className="text-[10px] mt-2"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          11 stages · fully offline
        </p>
      </div>
    );
  }

  if (processing && !run) {
    return (
      <div className="space-y-2">
        {Object.entries(STAGE_META).map(([name, info], i) => (
          <div
            key={name}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
              style={{
                background: `${info.color}20`,
                border: `1px solid ${info.color}40`,
                animation: 'pulse-glow 1s ease-in-out infinite',
                animationDelay: `${i * 0.1}s`,
              }}
            >
              {info.icon}
            </div>
            <span
              className="text-xs font-medium uppercase"
              style={{ color: info.color, fontFamily: 'var(--font-mono)' }}
            >
              {name}
            </span>
            <div className="ml-auto w-2 h-2 rounded-full animate-pulse" style={{ background: info.color }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {run!.stages.map((stage) => {
        const info = STAGE_META[stage.stage] || { icon: '•', color: '#888', desc: '' };
        const isExpanded = expanded === stage.stage;
        return (
          <div
            key={stage.stage}
            className="rounded-lg overflow-hidden transition-all"
            style={{
              background: 'var(--bg-tertiary)',
              border: `1px solid ${info.color}20`,
              opacity: stage.skipped ? 0.5 : 1,
            }}
          >
            <button
              onClick={() => setExpanded(isExpanded ? null : stage.stage)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0"
                style={{ background: `${info.color}30`, border: `1px solid ${info.color}50` }}
              >
                {info.icon}
              </div>
              <div className="flex-1 min-w-0">
                <span
                  className="text-xs font-semibold uppercase"
                  style={{ color: info.color, fontFamily: 'var(--font-mono)' }}
                >
                  {stage.stage}
                </span>
                <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                  {stage.summary || info.desc}
                </p>
              </div>
              <span
                className="text-[10px] flex-shrink-0"
                style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              >
                {stage.skipped ? 'skip' : `${stage.duration_ms.toFixed(1)}ms`}
              </span>
            </button>

            {isExpanded && (
              <div
                className="px-3 pb-3 pt-1 border-t animate-fade-in"
                style={{ borderColor: `${info.color}15` }}
              >
                <pre
                  className="text-[10px] overflow-x-auto whitespace-pre-wrap break-words"
                  style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', maxHeight: 260 }}
                >
                  {JSON.stringify(stage.detail, null, 1)}
                </pre>
              </div>
            )}
          </div>
        );
      })}

      {run!.tool_trace.length > 0 && (
        <div className="mt-3">
          <p
            className="text-[10px] mb-1.5 uppercase"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            Tools executed
          </p>
          {run!.tool_trace.map((call, i) => (
            <div
              key={i}
              className="px-3 py-2 rounded-lg mb-1.5 text-[11px]"
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
            >
              <div className="flex items-center gap-2">
                <span style={{ color: call.ok ? 'var(--accent-mint)' : 'var(--accent-pink)' }}>
                  {call.ok ? '✓' : '✗'}
                </span>
                <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {call.tool}
                </span>
                <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>
                  {call.duration_ms}ms
                </span>
              </div>
              {call.error && (
                <p className="mt-1" style={{ color: 'var(--accent-pink)' }}>
                  {call.error}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function LearningView({ meta, run }: { meta: MetaStats | null; run: HermesRun | null }) {
  if (!meta) {
    return (
      <p className="text-xs p-2" style={{ color: 'var(--text-muted)' }}>
        Loading meta-learning state…
      </p>
    );
  }

  const strategy = Object.entries(meta.strategy);

  return (
    <div className="space-y-3 text-[11px]" style={{ fontFamily: 'var(--font-mono)' }}>
      <Panel title="Learning state">
        <Row label="Episodes" value={String(meta.episodes)} />
        <Row label="Meta-updates" value={String(meta.updates)} />
        <Row label="Few-shot exemplars" value={String(meta.exemplars)} />
        <Row label="Mean reward" value={meta.mean_reward.toFixed(3)} />
        <Row
          label="Recent reward"
          value={meta.recent_mean_reward.toFixed(3)}
          color={meta.improving ? 'var(--accent-mint)' : undefined}
        />
        <Row
          label="Trend"
          value={meta.improving ? 'improving ↑' : 'steady'}
          color={meta.improving ? 'var(--accent-mint)' : 'var(--text-secondary)'}
        />
      </Panel>

      <Panel title="Adapted strategy">
        {strategy.map(([key, value]) => (
          <div key={key} className="mb-1.5">
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>{key.replace(/_/g, ' ')}</span>
              <span style={{ color: 'var(--accent-gold)' }}>{value.toFixed(3)}</span>
            </div>
            <div className="h-1 rounded mt-0.5" style={{ background: 'var(--bg-hover)' }}>
              <div
                className="h-full rounded transition-all"
                style={{ width: `${value * 100}%`, background: 'var(--accent-mint)' }}
              />
            </div>
          </div>
        ))}
      </Panel>

      {run && run.adaptation.rationale.length > 0 && (
        <Panel title="This turn's adaptation">
          <Row label="Familiarity" value={run.adaptation.familiarity.toFixed(3)} />
          <Row label="Exemplars used" value={String(run.adaptation.exemplars.length)} />
          {run.adaptation.rationale.map((line, i) => (
            <p key={i} className="mt-1" style={{ color: 'var(--text-secondary)' }}>
              • {line}
            </p>
          ))}
        </Panel>
      )}

      {meta.tool_priors.length > 0 && (
        <Panel title="Learned tool priors">
          {meta.tool_priors.slice(0, 8).map((prior) => (
            <div key={`${prior.intent}/${prior.tool}`} className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>
                {prior.intent}/{prior.tool}
              </span>
              <span
                style={{
                  color: prior.success_rate >= 0.6 ? 'var(--accent-mint)' : 'var(--accent-pink)',
                }}
              >
                {(prior.success_rate * 100).toFixed(0)}% ({prior.attempts})
              </span>
            </div>
          ))}
        </Panel>
      )}

      {Object.keys(meta.intent_prior).length > 0 && (
        <Panel title="Intent prior">
          {Object.entries(meta.intent_prior).slice(0, 8).map(([intent, weight]) => (
            <div key={intent} className="flex items-center gap-2">
              <span className="w-24 truncate" style={{ color: 'var(--text-muted)' }}>
                {intent}
              </span>
              <div className="flex-1 h-1 rounded" style={{ background: 'var(--bg-hover)' }}>
                <div
                  className="h-full rounded"
                  style={{ width: `${weight * 100}%`, background: 'var(--accent-blue)' }}
                />
              </div>
              <span style={{ color: 'var(--text-secondary)' }}>{(weight * 100).toFixed(0)}%</span>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg p-2.5"
      style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
    >
      <p className="text-[10px] mb-1.5 uppercase" style={{ color: 'var(--accent-mint)' }}>
        {title}
      </p>
      {children}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: color || 'var(--text-secondary)' }}>{value}</span>
    </div>
  );
}

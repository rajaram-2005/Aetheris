/* ─── C7 Inspector — Right panel showing cascade trace ─── */
"use client";

import { useState } from 'react';
import { C7Trace } from '@/types';

interface InspectorProps {
  trace: C7Trace | null;
  processing: boolean;
}

const STAGE_INFO: { key: keyof C7Trace; label: string; icon: string; color: string; desc: string }[] = [
  { key: 'sense', label: 'SENSE', icon: '🔍', color: '#3dffc2', desc: 'Tokenize, detect language, extract entities' },
  { key: 'align', label: 'ALIGN', icon: '🎯', color: '#62b6cb', desc: 'Classify intent via TF-IDF + cue patterns' },
  { key: 'plot', label: 'PLOT', icon: '📋', color: '#93c5fd', desc: 'Map intent to task graph + style' },
  { key: 'recall', label: 'RECALL', icon: '📚', color: '#f5c16c', desc: 'BM25 search over knowledge base' },
  { key: 'think', label: 'THINK', icon: '🧮', color: '#fbbf24', desc: 'Math parser, conversions, statistics' },
  { key: 'weave', label: 'WEAVE', icon: '🧵', color: '#e8837c', desc: 'Generate response per intent' },
  { key: 'refine', label: 'REFINE', icon: '✨', color: '#a78bfa', desc: 'Safety, honesty, persona polish' },
];

export function Inspector({ trace, processing }: InspectorProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const totalTime = trace ? Object.values(trace.timings).reduce((a, b) => a + b, 0) : 0;

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
            ⚡ C7 Inspector
          </h3>
          {trace && (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full"
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {totalTime.toFixed(0)}ms
            </span>
          )}
        </div>
        <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Live cascade trace
        </p>
      </div>

      {/* Stages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {!trace && !processing && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="text-3xl mb-3">⚡</div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Send a message to see the C7 cascade in action
            </p>
            <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Each stage lights up as it processes
            </p>
          </div>
        )}

        {processing && !trace && (
          <div className="space-y-2">
            {STAGE_INFO.map((stage, i) => (
              <div
                key={stage.key}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
                  style={{
                    background: `${stage.color}20`,
                    border: `1px solid ${stage.color}40`,
                    animation: 'pulse-glow 1s ease-in-out infinite',
                    animationDelay: `${i * 0.15}s`,
                  }}
                >
                  {stage.icon}
                </div>
                <div className="flex-1">
                  <span className="text-xs font-medium" style={{ color: stage.color, fontFamily: 'var(--font-mono)' }}>
                    {stage.label}
                  </span>
                </div>
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: stage.color }} />
              </div>
            ))}
          </div>
        )}

        {trace && STAGE_INFO.map(stage => {
          const data = trace[stage.key];
          const timing = trace.timings[stage.key];
          const isExpanded = expanded === stage.key;

          return (
            <div
              key={stage.key}
              className="rounded-lg overflow-hidden transition-all"
              style={{ background: 'var(--bg-tertiary)', border: `1px solid ${stage.color}20` }}
            >
              <button
                onClick={() => setExpanded(isExpanded ? null : stage.key)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
                  style={{
                    background: `${stage.color}30`,
                    border: `1px solid ${stage.color}50`,
                    boxShadow: `0 0 8px ${stage.color}20`,
                  }}
                >
                  {stage.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold" style={{ color: stage.color, fontFamily: 'var(--font-mono)' }}>
                    {stage.label}
                  </span>
                  <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                    {stage.desc}
                  </p>
                </div>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {timing?.toFixed(1)}ms
                </span>
              </button>

              {isExpanded && (
                <div
                  className="px-3 pb-3 pt-1 border-t animate-fade-in"
                  style={{ borderColor: `${stage.color}15` }}
                >
                  <StageDetail stage={stage.key} data={data} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {trace && (
        <div className="p-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Intent</p>
              <p className="text-xs font-medium" style={{ color: 'var(--accent-mint)' }}>{trace.align.intent}</p>
            </div>
            <div>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Language</p>
              <p className="text-xs font-medium" style={{ color: 'var(--accent-gold)' }}>{trace.sense.language}</p>
            </div>
            <div>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Confidence</p>
              <p className="text-xs font-medium" style={{ color: 'var(--accent-blue)' }}>{(trace.align.confidence * 100).toFixed(0)}%</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function StageDetail({ stage, data }: { stage: string; data: unknown }) {
  if (!data) return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No data</p>;

  switch (stage) {
    case 'sense': {
      const s = data as C7Trace['sense'];
      return (
        <div className="space-y-1.5 text-[11px]" style={{ fontFamily: 'var(--font-mono)' }}>
          <div><span style={{ color: 'var(--text-muted)' }}>Tokens:</span> <span style={{ color: 'var(--text-secondary)' }}>{s.tokens.length}</span></div>
          <div><span style={{ color: 'var(--text-muted)' }}>Language:</span> <span style={{ color: 'var(--accent-mint)' }}>{s.language}</span> ({s.script})</div>
          <div><span style={{ color: 'var(--text-muted)' }}>Sentiment:</span> <span style={{ color: s.sentiment > 0 ? 'var(--accent-mint)' : s.sentiment < 0 ? 'var(--accent-pink)' : 'var(--text-secondary)' }}>{s.sentiment.toFixed(2)}</span></div>
          <div><span style={{ color: 'var(--text-muted)' }}>Keywords:</span> <span style={{ color: 'var(--accent-gold)' }}>{s.keywords.join(', ') || 'none'}</span></div>
          <div><span style={{ color: 'var(--text-muted)' }}>Entities:</span> {s.entities.length > 0 ? s.entities.map(e => <span key={e.value} className="inline-block px-1 py-0.5 rounded mr-1 text-[10px]" style={{ background: 'var(--bg-hover)' }}>{e.type}:{e.value}</span>) : 'none'}</div>
        </div>
      );
    }
    case 'align': {
      const a = data as C7Trace['align'];
      return (
        <div className="space-y-1.5 text-[11px]" style={{ fontFamily: 'var(--font-mono)' }}>
          <div><span style={{ color: 'var(--text-muted)' }}>Primary:</span> <span style={{ color: 'var(--accent-mint)' }}>{a.intent}</span> ({(a.confidence * 100).toFixed(0)}%)</div>
          <div><span style={{ color: 'var(--text-muted)' }}>Alternatives:</span></div>
          {a.subIntents.slice(0, 5).map(si => (
            <div key={si.intent} className="flex items-center gap-2 pl-3">
              <span style={{ color: 'var(--text-secondary)' }}>{si.intent}</span>
              <div className="flex-1 h-1 rounded" style={{ background: 'var(--bg-hover)' }}>
                <div className="h-full rounded" style={{ width: `${si.score * 100}%`, background: 'var(--accent-mint)' }} />
              </div>
              <span style={{ color: 'var(--text-muted)' }}>{(si.score * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      );
    }
    case 'plot': {
      const p = data as C7Trace['plot'];
      return (
        <div className="space-y-1.5 text-[11px]" style={{ fontFamily: 'var(--font-mono)' }}>
          <div><span style={{ color: 'var(--text-muted)' }}>Style:</span> <span style={{ color: 'var(--accent-gold)' }}>{p.style}</span></div>
          <div><span style={{ color: 'var(--text-muted)' }}>Format:</span> <span style={{ color: 'var(--accent-blue)' }}>{p.format}</span></div>
          <div><span style={{ color: 'var(--text-muted)' }}>Steps:</span></div>
          {p.steps.map((s, i) => (
            <div key={i} className="pl-3" style={{ color: 'var(--text-secondary)' }}>{i + 1}. {s.action}: {s.description}</div>
          ))}
        </div>
      );
    }
    case 'recall': {
      const r = data as C7Trace['recall'];
      return (
        <div className="space-y-1.5 text-[11px]" style={{ fontFamily: 'var(--font-mono)' }}>
          <div><span style={{ color: 'var(--text-muted)' }}>KB Articles:</span> <span style={{ color: 'var(--accent-mint)' }}>{r.articles.length}</span></div>
          {r.articles.slice(0, 3).map(a => (
            <div key={a.title} className="pl-3"><span style={{ color: 'var(--accent-gold)' }}>{a.title}</span> <span style={{ color: 'var(--text-muted)' }}>(score: {a.score.toFixed(2)})</span></div>
          ))}
          {r.sessionContext && <div><span style={{ color: 'var(--text-muted)' }}>Session context:</span> <span style={{ color: 'var(--text-secondary)' }}>{r.sessionContext.length} chars</span></div>}
          {r.fileChunks.length > 0 && <div><span style={{ color: 'var(--text-muted)' }}>File chunks:</span> <span style={{ color: 'var(--text-secondary)' }}>{r.fileChunks.length}</span></div>}
        </div>
      );
    }
    case 'think': {
      const t = data as C7Trace['think'];
      return (
        <div className="space-y-1.5 text-[11px]" style={{ fontFamily: 'var(--font-mono)' }}>
          <div><span style={{ color: 'var(--text-muted)' }}>Type:</span> <span style={{ color: 'var(--accent-mint)' }}>{t.type}</span></div>
          {t.output && <div><span style={{ color: 'var(--text-muted)' }}>Output:</span> <span style={{ color: 'var(--accent-gold)' }}>{t.output}</span></div>}
          {t.steps.length > 0 && <div><span style={{ color: 'var(--text-muted)' }}>Steps:</span> {t.steps.map((s, i) => <div key={i} className="pl-3" style={{ color: 'var(--text-secondary)' }}>{s}</div>)}</div>}
        </div>
      );
    }
    case 'weave': {
      const w = data as C7Trace['weave'];
      return (
        <div className="space-y-1.5 text-[11px]" style={{ fontFamily: 'var(--font-mono)' }}>
          <div><span style={{ color: 'var(--text-muted)' }}>Format:</span> <span style={{ color: 'var(--accent-blue)' }}>{w.format}</span></div>
          <div><span style={{ color: 'var(--text-muted)' }}>Response length:</span> <span style={{ color: 'var(--text-secondary)' }}>{w.response.length} chars</span></div>
        </div>
      );
    }
    case 'refine': {
      const r = data as C7Trace['refine'];
      return (
        <div className="space-y-1.5 text-[11px]" style={{ fontFamily: 'var(--font-mono)' }}>
          <div><span style={{ color: 'var(--text-muted)' }}>Safety:</span> <span style={{ color: r.safetyFlag ? 'var(--accent-pink)' : 'var(--accent-mint)' }}>{r.safetyFlag ? '⚠️ Flagged' : '✓ Clear'}</span></div>
          {r.honestyNote && <div><span style={{ color: 'var(--text-muted)' }}>Honesty:</span> <span style={{ color: 'var(--accent-gold)' }}>{r.honestyNote.slice(0, 100)}</span></div>}
          {r.stripped.length > 0 && <div><span style={{ color: 'var(--text-muted)' }}>Stripped patterns:</span> <span style={{ color: 'var(--text-secondary)' }}>{r.stripped.length}</span></div>}
          <div><span style={{ color: 'var(--text-muted)' }}>Final length:</span> <span style={{ color: 'var(--text-secondary)' }}>{r.final.length} chars</span></div>
        </div>
      );
    }
    default:
      return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No details</p>;
  }
}

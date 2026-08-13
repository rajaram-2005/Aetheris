/* ─── Deep Research Modal — Autonomous Multi-Hop Research Engine (OpenAI / Grok style) ─── */
"use client";

import { useState } from 'react';

type DeepResearchDepth = 'standard' | 'deep' | 'exhaustive';

interface ResearchSource {
  id: number;
  title: string;
  url_or_file: string;
  snippet: string;
  relevance_score: number;
}

interface ResearchReport {
  id: string;
  topic: string;
  executive_summary: string;
  findings: { section: string; content: string; citations: number[] }[];
  methodology: string;
  sources: ResearchSource[];
  confidence_score: number;
  duration_ms: number;
}

interface DeepResearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRunInChat?: (text: string) => void;
}

export function DeepResearchModal({ isOpen, onClose, onRunInChat }: DeepResearchModalProps) {
  const [topic, setTopic] = useState('');
  const [depth, setDepth] = useState<DeepResearchDepth>('deep');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [copied, setCopied] = useState(false);

  const handleStartResearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || loading) return;

    setLoading(true);
    setReport(null);
    try {
      const res = await fetch('/v1/research/deep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, depth }),
      }).then((r) => r.json());

      if (res.id) {
        setReport(res);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!report) return;
    const text = `# Research Dossier: ${report.topic}\n\n${report.executive_summary}\n\n` +
      report.findings.map((f) => `### ${f.section}\n${f.content}\n`).join('\n\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
          boxShadow: '0 25px 60px -15px rgba(0, 180, 216, 0.3)',
        }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0"
          style={{ borderColor: 'var(--border-color)', background: 'rgba(15, 22, 43, 0.8)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold shadow"
              style={{
                background: 'linear-gradient(135deg, #00b4d8, #3dffc2)',
                color: '#060914',
              }}
            >
              🔬
            </div>
            <div>
              <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>
                Autonomous Deep Multi-Hop Research Engine
              </h2>
              <p className="text-xs text-gray-400">
                Recursive question decomposition, evidence triangulation &amp; rigorous citation synthesis
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

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Query Launch Bar */}
          <form onSubmit={handleStartResearch} className="p-4 rounded-2xl border border-gray-800 bg-black/40 space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                placeholder="Enter complex multi-hop research topic (e.g. Distributed consensus scaling in quantum-safe networks)..."
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-black border border-gray-700 text-xs font-mono text-white outline-none focus:border-cyan-400"
                required
              />

              <select
                value={depth}
                onChange={(e) => setDepth(e.target.value as DeepResearchDepth)}
                className="bg-black border border-gray-700 px-3 py-2 rounded-xl text-xs font-mono text-cyan-300 outline-none"
              >
                <option value="standard">Standard (2 hops)</option>
                <option value="deep">Deep (4 hops)</option>
                <option value="exhaustive">Exhaustive (8 hops)</option>
              </select>

              <button
                type="submit"
                disabled={loading || !topic.trim()}
                className="px-5 py-2.5 rounded-xl text-xs font-bold font-mono transition-all hover:scale-105 disabled:opacity-40"
                style={{ background: 'var(--accent-mint)', color: '#060914' }}
              >
                {loading ? '🔍 Researching…' : '🚀 Launch Deep Research'}
              </button>
            </div>
          </form>

          {loading && (
            <div className="p-8 rounded-2xl border border-cyan-500/30 bg-cyan-950/20 text-center space-y-3 animate-fade-in">
              <div className="flex justify-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-2.5 h-2.5 rounded-full bg-cyan-400"
                    style={{ animation: `pulse-glow 1.2s ease-in-out ${i * 0.2}s infinite` }}
                  />
                ))}
              </div>
              <p className="text-xs font-mono text-cyan-300">
                Decomposing query → Searching mounted index → Triangulating citations → Synthesizing findings…
              </p>
            </div>
          )}

          {report && (
            <div className="space-y-6 animate-fade-in">
              {/* Report Header Card */}
              <div
                className="p-5 rounded-2xl border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3"
                style={{ background: 'linear-gradient(135deg, rgba(11, 19, 43, 0.9), rgba(0, 180, 216, 0.15))', borderColor: 'rgba(61, 255, 194, 0.4)' }}
              >
                <div>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    Confidence: {(report.confidence_score * 100).toFixed(1)}% · {report.duration_ms}ms
                  </span>
                  <h3 className="text-base font-bold text-white mt-1 font-display">
                    {report.topic}
                  </h3>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">
                    {report.methodology}
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleCopy}
                    className="px-3 py-1.5 rounded-lg text-xs font-mono border border-gray-700 bg-black/40 text-cyan-300 transition-colors"
                  >
                    {copied ? '✓ Copied' : '📋 Copy Report'}
                  </button>
                  {onRunInChat && (
                    <button
                      onClick={() => {
                        onRunInChat(`Synthesized Research Findings on "${report.topic}":\n\n${report.executive_summary}`);
                        onClose();
                      }}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-bold font-mono bg-cyan-400 text-black transition-all hover:scale-105"
                    >
                      💬 Discuss in Chat
                    </button>
                  )}
                </div>
              </div>

              {/* Executive Summary */}
              <div className="p-4 rounded-xl border border-white/10 bg-black/40 text-xs leading-relaxed text-gray-200">
                <span className="text-[10px] font-mono uppercase text-cyan-400 font-bold block mb-1">
                  Executive Summary
                </span>
                {report.executive_summary}
              </div>

              {/* Detailed Findings Sections */}
              <div className="space-y-4">
                {report.findings.map((finding, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl border border-gray-800 bg-black/30 space-y-2"
                  >
                    <h4 className="text-xs font-bold text-white font-mono flex items-center justify-between">
                      <span>{finding.section}</span>
                      <span className="text-[10px] text-gray-400 font-normal">
                        Citations: {finding.citations.map((c) => `[${c}]`).join(', ')}
                      </span>
                    </h4>
                    <p className="text-xs text-gray-300 leading-relaxed font-ui">
                      {finding.content}
                    </p>
                  </div>
                ))}
              </div>

              {/* Grounded Sources */}
              <div className="p-4 rounded-xl border border-gray-800 bg-black/40">
                <span className="text-[10px] font-mono uppercase text-gray-400 font-bold block mb-2">
                  Verified Grounding Sources ({report.sources.length})
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {report.sources.map((s) => (
                    <div
                      key={s.id}
                      className="p-2.5 rounded-lg border border-gray-800 bg-black/60 text-[11px]"
                    >
                      <span className="text-cyan-400 font-mono font-bold block truncate">
                        [{s.id}] {s.title}
                      </span>
                      <span className="text-[10px] text-gray-400 font-mono block truncate">
                        {s.url_or_file}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

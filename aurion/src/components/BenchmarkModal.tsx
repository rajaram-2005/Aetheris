/* ─── Benchmark Modal — Open-Source Competitive Intelligence Matrix ─── */
"use client";

import { useState, useEffect } from 'react';

interface BenchmarkScore {
  model_id: string;
  model_name: string;
  organization: string;
  is_in_house: boolean;
  mmlu_pro: number;
  humaneval: number;
  math_500: number;
  gpqa_diamond: number;
  livecodebench: number;
  swe_bench_lite: number;
  ifeval: number;
  throughput_tps: number;
  ttft_ms: number;
  context_window_k: number;
}

interface BenchmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const BENCHMARKS: { key: keyof BenchmarkScore; label: string; desc: string; max: number; unit: string }[] = [
  { key: 'mmlu_pro', label: 'MMLU-Pro', desc: 'Multi-domain Knowledge & Reasoning', max: 100, unit: '%' },
  { key: 'humaneval', label: 'HumanEval', desc: 'Python Code Generation Pass@1', max: 100, unit: '%' },
  { key: 'math_500', label: 'MATH-500', desc: 'Complex Mathematical Proofs & Algebra', max: 100, unit: '%' },
  { key: 'gpqa_diamond', label: 'GPQA Diamond', desc: 'Google-Proof Graduate-Level Science', max: 100, unit: '%' },
  { key: 'livecodebench', label: 'LiveCodeBench', desc: 'Contest-Grade Algorithmic Problem Solving', max: 100, unit: '%' },
  { key: 'swe_bench_lite', label: 'SWE-bench Lite', desc: 'Real-World GitHub Bug Resolution', max: 100, unit: '%' },
  { key: 'ifeval', label: 'IFEval', desc: 'Strict Instruction Following & Constraints', max: 100, unit: '%' },
  { key: 'throughput_tps', label: 'Throughput (TPS)', desc: 'Token Generation Speed (Tokens / Sec)', max: 300, unit: ' tps' },
];

export function BenchmarkModal({ isOpen, onClose }: BenchmarkModalProps) {
  const [data, setData] = useState<BenchmarkScore[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<keyof BenchmarkScore>('humaneval');
  const [exportModel, setExportModel] = useState<string>('aetheris-prime-v4');
  const [exportedContent, setExportedContent] = useState<string>('');
  const [exportFormat, setExportFormat] = useState<'ollama' | 'huggingface'>('ollama');

  useEffect(() => {
    if (!isOpen) return;
    fetch('/v1/neural/benchmarks')
      .then((r) => r.json())
      .then((res) => {
        if (res.all_models) setData(res.all_models);
      })
      .catch(() => undefined);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    fetch(`/v1/neural/export/${exportFormat}/${exportModel}`)
      .then((r) => r.json())
      .then((res) => {
        if (exportFormat === 'ollama') {
          setExportedContent(res.modelfile || '');
        } else {
          setExportedContent(JSON.stringify(res.config, null, 2) || '');
        }
      })
      .catch(() => undefined);
  }, [exportModel, exportFormat, isOpen]);

  if (!isOpen) return null;

  const currentMetricInfo = BENCHMARKS.find((b) => b.key === selectedMetric) || BENCHMARKS[0];
  const sorted = [...data].sort((a, b) => Number(b[selectedMetric]) - Number(a[selectedMetric]));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(4, 7, 18, 0.85)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl overflow-hidden animate-fade-in shadow-2xl"
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
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold shadow-lg"
              style={{
                background: 'linear-gradient(135deg, #00b4d8, #3dffc2)',
                color: '#060914',
              }}
            >
              📊
            </div>
            <div>
              <h2
                className="text-lg font-bold tracking-tight"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}
              >
                Foundation Model Competitive Benchmark Arena
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Empirical evaluations comparing Aetheris sovereign models against leading frontier open-source architectures
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl transition-all hover:opacity-80"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="4" x2="16" y2="16" />
              <line x1="16" y1="4" x2="4" y2="16" />
            </svg>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Benchmark Metric Selector Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {BENCHMARKS.map((b) => (
              <button
                key={b.key}
                onClick={() => setSelectedMetric(b.key)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all"
                style={{
                  background:
                    selectedMetric === b.key
                      ? 'rgba(61, 255, 194, 0.15)'
                      : 'var(--bg-tertiary)',
                  border: `1px solid ${
                    selectedMetric === b.key ? 'var(--accent-mint)' : 'var(--border-color)'
                  }`,
                  color:
                    selectedMetric === b.key ? 'var(--accent-mint)' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {b.label}
              </button>
            ))}
          </div>

          {/* Metric Description */}
          <div
            className="p-4 rounded-xl flex items-center justify-between"
            style={{
              background: 'rgba(0, 180, 216, 0.08)',
              border: '1px solid rgba(0, 180, 216, 0.2)',
            }}
          >
            <div>
              <span className="text-xs uppercase font-mono tracking-wider font-semibold text-cyan-400">
                Evaluation Metric: {currentMetricInfo.label}
              </span>
              <p className="text-xs text-gray-300 mt-0.5">{currentMetricInfo.desc}</p>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-cyan-950/60 text-cyan-300 border border-cyan-500/30">
              Higher is better ↑
            </span>
          </div>

          {/* Model Comparison Bar Visualizer */}
          <div className="space-y-3">
            {sorted.map((m, idx) => {
              const val = Number(m[selectedMetric]);
              const pct = Math.min(100, (val / currentMetricInfo.max) * 100);
              return (
                <div
                  key={m.model_id}
                  className="p-3.5 rounded-xl border transition-all"
                  style={{
                    background: m.is_in_house
                      ? 'linear-gradient(135deg, rgba(11, 19, 43, 0.8), rgba(0, 180, 216, 0.12))'
                      : 'var(--bg-tertiary)',
                    borderColor: m.is_in_house
                      ? 'rgba(61, 255, 194, 0.4)'
                      : 'var(--border-color)',
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono opacity-60">#{idx + 1}</span>
                      <span
                        className="text-sm font-bold"
                        style={{
                          color: m.is_in_house ? 'var(--accent-mint)' : 'var(--text-primary)',
                          fontFamily: 'var(--font-display)',
                        }}
                      >
                        {m.model_name}
                      </span>
                      {m.is_in_house && (
                        <span className="text-[10px] px-2 py-0.2 rounded-full font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                          ✦ Sovereign
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-gray-400">
                        {m.organization}
                      </span>
                      <span
                        className="text-sm font-bold font-mono"
                        style={{ color: m.is_in_house ? 'var(--accent-mint)' : 'var(--text-primary)' }}
                      >
                        {val}
                        {currentMetricInfo.unit}
                      </span>
                    </div>
                  </div>

                  {/* Score Progress Bar */}
                  <div className="h-2 rounded-full overflow-hidden bg-black/40 border border-white/5">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${pct}%`,
                        background: m.is_in_house
                          ? 'linear-gradient(90deg, #00b4d8, #3dffc2)'
                          : 'linear-gradient(90deg, #64748b, #94a3b8)',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Developer Interop & Export Section */}
          <div
            className="p-5 rounded-2xl border space-y-4"
            style={{
              background: 'rgba(15, 22, 43, 0.6)',
              borderColor: 'var(--border-color)',
            }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-white font-mono">
                  📦 Open-Source Interop &amp; Export Formats
                </h3>
                <p className="text-xs text-gray-400">
                  Export Aetheris sovereign model configs directly for Ollama, vLLM, or HuggingFace
                </p>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={exportModel}
                  onChange={(e) => setExportModel(e.target.value)}
                  className="bg-black/50 border text-xs rounded-lg px-2.5 py-1.5 font-mono text-cyan-300 outline-none"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <option value="aetheris-prime-v4">Aetheris Prime v4</option>
                  <option value="aetheris-omni-reasoner">Aetheris Omni Reasoner</option>
                  <option value="aetheris-flash-v2">Aetheris Flash v2</option>
                  <option value="aetheris-vision-v3">Aetheris Vision v3</option>
                </select>

                <div className="flex rounded-lg overflow-hidden border border-gray-700">
                  <button
                    onClick={() => setExportFormat('ollama')}
                    className="px-2.5 py-1 text-xs font-mono transition-colors"
                    style={{
                      background: exportFormat === 'ollama' ? 'var(--accent-mint)' : 'transparent',
                      color: exportFormat === 'ollama' ? '#000' : 'var(--text-muted)',
                    }}
                  >
                    Ollama
                  </button>
                  <button
                    onClick={() => setExportFormat('huggingface')}
                    className="px-2.5 py-1 text-xs font-mono transition-colors"
                    style={{
                      background:
                        exportFormat === 'huggingface' ? 'var(--accent-mint)' : 'transparent',
                      color: exportFormat === 'huggingface' ? '#000' : 'var(--text-muted)',
                    }}
                  >
                    HuggingFace
                  </button>
                </div>
              </div>
            </div>

            <pre className="p-3.5 rounded-xl bg-black/80 border border-gray-800 text-xs font-mono text-cyan-200 overflow-x-auto max-h-48 leading-relaxed">
              {exportedContent}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

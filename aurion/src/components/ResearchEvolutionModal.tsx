/* ─── AI Evolution Research Hub (50 Milestones 1950-2026) ─── */
"use client";

import { useState, useEffect } from 'react';
import {
  ResearchBenchmarkResult, ResearchFeatureItem, ResearchRunOutput,
  ResearchSynthesisContribution, ResearchSynthesisResult, ResearchTimelineItem,
} from '@/types';

interface ResearchEvolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ERA_LABELS: Record<string, { label: string; span: string; color: string }> = {
  all: { label: 'All 50 Milestones', span: '1950–2026', color: 'border-emerald-500/30 text-emerald-300' },
  symbolic_foundations_1950_1980: { label: '1. Symbolic Foundations', span: '1950–1989', color: 'border-blue-500/30 text-blue-300' },
  statistical_learning_1990_2000: { label: '2. Statistical & Kernels', span: '1990–2009', color: 'border-purple-500/30 text-purple-300' },
  deep_learning_revolution_2010_2017: { label: '3. Deep Learning', span: '2010–2017', color: 'border-amber-500/30 text-amber-300' },
  transformers_scaling_2018_2022: { label: '4. Transformers & Scaling', span: '2018–2022', color: 'border-cyan-500/30 text-cyan-300' },
  direct_alignment_efficiency_2023_2024: { label: '5. Alignment & Efficiency', span: '2023–2024', color: 'border-rose-500/30 text-rose-300' },
  frontier_reasoning_compute_2024_2026: { label: '6. Frontier Reasoning', span: '2024–2026', color: 'border-emerald-500/30 text-emerald-300' },
};

export function ResearchEvolutionModal({ isOpen, onClose }: ResearchEvolutionModalProps) {
  const [features, setFeatures] = useState<ResearchFeatureItem[]>([]);
  const [timeline, setTimeline] = useState<ResearchTimelineItem[]>([]);
  const [activeEra, setActiveEra] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'timeline' | 'synthesis'>('grid');
  const [runningFeatureId, setRunningFeatureId] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<Record<string, ResearchRunOutput>>({});
  
  // Synthesis state
  const [synthesisPrompt, setSynthesisPrompt] = useState<string>('How do we combine symbolic proofs with reinforcement reasoning in LLMs?');
  const [synthesisResult, setSynthesisResult] = useState<ResearchSynthesisResult | null>(null);
  const [synthesisLoading, setSynthesisLoading] = useState<boolean>(false);

  // Benchmark state
  const [benchmarkResult, setBenchmarkResult] = useState<ResearchBenchmarkResult | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/v1/research/catalog')
      .then((r) => r.json())
      .then((data) => {
        if (data.features) setFeatures(data.features);
      })
      .catch((err) => console.error('Failed to load research catalog', err));

    fetch('/v1/research/timeline')
      .then((r) => r.json())
      .then((data) => {
        if (data.timeline) setTimeline(data.timeline);
      })
      .catch((err) => console.error('Failed to load research timeline', err));
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredFeatures = features.filter((f) => {
    const matchesEra = activeEra === 'all' || f.era === activeEra;
    const matchesQuery =
      searchQuery === '' ||
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.authors.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesEra && matchesQuery;
  });

  const handleRunFeature = async (featureId: string) => {
    setRunningFeatureId(featureId);
    try {
      const res = await fetch(`/v1/research/features/${featureId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parameters: {} }),
      });
      const data: ResearchRunOutput = await res.json();
      setRunResults((prev) => ({ ...prev, [featureId]: data }));
    } catch (err) {
      console.error('Feature run failed', err);
    } finally {
      setRunningFeatureId(null);
    }
  };

  const handleRunSynthesis = async () => {
    if (!synthesisPrompt.trim()) return;
    setSynthesisLoading(true);
    try {
      const res = await fetch('/v1/research/evolution/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: synthesisPrompt }),
      });
      const data: ResearchSynthesisResult = await res.json();
      setSynthesisResult(data);
    } catch (err) {
      console.error('Synthesis failed', err);
    } finally {
      setSynthesisLoading(false);
    }
  };

  const handleRunBenchmark = async () => {
    setBenchmarkLoading(true);
    try {
      const res = await fetch('/v1/research/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'reasoning_generalization_and_compression' }),
      });
      const data: ResearchBenchmarkResult = await res.json();
      setBenchmarkResult(data);
    } catch (err) {
      console.error('Benchmark failed', err);
    } finally {
      setBenchmarkLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-7xl h-[90vh] bg-[#0c1220] border border-[#1e2c4a] rounded-2xl flex flex-col shadow-2xl overflow-hidden text-slate-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2c4a] bg-[#0a0f1c]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 font-mono font-bold text-black text-lg">
              50
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-white tracking-tight">AI Evolution Research Hub</h2>
                <span className="px-2 py-0.5 text-xs font-mono rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  1950 – 2026
                </span>
                <span className="px-2 py-0.5 text-xs font-mono rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  50 Milestones
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Exact mathematical algorithms, simulation engines, and paradigms from Alan Turing to DeepSeek-R1 GRPO
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-[#131b2e] rounded-lg p-1 border border-[#1e2c4a]">
              <button
                onClick={() => setViewMode('grid')}
                className={`px-3 py-1 text-xs rounded-md font-medium transition ${
                  viewMode === 'grid' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-slate-400 hover:text-white'
                }`}
              >
                Features ({filteredFeatures.length})
              </button>
              <button
                onClick={() => setViewMode('timeline')}
                className={`px-3 py-1 text-xs rounded-md font-medium transition ${
                  viewMode === 'timeline' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-slate-400 hover:text-white'
                }`}
              >
                Timeline (1950–2026)
              </button>
              <button
                onClick={() => setViewMode('synthesis')}
                className={`px-3 py-1 text-xs rounded-md font-medium transition ${
                  viewMode === 'synthesis' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-white'
                }`}
              >
                Synthesis & Benchmark
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 hover:bg-[#1e2c4a] rounded-lg text-slate-400 hover:text-white transition"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Era Filter Toolbar */}
        <div className="px-6 py-2.5 bg-[#0e1526] border-b border-[#1e2c4a] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-4xl scrollbar-none">
            {Object.entries(ERA_LABELS).map(([key, info]) => (
              <button
                key={key}
                onClick={() => setActiveEra(key)}
                className={`px-2.5 py-1 text-xs rounded-lg border whitespace-nowrap transition ${
                  activeEra === key
                    ? 'bg-slate-800 border-emerald-400/50 text-white font-medium shadow-sm'
                    : 'border-[#1e2c4a] text-slate-400 hover:text-slate-200 hover:border-slate-600'
                }`}
              >
                {info.label} <span className="text-[10px] text-slate-500">({info.span})</span>
              </button>
            ))}
          </div>

          <div className="relative min-w-[200px]">
            <input
              type="text"
              placeholder="Search 50 research features..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#131b2e] border border-[#1e2c4a] rounded-lg px-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1.5 text-xs text-slate-500 hover:text-slate-300"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-[#0a0f1c]/50">
          {viewMode === 'grid' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredFeatures.map((feat) => {
                const runRes = runResults[feat.id];
                const isRunning = runningFeatureId === feat.id;

                return (
                  <div
                    key={feat.id}
                    className="bg-[#0f172a] border border-[#1e2c4a] hover:border-emerald-500/40 rounded-xl p-4 flex flex-col justify-between transition group shadow-md"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="px-2 py-0.5 text-[11px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded">
                          {feat.year}
                        </span>
                        <span className="text-[10px] uppercase font-mono text-slate-500 truncate max-w-[140px]">
                          {feat.era.replace('_', ' ')}
                        </span>
                      </div>

                      <h3 className="text-sm font-semibold text-white group-hover:text-emerald-300 transition leading-snug">
                        {feat.name}
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5 font-sans italic">
                        {feat.authors}
                      </p>

                      <p className="text-xs text-slate-300 mt-2 line-clamp-3 leading-relaxed">
                        {feat.summary}
                      </p>

                      {/* Math Formula Card */}
                      <div className="mt-3 p-2 bg-[#080d18] border border-[#1e2a44] rounded-lg font-mono text-[11px] text-emerald-300 overflow-x-auto">
                        <span className="text-[9px] text-slate-500 block mb-0.5 uppercase tracking-wider font-sans">Formula</span>
                        <code>{feat.mathematical_formula}</code>
                      </div>

                      {/* Citation */}
                      <div className="mt-2 text-[10px] text-slate-500 font-mono truncate">
                        📄 {feat.citation}
                      </div>

                      {/* Live Output if executed */}
                      {runRes && (
                        <div className="mt-3 p-2.5 bg-emerald-950/20 border border-emerald-500/30 rounded-lg text-xs space-y-1.5 animate-in fade-in">
                          <div className="flex items-center justify-between text-[11px] text-emerald-400 font-mono">
                            <span>✓ Executed ({runRes.execution_time_ms}ms)</span>
                            <span>Status: {runRes.status}</span>
                          </div>
                          <div className="font-mono text-[10px] text-slate-300 bg-black/40 p-1.5 rounded max-h-24 overflow-y-auto">
                            {JSON.stringify(runRes.metrics, null, 2)}
                          </div>
                          <p className="text-[11px] text-emerald-200/90 italic">
                            &quot;{runRes.theoretical_insight}&quot;
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-[#1e2c4a] flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleRunFeature(feat.id)}
                        disabled={isRunning}
                        className="w-full py-1.5 px-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-xs rounded-lg transition shadow flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        {isRunning ? (
                          <>
                            <span className="inline-block animate-spin">⚙</span> Simulating Algorithm...
                          </>
                        ) : (
                          <>
                            <span>▶</span> Execute Simulation
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Timeline View */}
          {viewMode === 'timeline' && (
            <div className="max-w-4xl mx-auto py-4 space-y-4">
              <div className="text-center mb-6">
                <h3 className="text-lg font-semibold text-white">Chronological Architecture Timeline</h3>
                <p className="text-xs text-slate-400">75 years of breakthroughs from Turing machines (1950) to Group Relative Policy Optimization (2025/2026)</p>
              </div>

              <div className="relative border-l-2 border-emerald-500/30 ml-4 pl-6 space-y-6">
                {timeline.map((event, idx) => (
                  <div key={idx} className="relative group">
                    <div className="absolute -left-[31px] top-1.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-[#0a0f1c] group-hover:scale-125 transition" />
                    <div className="bg-[#0f172a] border border-[#1e2c4a] rounded-xl p-4 hover:border-emerald-500/40 transition">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-emerald-400 font-mono">{event.year}</span>
                        <span className="text-xs px-2 py-0.5 bg-slate-800 text-slate-400 rounded-full font-mono text-[10px]">
                          {event.era}
                        </span>
                      </div>
                      <h4 className="text-base font-semibold text-white mt-1">{event.name}</h4>
                      <p className="text-xs text-slate-400 italic mt-0.5">📄 {event.paper_title}</p>
                      <p className="text-xs text-slate-300 mt-2">{event.milestone_impact}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Synthesis & Benchmark View */}
          {viewMode === 'synthesis' && (
            <div className="max-w-4xl mx-auto space-y-6">
              
              {/* Multi-Paradigm Synthesis Box */}
              <div className="bg-[#0f172a] border border-[#1e2c4a] rounded-2xl p-6 shadow-xl">
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <span>🧠</span> Multi-Paradigm Evolution Synthesis
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Synthesize insights across all 6 evolutionary eras (Symbolic, Statistical, Deep Learning, Scaling, Alignment, Frontier Reasoning) to solve hard inquiries.
                </p>

                <div className="mt-4 flex gap-2">
                  <input
                    type="text"
                    value={synthesisPrompt}
                    onChange={(e) => setSynthesisPrompt(e.target.value)}
                    placeholder="Enter query to synthesize across AI evolution..."
                    className="flex-1 bg-[#080d18] border border-[#1e2a44] rounded-xl px-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
                  />
                  <button
                    onClick={handleRunSynthesis}
                    disabled={synthesisLoading}
                    className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded-xl transition disabled:opacity-50"
                  >
                    {synthesisLoading ? 'Synthesizing...' : 'Synthesize'}
                  </button>
                </div>

                {synthesisResult && (
                  <div className="mt-4 p-4 bg-[#080d18] border border-cyan-500/30 rounded-xl space-y-3">
                    <div className="flex items-center justify-between text-xs text-cyan-400 font-mono">
                      <span>Confidence: {(synthesisResult.confidence * 100).toFixed(1)}%</span>
                      <span>Eras Utilized: {synthesisResult.eras_utilized?.length}</span>
                    </div>

                    <div className="space-y-2">
                      {synthesisResult.contributions?.map((c: ResearchSynthesisContribution, i: number) => (
                        <div key={i} className="text-xs border-l-2 border-cyan-500/40 pl-3 py-1">
                          <span className="font-semibold text-cyan-300">[{c.era_title}] {c.key_feature_applied}:</span>
                          <span className="text-slate-300 ml-1.5">{c.deduction}</span>
                        </div>
                      ))}
                    </div>

                    <div className="p-3 bg-black/40 rounded-lg text-xs text-slate-200 border border-slate-800 leading-relaxed font-sans whitespace-pre-line">
                      {synthesisResult.integrated_synthesis}
                    </div>
                  </div>
                )}
              </div>

              {/* Comparative Paradigm Benchmark */}
              <div className="bg-[#0f172a] border border-[#1e2c4a] rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-white flex items-center gap-2">
                      <span>⚡</span> Cross-Era Paradigm Benchmark
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Benchmark representative architectures across eras on unified reasoning and computational efficiency.
                    </p>
                  </div>
                  <button
                    onClick={handleRunBenchmark}
                    disabled={benchmarkLoading}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl transition disabled:opacity-50"
                  >
                    {benchmarkLoading ? 'Running...' : 'Run Benchmark'}
                  </button>
                </div>

                {benchmarkResult && (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {Object.entries(benchmarkResult.paradigm_comparison || {}).map(([era, score]: [string, number]) => (
                        <div key={era} className="p-2.5 bg-[#080d18] border border-[#1e2a44] rounded-lg">
                          <div className="text-[10px] text-slate-400 font-mono truncate">{era}</div>
                          <div className="text-lg font-bold text-emerald-400 font-mono mt-0.5">{score} / 100</div>
                        </div>
                      ))}
                    </div>

                    <div className="p-3 bg-black/30 border border-[#1e2c4a] rounded-lg text-xs text-slate-300 italic">
                      {benchmarkResult.conclusion}
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#1e2c4a] bg-[#0a0f1c] flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-4">
            <span>50 Seminal AI Features</span>
            <span>•</span>
            <span>6 Evolutionary Eras</span>
            <span>•</span>
            <span>Offline Math Simulations</span>
          </div>
          <div className="font-mono text-emerald-400 text-[11px]">
            Aetheris v0.14.0 Evolution Engine
          </div>
        </div>

      </div>
    </div>
  );
}

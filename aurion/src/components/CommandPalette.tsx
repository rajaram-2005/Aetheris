/* ─── Command Palette — ⌘K quick actions & interconnected studio jump ─── */
"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import { Thread } from '@/types';

interface CommandPaletteProps {
  onClose: () => void;
  onRun: (text: string) => void;
  threads: Thread[];
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  onOpenGallery?: () => void;
  onOpenBenchmarks?: () => void;
  onOpenCanvas?: () => void;
  onOpenAgentStore?: () => void;
  onOpenDeepResearch?: () => void;
  onOpenApexLab?: () => void;
  onOpenGodDeck?: () => void;
  onOpenSettings?: () => void;
  onSelectMode?: (mode: 'myth' | 'legendary' | 'pro' | 'lite' | 'flash' | 'general') => void;
}

interface Command {
  id: string;
  label: string;
  description: string;
  icon: string;
  category: string;
  action: () => void;
}

export function CommandPalette({
  onClose,
  onRun,
  threads,
  onSelectThread,
  onNewThread,
  onOpenGallery,
  onOpenBenchmarks,
  onOpenCanvas,
  onOpenAgentStore,
  onOpenDeepResearch,
  onOpenApexLab,
  onOpenGodDeck,
  onOpenSettings,
  onSelectMode,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commands: Command[] = useMemo(() => [
    // Frontier Tycoon Studios & Hubs
    ...(onOpenCanvas ? [{ id: 'studio-canvas', label: 'Artifacts 2.0 Canvas Studio', description: 'Open side-by-side interactive code, SVG & HTML execution runner', icon: '📐', category: 'Studios & Hubs', action: () => { onOpenCanvas(); onClose(); } }] : []),
    ...(onOpenDeepResearch ? [{ id: 'studio-research', label: 'Autonomous Deep Research Engine', description: 'Run multi-hop document & web research with citations', icon: '🔬', category: 'Studios & Hubs', action: () => { onOpenDeepResearch(); onClose(); } }] : []),
    ...(onOpenGodDeck ? [{ id: 'studio-god', label: 'God Deck', description: 'Tree-of-Thought MCTS, causal do(), proofs, red-team, forecasts', icon: 'Ω', category: 'Studios & Hubs', action: () => { onOpenGodDeck(); onClose(); } }] : []),
    ...(onOpenApexLab ? [{ id: 'studio-apex', label: 'Apex Cognition Lab', description: 'Knowledge graph, constitution, evals, and composable skills', icon: '✦', category: 'Studios & Hubs', action: () => { onOpenApexLab(); onClose(); } }] : []),
    ...(onOpenAgentStore ? [{ id: 'studio-agents', label: 'Sovereign Agents & Custom GPTs Store', description: 'Deploy, customize and run air-gapped domain agents', icon: '🤖', category: 'Studios & Hubs', action: () => { onOpenAgentStore(); onClose(); } }] : []),
    ...(onOpenGallery ? [{ id: 'studio-gallery', label: 'Neural Visual Design Studio Gallery', description: 'View & generate mind-blowing 8k cyberpunk visuals', icon: '🎨', category: 'Studios & Hubs', action: () => { onOpenGallery(); onClose(); } }] : []),
    ...(onOpenBenchmarks ? [{ id: 'studio-benchmarks', label: 'Foundation Model Benchmark Arena', description: 'Compare against DeepSeek-R1, Llama 3.3 70B & Qwen 2.5 72B', icon: '📊', category: 'Studios & Hubs', action: () => { onOpenBenchmarks(); onClose(); } }] : []),
    ...(onOpenSettings ? [{ id: 'action-settings', label: 'Settings & Model Selection', description: 'Switch sovereign neural models, themes, personas, and memory', icon: '⚙️', category: 'Actions', action: () => { onOpenSettings(); onClose(); } }] : []),

    // Actions & Prompt Templates
    ...(onSelectMode ? [
      { id: 'mode-myth', label: 'Mode: Myth', description: 'Oracle voice — works on Flash, Pro, Ultra', icon: '🜂', category: 'Modes', action: () => { onSelectMode('myth'); onClose(); } },
      { id: 'mode-legendary', label: 'Mode: Legendary', description: 'Strategist campaign voice on any model', icon: '⚔', category: 'Modes', action: () => { onSelectMode('legendary'); onClose(); } },
      { id: 'mode-pro', label: 'Mode: Pro', description: 'Operator voice — ship in the next hour', icon: '◆', category: 'Modes', action: () => { onSelectMode('pro'); onClose(); } },
      { id: 'mode-lite', label: 'Mode: Lite / Little', description: 'Simple short answers on any model', icon: '○', category: 'Modes', action: () => { onSelectMode('lite'); onClose(); } },
      { id: 'mode-flash', label: 'Mode: Flash', description: 'Fewest true words on any model', icon: '⚡', category: 'Modes', action: () => { onSelectMode('flash'); onClose(); } },
    ] : []),
    { id: 'new', label: 'New Exploration', description: 'Start a fresh conversation thread', icon: '✨', category: 'Actions', action: () => { onNewThread(); onClose(); } },
    { id: 'deep-reasoning', label: 'Deep Reasoning Proof', description: 'Perform multi-pass chain-of-thought verification', icon: '🧠', category: 'Reasoning', action: () => onRun('Solve and prove formally: ') },
    { id: 'code-pipeline', label: 'Async Python Pipeline', description: 'Generate high-throughput concurrent architecture', icon: '💻', category: 'Code', action: () => onRun('Write an async Python pipeline with rate limiting and retry backoff') },
    { id: 'mla-explain', label: 'Explain Multi-Head Latent Attention', description: 'Deep-dive into 93.3% KV-cache compression', icon: '⚡', category: 'Architecture', action: () => onRun('Explain how Multi-Head Latent Attention (MLA) reduces KV cache footprint') },
    { id: 'email', label: 'Write a technical proposal', description: 'Draft a high-impact engineering doc', icon: '✍️', category: 'Write', action: () => onRun('Draft a technical proposal for air-gapped sovereign AI') },
    { id: 'math', label: 'Symbolic Math & Physics', description: 'Solve equations and calculate invariants', icon: '📐', category: 'Compute', action: () => onRun('Calculate the eigenvalues and determinant of ') },
    { id: 'sec-audit', label: 'Smart Contract Audit', description: 'Security invariant verification', icon: '🛡️', category: 'Security', action: () => onRun('Audit this smart contract for reentrancy and integer overflow: ') },

    // Threads
    ...threads.slice(0, 5).map((t) => ({
      id: `thread-${t.id}`,
      label: t.title,
      description: `${t.messages.length} turns`,
      icon: '💬',
      category: 'Recent Conversations',
      action: () => { onSelectThread(t.id); onClose(); },
    })),
  ], [threads, onRun, onNewThread, onSelectThread, onClose, onOpenGallery, onOpenBenchmarks, onOpenCanvas, onOpenAgentStore, onOpenDeepResearch, onOpenApexLab, onOpenGodDeck, onOpenSettings, onSelectMode]);

  const filtered = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter((c) =>
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q)
    );
  }, [query, commands]);

  // Reset the highlighted row when the filter changes, without an effect.
  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setSelectedIdx(0);
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIdx]) {
      filtered[selectedIdx].action();
    }
  };

  const grouped = filtered.reduce<Record<string, Command[]>>((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl overflow-hidden animate-fade-in shadow-2xl"
        style={{ background: 'var(--bg-secondary)', border: '1px solid rgba(61, 255, 194, 0.3)', boxShadow: '0 25px 50px rgba(0,0,0,0.6)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--accent-mint)', flexShrink: 0 }}>
            <circle cx="8" cy="8" r="5" /><line x1="12" y1="12" x2="15" y2="15" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command, studio, or prompt… (e.g. Canvas, Research, Proof)"
            className="flex-1 bg-transparent outline-none text-xs font-mono text-white placeholder-gray-500"
          />
          <kbd className="text-[10px] px-2 py-0.5 rounded font-mono" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
            ESC
          </kbd>
        </div>

        {/* Command List */}
        <div className="max-h-96 overflow-y-auto py-2">
          {Object.entries(grouped).map(([category, cmds]) => (
            <div key={category}>
              <p className="text-[10px] uppercase font-mono tracking-wider font-semibold px-5 py-1.5" style={{ color: 'var(--accent-mint)' }}>
                {category}
              </p>
              {cmds.map((cmd) => {
                const idx = filtered.indexOf(cmd);
                return (
                  <button
                    key={cmd.id}
                    className="w-full flex items-center gap-3.5 px-5 py-2.5 text-left transition-colors"
                    style={{
                      background: idx === selectedIdx ? 'rgba(61,255,194,0.1)' : 'transparent',
                      borderLeft: `2px solid ${idx === selectedIdx ? 'var(--accent-mint)' : 'transparent'}`,
                    }}
                    onClick={cmd.action}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <span className="text-base">{cmd.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate text-white font-mono">
                        {cmd.label}
                      </p>
                      <p className="text-[11px] truncate text-gray-400 font-ui">
                        {cmd.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-xs py-8 text-gray-400 font-mono">
              No matching commands or studios
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t flex items-center justify-between text-[10px] font-mono text-gray-400" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-3">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>esc close</span>
          </div>
          <span className="text-cyan-400">Aetheris Unified OS</span>
        </div>
      </div>
    </div>
  );
}

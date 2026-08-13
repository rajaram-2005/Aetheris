/* ─── Sidebar — Brand, New thought, search, thread list, skills, visual studio ─── */
"use client";

import { useState } from 'react';
import { Thread } from '@/types';

interface RuntimeInfo {
  foundation: string;
  version: string;
  episodes: number;
  knowledge_articles: number;
  online: boolean;
}

interface SidebarProps {
  threads: Thread[];
  currentThreadId: string | null;
  isOpen: boolean;
  runtime?: RuntimeInfo | null;
  onToggle: () => void;
  onNewThread: () => void;
  onSelectThread: (id: string) => void;
  onDeleteThread: (id: string) => void;
  onOpenSettings: () => void;
  onOpenPrompts: () => void;
  onOpenGallery?: () => void;
  onOpenBenchmarks?: () => void;
  onOpenCanvas?: () => void;
  onOpenAgentStore?: () => void;
  onOpenDeepResearch?: () => void;
  onExport: () => void;
}

const SKILL_CHIPS = [
  { icon: '🎨', label: 'Visual Art', prompt: 'Generate an image: futuristic holographic neural core in cyber space' },
  { icon: '💻', label: 'Code', prompt: 'Write a Python async pipeline for processing high-throughput events' },
  { icon: '🧠', label: 'Reason', prompt: 'Prove step by step why P vs NP remains one of mathematics greatest open questions' },
  { icon: '🧮', label: 'Compute', prompt: 'Calculate optimal matrix multiplication complexity' },
  { icon: '✍️', label: 'Write', prompt: 'Help me draft a technical proposal for sovereign AI systems' },
  { icon: '📚', label: 'Study', prompt: 'Create a deep-dive curriculum for transformer attention mechanisms' },
];

export function Sidebar({
  threads,
  currentThreadId,
  isOpen,
  runtime,
  onToggle,
  onNewThread,
  onSelectThread,
  onDeleteThread,
  onOpenSettings,
  onOpenPrompts,
  onOpenGallery,
  onOpenBenchmarks,
  onOpenCanvas,
  onOpenAgentStore,
  onOpenDeepResearch,
  onExport,
}: SidebarProps) {
  const [search, setSearch] = useState('');

  const filtered = threads.filter(
    (t) =>
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      t.messages.some((m) => m.content.toLowerCase().includes(search.toLowerCase()))
  );

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed top-4 left-4 z-30 p-2 rounded-lg transition-colors shadow-lg"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
        title="Open Sidebar"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="5" x2="17" y2="5" />
          <line x1="3" y1="10" x2="17" y2="10" />
          <line x1="3" y1="15" x2="17" y2="15" />
        </svg>
      </button>
    );
  }

  return (
    <aside
      className="w-72 flex-shrink-0 flex flex-col h-full border-r overflow-hidden"
      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center text-sm font-bold shadow-md"
            style={{ background: 'var(--accent-mint)', color: '#0a0e1a', fontFamily: 'var(--font-display)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/avatar-prime.png"
              alt="Aetheris Avatar"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
            <span>A</span>
          </div>
          <div>
            <span className="font-bold block leading-none" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>
              Aetheris
            </span>
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              Sovereign Neural Core
            </span>
          </div>
        </div>
        <button onClick={onToggle} className="p-1 rounded hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="11,4 6,9 11,14" />
          </svg>
        </button>
      </div>

      {/* Action Buttons: New Thread, Visual Studio & Benchmark Arena */}
      <div className="p-3 space-y-2">
        <button
          onClick={onNewThread}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all hover:opacity-90 shadow-md"
          style={{
            background: 'var(--accent-mint)',
            color: '#0a0e1a',
            fontFamily: 'var(--font-ui)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="8" y1="3" x2="8" y2="13" />
            <line x1="3" y1="8" x2="13" y2="8" />
          </svg>
          New Exploration
        </button>

        <div className="grid grid-cols-2 gap-1.5">
          {onOpenGallery && (
            <button
              onClick={onOpenGallery}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl text-xs font-semibold transition-all hover:bg-white/5"
              style={{
                background: 'rgba(0, 180, 216, 0.1)',
                border: '1px solid rgba(0, 180, 216, 0.25)',
                color: 'var(--accent-mint)',
                fontFamily: 'var(--font-ui)',
              }}
            >
              <span>🎨</span>
              <span>Visuals</span>
            </button>
          )}

          {onOpenBenchmarks && (
            <button
              onClick={onOpenBenchmarks}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl text-xs font-semibold transition-all hover:bg-white/5"
              style={{
                background: 'rgba(192, 132, 252, 0.1)',
                border: '1px solid rgba(192, 132, 252, 0.25)',
                color: 'var(--accent-purple)',
                fontFamily: 'var(--font-ui)',
              }}
            >
              <span>📊</span>
              <span>Arena</span>
            </button>
          )}

          {onOpenCanvas && (
            <button
              onClick={onOpenCanvas}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl text-xs font-semibold transition-all hover:bg-white/5"
              style={{
                background: 'rgba(251, 191, 36, 0.1)',
                border: '1px solid rgba(251, 191, 36, 0.25)',
                color: 'var(--accent-gold)',
                fontFamily: 'var(--font-ui)',
              }}
            >
              <span>📐</span>
              <span>Canvas</span>
            </button>
          )}

          {onOpenAgentStore && (
            <button
              onClick={onOpenAgentStore}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl text-xs font-semibold transition-all hover:bg-white/5"
              style={{
                background: 'rgba(74, 222, 128, 0.1)',
                border: '1px solid rgba(74, 222, 128, 0.25)',
                color: '#4ade80',
                fontFamily: 'var(--font-ui)',
              }}
            >
              <span>🤖</span>
              <span>GPT Store</span>
            </button>
          )}

          {onOpenDeepResearch && (
            <button
              onClick={onOpenDeepResearch}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl text-xs font-semibold transition-all hover:bg-white/5"
              style={{
                background: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                color: '#38bdf8',
                fontFamily: 'var(--font-ui)',
              }}
            >
              <span>🔬</span>
              <span>Research</span>
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-muted)' }}>
            <circle cx="6" cy="6" r="4" />
            <line x1="9" y1="9" x2="12" y2="12" />
          </svg>
          <input
            type="text"
            placeholder="Search conversations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent outline-none flex-1 text-xs"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}
          />
        </div>
      </div>

      {/* Thread List */}
      <div className="flex-1 overflow-y-auto px-3 space-y-1">
        {filtered.length === 0 ? (
          <p className="text-center text-xs py-8" style={{ color: 'var(--text-muted)' }}>
            {search ? 'No matching conversations' : 'No conversations yet'}
          </p>
        ) : (
          filtered.map((thread) => (
            <div
              key={thread.id}
              className="group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all"
              style={{
                background: thread.id === currentThreadId ? 'var(--bg-hover)' : 'transparent',
                border: thread.id === currentThreadId ? '1px solid var(--border-hover)' : '1px solid transparent',
              }}
              onClick={() => onSelectThread(thread.id)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate font-medium" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}>
                  {thread.title}
                </p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {thread.messages.length} turns · {formatTime(thread.updatedAt)}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteThread(thread.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 transition-opacity"
                style={{ color: 'var(--accent-pink)' }}
                title="Delete thread"
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="2,4 12,4" />
                  <path d="M5,4V2h4v2M3,4l1,8h6l1-8" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      {/* Skill Chips */}
      <div className="px-3 py-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
        <p className="text-[10px] uppercase tracking-wider mb-2 font-semibold" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Capabilities
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SKILL_CHIPS.map((chip) => (
            <button
              key={chip.label}
              onClick={() => onNewThread()}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:border-cyan-400"
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-ui)',
              }}
              title={chip.prompt}
            >
              <span>{chip.icon}</span>
              <span className="text-[11px]">{chip.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="p-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--border-color)' }}>
        <button
          onClick={onOpenPrompts}
          className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}
        >
          📋 Prompts
        </button>
        <button
          onClick={onExport}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
          title="Export conversation"
        >
          📤
        </button>
        <button
          onClick={onOpenSettings}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
          title="Settings & Model Selection"
        >
          ⚙️
        </button>
      </div>

      {/* Runtime status */}
      <div className="px-3 pb-2">
        <div
          className="px-3 py-2 rounded-xl text-[10px] space-y-1"
          style={{
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <div className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: runtime?.online ? 'var(--accent-mint)' : 'var(--accent-pink)',
              }}
            />
            <span style={{ color: runtime?.online ? 'var(--accent-mint)' : 'var(--accent-pink)' }}>
              {runtime?.online ? 'Sovereign Core Online' : 'Runtime Offline'}
            </span>
            {runtime?.online && (
              <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>
                v{runtime.version}
              </span>
            )}
          </div>
          {runtime?.online && (
            <div style={{ color: 'var(--text-muted)' }}>
              {runtime.episodes} episode{runtime.episodes === 1 ? '' : 's'} learned ·{' '}
              {runtime.knowledge_articles} articles
            </div>
          )}
        </div>
      </div>

      {/* Sovereign Privacy Badge */}
      <div className="px-3 pb-3">
        <div
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold"
          style={{
            background: 'rgba(61,255,194,0.08)',
            border: '1px solid rgba(61,255,194,0.2)',
            color: 'var(--accent-mint)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <span>🔒</span>
          <span>Sovereign · No Cloud Mini 4.0 · Local</span>
        </div>
      </div>
    </aside>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

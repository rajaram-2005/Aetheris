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
  onOpenApexLab?: () => void;
  onOpenGodDeck?: () => void;
  onOpenSkills?: () => void;
  onOpenIntegrations?: () => void;
  onOpenResources?: () => void;
  onOpenMythology?: () => void;
  onExport: () => void;
}

const SKILL_CHIPS = [
  { icon: '🎨', label: 'Visual Art', prompt: 'Generate an image of a tranquil forest at golden hour' },
  { icon: '💻', label: 'Code', prompt: 'Write a Python async pipeline for processing high-throughput events' },
  { icon: '🧠', label: 'Reason', prompt: 'Explain the difference between correlation and causation with an example' },
  { icon: '🪔', label: 'Thamizh', prompt: 'Speak to me in the Thamizh mythos mode' },
  { icon: '✍️', label: 'Write', prompt: 'Help me draft a clear technical proposal' },
  { icon: '📚', label: 'Study', prompt: 'Create a study plan for learning transformers' },
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
  onOpenApexLab,
  onOpenGodDeck,
  onOpenSkills,
  onOpenIntegrations,
  onOpenResources,
  onOpenMythology,
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
            <span className="font-semibold block leading-none" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
              Aetheris
            </span>
            <span className="text-[11px] mt-0.5 block" style={{ color: 'var(--text-muted)' }}>
              Thamizh Mythos AI
            </span>
          </div>
        </div>
        <button onClick={onToggle} className="p-1 rounded hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="11,4 6,9 11,14" />
          </svg>
        </button>
      </div>

      {/* Actions — New chat + primary tools */}
      <div className="p-3 space-y-1.5">
        <button onClick={onNewThread} className="btn btn-primary w-full justify-center py-2.5" style={{ borderRadius: 10 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" /></svg>
          New chat
        </button>

        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <SideTool label="Visuals" onClick={onOpenGallery} show={!!onOpenGallery} icon={
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="2" width="12" height="12" rx="2" /><circle cx="5.5" cy="5.5" r="1.3" /><path d="M2 12l3.5-3.5 2.5 2.5 2.5-2.5 3.5 3.5" /></svg>} />
          <SideTool label="Mythos" onClick={onOpenMythology} show={!!onOpenMythology} icon={
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 2c0 6-3 8-5 10h10C11 10 8 8 8 2z" /><path d="M8 2v10" /></svg>} />
          <SideTool label="Skills" onClick={onOpenSkills} show={!!onOpenSkills} icon={
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2.5" y="4" width="11" height="8" rx="2" /><path d="M6 8h4M8 6v4" /></svg>} />
          <SideTool label="Connect" onClick={onOpenIntegrations} show={!!onOpenIntegrations} icon={
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M5.5 10.5L10.5 5.5" /><circle cx="4" cy="12" r="2" /><circle cx="12" cy="4" r="2" /><path d="M6 6l1-1M10 10l-1 1" /></svg>} />
          <SideTool label="Models" onClick={onOpenResources} show={!!onOpenResources} icon={
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 6h12v8H2zM2 6l1.5-3h9L14 6M5.5 2h5" /></svg>} />
          <SideTool label="Research" onClick={onOpenDeepResearch} show={!!onOpenDeepResearch} icon={
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="6.5" cy="6.5" r="3.5" /><line x1="9.5" y1="9.5" x2="13" y2="13" /><path d="M5.5 6.5l1 1 2-2" /></svg>} />
          <SideTool label="Agents" onClick={onOpenAgentStore} show={!!onOpenAgentStore} icon={
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="5" cy="5" r="2.5" /><circle cx="11" cy="5" r="2.5" /><path d="M3.5 13c.5-2 1-3 1.5-3s1 1 1.5 3M10 13c.5-2 1-3 1.5-3s1 1 1.5 3" /></svg>} />
          <SideTool label="Apex" onClick={onOpenApexLab} show={!!onOpenApexLab} icon={
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 2l6 12H2z" /><path d="M8 6l3 6H5z" fill="currentColor" stroke="none" /></svg>} />
          <SideTool label="God" onClick={onOpenGodDeck} show={!!onOpenGodDeck} icon={
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="5.5" /><path d="M8 3.5v9M3.5 8h9" /></svg>} />
          <SideTool label="Canvas" onClick={onOpenCanvas} show={!!onOpenCanvas} icon={
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="2" width="12" height="12" rx="2" /><path d="M6 6h4v4H6z" /></svg>} />
          <SideTool label="Arena" onClick={onOpenBenchmarks} show={!!onOpenBenchmarks} icon={
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2.5" y="3" width="4.5" height="10" rx="1" /><rect x="9" y="3" width="4.5" height="10" rx="1" /></svg>} />
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
              {runtime?.online ? 'Online' : 'Offline'}
            </span>
            {runtime?.online && (
              <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>
                v{runtime.version}
              </span>
            )}
          </div>
          {runtime?.online && (
            <div style={{ color: 'var(--text-muted)' }}>
              Hermes agent · {runtime.knowledge_articles} knowledge articles
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
          <span>Private · Offline-first</span>
        </div>
      </div>
    </aside>
  );
}

/* ── Clean, consistent sidebar tool button ── */
function SideTool({ label, onClick, show, icon }: { label: string; onClick?: () => void; show?: boolean; icon: React.ReactNode }) {
  if (!show || !onClick) return null;
  return (
    <button onClick={onClick} className="btn justify-start w-full px-2.5 py-2" style={{ borderRadius: 9, fontSize: 12 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

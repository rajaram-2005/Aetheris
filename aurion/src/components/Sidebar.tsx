/* ─── Sidebar — Brand, New thought, search, thread list, skills, privacy ─── */
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
  onExport: () => void;
}

const SKILL_CHIPS = [
  { icon: '✍️', label: 'Write', prompt: 'Help me write a professional email about' },
  { icon: '💻', label: 'Code', prompt: 'Write a Python function that' },
  { icon: '📐', label: 'Math', prompt: 'Calculate' },
  { icon: '🧮', label: 'Compute', prompt: 'Convert 42 km to miles' },
  { icon: '📚', label: 'Study', prompt: 'Create a study plan for' },
  { icon: '🎨', label: 'Image', prompt: 'Generate an image of an aurora over mountains' },
  { icon: '🍳', label: 'Recipe', prompt: 'Give me a biryani recipe' },
  { icon: '✈️', label: 'Travel', prompt: 'Places to visit in Hyderabad' },
];

export function Sidebar({
  threads, currentThreadId, isOpen, runtime, onToggle, onNewThread,
  onSelectThread, onDeleteThread, onOpenSettings, onOpenPrompts, onExport,
}: SidebarProps) {
  const [search, setSearch] = useState('');

  const filtered = threads.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.messages.some(m => m.content.toLowerCase().includes(search.toLowerCase()))
  );

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed top-4 left-4 z-30 p-2 rounded-lg transition-colors"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="5" x2="17" y2="5" /><line x1="3" y1="10" x2="17" y2="10" /><line x1="3" y1="15" x2="17" y2="15" />
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
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{ background: 'var(--accent-mint)', color: '#0a0e1a', fontFamily: 'var(--font-display)' }}
          >
            A
          </div>
          <span className="font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>
            Aetheris
          </span>
        </div>
        <button
          onClick={onToggle}
          className="p-1 rounded hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="11,4 6,9 11,14" />
          </svg>
        </button>
      </div>

      {/* New Thought */}
      <div className="p-3">
        <button
          onClick={onNewThread}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-90"
          style={{
            background: 'var(--accent-mint)',
            color: '#0a0e1a',
            fontFamily: 'var(--font-ui)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" />
          </svg>
          New thought
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-muted)' }}>
            <circle cx="6" cy="6" r="4" /><line x1="9" y1="9" x2="12" y2="12" />
          </svg>
          <input
            type="text"
            placeholder="Search threads…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent outline-none flex-1 text-sm"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}
          />
        </div>
      </div>

      {/* Thread List */}
      <div className="flex-1 overflow-y-auto px-3 space-y-1">
        {filtered.length === 0 ? (
          <p className="text-center text-xs py-8" style={{ color: 'var(--text-muted)' }}>
            {search ? 'No matching threads' : 'No conversations yet'}
          </p>
        ) : (
          filtered.map(thread => (
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
                <p className="text-sm truncate" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}>
                  {thread.title}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {thread.messages.length} messages · {formatTime(thread.updatedAt)}
                </p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); onDeleteThread(thread.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20"
                style={{ color: 'var(--accent-pink)' }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="2,4 12,4" /><path d="M5,4V2h4v2M3,4l1,8h6l1-8" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      {/* Skill Chips */}
      <div className="px-3 py-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
        <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Skills
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SKILL_CHIPS.map(chip => (
            <button
              key={chip.label}
              onClick={() => { onNewThread(); }}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-ui)',
              }}
              title={chip.prompt}
            >
              <span>{chip.icon}</span>
              <span>{chip.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="p-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--border-color)' }}>
        <button
          onClick={onOpenPrompts}
          className="flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}
        >
          📋 Prompts
        </button>
        <button
          onClick={onExport}
          className="px-3 py-2 rounded-lg text-xs font-medium transition-colors"
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
          title="Export thread"
        >
          📤
        </button>
        <button
          onClick={onOpenSettings}
          className="px-3 py-2 rounded-lg text-xs font-medium transition-colors"
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
          title="Settings"
        >
          ⚙️
        </button>
      </div>

      {/* Runtime status — proves what is actually serving inference */}
      <div className="px-3 pb-2">
        <div
          className="px-3 py-2 rounded-lg text-[10px] space-y-1"
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
              {runtime?.online ? 'Hermes online' : 'Runtime offline'}
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

      {/* Privacy Pill */}
      <div className="px-3 pb-3">
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px]"
          style={{ background: 'rgba(61,255,194,0.08)', border: '1px solid rgba(61,255,194,0.15)', color: 'var(--accent-mint)', fontFamily: 'var(--font-mono)' }}
        >
          <span>🔒</span>
          <span>Offline · No API keys · Private</span>
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

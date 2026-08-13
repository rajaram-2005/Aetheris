/* ─── Command Palette — ⌘K quick actions ─── */
"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import { Thread } from '@/types';

interface CommandPaletteProps {
  onClose: () => void;
  onRun: (text: string) => void;
  threads: Thread[];
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
}

interface Command {
  id: string;
  label: string;
  description: string;
  icon: string;
  category: string;
  action: () => void;
}

export function CommandPalette({ onClose, onRun, threads, onSelectThread, onNewThread }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commands: Command[] = useMemo(() => [
    // Actions
    { id: 'new', label: 'New thread', description: 'Start a new conversation', icon: '✨', category: 'Actions', action: () => { onNewThread(); onClose(); } },
    { id: 'email', label: 'Write an email', description: 'Draft a professional email', icon: '✍️', category: 'Write', action: () => onRun('Write a professional email about') },
    { id: 'blog', label: 'Write a blog post', description: 'Create a blog article', icon: '📝', category: 'Write', action: () => onRun('Write a blog post about') },
    { id: 'poem', label: 'Write a poem', description: 'Compose poetry', icon: '🎭', category: 'Write', action: () => onRun('Write a poem about') },
    { id: 'code', label: 'Generate code', description: 'Write a program or function', icon: '💻', category: 'Code', action: () => onRun('Write a Python function that') },
    { id: 'explain-code', label: 'Explain code', description: 'Understand what code does', icon: '📖', category: 'Code', action: () => onRun('Explain this code: ') },
    { id: 'math', label: 'Solve math', description: 'Calculate or solve equations', icon: '📐', category: 'Compute', action: () => onRun('Calculate ') },
    { id: 'convert', label: 'Convert units', description: 'km↔mi, kg↔lb, °C↔°F', icon: '🔄', category: 'Compute', action: () => onRun('Convert 100 km to miles') },
    { id: 'translate', label: 'Translate text', description: 'Translate to Hindi, Telugu, etc.', icon: '🌐', category: 'Translate', action: () => onRun('Translate hello to Hindi') },
    { id: 'quiz', label: 'Quiz me', description: 'Take a quiz on any topic', icon: '📝', category: 'Study', action: () => onRun('Quiz me on') },
    { id: 'flashcards', label: 'Flashcards', description: 'Create study flashcards', icon: '📇', category: 'Study', action: () => onRun('Create flashcards for') },
    { id: 'study', label: 'Study plan', description: 'Generate a study schedule', icon: '📚', category: 'Study', action: () => onRun('Create a study plan for JEE') },
    { id: 'eli5', label: 'Explain simply (ELI5)', description: 'Simple explanation of a topic', icon: '🧒', category: 'Learn', action: () => onRun('ELI5 ') },
    { id: 'resume', label: 'Build resume', description: 'Create a professional resume', icon: '📄', category: 'Career', action: () => onRun('Help me build a resume') },
    { id: 'interview', label: 'Interview prep', description: 'Practice interview questions', icon: '🎯', category: 'Career', action: () => onRun('Prepare me for a software engineer interview') },
    { id: 'aurora', label: 'Generate image', description: 'Synthesize a PNG in-process', icon: '🎨', category: 'Create', action: () => onRun('Generate an image of an aurora over mountains') },
    { id: 'meta', label: 'Show learning state', description: 'What the meta-learner has learned', icon: '🧬', category: 'Hermes', action: () => onRun('What have you learned so far?') },
    { id: 'recipe', label: 'Biryani recipe', description: 'Hyderabadi dum biryani', icon: '🍚', category: 'Cook', action: () => onRun('Give me a biryani recipe') },
    { id: 'hyderabad', label: 'Hyderabad guide', description: 'Weekend travel plan', icon: '🏛️', category: 'Travel', action: () => onRun('Weekend plan for Hyderabad') },
    // Threads
    ...threads.slice(0, 5).map(t => ({
      id: `thread-${t.id}`,
      label: t.title,
      description: `${t.messages.length} messages`,
      icon: '💬',
      category: 'Threads',
      action: () => { onSelectThread(t.id); onClose(); },
    })),
  ], [threads, onRun, onNewThread, onSelectThread, onClose]);

  const filtered = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q)
    );
  }, [query, commands]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIdx]) {
      filtered[selectedIdx].action();
    }
  };

  // Group by category
  const grouped = filtered.reduce<Record<string, Command[]>>((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden animate-fade-in"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
            <circle cx="8" cy="8" r="5" /><line x1="12" y1="12" x2="15" y2="15" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {Object.entries(grouped).map(([category, cmds]) => (
            <div key={category}>
              <p className="text-[10px] uppercase tracking-wider px-5 py-1.5" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {category}
              </p>
              {cmds.map(cmd => {
                const idx = filtered.indexOf(cmd);
                return (
                  <button
                    key={cmd.id}
                    className="w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors"
                    style={{
                      background: idx === selectedIdx ? 'var(--bg-hover)' : 'transparent',
                    }}
                    onClick={cmd.action}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <span className="text-sm">{cmd.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}>
                        {cmd.label}
                      </p>
                      <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                        {cmd.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-sm py-8" style={{ color: 'var(--text-muted)' }}>
              No matching commands
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t flex items-center gap-4 text-[10px]" style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

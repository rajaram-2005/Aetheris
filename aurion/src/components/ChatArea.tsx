/* ─── Chat Area — Center panel with messages and composer ─── */
"use client";

import { useRef, useEffect, useState } from 'react';
import { Thread, Message, Attachment } from '@/types';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';

interface ChatAreaProps {
  thread: Thread | null;
  processing: boolean;
  onSendMessage: (text: string, attachments?: Attachment[]) => void;
  onNewThread: () => void;
  onToggleInspector: () => void;
  onToggleSidebar: () => void;
  showInspector: boolean;
  sidebarOpen: boolean;
  onRunPrompt: (text: string) => void;
  onRate?: (message: Message, reward: number) => void;
}

export function ChatArea({
  thread, processing, onSendMessage, onNewThread,
  onToggleInspector, onToggleSidebar, showInspector, sidebarOpen, onRunPrompt, onRate,
}: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [voiceActive, setVoiceActive] = useState(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread?.messages]);

  const messages = thread?.messages || [];
  const isEmpty = messages.length === 0;

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 relative" style={{ background: 'var(--bg-primary)' }}>
      {/* Top Bar */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}
      >
        <div className="flex items-center gap-2">
          {!sidebarOpen && (
            <button
              onClick={onToggleSidebar}
              className="p-1.5 rounded-lg mr-1"
              style={{ color: 'var(--text-muted)' }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="4" x2="15" y2="4" /><line x1="3" y1="9" x2="15" y2="9" /><line x1="3" y1="14" x2="15" y2="14" />
              </svg>
            </button>
          )}
          <h2
            className="text-sm font-medium truncate max-w-[300px]"
            style={{ fontFamily: 'var(--font-ui)', color: 'var(--text-primary)' }}
          >
            {thread?.title || 'Aetheris'}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleInspector}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: showInspector ? 'rgba(61,255,194,0.1)' : 'var(--bg-tertiary)',
              border: `1px solid ${showInspector ? 'rgba(61,255,194,0.3)' : 'var(--border-color)'}`,
              color: showInspector ? 'var(--accent-mint)' : 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            ⚡ Inspector
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <EmptyState onRunPrompt={onRunPrompt} onNewThread={onNewThread} />
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
            {messages.map(msg => (
              <MessageBubble key={msg.id} message={msg} onRate={onRate} />
            ))}
            {processing && (
              <div className="flex items-start gap-3 animate-fade-in">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: 'var(--accent-mint)', color: '#0a0e1a', fontFamily: 'var(--font-display)' }}
                >
                  A
                </div>
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                  <div className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <div
                        key={i}
                        className="w-2 h-2 rounded-full"
                        style={{
                          background: 'var(--accent-mint)',
                          animation: `pulse-glow 1.4s ease-in-out ${i * 0.2}s infinite`,
                        }}
                      />
                    ))}
                  </div>
                  <span className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    Hermes cascade running…
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <Composer
        onSend={onSendMessage}
        disabled={processing}
        voiceActive={voiceActive}
        onToggleVoice={() => setVoiceActive(!voiceActive)}
      />
    </div>
  );
}

function EmptyState({ onRunPrompt, onNewThread }: { onRunPrompt: (text: string) => void; onNewThread: () => void }) {
  const suggestions = [
    { icon: '✍️', text: 'Write a professional email to my manager about a project update', category: 'Write' },
    { icon: '💻', text: 'Write a Python function to find prime numbers using the Sieve of Eratosthenes', category: 'Code' },
    { icon: '📐', text: 'Solve x² + 5x + 6 = 0', category: 'Math' },
    { icon: '🌐', text: 'Translate "How are you?" to Hindi', category: 'Translate' },
    { icon: '📚', text: 'Quiz me on photosynthesis', category: 'Study' },
    { icon: '🎨', text: 'Generate an image of an aurora', category: 'Create' },
    { icon: '🍳', text: 'Give me a biryani recipe', category: 'Cook' },
    { icon: '✈️', text: 'Weekend plan for Hyderabad', category: 'Travel' },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full px-4 pb-24">
      <div className="text-center mb-8 animate-fade-in">
        <h1
          className="text-4xl font-bold mb-3"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}
        >
          What's on your mind?
        </h1>
        <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}>
          Powered by the Hermes agent with meta-learning — running entirely offline on this machine.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl w-full">
        {suggestions.map(s => (
          <button
            key={s.text}
            onClick={() => onRunPrompt(s.text)}
            className="flex items-start gap-3 px-4 py-3 rounded-xl text-left transition-all hover:scale-[1.01]"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
            }}
          >
            <span className="text-lg mt-0.5">{s.icon}</span>
            <div>
              <p className="text-sm" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}>
                {s.text}
              </p>
              <p className="text-[10px] mt-1 uppercase tracking-wider" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {s.category}
              </p>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-8 flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        <kbd className="px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>⌘K</kbd>
        <span>Command palette</span>
        <span className="mx-2">·</span>
        <span>Press Enter to send, Shift+Enter for new line</span>
      </div>
    </div>
  );
}

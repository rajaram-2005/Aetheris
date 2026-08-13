/* ─── Message Bubble — Deep Reasoning <think> Parser, Markdown & Media ─── */
"use client";

import { Message } from '@/types';
import { useState, useCallback } from 'react';

interface MessageBubbleProps {
  message: Message;
  /** Rate an answer — the reward signal the meta-learner trains on. */
  onRate?: (message: Message, reward: number) => void;
}

export function MessageBubble({ message, onRate }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [showThinking, setShowThinking] = useState(true);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  const isUser = message.role === 'user';

  // Extract <think> ... </think> reasoning chain if present
  const { thinking, content } = extractThinking(message.content);

  return (
    <div className={`flex items-start gap-3 animate-fade-in ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-md overflow-hidden"
        style={{
          background: isUser ? 'var(--accent-gold)' : 'linear-gradient(135deg, #00b4d8, #3dffc2)',
          color: '#0a0e1a',
          fontFamily: 'var(--font-display)',
        }}
      >
        {isUser ? (
          'U'
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/avatar-prime.png"
              alt="Aetheris Avatar"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </>
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 min-w-0 max-w-[88%] ${isUser ? 'flex flex-col items-end' : ''}`}>
        <div
          className={`px-4 py-3 rounded-2xl ${
            isUser ? 'rounded-tr-sm' : 'rounded-tl-sm'
          }`}
          style={{
            background: isUser ? 'var(--bg-hover)' : 'var(--bg-secondary)',
            border: `1px solid ${isUser ? 'var(--border-hover)' : 'var(--border-color)'}`,
            boxShadow: isUser ? 'none' : '0 4px 20px rgba(0,0,0,0.15)',
          }}
        >
          {/* Deep Reasoning Chain-of-Thought Block */}
          {!isUser && thinking && (
            <div
              className="mb-3 rounded-xl overflow-hidden text-xs"
              style={{
                background: 'rgba(11, 19, 43, 0.6)',
                border: '1px solid rgba(0, 180, 216, 0.25)',
              }}
            >
              <button
                onClick={() => setShowThinking(!showThinking)}
                className="w-full px-3.5 py-2 flex items-center justify-between text-left transition-colors hover:bg-white/5"
                style={{
                  color: 'var(--accent-mint)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                  </span>
                  <span className="font-semibold">🧠 Deep Reasoning &amp; Verification Chain</span>
                </div>
                <span className="text-[10px] opacity-70">
                  {showThinking ? '▲ Hide steps' : '▼ View thought process'}
                </span>
              </button>

              {showThinking && (
                <div
                  className="px-3.5 pb-3 pt-1 border-t text-[11px] leading-relaxed whitespace-pre-wrap animate-fade-in"
                  style={{
                    borderColor: 'rgba(0, 180, 216, 0.15)',
                    color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {thinking}
                </div>
              )}
            </div>
          )}

          {/* Render Main Content */}
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}>
              {content}
            </p>
          ) : (
            <div
              className="prose text-sm leading-relaxed"
              style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          )}

          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {message.attachments.map((att, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs"
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                >
                  📎 {att.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Turn Meta & Feedback */}
        <div className={`flex items-center gap-2 mt-1.5 px-1 ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {new Date(message.timestamp).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
          </span>
          {!isUser && (
            <button
              onClick={handleCopy}
              className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80 transition-colors"
              style={{ color: copied ? 'var(--accent-mint)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {copied ? '✓ copied' : 'copy'}
            </button>
          )}
          {message.run && (
            <>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {message.run.duration_ms.toFixed(0)}ms · {message.run.intent}
              </span>
              {message.run.solved_exactly && (
                <span className="text-[10px] px-1.5 py-0.2 rounded" style={{ background: 'rgba(61,255,194,0.1)', color: 'var(--accent-mint)', fontFamily: 'var(--font-mono)' }}>
                  exact
                </span>
              )}
              {message.run.grounded && (
                <span className="text-[10px] px-1.5 py-0.2 rounded" style={{ background: 'rgba(245,193,108,0.1)', color: 'var(--accent-gold)', fontFamily: 'var(--font-mono)' }}>
                  grounded
                </span>
              )}
            </>
          )}

          {/* Rating for Meta-Learning */}
          {!isUser && message.run?.episode_id && onRate && (
            <span className="flex items-center gap-1 ml-1">
              {message.rated === undefined ? (
                <>
                  <button
                    onClick={() => onRate(message, 1)}
                    title="Helpful — reinforce this approach"
                    className="text-[10px] px-1 rounded hover:opacity-80 transition-transform active:scale-125"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => onRate(message, 0)}
                    title="Not helpful — learn from this"
                    className="text-[10px] px-1 rounded hover:opacity-80 transition-transform active:scale-125"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    👎
                  </button>
                </>
              ) : (
                <span
                  className="text-[10px]"
                  style={{
                    color: message.rated >= 0.5 ? 'var(--accent-mint)' : 'var(--accent-pink)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {message.rated >= 0.5 ? '👍 reinforced' : '👎 adapted'}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function extractThinking(raw: string): { thinking: string; content: string } {
  const match = raw.match(/<think>([\s\S]*?)<\/think>/i);
  if (match) {
    const thinking = match[1].trim();
    const content = raw.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
    return { thinking, content };
  }
  return { thinking: '', content: raw };
}

/* ── Simple markdown → HTML renderer (no external dep) ── */
function renderMarkdown(text: string): string {
  let html = text;

  // Code blocks with syntax badge
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<div class="my-2 rounded-xl overflow-hidden border border-[var(--border-color)] bg-[var(--bg-tertiary)]">
      <div class="px-3 py-1.5 bg-black/30 border-b border-[var(--border-color)] text-[10px] font-mono text-[var(--accent-mint)] flex justify-between">
        <span>${lang || 'code'}</span>
        <span>sovereign runner</span>
      </div>
      <pre class="p-3 overflow-x-auto text-xs font-mono"><code>${escapeHtml(code.trim())}</code></pre>
    </div>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--accent-mint)] font-mono text-xs">$1</code>');

  // Inline Images (e.g. ![title](/images/...))
  html = html.replace(/!\[(.*?)\]\((.*?)\)/g, '<div class="my-3 rounded-xl overflow-hidden border border-[var(--border-color)] bg-black/40"><img src="$2" alt="$1" class="w-full max-h-96 object-cover" /></div>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-base font-bold text-[var(--accent-mint)] mt-3 mb-1">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-[var(--accent-mint)] mt-4 mb-2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-[var(--accent-mint)] mt-5 mb-2">$1</h1>');

  // Bold & italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-white">$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-[var(--accent-mint)] underline underline-offset-2">$1</a>');

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote class="border-l-2 border-[var(--accent-mint)] pl-3 my-2 text-[var(--text-muted)] italic">$1</blockquote>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr class="my-4 border-[var(--border-color)]">');

  // Tables
  html = html.replace(/^\|(.+)\|$/gm, (match) => {
    const cells = match.split('|').filter(Boolean).map((c) => c.trim());
    if (cells.every((c) => /^[-:]+$/.test(c))) return '';
    const isHeader = cells.some((c) => /[a-zA-Z]/.test(c));
    const tag = isHeader ? 'th' : 'td';
    const row = cells.map((c) => `<${tag} class="border border-[var(--border-color)] px-3 py-1.5 text-xs font-mono">${c}</${tag}>`).join('');
    return `<tr>${row}</tr>`;
  });
  html = html.replace(/(<tr>[\s\S]*?<\/tr>\n?)+/g, (match) => {
    return `<div class="overflow-x-auto my-3"><table class="w-full border-collapse border border-[var(--border-color)]">${match}</table></div>`;
  });

  // Unordered lists
  html = html.replace(/^(?:- |\* )(.+)$/gm, '<li class="ml-4 list-disc">$1</li>');
  html = html.replace(/(<li class="ml-4 list-disc">[\s\S]*?<\/li>\n?)+/g, (match) => `<ul class="my-2 space-y-1">${match}</ul>`);

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>');

  // Paragraphs
  html = html.replace(/^(?!<[a-z]|$)(.+)$/gm, '<p class="my-1.5">$1</p>');
  html = html.replace(/<p class="my-1.5">\s*<\/p>/g, '');

  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

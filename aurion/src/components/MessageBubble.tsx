/* ─── Message Bubble — Renders user/assistant messages with markdown ─── */
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

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  const isUser = message.role === 'user';

  return (
    <div className={`flex items-start gap-3 animate-fade-in ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
        style={{
          background: isUser ? 'var(--accent-gold)' : 'var(--accent-mint)',
          color: '#0a0e1a',
          fontFamily: 'var(--font-display)',
        }}
      >
        {isUser ? 'U' : 'A'}
      </div>

      {/* Content */}
      <div className={`flex-1 min-w-0 max-w-[85%] ${isUser ? 'flex flex-col items-end' : ''}`}>
        <div
          className={`px-4 py-3 rounded-2xl ${
            isUser ? 'rounded-tr-sm' : 'rounded-tl-sm'
          }`}
          style={{
            background: isUser ? 'var(--bg-hover)' : 'var(--bg-secondary)',
            border: `1px solid ${isUser ? 'var(--border-hover)' : 'var(--border-color)'}`,
          }}
        >
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)', lineHeight: '1.7' }}>
              {message.content}
            </p>
          ) : (
            <div
              className="prose text-sm"
              style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)', lineHeight: '1.7' }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
            />
          )}

          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {message.attachments.map((att, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs"
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                >
                  📎 {att.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Meta */}
        <div className={`flex items-center gap-2 mt-1 px-1 ${isUser ? 'flex-row-reverse' : ''}`}>
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
                <span className="text-[10px]" style={{ color: 'var(--accent-mint)', fontFamily: 'var(--font-mono)' }}>
                  exact
                </span>
              )}
              {message.run.grounded && (
                <span className="text-[10px]" style={{ color: 'var(--accent-gold)', fontFamily: 'var(--font-mono)' }}>
                  grounded
                </span>
              )}
            </>
          )}

          {/* Rating — teaches the meta-learner */}
          {!isUser && message.run?.episode_id && onRate && (
            <span className="flex items-center gap-1">
              {message.rated === undefined ? (
                <>
                  <button
                    onClick={() => onRate(message, 1)}
                    title="Helpful — reinforce this approach"
                    className="text-[10px] px-1 rounded hover:opacity-80"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => onRate(message, 0)}
                    title="Not helpful — learn from this"
                    className="text-[10px] px-1 rounded hover:opacity-80"
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
                  {message.rated >= 0.5 ? '👍 learned' : '👎 learned'}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Simple markdown → HTML renderer (no external dep) ── */
function renderMarkdown(text: string): string {
  let html = text;

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang || 'text'}">${escapeHtml(code.trim())}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold & italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');

  // Tables
  html = html.replace(/^\|(.+)\|$/gm, (match) => {
    const cells = match.split('|').filter(Boolean).map(c => c.trim());
    if (cells.every(c => /^[-:]+$/.test(c))) return ''; // separator row
    const isHeader = cells.some(c => /[a-zA-Z]/.test(c));
    const tag = isHeader ? 'th' : 'td';
    const row = cells.map(c => `<${tag}>${c}</${tag}>`).join('');
    return `<tr>${row}</tr>`;
  });
  html = html.replace(/(<tr>[\s\S]*?<\/tr>\n?)+/g, (match) => {
    return `<table>${match}</table>`;
  });

  // Unordered lists
  html = html.replace(/^(?:- |\* )(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Details/summary (for quiz answers)
  html = html.replace(/<details><summary>(.+?)<\/summary>([\s\S]*?)<\/details>/g,
    '<details><summary>$1</summary>$2</details>');

  // Paragraphs (lines with content that aren't already wrapped)
  html = html.replace(/^(?!<[a-z]|$)(.+)$/gm, '<p>$1</p>');

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');

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

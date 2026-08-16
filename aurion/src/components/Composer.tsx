/* ─── Composer — Clean, professional message input bar ─── */
"use client";

import { useState, useRef, useCallback, useEffect } from 'react';
import { Attachment } from '@/types';

/* Minimal Web Speech API surface — the lib.dom typings don't cover it yet. */
interface SpeechRecognitionResultLike {
  0: { transcript: string };
  [index: number]: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionConstructor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

interface ComposerProps {
  onSend: (text: string, attachments?: Attachment[]) => void;
  disabled: boolean;
  /** True while a turn is in flight — shows the Stop button. */
  processing?: boolean;
  /** Abort the in-flight generation. */
  onStop?: () => void;
  voiceActive: boolean;
  onToggleVoice: () => void;
  onGenerateImage?: (prompt: string) => void;
  onSpeak?: (text: string) => void;
  onSpeakLast?: () => void;
  canSpeakLast?: boolean;
  imageBusy?: boolean;
  speaking?: boolean;
}

export function Composer({
  onSend, disabled, processing, onStop, voiceActive, onToggleVoice,
  onGenerateImage, onSpeak, onSpeakLast, canSpeakLast,
  imageBusy, speaking,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
    }
  }, [text]);

  const handleSend = useCallback(() => {
    if (!text.trim() && attachments.length === 0) return;
    if (disabled) return;
    onSend(text, attachments.length > 0 ? attachments : undefined);
    setText('');
    setAttachments([]);
  }, [text, attachments, disabled, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleFileAttach = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newAttachments: Attachment[] = [];
    for (const file of Array.from(files)) {
      newAttachments.push({ name: file.name, type: file.type, content: await readFileContent(file), size: file.size });
    }
    setAttachments(prev => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removeAttachment = useCallback((idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handleVoice = useCallback(() => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }
    onToggleVoice();
    if (!voiceActive) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        const transcript = Array.from(event.results).map((r) => r[0].transcript).join('');
        setText(transcript);
      };
      recognition.onend = () => onToggleVoice();
      recognition.onerror = () => onToggleVoice();
      recognition.start();
    }
  }, [voiceActive, onToggleVoice]);

  const canSend = text.trim().length > 0 || attachments.length > 0;

  return (
    <div className="px-4 pb-3 pt-1 flex-shrink-0" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-3xl mx-auto">
        {/* Attachments */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachments.map((att, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg text-xs"
                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                <span className="text-[11px]">{att.name}</span>
                <button onClick={() => removeAttachment(i)} className="w-4 h-4 flex items-center justify-center rounded hover:bg-white/10"
                  style={{ color: 'var(--text-muted)' }} title="Remove attachment">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 2l6 6M8 2l-6 6"/></svg>
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Input bar */}
        <div
          className="flex items-end gap-1.5 rounded-2xl px-3 py-2 transition-shadow"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
        >
          {/* Attach */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-icon btn-ghost mb-0.5"
            title="Attach files"
            style={{ width: 32, height: 32 }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M15.5 9l-6.5 6.5a3.5 3.5 0 01-5-5L12 2.5a2 2 0 013 3L6.5 14a.5.5 0 01-.7-.7L13 6" />
            </svg>
          </button>
          <input ref={fileInputRef} type="file" multiple
            accept=".txt,.md,.csv,.json,.pdf,.py,.js,.ts,.java,.cpp,.c,.html,.css,.go,.rs,.sql,.sh,.xml,.yaml,.yml,.toml,.ini,.log,.bat,image/*"
            onChange={handleFileAttach} className="hidden" />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything…"
            disabled={disabled}
            rows={1}
            className="input flex-1 resize-none text-[15px] py-1"
            style={{ minHeight: 26, maxHeight: 180, lineHeight: 1.5 }}
          />

          {/* Image generation */}
          {onGenerateImage && (
            <button
              onClick={() => text.trim() && onGenerateImage(text)}
              disabled={disabled || imageBusy || !text.trim()}
              className="btn btn-icon btn-ghost mb-0.5"
              title="Create an image from your prompt"
              style={{ width: 32, height: 32 }}
            >
              {imageBusy
                ? <span className="dot-pulse text-sm" style={{ color: 'var(--accent-mint)' }}>…</span>
                : <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <rect x="2" y="2" width="14" height="14" rx="2" />
                    <circle cx="6.5" cy="6.5" r="1.3" />
                    <path d="M2 12.5l3.5-3.5 2.5 2.5 2.5-2.5 5 5" />
                  </svg>}
            </button>
          )}

          {/* Speak (TTS) */}
          {onSpeak && (
            <button
              onClick={() => text.trim() && onSpeak(text)}
              disabled={disabled || speaking || !text.trim()}
              className="btn btn-icon btn-ghost mb-0.5"
              title="Speak this text aloud"
              style={{ width: 32, height: 32 }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M3 7v4h3l4 3V4L6 7H3z" fill="currentColor" stroke="none" />
                <path d="M12 6a3.5 3.5 0 010 6" />
                <path d="M13.5 4a6 6 0 010 10" />
              </svg>
            </button>
          )}

          {/* Voice (STT) */}
          <button
            onClick={handleVoice}
            className="btn btn-icon btn-ghost mb-0.5"
            title="Voice input"
            style={{ width: 32, height: 32, color: voiceActive ? 'var(--accent-mint)' : undefined }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
              <rect x="6" y="2" width="6" height="9" rx="3" />
              <path d="M4 9a5 5 0 0010 0" fill="none" stroke="currentColor" strokeWidth="2" />
              <line x1="9" y1="14" x2="9" y2="16" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>

          {/* Send / Stop */}
          {processing && onStop ? (
            <button
              onClick={onStop}
              title="Stop generating"
              className="btn btn-icon mb-0.5"
              style={{
                width: 34, height: 34, borderRadius: 10,
                background: 'var(--accent-pink, #f472b6)', color: '#0a0e1a',
              }}
            >
              <span className="block w-3 h-3 rounded-[3px]" style={{ background: '#0a0e1a' }} />
            </button>
          ) : (
          <button
            onClick={handleSend}
            disabled={disabled || !canSend}
            className="btn btn-primary btn-icon mb-0.5"
            title="Send message"
            style={{ width: 34, height: 34, borderRadius: 10, opacity: canSend ? 1 : 0.35 }}
          >
            <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9h12M10 4l5 5-5 5" />
            </svg>
          </button>
          )}
        </div>

        {/* Speak-last */}
        {onSpeakLast && canSpeakLast && (
          <button
            onClick={onSpeakLast}
            disabled={disabled || speaking}
            className="btn w-full mt-2"
            style={{ justifyContent: 'center', color: 'var(--text-secondary)' }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M2 6v2h2l2.5 2V4L4 6H2z" fill="currentColor" stroke="none" />
              <path d="M9 5a2.5 2.5 0 010 4" />
            </svg>
            {speaking ? 'Speaking…' : 'Speak the last answer aloud'}
          </button>
        )}

        <div className="flex items-center justify-center gap-2 mt-1.5">
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Aetheris may make mistakes · ⌘K for commands
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── File reader ── */
async function readFileContent(file: File): Promise<string> {
  if (file.type === 'application/pdf') {
    return `[PDF file: ${file.name} — ${(file.size / 1024).toFixed(1)} KB]\nPDF text extraction would require a PDF parser. For now, the file metadata is captured.`;
  }
  if (file.type.startsWith('image/')) {
    return `[Image file: ${file.name} — ${file.type} — ${(file.size / 1024).toFixed(1)} KB]`;
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve(`[Error reading file: ${file.name}]`);
    reader.readAsText(file);
  });
}

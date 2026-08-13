/* ─── Composer — Message input with file attach, mic, send ─── */
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
  voiceActive: boolean;
  onToggleVoice: () => void;
  /** Generate an image from the typed text (ChatGPT-style "create image"). */
  onGenerateImage?: (prompt: string) => void;
  /** Speak the typed text aloud via text-to-speech. */
  onSpeak?: (text: string) => void;
  /** Speak the assistant's last message aloud. */
  onSpeakLast?: () => void;
  canSpeakLast?: boolean;
  imageBusy?: boolean;
  speaking?: boolean;
}

export function Composer({
  onSend, disabled, voiceActive, onToggleVoice,
  onGenerateImage, onSpeak, onSpeakLast, canSpeakLast,
  imageBusy, speaking,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
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
      const textContent = await readFileContent(file);
      newAttachments.push({
        name: file.name,
        type: file.type,
        content: textContent,
        size: file.size,
      });
    }
    setAttachments(prev => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removeAttachment = useCallback((idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  }, []);

  // Voice input via Web Speech API
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
        const transcript = Array.from(event.results)
          .map((r) => r[0].transcript)
          .join('');
        setText(transcript);
      };

      recognition.onend = () => {
        onToggleVoice();
      };

      recognition.onerror = () => {
        onToggleVoice();
      };

      recognition.start();
    }
  }, [voiceActive, onToggleVoice]);

  return (
    <div
      className="border-t px-4 py-3 flex-shrink-0"
      style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}
    >
      <div className="max-w-3xl mx-auto">
        {/* Attachments */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachments.map((att, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
              >
                📎 {att.name}
                <button
                  onClick={() => removeAttachment(i)}
                  className="ml-1 hover:opacity-70"
                  style={{ color: 'var(--accent-pink)' }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Input area */}
        <div
          className="flex items-end gap-2 rounded-xl px-3 py-2"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
        >
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 rounded-lg transition-colors flex-shrink-0 mb-0.5"
            style={{ color: 'var(--text-muted)' }}
            title="Attach file (txt, md, csv, json, pdf, code, images)"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15.5 9l-6.5 6.5a3.5 3.5 0 01-5-5L12 2.5a2 2 0 013 3L6.5 14a.5.5 0 01-.7-.7L13 6" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,.csv,.json,.pdf,.py,.js,.ts,.java,.cpp,.c,.html,.css,.go,.rs,.sql,.sh,.xml,.yaml,.yml,.toml,.ini,.log,.bat,image/*"
            onChange={handleFileAttach}
            className="hidden"
          />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything… (Enter to send, Shift+Enter for new line)"
            disabled={disabled}
            rows={1}
            className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed"
            style={{
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-ui)',
              minHeight: '24px',
              maxHeight: '200px',
            }}
          />

          {/* Generate image (from the typed text) */}
          {onGenerateImage && (
            <button
              onClick={() => text.trim() && onGenerateImage(text)}
              disabled={disabled || imageBusy || !text.trim()}
              className="p-1.5 rounded-lg transition-colors flex-shrink-0 mb-0.5 disabled:opacity-30"
              style={{
                color: text.trim() ? 'var(--accent-purple)' : 'var(--text-muted)',
                background: imageBusy ? 'rgba(192,132,252,0.1)' : 'transparent',
              }}
              title="Create an image from your prompt"
            >
              {imageBusy
                ? <span className="text-xs" style={{ color: 'var(--accent-purple)' }}>…</span>
                : <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <rect x="2" y="2" width="14" height="14" rx="2" />
                    <circle cx="6.5" cy="6.5" r="1.5" />
                    <path d="M2 13l4-4 3 3 3-3 4 4" />
                  </svg>}
            </button>
          )}

          {/* Speak typed text aloud (TTS) */}
          {onSpeak && (
            <button
              onClick={() => text.trim() && onSpeak(text)}
              disabled={disabled || speaking || !text.trim()}
              className="p-1.5 rounded-lg transition-colors flex-shrink-0 mb-0.5 disabled:opacity-30"
              style={{
                color: text.trim() ? 'var(--accent-gold)' : 'var(--text-muted)',
                background: speaking ? 'rgba(251,191,36,0.12)' : 'transparent',
              }}
              title="Speak this text aloud"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M3 7v4h3l4 3V4L6 7H3z" fill="currentColor" stroke="none" />
                <path d="M12 6a3 3 0 010 6M14 4a6 6 0 010 10" />
              </svg>
            </button>
          )}

          {/* Voice button (speech-to-text) */}
          <button
            onClick={handleVoice}
            className="p-1.5 rounded-lg transition-colors flex-shrink-0 mb-0.5"
            style={{
              color: voiceActive ? 'var(--accent-mint)' : 'var(--text-muted)',
              background: voiceActive ? 'rgba(61,255,194,0.1)' : 'transparent',
            }}
            title="Voice input (speech-to-text)"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
              <rect x="6" y="2" width="6" height="9" rx="3" />
              <path d="M4 9a5 5 0 0010 0" fill="none" stroke="currentColor" strokeWidth="2" />
              <line x1="9" y1="14" x2="9" y2="16" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={disabled || (!text.trim() && attachments.length === 0)}
            className="p-1.5 rounded-lg transition-all flex-shrink-0 mb-0.5 disabled:opacity-30"
            style={{
              background: text.trim() ? 'var(--accent-mint)' : 'transparent',
              color: text.trim() ? '#0a0e1a' : 'var(--text-muted)',
            }}
            title="Send message"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9h12M10 4l5 5-5 5" />
            </svg>
          </button>
        </div>

        {/* Speak-last button (read the assistant's answer aloud) */}
        {onSpeakLast && canSpeakLast && (
          <button
            onClick={onSpeakLast}
            disabled={disabled || speaking}
            className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
            style={{
              background: 'rgba(251,191,36,0.1)',
              border: '1px solid rgba(251,191,36,0.3)',
              color: 'var(--accent-gold)',
              fontFamily: 'var(--font-ui)',
            }}
          >
            {speaking ? '⏹ Speaking…' : '🔊 Speak the last answer aloud'}
          </button>
        )}

        <p className="text-center text-[10px] mt-1.5" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Aetheris · Thamizh Mythos AI · text · voice · speech · image · ⌘K for commands
        </p>
      </div>
    </div>
  );
}

/* ── File reader ── */
async function readFileContent(file: File): Promise<string> {
  // Simple PDF text extraction
  if (file.type === 'application/pdf') {
    return `[PDF file: ${file.name} — ${(file.size / 1024).toFixed(1)} KB]\nPDF text extraction would require a PDF parser. For now, the file metadata is captured.`;
  }

  // Images
  if (file.type.startsWith('image/')) {
    return `[Image file: ${file.name} — ${file.type} — ${(file.size / 1024).toFixed(1)} KB]`;
  }

  // Text-based files
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve(`[Error reading file: ${file.name}]`);
    reader.readAsText(file);
  });
}

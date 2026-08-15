/* ─── Chat Area — Center panel with messages, hero banner & composer ─── */
"use client";

import { useRef, useEffect, useState } from 'react';
import { Thread, Message, Attachment, ModelId, ModeId } from '@/types';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';

interface ChatAreaProps {
  thread: Thread | null;
  processing: boolean;
  onSendMessage: (text: string, attachments?: Attachment[]) => void;
  onNewThread: () => void;
  onToggleInspector: () => void;
  onToggleSidebar: () => void;
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
  activeModel?: ModelId;
  onSelectModel?: (model: ModelId) => void;
  activeMode?: ModeId;
  onSelectMode?: (mode: ModeId) => void;
  showInspector: boolean;
  sidebarOpen: boolean;
  onRunPrompt: (text: string) => void;
  onRate?: (message: Message, reward: number) => void;
  /** Create an image from a prompt. */
  onGenerateImage?: (prompt: string) => void;
  /** Speak text aloud via TTS. */
  onSpeak?: (text: string) => void;
  /** Speak the last assistant answer aloud. */
  onSpeakLast?: () => void;
  canSpeakLast?: boolean;
  imageBusy?: boolean;
  speaking?: boolean;
}

const MODEL_NAMES: Record<ModelId, { label: string; icon: string }> = {
  'aetheris-prime-v4': { label: 'Aetheris Prime v4', icon: '⚡' },
  'aetheris-omni-reasoner': { label: 'Omni Reasoner', icon: '🧠' },
  'aetheris-flash-v2': { label: 'Flash v2', icon: '⚡' },
  'hermes-cognition-v4': { label: 'Hermes 4X', icon: '🧬' },
  'aetheris-vision-v3': { label: 'Vision-Gen v3', icon: '🎨' },
};

const MODE_NAMES: Record<ModeId, { label: string; icon: string }> = {
  general: { label: 'General', icon: '✦' },
  engineering: { label: 'Engineering', icon: '💻' },
  editorial: { label: 'Editorial', icon: '✍️' },
  structured: { label: 'Structured', icon: '{}' },
  myth: { label: 'Myth', icon: '🜂' },
  legendary: { label: 'Legendary', icon: '⚔' },
  pro: { label: 'Pro', icon: '◆' },
  lite: { label: 'Lite', icon: '○' },
  flash: { label: 'Flash', icon: '⚡' },
  thamizh: { label: 'Thamizh', icon: '🪔' },
};

export function ChatArea({
  thread,
  processing,
  onSendMessage,
  onNewThread,
  onToggleInspector,
  onToggleSidebar,
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
  activeModel = 'aetheris-prime-v4',
  onSelectModel,
  activeMode = 'general',
  onSelectMode,
  showInspector,
  sidebarOpen,
  onRunPrompt,
  onRate,
  onGenerateImage,
  onSpeak,
  onSpeakLast,
  canSpeakLast,
  imageBusy,
  speaking,
}: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [modelDropdown, setModelDropdown] = useState(false);
  const [modeDropdown, setModeDropdown] = useState(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread?.messages]);

  const messages = thread?.messages || [];
  const isEmpty = messages.length === 0;

  const currentModelInfo = MODEL_NAMES[activeModel] || MODEL_NAMES['aetheris-prime-v4'];
  const currentModeInfo = MODE_NAMES[activeMode] || MODE_NAMES.general;

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 relative" style={{ background: 'var(--bg-primary)' }}>
      {/* Top Bar */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b flex-shrink-0 gap-3"
        style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {!sidebarOpen && (
            <button onClick={onToggleSidebar} className="btn btn-icon btn-ghost" title="Toggle sidebar" style={{ width: 32, height: 32 }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8">
                <line x1="3" y1="4" x2="15" y2="4" /><line x1="3" y1="9" x2="15" y2="9" /><line x1="3" y1="14" x2="15" y2="14" />
              </svg>
            </button>
          )}

          <button onClick={onNewThread} className="btn" title="Start a new thread">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.8">
              <line x1="7.5" y1="2" x2="7.5" y2="13" /><line x1="2" y1="7.5" x2="13" y2="7.5" />
            </svg>
            <span className="hidden sm:inline">New chat</span>
          </button>

          {/* Model switcher */}
          <div className="relative">
            <button onClick={() => { setModelDropdown(!modelDropdown); setModeDropdown(false); }} className="btn" title="Select model">
              <span style={{ color: 'var(--accent-blue)' }}>{currentModelInfo.icon}</span>
              <span className="font-mono">{currentModelInfo.label}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 4.5L6 7.5L9 4.5" /></svg>
            </button>
            {modelDropdown && (
              <div className="absolute left-0 top-full mt-1.5 w-60 rounded-xl shadow-2xl z-40 p-1.5 space-y-0.5 animate-fade-in surface" style={{ boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
                {(Object.keys(MODEL_NAMES) as ModelId[]).map((mId) => (
                  <button key={mId} onClick={() => { onSelectModel?.(mId); setModelDropdown(false); }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors"
                    style={{ background: activeModel === mId ? 'var(--bg-hover)' : 'transparent', color: activeModel === mId ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    <span className="flex items-center gap-2 font-mono"><span>{MODEL_NAMES[mId].icon}</span><span>{MODEL_NAMES[mId].label}</span></span>
                    {activeModel === mId && <span style={{ color: 'var(--accent-mint)' }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Mode switcher */}
          <div className="relative">
            <button onClick={() => { setModeDropdown(!modeDropdown); setModelDropdown(false); }} className="btn" title="Inference mode">
              <span style={{ color: 'var(--accent-gold)' }}>{currentModeInfo.icon}</span>
              <span className="font-mono">{currentModeInfo.label}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 4.5L6 7.5L9 4.5" /></svg>
            </button>
            {modeDropdown && (
              <div className="absolute left-0 top-full mt-1.5 w-64 rounded-xl shadow-2xl z-40 p-1.5 space-y-0.5 animate-fade-in surface" style={{ boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
                {(Object.keys(MODE_NAMES) as ModeId[]).map((id) => (
                  <button key={id} onClick={() => { onSelectMode?.(id); setModeDropdown(false); }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors"
                    style={{ background: activeMode === id ? 'var(--bg-hover)' : 'transparent', color: activeMode === id ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    <span className="flex items-center gap-2 font-mono"><span>{MODE_NAMES[id].icon}</span><span>{MODE_NAMES[id].label}</span></span>
                    {activeMode === id && <span style={{ color: 'var(--accent-gold)' }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="text-xs font-medium truncate max-w-[180px] hidden md:block" style={{ fontFamily: 'var(--font-ui)', color: 'var(--text-muted)' }}>
            {thread?.title || ''}
          </span>
        </div>

        {/* Right tools — consistent icon toolbar */}
        <div className="flex items-center gap-1">
          <ToolButton icon="canvas" label="Canvas" onClick={onOpenCanvas} show={!!onOpenCanvas} />
          <ToolButton icon="research" label="Research" onClick={onOpenDeepResearch} show={!!onOpenDeepResearch} />
          <ToolButton icon="apex" label="Apex" onClick={onOpenApexLab} show={!!onOpenApexLab} />
          <ToolButton icon="god" label="God" onClick={onOpenGodDeck} show={!!onOpenGodDeck} />
          <ToolButton icon="agents" label="Agents" onClick={onOpenAgentStore} show={!!onOpenAgentStore} />
          <ToolButton icon="skills" label="Skills" onClick={onOpenSkills} show={!!onOpenSkills} />
          <ToolButton icon="connect" label="Connect" onClick={onOpenIntegrations} show={!!onOpenIntegrations} />
          <ToolButton icon="models" label="Models" onClick={onOpenResources} show={!!onOpenResources} />
          <ToolButton icon="arena" label="Arena" onClick={onOpenBenchmarks} show={!!onOpenBenchmarks} />
          <ToolButton icon="visuals" label="Visuals" onClick={onOpenGallery} show={!!onOpenGallery} />
          <ToolButton icon="mythos" label="Mythos" onClick={onOpenMythology} show={!!onOpenMythology} />

          <div className="w-px h-5 mx-1" style={{ background: 'var(--border-color)' }} />
          <button onClick={onToggleInspector} className="btn btn-ghost btn-icon" title="Toggle inspector" style={{ width: 32, height: 32, color: showInspector ? 'var(--accent-mint)' : 'var(--text-muted)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M2 3h12M2 8h12M2 13h12" />
              <circle cx="4.5" cy="3" r="1.3" fill="currentColor" stroke="none" />
              <circle cx="11.5" cy="8" r="1.3" fill="currentColor" stroke="none" />
              <circle cx="7" cy="13" r="1.3" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages / Hero Empty State */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <EmptyState onRunPrompt={onRunPrompt} />
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} onRate={onRate} />
            ))}
            {processing && (
              <div className="flex items-start gap-3 animate-fade-in">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-lg overflow-hidden"
                  style={{
                    background: 'linear-gradient(135deg, #00b4d8, #3dffc2)',
                    color: '#060914',
                    fontFamily: 'var(--font-display)',
                  }}
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
                <div className="flex items-center gap-3 px-4 py-3 surface">
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full dot-pulse" style={{ background: 'var(--accent-mint)', animationDelay: `${i * 0.18}s` }} />
                    ))}
                  </div>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Aetheris is thinking…
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
        onGenerateImage={onGenerateImage}
        onSpeak={onSpeak}
        onSpeakLast={onSpeakLast}
        canSpeakLast={canSpeakLast}
        imageBusy={imageBusy}
        speaking={speaking}
      />
    </div>
  );
}

function EmptyState({ onRunPrompt }: { onRunPrompt: (text: string) => void }) {
  const suggestions = [
    { icon: '🎨', title: 'Visual Art', text: 'Generate an image of a tranquil forest at golden hour' },
    { icon: '💻', title: 'Code', text: 'Write an optimized async Python pipeline with rate limiting' },
    { icon: '🧠', title: 'Reason', text: 'Prove step by step why the square root of 2 is irrational' },
    { icon: '🪔', title: 'Mythos', text: 'Give me a kural about perseverance from Tiruvalluvar' },
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-4 py-8 max-w-3xl mx-auto">
      {/* Welcome */}
      <div className="text-center mb-10 animate-fade-in">
        <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center brand-glow"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
          <span className="text-2xl">🪔</span>
        </div>
        <h1 className="text-2xl font-semibold mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          Aetheris
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          A private AI thought partner — reasoning, code, images, voice, and the living Tamil mythology.
        </p>
      </div>

      {/* Suggested prompts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full animate-fade-in">
        {suggestions.map((s) => (
          <button key={s.title} onClick={() => onRunPrompt(s.text)}
            className="surface surface-hover text-left px-4 py-3.5 flex items-start gap-3">
            <span className="text-lg mt-0.5">{s.icon}</span>
            <span>
              <span className="block text-sm font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>{s.title}</span>
              <span className="block text-xs leading-snug" style={{ color: 'var(--text-secondary)' }}>{s.text}</span>
            </span>
          </button>
        ))}
      </div>

      <p className="text-[11px] mt-6 text-center" style={{ color: 'var(--text-muted)' }}>
        Works fully offline · type below to begin
      </p>
    </div>
  );
}

/* ── Compact, consistent tool button (SVG icon + label) ── */
const TOOL_ICONS: Record<string, React.ReactNode> = {
  canvas: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2" y="2" width="12" height="12" rx="2" /><path d="M6 6h4v4H6z" /></svg>,
  research: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="6.5" cy="6.5" r="3.5" /><line x1="9.5" y1="9.5" x2="13" y2="13" /><path d="M5.5 6.5l1 1 2-2" /></svg>,
  apex: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 2l6 12H2z" /><path d="M8 6l3 6H5z" fill="currentColor" stroke="none" /></svg>,
  god: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="8" cy="8" r="5.5" /><path d="M8 3.5v9M3.5 8h9" /></svg>,
  agents: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="5" cy="5" r="2.5" /><circle cx="11" cy="5" r="2.5" /><path d="M3.5 13c.5-2 1-3 1.5-3s1 1 1.5 3M10 13c.5-2 1-3 1.5-3s1 1 1.5 3" /></svg>,
  arena: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2.5" y="3" width="4.5" height="10" rx="1" /><rect x="9" y="3" width="4.5" height="10" rx="1" /></svg>,
  visuals: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2" y="2" width="12" height="12" rx="2" /><circle cx="5.5" cy="5.5" r="1.3" /><path d="M2 12l3.5-3.5 2.5 2.5 2.5-2.5 3.5 3.5" /></svg>,
  mythos: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 2c0 6-3 8-5 10h10C11 10 8 8 8 2z" /><path d="M8 2v10" /></svg>,
  skills: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 1.5l5.7 3.3v6.4L8 14.5l-5.7-3.3V4.8z" /><path d="M8 5v6M5.2 6.6l5.6 3.2M10.8 6.6l-5.6 3.2" /></svg>,
  connect: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="4" cy="8" r="2.2" /><circle cx="12" cy="8" r="2.2" /><path d="M6.2 8h3.6" /></svg>,
  models: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 1.5l5.7 3.3L8 8 2.3 4.8z" /><path d="M2.3 8L8 11.2 13.7 8" /><path d="M2.3 11.2L8 14.5l5.7-3.3" /></svg>,
};

function ToolButton({ icon, label, onClick, show }: { icon: string; label: string; onClick?: () => void; show?: boolean }) {
  if (!show || !onClick) return null;
  return (
    <button onClick={onClick} className="btn btn-ghost btn-icon hidden lg:flex" title={label} style={{ width: 34, height: 34, color: 'var(--text-muted)' }}>
      {TOOL_ICONS[icon]}
    </button>
  );
}

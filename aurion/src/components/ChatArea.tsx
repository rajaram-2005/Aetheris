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
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}
      >
        <div className="flex items-center gap-3">
          {!sidebarOpen && (
            <button
              onClick={onToggleSidebar}
              className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
              style={{ color: 'var(--text-muted)' }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="4" x2="15" y2="4" /><line x1="3" y1="9" x2="15" y2="9" /><line x1="3" y1="14" x2="15" y2="14" />
              </svg>
            </button>
          )}

          {/* New Exploration */}
          <button
            onClick={onNewThread}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all hover:scale-[1.02]"
            style={{
              background: 'rgba(61,255,194,0.08)',
              border: '1px solid rgba(61,255,194,0.25)',
              color: 'var(--accent-mint)',
              fontFamily: 'var(--font-ui)',
            }}
            title="Start a new thread"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="7" y1="1" x2="7" y2="13" /><line x1="1" y1="7" x2="13" y2="7" />
            </svg>
            <span className="hidden sm:inline">New</span>
          </button>

          {/* Model Switcher Pill */}
          <div className="relative">
            <button
              onClick={() => { setModelDropdown(!modelDropdown); setModeDropdown(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:scale-[1.02]"
              style={{
                background: 'rgba(0, 180, 216, 0.1)',
                border: '1px solid rgba(0, 180, 216, 0.3)',
                color: 'var(--accent-mint)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <span>{currentModelInfo.icon}</span>
              <span>{currentModelInfo.label}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 4.5L6 7.5L9 4.5" />
              </svg>
            </button>

            {modelDropdown && (
              <div
                className="absolute left-0 top-full mt-2 w-56 rounded-xl shadow-2xl z-40 p-1.5 space-y-1 animate-fade-in"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid rgba(61, 255, 194, 0.3)',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                }}
              >
                {(Object.keys(MODEL_NAMES) as ModelId[]).map((mId) => (
                  <button
                    key={mId}
                    onClick={() => {
                      if (onSelectModel) onSelectModel(mId);
                      setModelDropdown(false);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors"
                    style={{
                      background: activeModel === mId ? 'rgba(61,255,194,0.1)' : 'transparent',
                      color: activeModel === mId ? 'var(--accent-mint)' : 'var(--text-primary)',
                    }}
                  >
                    <span className="flex items-center gap-2 font-mono">
                      <span>{MODEL_NAMES[mId].icon}</span>
                      <span>{MODEL_NAMES[mId].label}</span>
                    </span>
                    {activeModel === mId && <span className="text-xs">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Mode Switcher — myth / legendary / pro / lite / flash on any model */}
          <div className="relative">
            <button
              onClick={() => { setModeDropdown(!modeDropdown); setModelDropdown(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:scale-[1.02]"
              style={{
                background: 'rgba(251, 191, 36, 0.1)',
                border: '1px solid rgba(251, 191, 36, 0.35)',
                color: '#fbbf24',
                fontFamily: 'var(--font-mono)',
              }}
              title="Inference mode — works on Flash, Pro, and Ultra"
            >
              <span>{currentModeInfo.icon}</span>
              <span>{currentModeInfo.label}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 4.5L6 7.5L9 4.5" />
              </svg>
            </button>

            {modeDropdown && (
              <div
                className="absolute left-0 top-full mt-2 w-56 rounded-xl shadow-2xl z-40 p-1.5 space-y-1 animate-fade-in"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid rgba(251, 191, 36, 0.35)',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                }}
              >
                {(Object.keys(MODE_NAMES) as ModeId[]).map((id) => (
                  <button
                    key={id}
                    onClick={() => {
                      if (onSelectMode) onSelectMode(id);
                      setModeDropdown(false);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors"
                    style={{
                      background: activeMode === id ? 'rgba(251,191,36,0.12)' : 'transparent',
                      color: activeMode === id ? '#fbbf24' : 'var(--text-primary)',
                    }}
                  >
                    <span className="flex items-center gap-2 font-mono">
                      <span>{MODE_NAMES[id].icon}</span>
                      <span>{MODE_NAMES[id].label}</span>
                    </span>
                    {activeMode === id && <span className="text-xs">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <h2
            className="text-xs font-medium truncate max-w-[200px] hidden sm:block"
            style={{ fontFamily: 'var(--font-ui)', color: 'var(--text-muted)' }}
          >
            {thread?.title || 'New Exploration'}
          </h2>
        </div>

        {/* Right Tools */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {onOpenCanvas && (
            <button
              onClick={onOpenCanvas}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105"
              style={{
                background: 'rgba(251, 191, 36, 0.12)',
                border: '1px solid rgba(251, 191, 36, 0.35)',
                color: 'var(--accent-gold)',
                fontFamily: 'var(--font-ui)',
              }}
              title="Artifacts 2.0 Canvas Studio"
            >
              <span>📐</span>
              <span className="hidden md:inline">Canvas</span>
            </button>
          )}

          {onOpenDeepResearch && (
            <button
              onClick={onOpenDeepResearch}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105"
              style={{
                background: 'rgba(0, 180, 216, 0.12)',
                border: '1px solid rgba(0, 180, 216, 0.35)',
                color: 'var(--accent-blue)',
                fontFamily: 'var(--font-ui)',
              }}
              title="Autonomous Deep Research"
            >
              <span>🔬</span>
              <span className="hidden md:inline">Research</span>
            </button>
          )}

          {onOpenApexLab && (
            <button
              onClick={onOpenApexLab}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105"
              style={{
                background: 'rgba(192, 132, 252, 0.14)',
                border: '1px solid rgba(192, 132, 252, 0.4)',
                color: '#c084fc',
                fontFamily: 'var(--font-ui)',
              }}
              title="Apex Cognition Lab"
            >
              <span>✦</span>
              <span className="hidden md:inline">Apex</span>
            </button>
          )}

          {onOpenGodDeck && (
            <button
              onClick={onOpenGodDeck}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105"
              style={{
                background: 'rgba(251, 191, 36, 0.16)',
                border: '1px solid rgba(251, 191, 36, 0.45)',
                color: '#fbbf24',
                fontFamily: 'var(--font-ui)',
              }}
              title="God Deck — ToT, causal world, proofs, red-team"
            >
              <span>Ω</span>
              <span className="hidden md:inline">God</span>
            </button>
          )}

          {onOpenAgentStore && (
            <button
              onClick={onOpenAgentStore}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105"
              style={{
                background: 'rgba(74, 222, 128, 0.12)',
                border: '1px solid rgba(74, 222, 128, 0.35)',
                color: '#4ade80',
                fontFamily: 'var(--font-ui)',
              }}
              title="Sovereign Agents & Custom GPTs"
            >
              <span>🤖</span>
              <span className="hidden md:inline">GPT Store</span>
            </button>
          )}

          {onOpenBenchmarks && (
            <button
              onClick={onOpenBenchmarks}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105"
              style={{
                background: 'rgba(192, 132, 252, 0.12)',
                border: '1px solid rgba(192, 132, 252, 0.35)',
                color: 'var(--accent-purple)',
                fontFamily: 'var(--font-ui)',
              }}
              title="Open-Source Benchmark Arena"
            >
              <span>📊</span>
              <span className="hidden md:inline">Arena</span>
            </button>
          )}

          {onOpenGallery && (
            <button
              onClick={onOpenGallery}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105"
              style={{
                background: 'linear-gradient(135deg, rgba(0, 180, 216, 0.15), rgba(61, 255, 194, 0.15))',
                border: '1px solid rgba(61, 255, 194, 0.4)',
                color: 'var(--accent-mint)',
                fontFamily: 'var(--font-ui)',
              }}
              title="Neural Visual Studio"
            >
              <span>🎨</span>
              <span className="hidden md:inline">Visuals</span>
            </button>
          )}

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

      {/* Messages / Hero Empty State */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <EmptyState
            onRunPrompt={onRunPrompt}
            onOpenGallery={onOpenGallery}
            onOpenBenchmarks={onOpenBenchmarks}
          />
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
                <div
                  className="flex items-center gap-2 px-4 py-3 rounded-xl shadow-md"
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid rgba(61, 255, 194, 0.3)',
                  }}
                >
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map((i) => (
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
                  <span className="text-xs" style={{ color: 'var(--accent-mint)', fontFamily: 'var(--font-mono)' }}>
                    Aetheris Sovereign Neural Core generating…
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

function EmptyState({
  onRunPrompt,
  onOpenGallery,
  onOpenBenchmarks,
}: {
  onRunPrompt: (text: string) => void;
  onOpenGallery?: () => void;
  onOpenBenchmarks?: () => void;
}) {
  const suggestions = [
    {
      icon: '🎨',
      title: 'Neural Visual Art',
      text: 'Generate an image: ultra-detailed 8k holographic AI core with luminous crystal filaments in obsidian space',
      badge: 'Visual Gen',
    },
    {
      icon: '💻',
      title: 'Precision Code',
      text: 'Write an optimized async Python pipeline with token bucket rate limiting and retry backoff',
      badge: 'Architecture',
    },
    {
      icon: '🧠',
      title: 'Deep Reasoning',
      text: 'Solve and verify: Prove why the square root of 2 is irrational step by step with formal logic',
      badge: 'Math Proof',
    },
    {
      icon: '🌐',
      title: 'Multi-Agent Mesh',
      text: 'Design a distributed multi-agent consensus protocol with fault tolerance and low latency',
      badge: 'Systems',
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-4 py-8 max-w-4xl mx-auto">
      {/* Mind-Blowing Hero Visual Card */}
      <div
        className="w-full rounded-3xl p-6 sm:p-8 mb-8 relative overflow-hidden flex flex-col md:flex-row items-center gap-6 shadow-2xl animate-fade-in"
        style={{
          background: 'linear-gradient(135deg, rgba(11, 19, 43, 0.95), rgba(15, 22, 43, 0.85))',
          border: '1px solid rgba(61, 255, 194, 0.3)',
          boxShadow: '0 20px 50px -10px rgba(0, 180, 216, 0.3)',
        }}
      >
        {/* Glow backdrop behind hero */}
        <div
          className="absolute -top-24 -left-24 w-72 h-72 rounded-full pointer-events-none opacity-40 blur-3xl"
          style={{ background: '#00b4d8' }}
        />
        <div
          className="absolute -bottom-24 -right-24 w-72 h-72 rounded-full pointer-events-none opacity-30 blur-3xl"
          style={{ background: '#3dffc2' }}
        />

        {/* Hero Visual Image Thumbnail with Cybernetic Border */}
        <div
          className="relative w-40 h-40 sm:w-48 sm:h-48 rounded-2xl overflow-hidden flex-shrink-0 cursor-pointer group shadow-xl"
          style={{
            border: '2px solid rgba(61, 255, 194, 0.4)',
            boxShadow: '0 0 25px rgba(0, 180, 216, 0.4)',
          }}
          onClick={onOpenGallery}
          title="Click to open Visual Studio Gallery"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/hero-neural-core.png"
            alt="Aetheris Sovereign Neural Core"
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-2.5">
            <span
              className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full"
              style={{
                background: 'rgba(0,0,0,0.8)',
                color: 'var(--accent-mint)',
                border: '1px solid rgba(61, 255, 194, 0.5)',
              }}
            >
              ✦ Sovereign Core v4.0
            </span>
          </div>
        </div>

        {/* Hero Copy */}
        <div className="flex-1 text-center md:text-left z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono mb-3" style={{ background: 'rgba(61,255,194,0.1)', color: 'var(--accent-mint)', border: '1px solid rgba(61,255,194,0.3)' }}>
            <span>⚡</span>
            <span>Zero Third-Party Dependency · Sovereign Intelligence</span>
          </div>

          <h1
            className="text-2xl sm:text-4xl font-extrabold tracking-tight mb-2 leading-tight"
            style={{
              fontFamily: 'var(--font-display)',
              background: 'linear-gradient(135deg, #ffffff 0%, #a6b3ca 50%, #3dffc2 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Aetheris Sovereign Neural Platform
          </h1>

          <p className="text-xs sm:text-sm text-gray-300 leading-relaxed mb-4 max-w-xl">
            Experience next-generation in-house neural reasoning, multimodal synthesis, and autonomous meta-learning. Engineered entirely offline for maximum privacy and uncompromising performance.
          </p>

          <div className="flex flex-wrap gap-2 justify-center md:justify-start">
          {onOpenGallery && (
            <button
              onClick={onOpenGallery}
              className="px-4 py-2 rounded-xl text-xs font-bold transition-all hover:scale-105 flex items-center gap-2"
              style={{
                background: 'var(--accent-mint)',
                color: '#060914',
              }}
            >
              <span>🎨</span>
              <span>Visual Studio</span>
            </button>
          )}
          {onOpenBenchmarks && (
            <button
              onClick={onOpenBenchmarks}
              className="px-4 py-2 rounded-xl text-xs font-semibold transition-all hover:scale-105 flex items-center gap-2"
              style={{
                background: 'rgba(192, 132, 252, 0.15)',
                border: '1px solid rgba(192, 132, 252, 0.35)',
                color: 'var(--accent-purple)',
              }}
            >
              <span>📊</span>
              <span>Benchmark Arena</span>
            </button>
          )}
          <button
            onClick={() => onRunPrompt('Show me the Aetheris neural architecture specs and benchmark comparison')}
              className="px-4 py-2 rounded-xl text-xs font-semibold transition-all hover:bg-white/10 flex items-center gap-1.5"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
              }}
            >
              <span>🔬</span>
              <span>Architecture Specs</span>
            </button>
          </div>
        </div>
      </div>

      {/* Suggestion Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full mb-6">
        {suggestions.map((s) => (
          <button
            key={s.title}
            onClick={() => onRunPrompt(s.text)}
            className="group flex items-start gap-3.5 p-4 rounded-2xl text-left transition-all duration-300 hover:scale-[1.01] relative overflow-hidden"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
            }}
          >
            <span className="text-2xl p-2 rounded-xl" style={{ background: 'var(--bg-tertiary)' }}>
              {s.icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                  {s.title}
                </span>
                <span
                  className="text-[10px] px-2 py-0.5 rounded font-mono font-medium"
                  style={{
                    background: 'rgba(0,180,216,0.12)',
                    color: 'var(--accent-blue)',
                  }}
                >
                  {s.badge}
                </span>
              </div>
              <p className="text-xs line-clamp-2 leading-relaxed" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-ui)' }}>
                {s.text}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Footer shortcut info */}
      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        <kbd className="px-2 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
          ⌘K
        </kbd>
        <span>Command Palette</span>
        <span className="mx-1.5">·</span>
        <kbd className="px-2 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
          Enter
        </kbd>
        <span>Send prompt</span>
      </div>
    </div>
  );
}

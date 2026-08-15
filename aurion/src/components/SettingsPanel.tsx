/* ─── Settings Panel — Sovereign Model Engine, Persona, Creativity, Theme ─── */
"use client";

import { useEffect, useState } from 'react';
import { Settings, Persona, Theme, ModelId, ModeId, MetaStats } from '@/types';
import { getMetaStats, getNeuralModels, getNvidiaStatus } from '@/lib/hermes';

interface SettingsPanelProps {
  settings: Settings;
  onUpdate: (settings: Settings) => void;
  onClose: () => void;
  onOpenGallery?: () => void;
}

const MODELS: {
  id: ModelId;
  name: string;
  badge: string;
  context: string;
  params: string;
  desc: string;
  icon: string;
}[] = [
  {
    id: 'aetheris-prime-v4',
    name: 'Aetheris Prime v4',
    badge: 'Flagship Multimodal',
    context: '128K',
    params: '32.8B MoE',
    desc: 'Balanced sovereign workhorse for precision code, complex documents, and multimodal synthesis.',
    icon: '⚡',
  },
  {
    id: 'aetheris-omni-reasoner',
    name: 'Aetheris Omni Reasoner',
    badge: 'Deep Reasoning Core',
    context: '256K',
    params: '70.4B Dense',
    desc: 'Extended chain-of-thought engine for formal mathematical proofs, complex architectures & verification.',
    icon: '🧠',
  },
  {
    id: 'aetheris-flash-v2',
    name: 'Aetheris Flash v2',
    badge: 'Ultra Low-Latency',
    context: '65K',
    params: '7.6B Linear',
    desc: 'Sub-millisecond instant execution core optimized for high-speed streaming and quick automation.',
    icon: '⚡',
  },
  {
    id: 'hermes-cognition-v4',
    name: 'Hermes Cognition 4X',
    badge: 'Autonomous Meta-Agent',
    context: '131K',
    params: '11-Stage Core',
    desc: 'Unified offline cognition runtime with continuous Reptile meta-learning and exact symbolic math.',
    icon: '🧬',
  },
  {
    id: 'aetheris-vision-v3',
    name: 'Aetheris Vision-Gen v3',
    badge: 'Neural Canvas',
    context: '65K',
    params: '14.2B Latent',
    desc: 'Specialized generative visual synthesis core for procedural graphics, UI designs, and vector art.',
    icon: '🎨',
  },
];

const INFERENCE_MODES: { id: ModeId; label: string; desc: string }[] = [
  { id: 'general', label: '✦ General', desc: 'Default thought partner' },
  { id: 'engineering', label: '💻 Engineering', desc: 'Architecture-first code' },
  { id: 'editorial', label: '✍️ Editorial', desc: 'Voice-preserving editor' },
  { id: 'structured', label: '{} Structured', desc: 'JSON-only output' },
  { id: 'myth', label: '🜂 Myth', desc: 'Oracle / archetype lens' },
  { id: 'legendary', label: '⚔ Legendary', desc: 'Named-strategist campaign' },
  { id: 'pro', label: '◆ Pro', desc: 'Operator: ship in an hour' },
  { id: 'lite', label: '○ Lite / Little', desc: 'Simple, short, friendly' },
  { id: 'flash', label: '⚡ Flash', desc: 'Fewest true words' },
  { id: 'thamizh', label: '🪔 Thamizh', desc: 'Sangam cadence · Tamil mythos · Tiruvalluvar' },
];

const PERSONAS: { value: Persona; label: string; desc: string }[] = [
  { value: 'balanced', label: '⚖️ Balanced', desc: 'Default — clear, helpful, slightly dry' },
  { value: 'precise', label: '🎯 Precise', desc: 'Concise, factual, no hedging' },
  { value: 'imaginative', label: '✨ Imaginative', desc: 'Creative, expressive, vivid' },
  { value: 'mentor', label: '🧑‍🏫 Mentor', desc: 'Guiding, educational, asks follow-ups' },
  { value: 'concise', label: '⚡ Concise', desc: 'Short answers, essential info only' },
];

interface ThemeDefinition {
  value: Theme;
  label: string;
  category: 'All' | 'Professional' | 'Magic & Fantasy' | 'Horror & Gothic' | 'Cyberpunk & Sci-Fi' | 'Mythos & Lore';
  desc: string;
  preview: string;
}

const THEMES: ThemeDefinition[] = [
  // Professional
  { value: 'aurora', label: '🌌 Aurora', category: 'Professional', desc: 'Cosmic deep navy with electric mint', preview: 'linear-gradient(135deg, #0a0d14, #10141f, #34d399)' },
  { value: 'daylight', label: '☀️ Daylight', category: 'Professional', desc: 'High-legibility crisp light studio', preview: 'linear-gradient(135deg, #f7f8fa, #ffffff, #059669)' },
  { value: 'ink', label: '🖤 OLED Ink', category: 'Professional', desc: 'True pitch black, distraction-free', preview: 'linear-gradient(135deg, #050505, #121212, #ffffff)' },
  { value: 'titanium', label: '🛡️ Titanium', category: 'Professional', desc: 'Enterprise slate-gray with cobalt', preview: 'linear-gradient(135deg, #0f141c, #1e2636, #60a5fa)' },
  { value: 'nordic', label: '❄️ Nordic Frost', category: 'Professional', desc: 'Glacial ice blue with arctic navy', preview: 'linear-gradient(135deg, #0b1118, #182432, #38bdf8)' },

  // Magic & Fantasy
  { value: 'arcane', label: '🔮 Arcane Sorcery', category: 'Magic & Fantasy', desc: 'Mystic violet with runic amethyst', preview: 'linear-gradient(135deg, #0e0919, #221838, #c084fc)' },
  { value: 'elven', label: '🌿 Elven Sanctuary', category: 'Magic & Fantasy', desc: 'Enchanted forest emerald and mythic gold', preview: 'linear-gradient(135deg, #08130e, #162a20, #fbbf24)' },
  { value: 'celestial', label: '✨ Celestial Starlight', category: 'Magic & Fantasy', desc: 'Astral deep navy with luminous gold', preview: 'linear-gradient(135deg, #090d1f, #19234a, #facc15)' },
  { value: 'alchemy', label: '⚗️ Philosopher', category: 'Magic & Fantasy', desc: 'Alchemical brass & molten amber', preview: 'linear-gradient(135deg, #140f09, #2a2014, #f59e0b)' },

  // Horror & Gothic
  { value: 'abyssal_horror', label: '🐙 Abyssal Horror', category: 'Horror & Gothic', desc: 'Lovecraftian void & toxic cyan glow', preview: 'linear-gradient(135deg, #030708, #0a1a1e, #06b6d4)' },
  { value: 'blood_moon', label: '🩸 Blood Moon', category: 'Horror & Gothic', desc: 'Gothic crimson & obsidian darkness', preview: 'linear-gradient(135deg, #100507, #260d12, #f43f5e)' },
  { value: 'shadow_realm', label: '👻 Shadow Realm', category: 'Horror & Gothic', desc: 'Spectral violet mist & haunted ash', preview: 'linear-gradient(135deg, #0a090f, #1c192a, #8b5cf6)' },

  // Cyberpunk & Sci-Fi
  { value: 'cyberpunk_neon', label: '⚡ Cyberpunk 2077', category: 'Cyberpunk & Sci-Fi', desc: 'Neon cyan, hot magenta & cyber yellow', preview: 'linear-gradient(135deg, #07060f, #181432, #00f0ff)' },
  { value: 'synthwave', label: '🌴 Synthwave 1984', category: 'Cyberpunk & Sci-Fi', desc: 'Retrofuturistic sunset pink & violet', preview: 'linear-gradient(135deg, #12071d, #291242, #f472b6)' },
  { value: 'matrix_terminal', label: '💻 Matrix Protocol', category: 'Cyberpunk & Sci-Fi', desc: 'Phosphor green CRT terminal glow', preview: 'linear-gradient(135deg, #030904, #0d2212, #22c55e)' },

  // Mythos & Lore
  { value: 'thamizh_mythos', label: '🪔 Dravidian Mythos', category: 'Mythos & Lore', desc: 'Temple terracotta & sacred saffron', preview: 'linear-gradient(135deg, #140a06, #2b170d, #f97316)' },
  { value: 'olympus', label: '🏛️ Mount Olympus', category: 'Mythos & Lore', desc: 'Divine marble, Olympian gold & lapis', preview: 'linear-gradient(135deg, #0d131f, #1e2b42, #fbbf24)' },
];

export function SettingsPanel({ settings, onUpdate, onClose, onOpenGallery }: SettingsPanelProps) {
  const [meta, setMeta] = useState<MetaStats | null>(null);
  const [neuralEngineInfo, setNeuralEngineInfo] = useState<string>('Aetheris Neural Core v4.2');
  const [nvidia, setNvidia] = useState<Awaited<ReturnType<typeof getNvidiaStatus>> | null>(null);
  const [selectedThemeCategory, setSelectedThemeCategory] = useState<string>('All');

  useEffect(() => {
    let cancelled = false;
    getMetaStats()
      .then((stats) => !cancelled && setMeta(stats))
      .catch(() => undefined);
    getNeuralModels()
      .then((res) => !cancelled && setNeuralEngineInfo(res.sovereign_engine))
      .catch(() => undefined);
    getNvidiaStatus()
      .then((status) => !cancelled && setNvidia(status))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onUpdate({ ...settings, [key]: value });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}>
      <div
        className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl animate-fade-in overflow-hidden"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b flex-shrink-0" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-2.5">
            <span className="text-xl">⚙️</span>
            <div>
              <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>
                Aetheris Settings &amp; Neural Engine
              </h2>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {neuralEngineInfo} · Offline-first · NVIDIA NIM optional
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-80 transition-colors" style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)' }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-6 overflow-y-auto flex-1">
          {/* Sovereign Neural Model Engine Selection */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--accent-mint)', fontFamily: 'var(--font-mono)' }}>
                🧠 In-House Sovereign Model Engine
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono" style={{ background: 'rgba(61,255,194,0.1)', color: 'var(--accent-mint)', border: '1px solid rgba(61,255,194,0.3)' }}>
                No External Mini 4.0
              </span>
            </div>
            <div className="space-y-2">
              {MODELS.map((m) => {
                const isSelected = (settings.model || 'aetheris-prime-v4') === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => update('model', m.id)}
                    className="w-full flex items-start gap-3 p-3 rounded-xl text-left transition-all relative overflow-hidden"
                    style={{
                      background: isSelected ? 'rgba(61,255,194,0.08)' : 'var(--bg-tertiary)',
                      border: `1px solid ${isSelected ? 'var(--accent-mint)' : 'var(--border-color)'}`,
                      boxShadow: isSelected ? '0 0 15px rgba(61,255,194,0.15)' : 'none',
                    }}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0 mt-0.5" style={{ background: isSelected ? 'rgba(61,255,194,0.2)' : 'rgba(255,255,255,0.05)' }}>
                      {m.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold" style={{ color: isSelected ? 'var(--accent-mint)' : 'var(--text-primary)' }}>
                          {m.name}
                        </p>
                        <span className="text-[10px] px-1.5 py-0.2 rounded font-mono" style={{ background: 'rgba(0,180,216,0.15)', color: 'var(--accent-blue)' }}>
                          {m.badge}
                        </span>
                        <span className="ml-auto text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                          {m.context} ctx · {m.params}
                        </span>
                      </div>
                      <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        {m.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Optional NVIDIA NIM acceleration — keys stay server-side. */}
          {nvidia && (
            <section>
              <div
                className="rounded-xl p-4"
                style={{
                  background: nvidia.configured ? 'rgba(118,185,0,0.08)' : 'var(--bg-tertiary)',
                  border: `1px solid ${nvidia.configured ? 'rgba(118,185,0,0.45)' : 'var(--border-color)'}`,
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg grid place-items-center font-black text-xs" style={{ background: '#76b900', color: '#071000' }}>
                    NV
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs uppercase tracking-wider font-semibold" style={{ color: nvidia.configured ? '#76b900' : 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                        NVIDIA NIM + Hermes
                      </h3>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-mono" style={{ background: nvidia.configured ? 'rgba(118,185,0,0.15)' : 'rgba(251,191,36,0.1)', color: nvidia.configured ? '#76b900' : 'var(--accent-gold)' }}>
                        {nvidia.configured ? 'READY' : 'API KEY NEEDED'}
                      </span>
                    </div>
                    <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      {nvidia.setup}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {[
                        ['Chat', nvidia.chat.enabled],
                        ['Images', nvidia.image.enabled],
                        ['Video', nvidia.video.enabled],
                        ['Code', nvidia.code.enabled],
                        ['Meta-learn', nvidia.chat.hermes_meta_learning],
                      ].map(([label, enabled]) => (
                        <span key={String(label)} className="text-[10px] px-2 py-1 rounded-md font-mono" style={{ background: enabled ? 'rgba(118,185,0,0.12)' : 'rgba(255,255,255,0.04)', color: enabled ? '#76b900' : 'var(--text-muted)' }}>
                          {enabled ? '✓' : '○'} {label}
                        </span>
                      ))}
                    </div>
                    {!nvidia.configured && (
                      <code className="block mt-2 text-[10px] rounded-lg px-2.5 py-2 select-all" style={{ background: 'rgba(0,0,0,0.25)', color: 'var(--accent-mint)' }}>
                        AETHERIS_NVIDIA_API_KEY=nvapi-...
                      </code>
                    )}
                    <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
                      The key is read only by the Python server and is never returned to this browser.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Inference modes — work on Flash, Pro, and Ultra */}
          <section>
            <h3 className="text-xs uppercase tracking-wider mb-3 font-semibold" style={{ color: 'var(--accent-gold, #fbbf24)', fontFamily: 'var(--font-mono)' }}>
              Inference Mode · all three models
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {INFERENCE_MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => update('mode', m.id)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all"
                  style={{
                    background: (settings.mode || 'general') === m.id ? 'rgba(251,191,36,0.1)' : 'var(--bg-tertiary)',
                    border: `1px solid ${(settings.mode || 'general') === m.id ? 'rgba(251,191,36,0.4)' : 'var(--border-color)'}`,
                  }}
                >
                  <div>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{m.label}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{m.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Persona */}
          <section>
            <h3 className="text-xs uppercase tracking-wider mb-3 font-semibold" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Persona Mode
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PERSONAS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => update('persona', p.value)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all"
                  style={{
                    background: settings.persona === p.value ? 'rgba(61,255,194,0.08)' : 'var(--bg-tertiary)',
                    border: `1px solid ${settings.persona === p.value ? 'rgba(61,255,194,0.3)' : 'var(--border-color)'}`,
                  }}
                >
                  <div>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{p.label}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{p.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Theme */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Interface Atmosphere &amp; Genre Themes
              </h3>
              <span className="text-[10px] font-mono" style={{ color: 'var(--accent-mint)' }}>
                {THEMES.length} Themes Across 5 Genres
              </span>
            </div>

            {/* Genre filter chips */}
            <div className="flex flex-wrap gap-1 mb-3">
              {['All', 'Professional', 'Magic & Fantasy', 'Horror & Gothic', 'Cyberpunk & Sci-Fi', 'Mythos & Lore'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedThemeCategory(cat)}
                  className="px-2 py-1 text-[11px] rounded-lg transition"
                  style={{
                    background: selectedThemeCategory === cat ? 'var(--accent-mint)' : 'var(--bg-tertiary)',
                    color: selectedThemeCategory === cat ? '#000000' : 'var(--text-secondary)',
                    fontWeight: selectedThemeCategory === cat ? 600 : 400,
                    border: '1px solid var(--border-color)',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
              {THEMES.filter((t) => selectedThemeCategory === 'All' || t.category === selectedThemeCategory).map((t) => (
                <button
                  key={t.value}
                  onClick={() => update('theme', t.value)}
                  className="flex flex-col items-start gap-1.5 p-2.5 rounded-xl transition-all text-left"
                  style={{
                    background: settings.theme === t.value ? 'rgba(52, 211, 153, 0.1)' : 'var(--bg-tertiary)',
                    border: `1px solid ${settings.theme === t.value ? 'var(--accent-mint)' : 'var(--border-color)'}`,
                  }}
                >
                  <div className="w-full h-8 rounded-lg shadow-sm" style={{ background: t.preview, border: '1px solid var(--border-color)' }} />
                  <div className="w-full">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t.label}</span>
                      {settings.theme === t.value && (
                        <span className="text-[10px] font-mono px-1 rounded bg-emerald-500/20 text-emerald-400">Active</span>
                      )}
                    </div>
                    <p className="text-[10px] mt-0.5 line-clamp-1" style={{ color: 'var(--text-muted)' }}>{t.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Voice */}
          <section>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  Voice Synthesis Output
                </h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Read assistant responses aloud (Web Speech API)
                </p>
              </div>
              <button
                onClick={() => update('voiceEnabled', !settings.voiceEnabled)}
                className="w-10 h-6 rounded-full transition-colors relative"
                style={{ background: settings.voiceEnabled ? 'var(--accent-mint)' : 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
              >
                <div
                  className="w-4 h-4 rounded-full absolute top-0.5 transition-all"
                  style={{
                    background: settings.voiceEnabled ? '#0a0e1a' : 'var(--text-muted)',
                    left: settings.voiceEnabled ? '20px' : '2px',
                  }}
                />
              </button>
            </div>
          </section>

          {/* Visual Studio Gallery */}
          {onOpenGallery && (
            <section>
              <button
                onClick={onOpenGallery}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all hover:scale-[1.01]"
                style={{
                  background: 'linear-gradient(135deg, rgba(0,180,216,0.12), rgba(61,255,194,0.12))',
                  border: '1px solid rgba(61,255,194,0.35)',
                }}
              >
                <span className="text-lg">🎨</span>
                <div className="flex-1 text-left">
                  <p className="text-xs font-bold" style={{ color: 'var(--accent-mint)' }}>
                    Neural Visual Studio Gallery
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Browse &amp; generate sovereign 8k visuals and artwork
                  </p>
                </div>
                <span style={{ color: 'var(--accent-mint)' }}>→</span>
              </button>
            </section>
          )}

          {/* Memory & learning */}
          <section>
            <h3 className="text-xs uppercase tracking-wider mb-3 font-semibold" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Memory &amp; Autonomous Meta-Learning
            </h3>

            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Hierarchical Memory</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Recall relevant previous interactions across sessions
                </p>
              </div>
              <Toggle on={settings.useMemory} onClick={() => update('useMemory', !settings.useMemory)} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Online Meta-Learning</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Adapt parameters and tool priors dynamically from feedback
                </p>
              </div>
              <Toggle on={settings.learn} onClick={() => update('learn', !settings.learn)} />
            </div>

            {meta && (
              <div
                className="mt-3 px-3.5 py-2.5 rounded-xl text-[11px] space-y-1.5"
                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', fontFamily: 'var(--font-mono)' }}
              >
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-muted)' }}>Episodes learned from</span>
                  <span style={{ color: 'var(--accent-mint)' }}>{meta.episodes}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-muted)' }}>Few-shot exemplars</span>
                  <span style={{ color: 'var(--accent-gold)' }}>{meta.exemplars}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-muted)' }}>Mean reward score</span>
                  <span style={{ color: 'var(--accent-blue)' }}>{meta.mean_reward.toFixed(3)}</span>
                </div>
              </div>
            )}
          </section>

          {/* Sovereign Guarantee */}
          <section>
            <div
              className="flex items-start gap-3 px-4 py-3.5 rounded-xl"
              style={{ background: 'rgba(61,255,194,0.06)', border: '1px solid rgba(61,255,194,0.2)' }}
            >
              <span className="text-lg mt-0.5">🔒</span>
              <div>
                <p className="text-xs font-bold" style={{ color: 'var(--accent-mint)' }}>Sovereign AI Guarantee</p>
                <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Aetheris is offline-first: without an enabled remote provider, prompts stay inside this runtime.
                  If you opt into NVIDIA NIM, only generation requests are sent to your configured NVIDIA endpoint;
                  credentials remain server-side and offline fallbacks stay available.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-10 h-6 rounded-full transition-colors relative flex-shrink-0"
      style={{ background: on ? 'var(--accent-mint)' : 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
    >
      <div
        className="w-4 h-4 rounded-full absolute top-0.5 transition-all"
        style={{ background: on ? '#0a0e1a' : 'var(--text-muted)', left: on ? '20px' : '2px' }}
      />
    </button>
  );
}

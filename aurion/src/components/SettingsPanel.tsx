/* ─── Settings Panel — Modal for persona, creativity, theme, system prompt ─── */
"use client";

import { useEffect, useState } from 'react';
import { Settings, Persona, Theme, MetaStats } from '@/types';
import { getMetaStats } from '@/lib/hermes';

interface SettingsPanelProps {
  settings: Settings;
  onUpdate: (settings: Settings) => void;
  onClose: () => void;
}

const PERSONAS: { value: Persona; label: string; desc: string }[] = [
  { value: 'balanced', label: '⚖️ Balanced', desc: 'Default — clear, helpful, slightly dry' },
  { value: 'precise', label: '🎯 Precise', desc: 'Concise, factual, no hedging' },
  { value: 'imaginative', label: '✨ Imaginative', desc: 'Creative, expressive, vivid' },
  { value: 'mentor', label: '🧑‍🏫 Mentor', desc: 'Guiding, educational, asks follow-ups' },
  { value: 'concise', label: '⚡ Concise', desc: 'Short answers, essential info only' },
];

const THEMES: { value: Theme; label: string; desc: string; preview: string }[] = [
  { value: 'aurora', label: '🌌 Aurora', desc: 'Dark navy with mint & gold', preview: 'linear-gradient(135deg, #0a0e1a, #0f1629)' },
  { value: 'daylight', label: '☀️ Daylight', desc: 'Light, clean, professional', preview: 'linear-gradient(135deg, #f8f9fa, #ffffff)' },
  { value: 'ink', label: '🖤 Ink', desc: 'Pure black, minimal', preview: 'linear-gradient(135deg, #000000, #0a0a0a)' },
];

export function SettingsPanel({ settings, onUpdate, onClose }: SettingsPanelProps) {
  const [meta, setMeta] = useState<MetaStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMetaStats()
      .then((stats) => !cancelled && setMeta(stats))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onUpdate({ ...settings, [key]: value });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl animate-fade-in"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <h2 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>
            ⚙️ Settings
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Persona */}
          <section>
            <h3 className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Persona
            </h3>
            <div className="space-y-2">
              {PERSONAS.map(p => (
                <button
                  key={p.value}
                  onClick={() => update('persona', p.value)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all"
                  style={{
                    background: settings.persona === p.value ? 'rgba(61,255,194,0.08)' : 'var(--bg-tertiary)',
                    border: `1px solid ${settings.persona === p.value ? 'rgba(61,255,194,0.3)' : 'var(--border-color)'}`,
                  }}
                >
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{p.label}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Theme */}
          <section>
            <h3 className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Theme
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {THEMES.map(t => (
                <button
                  key={t.value}
                  onClick={() => update('theme', t.value)}
                  className="flex flex-col items-center gap-2 px-3 py-3 rounded-xl transition-all"
                  style={{
                    background: settings.theme === t.value ? 'rgba(61,255,194,0.08)' : 'var(--bg-tertiary)',
                    border: `1px solid ${settings.theme === t.value ? 'rgba(61,255,194,0.3)' : 'var(--border-color)'}`,
                  }}
                >
                  <div className="w-full h-8 rounded" style={{ background: t.preview, border: '1px solid var(--border-color)' }} />
                  <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{t.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Voice */}
          <section>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  Voice Output
                </h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Read responses aloud (Web Speech API)
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

          {/* Memory & learning */}
          <section>
            <h3 className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Memory &amp; Learning
            </h3>

            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm" style={{ color: 'var(--text-primary)' }}>Long-term memory</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Let Hermes recall earlier sessions
                </p>
              </div>
              <Toggle on={settings.useMemory} onClick={() => update('useMemory', !settings.useMemory)} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm" style={{ color: 'var(--text-primary)' }}>Meta-learning</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Learn from each episode to improve next time
                </p>
              </div>
              <Toggle on={settings.learn} onClick={() => update('learn', !settings.learn)} />
            </div>

            {meta && (
              <div
                className="mt-3 px-3 py-2 rounded-xl text-[11px] space-y-1"
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
                  <span style={{ color: 'var(--text-muted)' }}>Mean reward</span>
                  <span style={{ color: 'var(--accent-blue)' }}>{meta.mean_reward.toFixed(3)}</span>
                </div>
              </div>
            )}
          </section>

          {/* Privacy */}
          <section>
            <div
              className="flex items-center gap-2 px-4 py-3 rounded-xl"
              style={{ background: 'rgba(61,255,194,0.05)', border: '1px solid rgba(61,255,194,0.15)' }}
            >
              <span>🔒</span>
              <div>
                <p className="text-xs font-medium" style={{ color: 'var(--accent-mint)' }}>Privacy Guarantee</p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Everything runs on this machine: the Hermes runtime is local, no
                  vendor API is called, and no API key is required.
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

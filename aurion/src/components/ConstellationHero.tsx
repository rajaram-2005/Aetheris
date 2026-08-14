/* ─── ConstellationHero — cinematic home that presents every surface as one ─── */
"use client";

import { useEffect, useState } from 'react';
import { getDailyWisdom, getMetaStats } from '@/lib/hermes';
import type { StudioChamber } from '@/types';

interface ConstellationHeroProps {
  online: boolean;
  onLaunch: () => void;
  onOpenStudio: (chamber?: StudioChamber) => void;
  onRunPrompt: (text: string) => void;
}

const ORBS: { chamber: StudioChamber; glyph: string; label: string; hint: string }[] = [
  { chamber: 'mythos', glyph: '🪔', label: 'Mythos', hint: '31 living legends' },
  { chamber: 'visuals', glyph: '🎨', label: 'Visuals', hint: 'Neural gallery' },
  { chamber: 'research', glyph: '◇', label: 'Research', hint: '50 milestones' },
  { chamber: 'god', glyph: 'Ω', label: 'God', hint: 'Fused arsenal' },
  { chamber: 'apex', glyph: '△', label: 'Apex', hint: 'Graph · evals' },
  { chamber: 'skills', glyph: '⬡', label: 'Skills', hint: 'Deep-work packs' },
  { chamber: 'agents', glyph: '◎', label: 'Agents', hint: 'Custom GPTs' },
  { chamber: 'canvas', glyph: '▭', label: 'Canvas', hint: 'Artifacts' },
  { chamber: 'arena', glyph: '▣', label: 'Arena', hint: 'Benchmarks' },
  { chamber: 'create', glyph: '✧', label: 'Create', hint: 'Image · voice' },
  { chamber: 'connect', glyph: '☍', label: 'Connect', hint: 'Apps' },
  { chamber: 'models', glyph: '⬢', label: 'Models', hint: 'Runtimes' },
];

export function ConstellationHero({ online, onLaunch, onOpenStudio, onRunPrompt }: ConstellationHeroProps) {
  const [ask, setAsk] = useState('');
  const [daily, setDaily] = useState<{ character: { name: string }; wisdom: string } | null>(null);
  const [pulse, setPulse] = useState<{ episodes: number; improving: boolean } | null>(null);

  useEffect(() => {
    getDailyWisdom().then(setDaily).catch(() => undefined);
    getMetaStats()
      .then((s) => setPulse({ episodes: s.episodes, improving: s.improving }))
      .catch(() => undefined);
  }, []);

  return (
    <section className="relative overflow-hidden border-b" style={{ borderColor: 'var(--border-color)' }}>
      <div className="aurora-veil" aria-hidden />
      <div className="nexus-stars" aria-hidden />

      <div className="relative max-w-6xl mx-auto px-6 pt-16 pb-12 md:pt-20 md:pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-6">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-5"
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: online ? 'var(--accent-mint)' : 'var(--accent-pink)' }} />
              {online ? 'One runtime · offline · no API key' : 'Runtime offline — start the server'}
              {pulse && (
                <span className="hidden sm:inline" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  · {pulse.episodes} learned {pulse.improving ? '↑' : ''}
                </span>
              )}
            </div>

            <h1
              className="text-4xl md:text-6xl font-extrabold leading-[1.04] tracking-tight"
              style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
            >
              Every surface.
              <br />
              <span
                className="text-transparent bg-clip-text"
                style={{ backgroundImage: 'linear-gradient(110deg, var(--accent-mint), var(--accent-blue), var(--accent-purple))' }}
              >
                One constellation.
              </span>
            </h1>

            <p className="mt-5 text-base md:text-lg max-w-xl leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Mythos, visuals, research, God Mode, and skills used to live in twelve rooms.
              They now orbit a single mind — the Hermes agent with meta-learning — and every
              path returns to the same conversation.
            </p>

            <form
              className="mt-7 flex flex-col sm:flex-row gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (ask.trim()) onRunPrompt(ask.trim());
                else onLaunch();
              }}
            >
              <input
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                placeholder="Ask anything — or open the studio…"
                className="input surface flex-1 px-4 py-3"
                style={{ background: 'var(--bg-secondary)' }}
              />
              <button type="submit" className="btn btn-primary px-5 py-3">
                {ask.trim() ? 'Think →' : 'Launch workspace'}
              </button>
              <button type="button" className="btn px-5 py-3" onClick={() => onOpenStudio('one')}>
                Open Studio
              </button>
            </form>

            {daily && (
              <button
                onClick={() => onOpenStudio('mythos')}
                className="mt-6 w-full text-left rounded-2xl p-4 border transition-colors"
                style={{
                  background: 'linear-gradient(135deg, rgba(249,115,22,0.08), var(--bg-secondary))',
                  borderColor: 'var(--border-color)',
                }}
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--accent-gold)', fontFamily: 'var(--font-mono)' }}>
                  Wisdom of the day · {daily.character.name}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>{daily.wisdom}</p>
              </button>
            )}
          </div>

          <div className="lg:col-span-6">
            <div className="relative rounded-3xl overflow-hidden border aspect-[4/3] md:aspect-[5/4]" style={{ borderColor: 'var(--border-color)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/studio-nexus.png" alt="The Aetheris constellation" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 45%, transparent 20%, rgba(6,9,20,0.55) 100%)' }} />
              <ConstellationSvg />
              <div className="absolute inset-0 grid grid-cols-2 sm:grid-cols-3 gap-2 p-4 content-end">
                {ORBS.map((orb) => (
                  <button
                    key={orb.chamber}
                    onClick={() => onOpenStudio(orb.chamber)}
                    className="backdrop-blur-md rounded-2xl px-3 py-2.5 text-left transition-transform hover:-translate-y-0.5"
                    style={{
                      background: 'color-mix(in srgb, var(--bg-secondary) 78%, transparent)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <span className="text-base">{orb.glyph}</span>
                    <span className="block text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{orb.label}</span>
                    <span className="block text-[10px]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{orb.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ConstellationSvg() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-70" viewBox="0 0 600 480" aria-hidden>
      <g className="orbit-spin-slow" style={{ transformOrigin: '300px 210px' }}>
        <circle cx="300" cy="210" r="88" fill="none" stroke="var(--accent-mint)" strokeOpacity="0.25" />
        <circle cx="300" cy="122" r="4" fill="var(--accent-mint)" />
      </g>
      <g className="orbit-spin-rev" style={{ transformOrigin: '300px 210px' }}>
        <circle cx="300" cy="210" r="140" fill="none" stroke="var(--accent-blue)" strokeOpacity="0.2" strokeDasharray="3 10" />
        <circle cx="440" cy="210" r="4" fill="var(--accent-blue)" />
      </g>
      <circle cx="300" cy="210" r="14" fill="var(--accent-mint)" fillOpacity="0.9" />
    </svg>
  );
}


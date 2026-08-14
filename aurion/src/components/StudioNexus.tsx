/* ─── Studio Nexus — every beautiful surface, one chamber ───
 *
 * Gallery, Mythos, Research, God Deck, Skills, and Create used to live as
 * twelve disconnected modals. This is the single studio: a constellation of
 * chambers that share one shell, one theme, and one path back into chat.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GalleryImage,
  EraSummary,
  StudioChamber,
} from '@/types';
import {
  getDailyWisdom,
  getGalleryImages,
  getMetaStats,
  getMythology,
  getResearchEras,
  getSkillsCatalog,
  mythologyChat,
  mythologyPortrait,
  generateImage,
  synthesizeSpeech,
  MythCharacter,
} from '@/lib/hermes';
import {
  AgentsChamber,
  ApexChamber,
  ArenaChamber,
  CanvasChamber,
  ConnectChamber,
  DeepResearchPane,
  ModelsChamber,
} from '@/components/StudioChambers';

export type { StudioChamber };

interface StudioNexusProps {
  isOpen: boolean;
  chamber?: StudioChamber;
  onClose: () => void;
  onRunInChat: (text: string) => void;
  onGenerateImage: (prompt: string) => void;
}

const CHAMBERS: {
  id: StudioChamber;
  label: string;
  kicker: string;
  glyph: string;
}[] = [
  { id: 'one', label: 'One', kicker: 'The constellation', glyph: '✦' },
  { id: 'mythos', label: 'Mythos', kicker: 'Living pantheon', glyph: '🪔' },
  { id: 'visuals', label: 'Visuals', kicker: 'Neural gallery', glyph: '🎨' },
  { id: 'create', label: 'Create', kicker: 'Image · voice', glyph: '✧' },
  { id: 'research', label: 'Research', kicker: '1950 → 2026', glyph: '◇' },
  { id: 'god', label: 'God', kicker: 'Fused arsenal', glyph: 'Ω' },
  { id: 'apex', label: 'Apex', kicker: 'Graph · evals', glyph: '△' },
  { id: 'skills', label: 'Skills', kicker: 'Deep-work packs', glyph: '⬡' },
  { id: 'agents', label: 'Agents', kicker: 'Custom GPTs', glyph: '◎' },
  { id: 'canvas', label: 'Canvas', kicker: 'Artifacts', glyph: '▭' },
  { id: 'arena', label: 'Arena', kicker: 'Benchmarks', glyph: '▣' },
  { id: 'connect', label: 'Connect', kicker: 'Apps', glyph: '☍' },
  { id: 'models', label: 'Models', kicker: 'Runtimes', glyph: '⬢' },
];

const CASCADE = [
  'perceive', 'classify', 'adapt', 'deliberate', 'ground',
  'route', 'recall', 'act', 'synthesize', 'polish', 'learn',
];

export function StudioNexus({
  isOpen,
  chamber = 'one',
  onClose,
  onRunInChat,
  onGenerateImage,
}: StudioNexusProps) {
  const [active, setActive] = useState<StudioChamber>(chamber);

  // Follow the `chamber` prop while the studio is open — state adjusted during
  // render instead of in an effect, so no cascading re-render occurs.
  const [lastOpen, setLastOpen] = useState({ isOpen, chamber });
  if (lastOpen.isOpen !== isOpen || lastOpen.chamber !== chamber) {
    setLastOpen({ isOpen, chamber });
    if (isOpen) setActive(chamber);
  }

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center p-0 sm:p-4"
      style={{ background: 'rgba(4, 7, 18, 0.78)', backdropFilter: 'blur(16px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl h-full sm:h-[92vh] sm:my-auto flex flex-col overflow-hidden animate-fade-in nexus-shell"
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '22px',
          boxShadow: '0 40px 120px -20px var(--shadow-glow)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="relative px-5 py-4 flex items-center justify-between gap-4 border-b flex-shrink-0 overflow-hidden"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div className="aurora-veil" aria-hidden />
          <div className="relative flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-2xl overflow-hidden flex items-center justify-center shrink-0 pulse-ring"
              style={{ background: 'linear-gradient(135deg, var(--accent-mint), var(--accent-blue))' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/studio-nexus.png" alt="" className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0">
              <h2
                className="text-base font-bold tracking-tight truncate"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
              >
                Studio — one constellation
              </h2>
              <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Every lab · one chamber
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-icon btn-ghost shrink-0"
            aria-label="Close studio"
            title="Close"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="4" x2="16" y2="16" />
              <line x1="16" y1="4" x2="4" y2="16" />
            </svg>
          </button>
        </header>

        <div className="flex-1 flex min-h-0">
          <nav
            className="hidden sm:flex w-52 flex-col gap-1 p-3 border-r overflow-y-auto"
            style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}
            aria-label="Studio chambers"
          >
            {CHAMBERS.map((c) => {
              const on = active === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setActive(c.id)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors"
                  style={{
                    background: on ? 'var(--bg-hover)' : 'transparent',
                    border: `1px solid ${on ? 'var(--border-hover)' : 'transparent'}`,
                    color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  <span className="w-7 h-7 rounded-lg grid place-items-center text-sm" style={{ background: 'var(--bg-tertiary)' }}>
                    {c.glyph}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold" style={{ fontFamily: 'var(--font-display)' }}>{c.label}</span>
                    <span className="block text-[10px]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{c.kicker}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="flex-1 flex flex-col min-w-0">
            <div
              className="sm:hidden flex gap-1.5 px-3 py-2 border-b overflow-x-auto"
              style={{ borderColor: 'var(--border-color)' }}
            >
              {CHAMBERS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActive(c.id)}
                  className="px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
                  style={{
                    background: active === c.id ? 'var(--bg-hover)' : 'var(--bg-tertiary)',
                    border: `1px solid ${active === c.id ? 'var(--border-hover)' : 'var(--border-color)'}`,
                    color: active === c.id ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  {c.glyph} {c.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {active === 'one' && (
                <OneChamber
                  onEnter={setActive}
                  onRunInChat={onRunInChat}
                />
              )}
              {active === 'mythos' && <MythosChamber onRunInChat={onRunInChat} />}
              {active === 'visuals' && (
                <VisualsChamber onGenerateImage={onGenerateImage} />
              )}
              {active === 'research' && (
                <ResearchChamber onRunInChat={onRunInChat} />
              )}
              {active === 'god' && (
                <GodChamber onRunInChat={onRunInChat} />
              )}
              {active === 'apex' && <ApexChamber onRunInChat={onRunInChat} />}
              {active === 'skills' && <SkillsChamber onRunInChat={onRunInChat} />}
              {active === 'agents' && <AgentsChamber onRunInChat={onRunInChat} />}
              {active === 'canvas' && <CanvasChamber onRunInChat={onRunInChat} />}
              {active === 'arena' && <ArenaChamber />}
              {active === 'create' && (
                <CreateChamber
                  onGenerateImage={onGenerateImage}
                  onRunInChat={onRunInChat}
                />
              )}
              {active === 'connect' && <ConnectChamber />}
              {active === 'models' && <ModelsChamber />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── One: the living map of every surface ── */

function OneChamber({
  onEnter,
  onRunInChat,
}: {
  onEnter: (c: StudioChamber) => void;
  onRunInChat: (text: string) => void;
}) {
  const [meta, setMeta] = useState<{ episodes: number; mean_reward: number; improving: boolean } | null>(null);
  const [ask, setAsk] = useState('');

  useEffect(() => {
    getMetaStats()
      .then((s) => setMeta({ episodes: s.episodes, mean_reward: s.mean_reward, improving: s.improving }))
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl border" style={{ borderColor: 'var(--border-color)', minHeight: 280 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/studio-nexus.png"
          alt="Aetheris constellation"
          className="absolute inset-0 w-full h-full object-cover opacity-55"
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(6,9,20,0.15) 0%, var(--bg-secondary) 96%)' }}
        />
        <LivingOrbit />
        <div className="relative z-10 p-6 sm:p-8 max-w-xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: 'var(--accent-mint)', fontFamily: 'var(--font-mono)' }}>
            One mind · eleven stages · every lab
          </p>
          <h3
            className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
          >
            Every beautiful feature,<br />folded into a single one.
          </h3>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            The pantheon, the gallery, the research archive, God Mode, and the skill packs
            no longer live in twelve separate rooms. They orbit one core — Hermes — and
            every path returns to the same conversation.
          </p>
          {meta && (
            <div className="mt-4 flex flex-wrap gap-2 text-[11px]" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              <span className="px-2 py-1 rounded-full" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
                {meta.episodes} episodes
              </span>
              <span className="px-2 py-1 rounded-full" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
                reward {meta.mean_reward.toFixed(2)}
              </span>
              <span className="px-2 py-1 rounded-full" style={{ background: 'rgba(52,211,153,0.12)', color: 'var(--accent-mint)', border: '1px solid rgba(52,211,153,0.25)' }}>
                {meta.improving ? 'improving ↑' : 'stable'}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {CHAMBERS.filter((c) => c.id !== 'one').map((c) => (
          <button
            key={c.id}
            onClick={() => onEnter(c.id)}
            className="surface surface-hover p-4 text-left"
          >
            <span className="text-lg">{c.glyph}</span>
            <strong className="block mt-2 text-sm" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
              {c.label}
            </strong>
            <span className="block text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.kicker}</span>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-tertiary)' }}>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Cascade
        </p>
        <div className="flex flex-wrap gap-1.5">
          {CASCADE.map((stage, i) => (
            <span
              key={stage}
              className="px-2 py-1 rounded-lg text-[10px] font-semibold"
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {String(i + 1).padStart(2, '0')} {stage}
            </span>
          ))}
        </div>
      </div>

      <form
        className="flex flex-col sm:flex-row gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ask.trim()) return;
          onRunInChat(ask.trim());
        }}
      >
        <input
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          placeholder="Ask the constellation — it opens in the workspace…"
          className="input surface flex-1 px-4 py-3"
          style={{ background: 'var(--bg-tertiary)' }}
        />
        <button type="submit" className="btn btn-primary px-5" disabled={!ask.trim()}>
          Think →
        </button>
      </form>

    </div>
  );
}

function LivingOrbit() {
  return (
    <svg className="absolute right-[-40px] top-[-20px] w-[420px] h-[420px] pointer-events-none opacity-80" viewBox="0 0 400 400" aria-hidden>
      <circle cx="200" cy="200" r="70" fill="none" stroke="currentColor" strokeOpacity="0.15" className="orbit-spin" style={{ color: 'var(--accent-mint)', transformOrigin: '200px 200px' }} />
      <circle cx="200" cy="200" r="120" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeDasharray="4 8" className="orbit-spin-rev" style={{ color: 'var(--accent-blue)', transformOrigin: '200px 200px' }} />
      <circle cx="200" cy="200" r="168" fill="none" stroke="currentColor" strokeOpacity="0.1" className="orbit-spin-slow" style={{ color: 'var(--accent-purple)', transformOrigin: '200px 200px' }} />
      <circle cx="200" cy="200" r="18" fill="var(--accent-mint)" fillOpacity="0.85" />
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x = 200 + Math.cos(rad) * 120;
        const y = 200 + Math.sin(rad) * 120;
        return <circle key={deg} cx={x} cy={y} r="5" fill="var(--accent-blue)" className="dot-pulse" />;
      })}
    </svg>
  );
}

/* ── Mythos ── */

function MythosChamber({ onRunInChat }: { onRunInChat: (text: string) => void }) {
  const [characters, setCharacters] = useState<MythCharacter[]>([]);
  const [daily, setDaily] = useState<{ character: { name: string; tamil_name?: string }; wisdom: string } | null>(null);
  const [selected, setSelected] = useState<MythCharacter | null>(null);
  const [turns, setTurns] = useState<{ who: string; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [portrait, setPortrait] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getMythology().then((r) => setCharacters(r.characters || [])).catch(() => undefined);
    getDailyWisdom().then(setDaily).catch(() => undefined);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const summon = (c: MythCharacter) => {
    setSelected(c);
    setTurns([{ who: c.name, text: c.summon }]);
    setPortrait(null);
    setInput('');
  };

  const send = async () => {
    if (!selected || !input.trim() || busy) return;
    const text = input.trim();
    setTurns((p) => [...p, { who: 'You', text }]);
    setInput('');
    setBusy(true);
    try {
      const res = await mythologyChat(selected.id, text);
      setTurns((p) => [...p, { who: selected.name, text: res.reply }]);
    } catch (e) {
      setTurns((p) => [...p, { who: selected.name, text: e instanceof Error ? e.message : 'The legend fell silent.' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 h-full">
      <div className="lg:col-span-2 space-y-3">
        {daily && (
          <div className="rounded-2xl p-4 border" style={{ borderColor: 'var(--border-hover)', background: 'linear-gradient(135deg, rgba(249,115,22,0.08), var(--bg-tertiary))' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent-gold)', fontFamily: 'var(--font-mono)' }}>
              Wisdom of the day · {daily.character.name}
            </p>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>{daily.wisdom}</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-1.5 max-h-[48vh] overflow-y-auto pr-1">
          {characters.slice(0, 24).map((c) => (
            <button
              key={c.id}
              onClick={() => summon(c)}
              className="px-3 py-2 rounded-xl text-left surface surface-hover"
              style={{ background: selected?.id === c.id ? 'var(--bg-hover)' : 'var(--bg-tertiary)' }}
            >
              <span className="block text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</span>
              <span className="block text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{c.epithet}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="lg:col-span-3 flex flex-col rounded-2xl border min-h-[360px]" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}>
        {selected ? (
          <>
            <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate" style={{ fontFamily: 'var(--font-display)' }}>{selected.name}</p>
                <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{selected.title} — {selected.domain}</p>
              </div>
              <button
                className="btn text-xs"
                onClick={async () => {
                  try {
                    const res = await mythologyPortrait(selected.id);
                    setPortrait(res.artifact.url);
                  } catch { /* portrait is optional */ }
                }}
              >
                Form
              </button>
              <button
                className="btn text-xs"
                onClick={() => onRunInChat(`Speak with ${selected.name} (${selected.epithet}). ${selected.summon}`)}
              >
                To chat
              </button>
            </div>
            {portrait && (
              <div className="px-4 pt-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={portrait} alt={selected.name} className="w-full max-h-40 object-cover rounded-xl" />
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {turns.map((t, i) => (
                <div key={i} className={`flex ${t.who === 'You' ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[85%] rounded-2xl px-3 py-2 text-sm" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
                    <p className="text-[10px] mb-0.5" style={{ color: t.who === 'You' ? 'var(--text-muted)' : 'var(--accent-gold)', fontFamily: 'var(--font-mono)' }}>{t.who}</p>
                    <p className="leading-relaxed whitespace-pre-wrap">{t.text}</p>
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <form
              className="p-3 border-t flex gap-2"
              style={{ borderColor: 'var(--border-color)' }}
              onSubmit={(e) => { e.preventDefault(); send(); }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`Speak to ${selected.name}…`}
                className="input surface flex-1 px-3 py-2"
                style={{ background: 'var(--bg-tertiary)' }}
              />
              <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>Send</button>
            </form>
          </>
        ) : (
          <div className="flex-1 grid place-items-center p-8 text-center">
            <div>
              <p className="text-3xl mb-2">🪔</p>
              <p className="font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Choose a legend</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>They speak here, inside the same studio.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Visuals ── */

function VisualsChamber({
  onGenerateImage,
}: {
  onGenerateImage: (prompt: string) => void;
}) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    getGalleryImages()
      .then((r) => setImages(r.images || []))
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim()) onGenerateImage(prompt.trim());
        }}
      >
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe a visual — generated in the workspace…"
          className="input surface flex-1 px-4 py-3"
          style={{ background: 'var(--bg-tertiary)' }}
        />
        <button type="submit" className="btn btn-primary" disabled={!prompt.trim()}>Generate</button>
      </form>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {images.map((img) => (
          <article key={img.id} className="rounded-2xl overflow-hidden border" style={{ borderColor: 'var(--border-color)' }}>
            <div className="aspect-[16/10] bg-black/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.title} className="w-full h-full object-cover" />
            </div>
            <div className="p-3">
              <p className="text-xs font-semibold truncate" style={{ fontFamily: 'var(--font-display)' }}>{img.title}</p>
              <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{img.tagline}</p>
              <button className="btn btn-primary w-full justify-center mt-2 text-xs" onClick={() => onGenerateImage(img.prompt)}>
                Remix this
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ── Research ── */

function ResearchChamber({
  onRunInChat,
}: {
  onRunInChat: (text: string) => void;
}) {
  const [eras, setEras] = useState<EraSummary[]>([]);

  useEffect(() => {
    getResearchEras().then((r) => setEras(r.eras || [])).catch(() => undefined);
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Fifty seminal milestones, six eras — executable in-process. One timeline, not a second product.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {eras.map((era) => (
          <button
            key={era.era_id}
            onClick={() => onRunInChat(`Synthesize the ${era.title} era (${era.time_span}): ${era.paradigm}`)}
            className="surface surface-hover p-4 text-left"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)' }}>
              {era.time_span}
            </span>
            <strong className="block mt-1 text-sm" style={{ fontFamily: 'var(--font-display)' }}>{era.title}</strong>
            <span className="block mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{era.paradigm}</span>
            <span className="block mt-2 text-[11px]" style={{ color: 'var(--accent-mint)', fontFamily: 'var(--font-mono)' }}>
              {era.feature_count} milestones
            </span>
          </button>
        ))}
      </div>
      <DeepResearchPane onRunInChat={onRunInChat} />
    </div>
  );
}

/* ── God ── */

function GodChamber({
  onRunInChat,
}: {
  onRunInChat: (text: string) => void;
}) {
  const [task, setTask] = useState('Why did the sandbox fail on a timeout boundary, and what should we intervene on?');
  const [out, setOut] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch('/v1/god/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, simulations: 16 }),
      }).then((r) => r.json());
      setOut(res);
    } finally {
      setLoading(false);
    }
  };

  const notes = (out?.notes as string[]) || [];

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Tree-of-Thought, causal <code>do()</code>, hypotheses, proofs, and red-team — fused, not five products.
      </p>
      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        rows={3}
        className="input surface w-full px-4 py-3"
        style={{ background: 'var(--bg-tertiary)', resize: 'vertical' }}
      />
      <div className="flex flex-wrap gap-2">
        <button onClick={run} className="btn btn-primary" disabled={loading}>
          {loading ? 'Fusing…' : 'Engage God Mode'}
        </button>
      </div>
      {out && (
        <div className="rounded-2xl border p-4 space-y-2" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-tertiary)' }}>
          <p className="text-[11px]" style={{ color: 'var(--accent-gold)', fontFamily: 'var(--font-mono)' }}>
            {(out.arsenal as string[])?.join(' · ')} · {Number(out.duration_ms).toFixed(0)}ms
          </p>
          {notes.map((n) => (
            <p key={n} className="text-xs" style={{ color: 'var(--text-secondary)' }}>• {n}</p>
          ))}
          <button
            className="btn btn-primary text-xs"
            onClick={() => onRunInChat(`God Mode briefing on: ${task}\n\n${notes.join('\n')}`)}
          >
            Drop briefing into chat
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Skills ── */

function SkillsChamber({ onRunInChat }: { onRunInChat: (text: string) => void }) {
  const [families, setFamilies] = useState<{
    family: string;
    note: string;
    skills: { id: string; name: string; icon: string; description: string; tools: string[]; trigger: string }[];
  }[]>([]);

  useEffect(() => {
    getSkillsCatalog().then((c) => setFamilies(c.families || [])).catch(() => undefined);
  }, []);

  return (
    <div className="space-y-5">
      {families.map((family) => (
        <div key={family.family}>
          <h3 className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>{family.family}</h3>
          <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>{family.note}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {family.skills.map((skill) => (
              <button
                key={skill.id}
                onClick={() => onRunInChat(skill.trigger)}
                className="surface surface-hover p-3 text-left flex gap-3"
              >
                <span className="text-lg">{skill.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{skill.name}</span>
                  <span className="block text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{skill.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Create ── */

function CreateChamber({
  onGenerateImage,
  onRunInChat,
}: {
  onGenerateImage: (prompt: string) => void;
  onRunInChat: (text: string) => void;
}) {
  const [imagePrompt, setImagePrompt] = useState('a serene temple at dusk over a teal river, cinematic');
  const [voice, setVoice] = useState('Welcome to Aetheris. Every surface is one constellation.');
  const [speaking, setSpeaking] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const presets = useMemo(
    () => [
      'orbiting teal nebula, cosmic indigo void',
      'tamil temple bronze vel, saffron light',
      'holographic mixture-of-experts lattice',
    ],
    [],
  );

  const speak = async () => {
    if (!voice.trim() || speaking) return;
    setSpeaking(true);
    try {
      const res = await synthesizeSpeech(voice.trim());
      const audio = new Audio(res.artifact.url);
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => setSpeaking(false);
      audio.play();
    } catch {
      setSpeaking(false);
    }
  };

  const paintHere = async () => {
    if (!imagePrompt.trim() || localBusy) return;
    setLocalBusy(true);
    try {
      await generateImage(imagePrompt.trim());
      onGenerateImage(imagePrompt.trim());
    } finally {
      setLocalBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-tertiary)' }}>
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent-mint)', fontFamily: 'var(--font-mono)' }}>Image</p>
        <h3 className="mt-1 text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>Paint from a sentence</h3>
        <textarea
          value={imagePrompt}
          onChange={(e) => setImagePrompt(e.target.value)}
          rows={4}
          className="input surface w-full mt-3 px-3 py-2"
          style={{ background: 'var(--bg-secondary)', resize: 'none' }}
        />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {presets.map((p) => (
            <button key={p} className="btn text-[10px] py-1" onClick={() => setImagePrompt(p)}>{p}</button>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn btn-primary" onClick={paintHere} disabled={localBusy}>Generate</button>
          <button className="btn" onClick={() => onRunInChat(`Create an image of ${imagePrompt}`)}>Via chat</button>
        </div>
      </div>
      <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-tertiary)' }}>
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent-gold)', fontFamily: 'var(--font-mono)' }}>Voice</p>
        <h3 className="mt-1 text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>Speak it aloud</h3>
        <textarea
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          rows={4}
          className="input surface w-full mt-3 px-3 py-2"
          style={{ background: 'var(--bg-secondary)', resize: 'none' }}
        />
        <button className="btn btn-primary mt-4" onClick={speak} disabled={speaking}>
          {speaking ? 'Speaking…' : 'Read aloud'}
        </button>
        <p className="text-[11px] mt-3" style={{ color: 'var(--text-muted)' }}>
          Offline formant synthesis by default — no key, no network.
        </p>
      </div>
    </div>
  );
}
      
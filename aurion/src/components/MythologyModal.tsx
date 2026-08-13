/* ─── Tamil Mythology — summon gods, heroes, sages & villains to life ─── */
"use client";

import { useState, useEffect, useRef } from 'react';
import {
  getMythology, mythologyChat, mythologyPortrait,
  MythCharacter,
} from '@/lib/hermes';

const CATEGORY_ICONS: Record<string, string> = {
  god: '⚡', goddess: '🌺', hero: '🛡️', sage: '🪔', epic: '👑',
  villain: '🗡️', asura: '🔥', 'divine-tool': '✨',
};

interface ChatTurn {
  role: 'you' | string;
  name: string;
  text: string;
}

interface MythologyModalProps {
  onClose: () => void;
}

export function MythologyModal({ onClose }: MythologyModalProps) {
  const [characters, setCharacters] = useState<MythCharacter[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [selected, setSelected] = useState<MythCharacter | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [portrait, setPortrait] = useState<string | null>(null);
  const [portraitBusy, setPortraitBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getMythology()
      .then((res) => {
        setCharacters(res.characters || []);
        setCategories(res.categories || {});
      })
      .catch(() => setError('Could not load the Tamil mythology pantheon.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const summon = (c: MythCharacter) => {
    setSelected(c);
    setTurns([{ role: c.name, name: c.name, text: c.summon }]);
    setPortrait(null);
    setInput('');
  };

  const send = async () => {
    if (!selected || !input.trim() || busy) return;
    const text = input.trim();
    setTurns((prev) => [...prev, { role: 'you', name: 'You', text }]);
    setInput('');
    setBusy(true);
    try {
      const res = await mythologyChat(selected.id, text);
      setTurns((prev) => [...prev, { role: selected.name, name: selected.name, text: res.reply }]);
    } catch (e) {
      setTurns((prev) => [...prev, {
        role: selected.name, name: selected.name,
        text: '…I faltered. ' + (e instanceof Error ? e.message : 'Try again, devotee.'),
      }]);
    } finally {
      setBusy(false);
    }
  };

  const makePortrait = async () => {
    if (!selected || portraitBusy) return;
    setPortraitBusy(true);
    try {
      const res = await mythologyPortrait(selected.id);
      setPortrait(res.artifact.url);
    } catch (e) {
      setPortrait(null);
      setError('Portrait failed: ' + (e instanceof Error ? e.message : 'unknown error'));
      setTimeout(() => setError(null), 3000);
    } finally {
      setPortraitBusy(false);
    }
  };

  const filtered = activeCat ? characters.filter((c) => c.category === activeCat) : characters;
  const categoryOrder = Object.keys(categories);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div
        className="w-full max-w-4xl h-[88vh] rounded-2xl overflow-hidden animate-fade-in flex flex-col"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>
                🪔 Tamil Mythology · Living Legends
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Summon gods, heroes, sages, kings, and villains — from Murugan to Ravana — and speak with them.
              </p>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" />
              </svg>
            </button>
          </div>
          {error && <p className="text-xs mt-1" style={{ color: 'var(--accent-pink)' }}>{error}</p>}
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: catalog */}
          <div className="w-72 flex-shrink-0 flex flex-col border-r" style={{ borderColor: 'var(--border-color)' }}>
            {/* category filter */}
            <div className="p-2 flex flex-wrap gap-1 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <button
                onClick={() => setActiveCat(null)}
                className="px-2 py-1 rounded-lg text-[11px] whitespace-nowrap"
                style={{
                  background: !activeCat ? 'rgba(61,255,194,0.12)' : 'var(--bg-tertiary)',
                  border: `1px solid ${!activeCat ? 'rgba(61,255,194,0.4)' : 'var(--border-color)'}`,
                  color: !activeCat ? 'var(--accent-mint)' : 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                All {characters.length}
              </button>
              {categoryOrder.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCat(activeCat === cat ? null : cat)}
                  className="px-2 py-1 rounded-lg text-[11px] whitespace-nowrap"
                  style={{
                    background: activeCat === cat ? 'rgba(61,255,194,0.12)' : 'var(--bg-tertiary)',
                    border: `1px solid ${activeCat === cat ? 'rgba(61,255,194,0.4)' : 'var(--border-color)'}`,
                    color: activeCat === cat ? 'var(--accent-mint)' : 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {CATEGORY_ICONS[cat] || '·'} {categories[cat]}
                </button>
              ))}
            </div>

            {/* character list */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {loading && <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>Gathering the pantheon…</p>}
              {filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => summon(c)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all hover:scale-[1.01]"
                  style={{
                    background: selected?.id === c.id ? 'var(--bg-hover)' : 'var(--bg-tertiary)',
                    border: `1px solid ${selected?.id === c.id ? 'var(--accent-mint)' : 'var(--border-color)'}`,
                  }}
                >
                  <span className="text-lg">{CATEGORY_ICONS[c.category] || '·'}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}>
                      {c.name}
                    </p>
                    <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                      {c.epithet} · {c.tamil_name}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right: conversation */}
          <div className="flex-1 flex flex-col min-w-0">
            {!selected ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                <span className="text-5xl mb-3">🪔</span>
                <p className="text-lg font-semibold mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                  Choose a legend to bring to life
                </p>
                <p className="text-sm max-w-md" style={{ color: 'var(--text-muted)' }}>
                  From the vel of Murugan to the pride of Ravana, every figure of Tamil mythology can speak with you now.
                </p>
              </div>
            ) : (
              <>
                {/* character banner */}
                <div className="px-5 py-3 flex items-center gap-3 border-b" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-tertiary)' }}>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>
                      {CATEGORY_ICONS[selected.category]} {selected.name} <span className="opacity-60">{selected.tamil_name}</span>
                    </p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                      {selected.title} — {selected.domain}
                    </p>
                  </div>
                  <button
                    onClick={makePortrait}
                    disabled={portraitBusy}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold shrink-0"
                    style={{ background: 'rgba(192,132,252,0.12)', border: '1px solid rgba(192,132,252,0.4)', color: '#c084fc', fontFamily: 'var(--font-ui)' }}
                  >
                    {portraitBusy ? 'Summoning…' : '🎨 Summon their form'}
                  </button>
                  <button
                    onClick={() => setSelected(null)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-mono shrink-0"
                    style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}
                  >
                    ← Choose another
                  </button>
                </div>

                {/* portrait */}
                {portrait && (
                  <div className="px-5 py-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="rounded-xl overflow-hidden max-h-56 mx-auto" style={{ border: '1px solid var(--border-color)' }}>
                      <img src={portrait} alt={selected.name} className="w-full h-full object-contain max-h-56" />
                    </div>
                  </div>
                )}

                {/* conversation */}
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  {turns.map((t, i) => (
                    <div key={i} className={`flex ${t.role === 'you' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm`}
                        style={{
                          background: t.role === 'you' ? 'rgba(61,255,194,0.12)' : 'var(--bg-tertiary)',
                          border: `1px solid ${t.role === 'you' ? 'rgba(61,255,194,0.3)' : 'var(--border-color)'}`,
                          color: 'var(--text-primary)',
                        }}
                      >
                        <p className="text-[10px] font-mono mb-1" style={{ color: t.role === 'you' ? 'var(--accent-mint)' : 'var(--accent-purple)' }}>
                          {t.role === 'you' ? 'You' : `${CATEGORY_ICONS[selected.category]} ${t.name}`}
                        </p>
                        <p className="whitespace-pre-wrap leading-relaxed">{t.text}</p>
                      </div>
                    </div>
                  ))}
                  {busy && (
                    <div className="flex justify-start">
                      <p className="text-xs px-3 py-1.5 rounded-2xl" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
                        {selected.name} is speaking…
                      </p>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* input */}
                <div className="p-4 border-t flex items-end gap-2" style={{ borderColor: 'var(--border-color)' }}>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder={`Speak to ${selected.name}… (Enter to send)`}
                    rows={1}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none resize-none"
                    style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}
                  />
                  <button
                    onClick={send}
                    disabled={busy || !input.trim()}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold shrink-0 disabled:opacity-30"
                    style={{ background: 'var(--accent-mint)', color: '#0a0e1a', fontFamily: 'var(--font-ui)' }}
                  >
                    Send
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t text-center text-[10px]" style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {characters.length} legends · each speaks in its own voice · summon their form with 🎨
        </div>
      </div>
    </div>
  );
}

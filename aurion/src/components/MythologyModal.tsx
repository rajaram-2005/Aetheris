/* ─── Tamil Mythology — summon gods, heroes, sages & villains to life ─── */
"use client";

import { useState, useEffect, useRef } from 'react';
import {
  getMythology, getMythologyCharacter, mythologyChat, mythologyPortrait,
  getDailyWisdom, mythologyCouncil, createCustomLegend,
  MythCharacter,
} from '@/lib/hermes';

const CATEGORY_ICONS: Record<string, string> = {
  god: '⚡', goddess: '🌺', hero: '🛡️', sage: '🪔', epic: '👑',
  villain: '🗡️', asura: '🔥', 'divine-tool': '✨',
};

const CATEGORY_LABELS: Record<string, string> = {
  god: 'God', goddess: 'Goddess', hero: 'Hero', sage: 'Sage', epic: 'King',
  villain: 'Villain', asura: 'Asura', 'divine-tool': 'Symbol',
};

interface ChatTurn { role: 'you' | string; name: string; text: string; }
interface CouncilMember { id: string; name: string; category: string; epithet: string; }

interface MythologyModalProps { onClose: () => void; }

type Tab = 'pantheon' | 'council' | 'create';

export function MythologyModal({ onClose }: MythologyModalProps) {
  const [tab, setTab] = useState<Tab>('pantheon');
  const [characters, setCharacters] = useState<MythCharacter[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [daily, setDaily] = useState<{ character: { name: string }; wisdom: string } | null>(null);

  // Chat state
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [selected, setSelected] = useState<MythCharacter | null>(null);
  const [connections, setConnections] = useState<{ other: string; relation: string }[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [portrait, setPortrait] = useState<string | null>(null);
  const [portraitBusy, setPortraitBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Council state
  const [councilPick, setCouncilPick] = useState<string[]>([]);
  const [councilQuestion, setCouncilQuestion] = useState('');
  const [councilBusy, setCouncilBusy] = useState(false);
  const [councilResult, setCouncilResult] = useState<{ members: CouncilMember[]; speeches: { name: string; voice: string }[]; synthesis: string } | null>(null);

  // Create state
  const [form, setForm] = useState<Record<string, string>>({});
  const [createBusy, setCreateBusy] = useState(false);
  const [created, setCreated] = useState<MythCharacter | null>(null);

  useEffect(() => {
    getMythology()
      .then((res) => { setCharacters(res.characters || []); setCategories(res.categories || {}); })
      .catch(() => setError('Could not load the Tamil mythology pantheon.'))
      .finally(() => setLoading(false));
    getDailyWisdom().then(setDaily).catch(() => {});
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns]);

  const summon = (c: MythCharacter) => {
    setSelected(c);
    setTurns([{ role: c.name, name: c.name, text: c.summon }]);
    setPortrait(null);
    setConnections([]);
    setInput('');
    getMythologyCharacter(c.id)
      .then((detail) => setConnections(detail.connections || []))
      .catch(() => setConnections([]));
  };

  const send = async () => {
    if (!selected || !input.trim() || busy) return;
    const text = input.trim();
    setTurns((prev) => [...prev, { role: 'you', name: 'You', text }]);
    setInput(''); setBusy(true);
    try {
      const res = await mythologyChat(selected.id, text);
      setTurns((prev) => [...prev, { role: selected.name, name: selected.name, text: res.reply }]);
    } catch (e) {
      setTurns((prev) => [...prev, { role: selected.name, name: selected.name, text: '…I faltered. ' + (e instanceof Error ? e.message : 'Try again, devotee.') }]);
    } finally { setBusy(false); }
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
    } finally { setPortraitBusy(false); }
  };

  const toggleCouncilPick = (id: string) => {
    setCouncilPick((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : (prev.length >= 4 ? prev : [...prev, id]));
  };

  const runCouncil = async () => {
    if (councilPick.length < 2 || !councilQuestion.trim() || councilBusy) return;
    setCouncilBusy(true); setCouncilResult(null);
    try {
      const res = await mythologyCouncil(councilPick, councilQuestion.trim());
      setCouncilResult(res);
    } catch (e) {
      setError('Council failed: ' + (e instanceof Error ? e.message : 'unknown error'));
      setTimeout(() => setError(null), 3000);
    } finally { setCouncilBusy(false); }
  };

  const runCreate = async () => {
    if (!form.name?.trim() || createBusy) return;
    setCreateBusy(true); setCreated(null);
    try {
      const legend = await createCustomLegend({ name: form.name || 'Legend', ...form });
      setCreated(legend);
      setForm({});
      getMythology().then((res) => setCharacters(res.characters || []));
    } catch (e) {
      setError('Could not create legend: ' + (e instanceof Error ? e.message : 'unknown error'));
      setTimeout(() => setError(null), 3000);
    } finally { setCreateBusy(false); }
  };

  const filtered = activeCat ? characters.filter((c) => c.category === activeCat) : characters;
  const categoryOrder = Object.keys(categories);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div
        className="w-full max-w-4xl h-[90vh] rounded-2xl overflow-hidden animate-fade-in flex flex-col"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                Tamil Mythology
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Summon {characters.length || 31} legends — gods, heroes, sages, kings &amp; villains
              </p>
            </div>
            <button onClick={onClose} className="btn btn-icon btn-ghost" title="Close" style={{ width: 32, height: 32 }}>
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" /></svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1">
            <TabButton active={tab === 'pantheon'} onClick={() => setTab('pantheon')}>Pantheon</TabButton>
            <TabButton active={tab === 'council'} onClick={() => setTab('council')}>Council</TabButton>
            <TabButton active={tab === 'create'} onClick={() => setTab('create')}>Create</TabButton>
          </div>

          {error && <p className="text-xs mt-2" style={{ color: 'var(--accent-pink)' }}>{error}</p>}
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {tab === 'pantheon' && (
            <PantheonTab
              loading={loading}
              characters={characters}
              filtered={filtered}
              categories={categories}
              categoryOrder={categoryOrder}
              activeCat={activeCat}
              setActiveCat={setActiveCat}
              selected={selected}
              onSummon={summon}
              daily={daily}
            />
          )}

          {tab === 'council' && (
            <CouncilTab
              characters={characters}
              pick={councilPick}
              toggle={toggleCouncilPick}
              question={councilQuestion}
              setQuestion={setCouncilQuestion}
              busy={councilBusy}
              onRun={runCouncil}
              result={councilResult}
            />
          )}

          {tab === 'create' && (
            <CreateTab form={form} setForm={setForm} busy={createBusy} onRun={runCreate} created={created} />
          )}

          {/* Right: conversation */}
          {tab === 'pantheon' && selected && (
            <ChatPane
              selected={selected}
              connections={connections}
              turns={turns}
              busy={busy}
              input={input}
              setInput={setInput}
              onSend={send}
              portrait={portrait}
              portraitBusy={portraitBusy}
              onPortrait={makePortrait}
              onBack={() => setSelected(null)}
              chatEndRef={chatEndRef}
            />
          )}
          {tab === 'pantheon' && !selected && (
            <div className="flex-1 flex items-center justify-center p-8 text-center">
              <div>
                <span className="text-4xl block mb-3">🪔</span>
                <p className="text-base font-semibold mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>Choose a legend to bring to life</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>From the vel of Murugan to the pride of Ravana, every figure can speak with you now.</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{characters.length} legends · each speaks in its own voice</span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>🪔 Thamizh Mythos</span>
        </div>
      </div>
    </div>
  );
}

/* ── Tab button ── */
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="btn px-3 py-1.5" style={{
      background: active ? 'var(--bg-hover)' : 'transparent',
      borderColor: active ? 'var(--border-hover)' : 'transparent',
      color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    }}>
      {children}
    </button>
  );
}

/* ── Pantheon (browse) tab ── */
function PantheonTab({ loading, filtered, categories, categoryOrder, activeCat, setActiveCat, selected, onSummon, daily }: {
  loading: boolean; characters: MythCharacter[]; filtered: MythCharacter[];
  categories: Record<string, string>; categoryOrder: string[]; activeCat: string | null;
  setActiveCat: (s: string | null) => void; selected: MythCharacter | null; onSummon: (c: MythCharacter) => void;
  daily: { character: { name: string }; wisdom: string } | null;
}) {
  return (
    <div className="w-72 flex-shrink-0 flex flex-col border-r" style={{ borderColor: 'var(--border-color)' }}>
      {daily && (
        <div className="p-3 border-b" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-tertiary)' }}>
          <p className="text-[10px] font-mono mb-1" style={{ color: 'var(--accent-gold)' }}>✦ Wisdom of the day · {daily.character.name}</p>
          <p className="text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>{daily.wisdom}</p>
        </div>
      )}
      <div className="p-2 flex flex-wrap gap-1 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <CatPill active={!activeCat} onClick={() => setActiveCat(null)} label="All" />
        {categoryOrder.map((cat) => (
          <CatPill key={cat} active={activeCat === cat} onClick={() => setActiveCat(activeCat === cat ? null : cat)}
            label={`${CATEGORY_ICONS[cat] || '·'} ${categories[cat]}`} />
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading && <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>Gathering the pantheon…</p>}
        {filtered.map((c) => (
          <button key={c.id} onClick={() => onSummon(c)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left surface surface-hover"
            style={{ background: selected?.id === c.id ? 'var(--bg-hover)' : 'var(--bg-tertiary)' }}>
            <span className="text-base">{CATEGORY_ICONS[c.category] || '·'}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</span>
              <span className="block text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{c.epithet} · {c.tamil_name}{c.id.startsWith('custom') ? ' · yours' : ''}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CatPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="px-2 py-1 rounded-lg text-[10px] whitespace-nowrap" style={{
      background: active ? 'var(--bg-hover)' : 'var(--bg-tertiary)',
      border: `1px solid ${active ? 'var(--border-hover)' : 'var(--border-color)'}`,
      color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    }}>{label}</button>
  );
}

/* ── Council tab ── */
function CouncilTab({ characters, pick, toggle, question, setQuestion, busy, onRun, result }: {
  characters: MythCharacter[]; pick: string[]; toggle: (id: string) => void;
  question: string; setQuestion: (s: string) => void; busy: boolean; onRun: () => void;
  result: { members: CouncilMember[]; speeches: { name: string; voice: string }[]; synthesis: string } | null;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <h3 className="text-base font-semibold mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>⚖️ Legend Council</h3>
      <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Convene 2–4 legends to advise together on a single question.</p>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {characters.filter((c) => !c.id.startsWith('custom')).slice(0, 18).map((c) => (
          <button key={c.id} onClick={() => toggle(c.id)} className="px-2.5 py-1.5 rounded-lg text-xs" style={{
            background: pick.includes(c.id) ? 'var(--bg-hover)' : 'var(--bg-tertiary)',
            border: `1px solid ${pick.includes(c.id) ? 'var(--border-hover)' : 'var(--border-color)'}`,
            color: pick.includes(c.id) ? 'var(--text-primary)' : 'var(--text-muted)',
          }}>
            {CATEGORY_ICONS[c.category]} {c.name}
          </button>
        ))}
      </div>

      <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2}
        placeholder="Ask the council… (e.g. How should I choose between two paths?)"
        className="input w-full surface px-3 py-2 mb-3" style={{ background: 'var(--bg-tertiary)', resize: 'none' }} />

      <button onClick={onRun} disabled={busy || pick.length < 2 || !question.trim()} className="btn btn-primary"
        style={{ opacity: pick.length < 2 || !question.trim() ? 0.4 : 1 }}>
        {busy ? 'Convening…' : `Convene ${pick.length} legends`}
      </button>

      {result && (
        <div className="mt-5 space-y-3">
          <div className="surface p-4" style={{ background: 'var(--bg-tertiary)' }}>
            <p className="text-[11px] font-mono mb-2" style={{ color: 'var(--accent-gold)' }}>Council synthesis</p>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>{result.synthesis}</p>
          </div>
          {result.speeches.map((s, i) => (
            <details key={i} className="surface p-3" style={{ background: 'var(--bg-tertiary)' }}>
              <summary className="text-sm cursor-pointer font-medium" style={{ color: 'var(--text-primary)' }}>{CATEGORY_ICONS[result.members[i]?.category] || '·'} {s.name}</summary>
              <p className="text-xs mt-2 leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{s.voice}</p>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Create tab ── */
function CreateTab({ form, setForm, busy, onRun, created }: {
  form: Record<string, string>; setForm: (f: Record<string, string>) => void;
  busy: boolean; onRun: () => void; created: MythCharacter | null;
}) {
  const fields: { key: string; label: string; ph: string }[] = [
    { key: 'name', label: 'Name', ph: 'e.g. Vaan the Sky-King' },
    { key: 'tamil_name', label: 'Tamil name', ph: 'e.g. வான்' },
    { key: 'epithet', label: 'Epithet', ph: 'e.g. Guardian of the Dawn' },
    { key: 'domain', label: 'Domain', ph: 'What do they rule?' },
    { key: 'symbol', label: 'Symbol', ph: 'e.g. a golden bow' },
    { key: 'aspect', label: 'Aspect', ph: 'What truth do they embody?' },
    { key: 'summon', label: 'Summoning line', ph: 'What do they say when summoned?' },
  ];
  return (
    <div className="flex-1 overflow-y-auto p-5 max-w-2xl">
      <h3 className="text-base font-semibold mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>🛠️ Create a Legend</h3>
      <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Invent a figure of your own — they join the pantheon and can be summoned and portrayed.</p>

      <div className="space-y-2 mb-3">
        {fields.map((f) => (
          <div key={f.key}>
            <label className="block text-[11px] font-mono mb-1" style={{ color: 'var(--text-muted)' }}>{f.label}</label>
            <input value={form[f.key] || ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              placeholder={f.ph} className="input w-full surface px-3 py-2" style={{ background: 'var(--bg-tertiary)' }} />
          </div>
        ))}
        <div>
          <label className="block text-[11px] font-mono mb-1" style={{ color: 'var(--text-muted)' }}>Persona</label>
          <textarea value={form.persona || ''} onChange={(e) => setForm({ ...form, persona: e.target.value })} rows={3}
            placeholder="Describe their voice and temperament (optional)" className="input w-full surface px-3 py-2" style={{ background: 'var(--bg-tertiary)', resize: 'none' }} />
        </div>
      </div>

      <button onClick={onRun} disabled={busy || !form.name?.trim()} className="btn btn-primary" style={{ opacity: form.name?.trim() ? 1 : 0.4 }}>
        {busy ? 'Creating…' : 'Create legend'}
      </button>

      {created && (
        <div className="surface p-4 mt-4" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border-hover)' }}>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--accent-mint)' }}>✅ {created.name} joins the pantheon</p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{created.summon} — switch to Pantheon and pick them to begin speaking.</p>
        </div>
      )}
    </div>
  );
}

/* ── Chat pane ── */
function ChatPane({ selected, connections, turns, busy, input, setInput, onSend, portrait, portraitBusy, onPortrait, onBack, chatEndRef }: {
  selected: MythCharacter; connections: { other: string; relation: string }[];
  turns: ChatTurn[]; busy: boolean; input: string; setInput: (s: string) => void; onSend: () => void;
  portrait: string | null; portraitBusy: boolean; onPortrait: () => void; onBack: () => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-4 py-2.5 flex items-center gap-3 border-b" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-tertiary)' }}>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            {CATEGORY_ICONS[selected.category]} {selected.name} <span style={{ opacity: 0.6, color: 'var(--text-muted)' }}>{selected.tamil_name}</span>
          </p>
          <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{selected.title} — {selected.domain}</p>
        </div>
        <button onClick={onPortrait} disabled={portraitBusy} className="btn" title="Summon their form">
          {portraitBusy ? '…' : '🎨 Form'}
        </button>
        <button onClick={onBack} className="btn btn-ghost">← Back</button>
      </div>

      {portrait && (
        <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="rounded-xl overflow-hidden max-h-48 mx-auto" style={{ border: '1px solid var(--border-color)' }}>
            <img src={portrait} alt={selected.name} className="w-full h-full object-contain max-h-48" />
          </div>
        </div>
      )}

      {connections.length > 0 && (
        <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <p className="text-[10px] font-mono mb-1" style={{ color: 'var(--text-muted)' }}>Connected in the pantheon</p>
          <div className="flex flex-wrap gap-1">
            {connections.map((conn, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                {conn.other} · {conn.relation}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.role === 'you' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm`} style={{
              background: t.role === 'you' ? 'var(--bg-hover)' : 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
            }}>
              <p className="text-[10px] font-mono mb-1" style={{ color: t.role === 'you' ? 'var(--text-muted)' : 'var(--accent-gold)' }}>
                {t.role === 'you' ? 'You' : `${CATEGORY_ICONS[selected.category]} ${t.name}`}
              </p>
              <p className="whitespace-pre-wrap leading-relaxed">{t.text}</p>
            </div>
          </div>
        ))}
        {busy && <div className="flex justify-start"><p className="text-xs px-3 py-1.5 rounded-2xl surface" style={{ color: 'var(--text-muted)' }}>{selected.name} is speaking…</p></div>}
        <div ref={chatEndRef} />
      </div>

      <div className="p-3 border-t flex items-end gap-2" style={{ borderColor: 'var(--border-color)' }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          placeholder={`Speak to ${selected.name}…`} rows={1}
          className="input flex-1 surface px-3 py-2 resize-none" style={{ background: 'var(--bg-tertiary)' }} />
        <button onClick={onSend} disabled={busy || !input.trim()} className="btn btn-primary" style={{ opacity: input.trim() ? 1 : 0.4 }}>Send</button>
      </div>
    </div>
  );
}

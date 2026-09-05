"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type CharacterMode = "roleplay" | "guide";
export interface CharacterInfo {
  id: string;
  ownerId: string | null;
  builtIn: boolean;
  name: string;
  avatar: string;
  tradition: string;
  title: string;
  description: string;
  greeting: string;
  traits: string[];
  instructions: string;
  modes: CharacterMode[];
  suggestedPrompts: string[];
  sourceNote?: string;
  createdAt: number;
  updatedAt: number;
}

export function useCharacters() {
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/characters", { cache: "no-store" });
      if (response.ok) setCharacters(((await response.json()).characters ?? []) as CharacterInfo[]);
    } catch { /* the page shows its empty state; retrying reload is safe */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { characters, loading, reload };
}

const EMPTY_FORM = {
  name: "", avatar: "✨", tradition: "Original", title: "", description: "", greeting: "",
  traits: "", instructions: "", suggestedPrompts: "", roleplay: true, guide: true, sourceNote: "",
};
type FormState = typeof EMPTY_FORM;

function toForm(character?: CharacterInfo | null): FormState {
  if (!character) return { ...EMPTY_FORM };
  return {
    name: character.name, avatar: character.avatar, tradition: character.tradition, title: character.title,
    description: character.description, greeting: character.greeting, traits: character.traits.join(", "),
    instructions: character.instructions, suggestedPrompts: character.suggestedPrompts.join("\n"),
    roleplay: character.modes.includes("roleplay"), guide: character.modes.includes("guide"), sourceNote: character.sourceNote ?? "",
  };
}

function CharacterEditor({ character, onClose, onSaved }: { character: CharacterInfo | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<FormState>(() => toForm(character));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!form.name.trim() || (!form.roleplay && !form.guide)) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(character ? `/api/characters/${character.id}` : "/api/characters", {
        method: character ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name, avatar: form.avatar, tradition: form.tradition, title: form.title,
          description: form.description, greeting: form.greeting,
          traits: form.traits.split(",").map((item) => item.trim()).filter(Boolean),
          instructions: form.instructions,
          suggestedPrompts: form.suggestedPrompts.split("\n").map((item) => item.trim()).filter(Boolean),
          sourceNote: form.sourceNote,
          modes: [form.roleplay ? "roleplay" : null, form.guide ? "guide" : null].filter(Boolean),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(result.error ?? "Could not save character"); return; }
      await onSaved();
    } catch { setError("Connection lost while saving the character"); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal character-editor" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2>{character ? `Edit ${character.name}` : "Create a character"}</h2>
        <p>Custom characters are private to this browser or signed-in account and stored in the Aetheris database.</p>
        <div className="character-form-grid">
          <label className="field character-avatar-field"><span>Avatar</span><input value={form.avatar} maxLength={16} onChange={(event) => set("avatar", event.target.value)} placeholder="✨" /></label>
          <label className="field"><span>Name *</span><input autoFocus value={form.name} maxLength={60} onChange={(event) => set("name", event.target.value)} placeholder="Character name" /></label>
          <label className="field"><span>Collection / tradition</span><input value={form.tradition} maxLength={60} onChange={(event) => set("tradition", event.target.value)} placeholder="Original, Tamil folklore, Greek mythology…" /></label>
          <label className="field"><span>Title</span><input value={form.title} maxLength={100} onChange={(event) => set("title", event.target.value)} placeholder="A short role or epithet" /></label>
        </div>
        <div className="settings">
          <label className="field"><span>Description</span><textarea rows={2} value={form.description} maxLength={600} onChange={(event) => set("description", event.target.value)} placeholder="What users should know before starting a chat" /></label>
          <label className="field"><span>Greeting</span><textarea rows={2} value={form.greeting} maxLength={1000} onChange={(event) => set("greeting", event.target.value)} placeholder="The welcome shown at the start of a new chat" /></label>
          <label className="field"><span>Personality traits <small>comma-separated</small></span><input value={form.traits} onChange={(event) => set("traits", event.target.value)} placeholder="wise, playful, direct" /></label>
          <label className="field"><span>Character instructions</span><textarea rows={6} value={form.instructions} maxLength={6000} onChange={(event) => set("instructions", event.target.value)} placeholder="Voice, background, knowledge, boundaries, and how this character should respond…" /><small>These are loaded server-side as character direction. Aetheris safety and transparency rules still apply.</small></label>
          <label className="field"><span>Conversation starters <small>one per line, up to 6</small></span><textarea rows={3} value={form.suggestedPrompts} onChange={(event) => set("suggestedPrompts", event.target.value)} placeholder={"Tell me your story\nHelp me think through a choice"} /></label>
          <label className="field"><span>Source / interpretation note <small>optional</small></span><textarea rows={2} value={form.sourceNote} maxLength={500} onChange={(event) => set("sourceNote", event.target.value)} placeholder="Explain sources, inspiration, or where creative interpretation begins" /></label>
          <div className="character-mode-checks">
            <span>Available modes *</span>
            <label><input type="checkbox" checked={form.roleplay} onChange={(event) => set("roleplay", event.target.checked)} /> 🎭 Immersive roleplay</label>
            <label><input type="checkbox" checked={form.guide} onChange={(event) => set("guide", event.target.checked)} /> 📚 Educational guide</label>
          </div>
          {error && <div className="err-text">{error}</div>}
          <div className="character-form-actions"><button className="ghost" onClick={onClose}>Cancel</button><button className="send" disabled={saving || !form.name.trim() || (!form.roleplay && !form.guide)} onClick={save}>{saving ? "Saving…" : "Save character"}</button></div>
        </div>
      </div>
    </div>
  );
}

export default function CharactersPage({ characters, loading, reload, onChat }: {
  characters: CharacterInfo[];
  loading: boolean;
  reload: () => Promise<void>;
  onChat: (character: CharacterInfo, mode: CharacterMode) => void;
}) {
  const [query, setQuery] = useState("");
  const [tradition, setTradition] = useState("All");
  const [mine, setMine] = useState(false);
  const [editing, setEditing] = useState<CharacterInfo | null | "new">(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const traditions = useMemo(() => Array.from(new Set(characters.map((character) => character.tradition))).sort(), [characters]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return characters.filter((character) => {
      if (mine && character.builtIn) return false;
      if (tradition !== "All" && character.tradition !== tradition) return false;
      return !term || [character.name, character.title, character.description, character.tradition, ...character.traits].some((field) => field.toLowerCase().includes(term));
    });
  }, [characters, mine, query, tradition]);

  const remove = async (character: CharacterInfo) => {
    if (!confirm(`Delete your character “${character.name}”? Existing chat transcripts will be kept, but new messages cannot use it.`)) return;
    const response = await fetch(`/api/characters/${character.id}`, { method: "DELETE" });
    if (response.ok) await reload();
  };

  return (
    <div className="characters-page">
      <div className="characters-hero">
        <div>
          <div className="eyebrow">DATABASE-BACKED PERSONAS</div>
          <h2>Characters</h2>
          <p>Meet curated mythological figures in two transparent modes—or create a private character of your own.</p>
        </div>
        <button className="send" onClick={() => setEditing("new")}>＋ Create character</button>
      </div>

      <div className="character-notice"><span>✦</span><div><b>Respectful AI interpretations</b><small>Roleplay is creative—not divine contact. Guide mode explains sources and variants. Living traditions are presented with care, and exact scripture is never invented.</small></div></div>

      <div className="character-tools">
        <input className="agent-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names, traits, traditions…" />
        <select value={tradition} onChange={(event) => setTradition(event.target.value)}><option>All</option>{traditions.map((item) => <option key={item}>{item}</option>)}</select>
        <div className="mode-toggle"><button className={!mine ? "active" : ""} onClick={() => setMine(false)}>All</button><button className={mine ? "active" : ""} onClick={() => setMine(true)}>My characters</button></div>
      </div>

      {loading && <div className="sb-empty">Opening the character database…</div>}
      {!loading && filtered.length === 0 && <div className="character-empty"><b>No characters found</b><span>Try another filter or create your own.</span></div>}
      <div className="character-grid">
        {filtered.map((character) => {
          const open = expanded === character.id;
          return (
            <article key={character.id} className={`character-card ${character.builtIn ? "curated" : "custom"}`}>
              <div className="character-card-top">
                <div className="character-avatar" aria-hidden>{character.avatar}</div>
                <div className="character-identity"><div className="character-collection">{character.tradition}</div><h3>{character.name}</h3><span>{character.title}</span></div>
                <span className={`character-kind ${character.builtIn ? "" : "mine"}`}>{character.builtIn ? "CURATED" : "PRIVATE"}</span>
              </div>
              <p>{character.description || "A custom character ready for conversation."}</p>
              <div className="character-traits">{character.traits.slice(0, 5).map((trait) => <span key={trait}>{trait}</span>)}</div>
              {open && (
                <div className="character-details">
                  {character.greeting && <blockquote>“{character.greeting}”</blockquote>}
                  {character.sourceNote && <small><b>Interpretation note:</b> {character.sourceNote}</small>}
                  {character.suggestedPrompts.length > 0 && <div><b>Try asking</b>{character.suggestedPrompts.map((prompt) => <button key={prompt} onClick={() => onChat(character, character.modes.includes("guide") ? "guide" : character.modes[0])}>{prompt}</button>)}</div>}
                </div>
              )}
              <div className="character-card-actions">
                {character.modes.includes("roleplay") && <button className="character-roleplay" onClick={() => onChat(character, "roleplay")}><span>🎭</span><b>Roleplay</b><small>in character</small></button>}
                {character.modes.includes("guide") && <button className="character-guide" onClick={() => onChat(character, "guide")}><span>📚</span><b>Guide</b><small>learn & explore</small></button>}
              </div>
              <div className="character-card-foot">
                <button className="link" onClick={() => setExpanded(open ? null : character.id)}>{open ? "Less" : "Details & starters"}</button>
                {!character.builtIn && <span><button className="link" onClick={() => setEditing(character)}>Edit</button><button className="link danger-text" onClick={() => remove(character)}>Delete</button></span>}
              </div>
            </article>
          );
        })}
      </div>

      {editing !== null && <CharacterEditor character={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { await reload(); setEditing(null); }} />}
    </div>
  );
}

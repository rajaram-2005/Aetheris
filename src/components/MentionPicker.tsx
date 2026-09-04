"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentInfo } from "./Agents";

/**
 * Inline @mention / slash-command autocomplete for the composer.
 * - Typing `@` (at start or after whitespace) filters the 99-agent roster by id, alias, name, domain and skills.
 * - Typing `/` at the start offers commands (research, arena, room, share, new, clear…).
 * Keyboard: ↑/↓ move, Tab/Enter accept, Esc close.
 */
export interface Command { id: string; icon: string; label: string; hint: string }
export const COMMANDS: Command[] = [
  { id: "research", icon: "🔬", label: "/research", hint: "Deep research with sources" },
  { id: "arena", icon: "⚔️", label: "/arena", hint: "Compare several providers side by side" },
  { id: "image", icon: "🎨", label: "/image", hint: "Generate an image in the Studio" },
  { id: "debate", icon: "🥊", label: "/debate", hint: "Two agents argue a motion, Metis judges — /debate <motion>" },
  { id: "workflows", icon: "⛓️", label: "/workflows", hint: "Chain agents into automations" },
  { id: "room", icon: "👥", label: "/room", hint: "Open a live room for this chat" },
  { id: "share", icon: "🔗", label: "/share", hint: "Create a public link to this chat" },
  { id: "new", icon: "✨", label: "/new", hint: "Start a new chat" },
  { id: "agents", icon: "🤖", label: "/agents", hint: "Browse all agents" },
  { id: "gallery", icon: "🗂️", label: "/gallery", hint: "Prompt & agent gallery" },
  { id: "settings", icon: "⚙️", label: "/settings", hint: "Open settings" },
  { id: "export", icon: "⤓", label: "/export", hint: "Download this chat as Markdown" },
];

export function detectTrigger(value: string, caret: number): { kind: "agent" | "command"; query: string; start: number } | null {
  const before = value.slice(0, caret);
  const at = /(^|\s)@([\w-]*)$/.exec(before);
  if (at) return { kind: "agent", query: at[2].toLowerCase(), start: caret - at[2].length - 1 };
  const slash = /^\/([\w-]*)$/.exec(before);
  if (slash) return { kind: "command", query: slash[1].toLowerCase(), start: 0 };
  return null;
}

export function rankAgents(agents: AgentInfo[], q: string, limit = 8): AgentInfo[] {
  if (!q) return agents.filter((a) => a.tier !== "ultra").slice(0, limit);
  const score = (a: AgentInfo) => {
    if (a.id === q) return 100;
    if (a.id.startsWith(q)) return 80;
    if (a.aliases.some((x) => x === q)) return 75;
    if (a.aliases.some((x) => x.startsWith(q))) return 60;
    if (a.name.toLowerCase().includes(q)) return 50;
    if (a.domain.includes(q)) return 30;
    if (a.skills.some((s) => s.toLowerCase().includes(q))) return 20;
    if (a.description.toLowerCase().includes(q)) return 10;
    return 0;
  };
  return agents.map((a) => [score(a), a] as const).filter(([s]) => s > 0).sort((x, y) => y[0] - x[0]).slice(0, limit).map(([, a]) => a);
}

export default function MentionPicker({ value, caret, agents, onPick, onCommand, onClose }: {
  value: string; caret: number; agents: AgentInfo[];
  onPick: (next: string, caret: number) => void; onCommand: (id: string) => void; onClose: () => void;
}) {
  const trig = useMemo(() => detectTrigger(value, caret), [value, caret]);
  const items = useMemo(() => {
    if (!trig) return [];
    if (trig.kind === "agent") return rankAgents(agents, trig.query).map((a) => ({ key: a.id, icon: a.icon, label: `@${a.id}`, hint: `${a.name} · ${a.description}`, tier: a.tier }));
    return COMMANDS.filter((c) => c.id.startsWith(trig.query)).map((c) => ({ key: c.id, icon: c.icon, label: c.label, hint: c.hint, tier: "cmd" }));
  }, [trig, agents]);
  const [sel, setSel] = useState(0);
  useEffect(() => setSel(0), [trig?.query, trig?.kind]);

  useEffect(() => {
    if (!trig || items.length === 0) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % items.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + items.length) % items.length); }
      else if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); accept(items[sel].key); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trig, items, sel]);

  const accept = (key: string) => {
    if (!trig) return;
    if (trig.kind === "command") { onCommand(key); return; }
    const before = value.slice(0, trig.start); const after = value.slice(caret);
    const next = `${before}@${key} ${after.replace(/^\s+/, "")}`;
    onPick(next, before.length + key.length + 2);
  };

  if (!trig || items.length === 0) return null;
  return (
    <div className="mention-pop" role="listbox">
      {items.map((it, i) => (
        <button key={it.key} role="option" aria-selected={i === sel} className={`mention-item ${i === sel ? "on" : ""}`} onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); accept(it.key); }}>
          <span className="mi-icon">{it.icon}</span>
          <span className="mi-label">{it.label}</span>
          <span className="mi-hint">{it.hint}</span>
          {it.tier === "god" && <span className="plan-badge god" style={{ marginLeft: "auto" }}>god</span>}
        </button>
      ))}
      <div className="mention-foot">↑↓ navigate · Tab/Enter select · Esc close · {trig.kind === "agent" ? `${agents.length} agents` : "commands"}</div>
    </div>
  );
}

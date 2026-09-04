"use client";

import { useMemo, useState , useEffect} from "react";
import type { Conversation, Project } from "./store";
import { useLang } from "@/lib/i18n";

export type Mode = "chat" | "agents" | "factory" | "studio" | "apps" | "gallery" | "providers";
export const MODES: { id: Mode; label: string; icon: string; blurb: string }[] = [
  { id: "chat", label: "Chat", icon: "💬", blurb: "One chat, every free model" },
  { id: "agents", label: "Agents", icon: "🤖", blurb: "Prime, Hermes, Metis + specialists" },
  { id: "factory", label: "Coding Factory", icon: "🏭", blurb: "Write, push, test on GitHub" },
  { id: "studio", label: "Studio", icon: "🎨", blurb: "Images, speech, video" },
  { id: "apps", label: "Apps", icon: "🧩", blurb: "100+ MCP connectors" },
  { id: "gallery", label: "Gallery", icon: "🗂️", blurb: "Community prompts & agent recipes" },
  { id: "providers", label: "Providers", icon: "🛰️", blurb: "AI mesh status & keys" },
];

export default function Sidebar({ convos, projects, activeId, activeProject, open, mode, onMode, appsCount, onOpen, onNew, onSelect, onDelete, onPin, onRename, onProject, onNewProject, onEditProject, onDeleteProject, onSettings, onClose }: {
  convos: Conversation[]; projects: Project[]; activeId: string | null; activeProject: string | null; open: boolean; mode: Mode; onMode: (m: Mode) => void; appsCount: number;
  onOpen: () => void; onNew: () => void; onSelect: (id: string) => void; onDelete: (id: string) => void; onPin: (id: string) => void; onRename: (id: string, t: string) => void;
  onProject: (id: string | null) => void; onNewProject: () => void; onEditProject: (id: string) => void; onDeleteProject: (id: string) => void; onSettings: () => void; onClose: () => void;
}) {
  const { t } = useLang();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return convos.filter((c) => (activeProject ? c.projectId === activeProject : true) && (!t || c.title.toLowerCase().includes(t) || c.messages.some((m) => m.content.toLowerCase().includes(t))));
  }, [convos, q, activeProject]);

  const groups = useMemo(() => {
    const now = Date.now(); const day = 86_400_000;
    const g: Record<string, Conversation[]> = { Pinned: [], Today: [], Yesterday: [], "Previous 7 days": [], "Previous 30 days": [], Older: [] };
    for (const c of filtered) {
      const age = now - c.updatedAt;
      const k = c.pinned ? "Pinned" : age < day ? "Today" : age < 2 * day ? "Yesterday" : age < 7 * day ? "Previous 7 days" : age < 30 * day ? "Previous 30 days" : "Older";
      g[k].push(c);
    }
    return Object.entries(g).filter(([, v]) => v.length);
  }, [filtered]);

  if (!open) return <button className="sb-toggle" onClick={onOpen} title="Open sidebar">☰</button>;

  return (
    <nav className="sidebar">
      <div className="sb-top">
        <button className="sb-new" onClick={onNew}>＋ New chat</button>
        <button className="ghost sb-close" onClick={onClose} title="Hide sidebar">⟨</button>
      </div>
      <div className="sb-nav">
        {MODES.map((m) => (
          <button key={m.id} className={`sb-navitem ${mode === m.id ? "active" : ""}`} onClick={() => onMode(m.id)}>
            <span className="sb-ico">{m.icon}</span>
            <span className="sb-navtext"><span>{t(`mode.${m.id}` as "mode.chat")}{m.id === "apps" && appsCount ? <span className="sb-count-pill">{appsCount}</span> : null}</span><small>{m.blurb}</small></span>
          </button>
        ))}
      </div>
      <input className="sb-search" placeholder="Search chats…" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="sb-section">
        <div className="sb-label">Projects <button className="link" onClick={onNewProject}>+ new</button></div>
        <button className={`sb-item ${activeProject === null ? "active" : ""}`} onClick={() => onProject(null)}>All chats</button>
        {projects.map((p) => (
          <div key={p.id} className={`sb-item sb-proj ${activeProject === p.id ? "active" : ""}`}>
            <button className="sb-item-main" onClick={() => onProject(p.id)}>📁 {p.name}<span className="sb-count">{convos.filter((c) => c.projectId === p.id).length}</span></button>
            <span className="sb-item-actions">
              <button title="Edit project" onClick={() => onEditProject(p.id)}>✎</button>
              <button title="Delete project" onClick={() => { if (confirm(`Delete project "${p.name}"? Chats are kept.`)) onDeleteProject(p.id); }}>🗑</button>
            </span>
          </div>
        ))}
      </div>

      <div className="sb-list">
        {groups.length === 0 && <div className="sb-empty">{q ? "No matches." : "No chats yet."}</div>}
        {groups.map(([label, list]) => (
          <div key={label} className="sb-section">
            <div className="sb-label">{label}</div>
            {list.map((c) => (
              <div key={c.id} className={`sb-item ${c.id === activeId ? "active" : ""}`}>
                {editing === c.id ? (
                  <input autoFocus className="sb-rename" value={draft} onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => { onRename(c.id, draft.trim() || c.title); setEditing(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }} />
                ) : (
                  <button className="sb-item-main" onClick={() => onSelect(c.id)} onDoubleClick={() => { setEditing(c.id); setDraft(c.title); }} title={c.title}>
                    {c.title}
                  </button>
                )}
                <span className="sb-item-actions">
                  <button title={c.pinned ? "Unpin" : "Pin"} onClick={() => onPin(c.id)}>{c.pinned ? "★" : "☆"}</button>
                  <button title="Rename" onClick={() => { setEditing(c.id); setDraft(c.title); }}>✎</button>
                  <button title="Delete" onClick={() => onDelete(c.id)}>🗑</button>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="sb-bottom">
        <AccountChip />
        <button className="sb-item sb-item-main" onClick={onSettings}>{t("sb.settings")}</button>
      </div>
    </nav>
  );
}

function AccountChip() {
  const { t } = useLang();
  const [acc, setAcc] = useState<{ name?: string; email?: string; phone?: string; avatar?: string; providers: string[]; admin?: boolean } | null | undefined>(undefined);
  useEffect(() => {
    fetch("/api/auth/session").then((r) => r.json()).then((j) => setAcc(j.account ?? null)).catch(() => setAcc(null));
  }, []);
  if (acc === undefined) return null;
  if (!acc) return <a className="sb-item" href="/login">{t("sb.signIn")}</a>;
  const label = acc.name || acc.email || acc.phone || "Account";
  return (
    <div className="sb-account" title={[acc.email, acc.phone, ...acc.providers].filter(Boolean).join(" · ")}>
      {acc.avatar ? <img src={acc.avatar} alt="" /> : <span className="av">{label[0]?.toUpperCase()}</span>}
      <span className="who">{label}{acc.admin && <span title="Admin — full access" style={{ marginLeft: 6, fontSize: 10, color: "var(--accent)" }}>ADMIN</span>}</span>
      {acc.admin && <a className="link" href="/admin">admin</a>}
      <button className="link" onClick={async () => { await fetch("/api/auth/session", { method: "DELETE" }); location.reload(); }}>{t("sb.signOut")}</button>
    </div>
  );
}

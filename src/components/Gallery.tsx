"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

export interface GalleryEntry { id: string; title: string; description: string; prompt: string; agents: string[]; tags: string[]; author: { name: string }; uses: number; likes: number; liked: boolean; mine: boolean }

export default function Gallery({ onUse }: { onUse: (prompt: string) => void }) {
  const { t } = useLang();
  const [items, setItems] = useState<GalleryEntry[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState(false);
  const [q, setQ] = useState(""); const [tag, setTag] = useState<string | null>(null); const [mine, setMine] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", prompt: "", agents: "", tags: "" });

  const load = async () => {
    const r = await fetch(`/api/gallery?q=${encodeURIComponent(q)}${tag ? `&tag=${tag}` : ""}${mine ? "&mine=1" : ""}`, { cache: "no-store" });
    if (r.ok) { const j = await r.json(); setItems(j.items); setTags(j.tags); }
  };
  useEffect(() => { const h = setTimeout(load, 200); return () => clearTimeout(h); }, [q, tag, mine]); // eslint-disable-line react-hooks/exhaustive-deps

  const use = async (i: GalleryEntry) => { fetch(`/api/gallery/${i.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "use" }) }); onUse(i.prompt); };
  const like = async (i: GalleryEntry) => { const r = await fetch(`/api/gallery/${i.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "like" }) }); const j = await r.json(); setItems((l) => l.map((x) => (x.id === i.id ? { ...x, likes: j.likes, liked: j.liked } : x))); };
  const del = async (i: GalleryEntry) => { await fetch(`/api/gallery/${i.id}`, { method: "DELETE" }); load(); };
  const publish = async () => {
    const r = await fetch("/api/gallery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) { setPublishing(false); setForm({ title: "", description: "", prompt: "", agents: "", tags: "" }); load(); }
  };

  return (
    <div className="gallery">
      <div className="gallery-head">
        <div><h2 style={{ margin: 0 }}>🗂️ {t("gallery.title")}</h2><p className="hint" style={{ margin: "4px 0 0", textAlign: "left" }}>{t("gallery.sub")}</p></div>
        <button className="send" onClick={() => setPublishing(true)}>+ {t("gallery.publish")}</button>
      </div>
      <div className="gallery-tools">
        <input className="agent-search" placeholder={t("gallery.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="mode-toggle"><button className={!mine ? "active" : ""} onClick={() => setMine(false)}>{t("gallery.all")}</button><button className={mine ? "active" : ""} onClick={() => setMine(true)}>{t("gallery.mine")}</button></div>
      </div>
      <div className="gallery-tags">{(allTags ? tags : tags.slice(0, 24)).map((x) => <button key={x} className={`chip ${tag === x ? "on" : ""}`} onClick={() => setTag(tag === x ? null : x)}>#{x}</button>)}{tags.length > 24 && <button className="chip" onClick={() => setAllTags((v) => !v)}>{allTags ? "less ▲" : `+${tags.length - 24} more`}</button>}</div>
      {publishing && (
        <div className="gallery-form">
          <h3 style={{ margin: 0 }}>{t("gallery.publishTitle")}</h3>
          <input placeholder={t("gallery.name")} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input placeholder={t("gallery.desc")} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <textarea rows={5} placeholder={t("gallery.prompt")} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
          <input placeholder={t("gallery.agents")} value={form.agents} onChange={(e) => setForm({ ...form, agents: e.target.value })} />
          <input placeholder={t("gallery.tags")} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button className="link" onClick={() => setPublishing(false)}>{t("gallery.cancel")}</button><button className="send" disabled={!form.title.trim() || !form.prompt.trim()} onClick={publish}>{t("gallery.submit")}</button></div>
        </div>
      )}
      {items.length === 0 && <div className="sb-empty">{t("gallery.empty")}</div>}
      <div className="gallery-grid">
        {items.map((i) => (
          <div key={i.id} className="gcard">
            <div className="gcard-top"><b>{i.title}</b>{i.mine && <button className="link" onClick={() => del(i)}>✕</button>}</div>
            <div className="hint" style={{ margin: 0, textAlign: "left" }}>{i.description}</div>
            <pre className="gcard-prompt">{i.prompt}</pre>
            <div className="gcard-meta">
              {i.agents.map((a) => <span key={a} className="meta">@{a}</span>)}{i.tags.map((x) => <span key={x} className="meta">#{x}</span>)}
            </div>
            <div className="gcard-foot">
              <span className="meta">{t("gallery.by")} {i.author.name} · {i.uses} {t("gallery.uses")}</span>
              <span style={{ flex: 1 }} />
              <button className={`chip ${i.liked ? "on" : ""}`} onClick={() => like(i)}>♥ {i.likes}</button>
              <button className="send" onClick={() => use(i)}>{t("gallery.use")} →</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

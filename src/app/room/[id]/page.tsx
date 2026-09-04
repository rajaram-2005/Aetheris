"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { renderMarkdown } from "@/components/markdown";
import { t } from "@/lib/i18n";

interface Author { uid: string; name: string; color: string }
interface Msg { id: string; role: "user" | "assistant" | "system"; content: string; author?: Author; provider?: string; model?: string; at: number; streaming?: boolean }
interface Participant extends Author { lastSeen: number }

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const [title, setTitle] = useState("Room");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [people, setPeople] = useState<Participant[]>([]);
  const [me, setMe] = useState<Participant | null>(null);
  const [name, setName] = useState("");
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const seq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const apply = useCallback((ev: { seq: number; type: string; data: unknown }) => {
    if (ev.seq <= seq.current) return; seq.current = ev.seq;
    if (ev.type === "message") { const m = ev.data as Msg; setMsgs((l) => (l.some((x) => x.id === m.id) ? l.map((x) => (x.id === m.id ? { ...m, streaming: false } : x)) : [...l, m])); }
    else if (ev.type === "delta") { const d = ev.data as { id: string; text: string }; setMsgs((l) => (l.some((x) => x.id === d.id) ? l.map((x) => (x.id === d.id ? { ...x, content: x.content + d.text } : x)) : [...l, { id: d.id, role: "assistant", content: d.text, at: Date.now(), streaming: true }])); }
    else if (ev.type === "presence") setPeople(ev.data as Participant[]);
  }, []);

  // initial load + presence heartbeat
  useEffect(() => {
    const saved = localStorage.getItem("aetheris.room.name") ?? "";
    setName(saved);
    let stop = false;
    const load = async () => {
      const r = await fetch(`/api/rooms/${id}${saved ? `?name=${encodeURIComponent(saved)}` : ""}`, { cache: "no-store" });
      if (!r.ok) { setErr(t("room.notFound")); return; }
      const j = await r.json();
      if (stop) return;
      setTitle(j.title); setMsgs(j.messages); setPeople(j.participants); setMe(j.me); seq.current = j.seq;
    };
    load();
    const hb = setInterval(() => fetch(`/api/rooms/${id}`).then((r) => r.json()).then((j) => setPeople(j.participants)).catch(() => undefined), 25_000);
    return () => { stop = true; clearInterval(hb); };
  }, [id]);

  // live events: SSE with polling fallback
  useEffect(() => {
    let es: EventSource | null = null; let poll: ReturnType<typeof setInterval> | null = null; let dead = false;
    const startPoll = () => { if (poll) return; poll = setInterval(async () => { try { const j = await fetch(`/api/rooms/${id}/events?poll=1&since=${seq.current}`).then((r) => r.json()); for (const ev of j.events ?? []) apply(ev); } catch { /* retry */ } }, 2000); };
    try {
      es = new EventSource(`/api/rooms/${id}/events?since=${seq.current}`);
      es.onopen = () => setLive(true);
      es.onmessage = (e) => apply(JSON.parse(e.data));
      es.onerror = () => { setLive(false); if (!dead) startPoll(); };
    } catch { startPoll(); }
    return () => { dead = true; es?.close(); if (poll) clearInterval(poll); };
  }, [id, apply]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [msgs]);

  const send = async (ai = true) => {
    const content = input.trim(); if (!content) return;
    setInput("");
    localStorage.setItem("aetheris.room.name", name);
    const r = await fetch(`/api/rooms/${id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, name: name || undefined, ai }) });
    if (!r.ok) setErr((await r.json()).error);
  };

  if (err) return <div className="login-wrap"><div className="login-card"><h1>{err}</h1><a className="send" href="/">Aetheris</a></div></div>;
  return (
    <div className="room">
      <header className="room-head">
        <a href="/" className="brand" style={{ textDecoration: "none" }}><span className="hero-orb" style={{ width: 22, height: 22, margin: 0, borderRadius: 7, display: "inline-block" }} /> <b>Aetheris</b></a>
        <h1>👥 {title}</h1>
        <div className="room-people" title={people.map((p) => p.name).join(", ")}>
          {people.map((p) => <span key={p.uid} className="av" style={{ background: p.color }} title={p.name}>{p.name[0]?.toUpperCase()}</span>)}
          <span className="hint" style={{ margin: 0 }}>{people.length} {t("room.online")} · <span className={`sync-dot ${live ? "on" : ""}`}>{live ? "● live" : "○ polling"}</span></span>
        </div>
        <button className="mesh-pill" onClick={() => { navigator.clipboard.writeText(location.href); }} title={t("room.copyLink")}>🔗 {t("room.invite")}</button>
      </header>
      <div ref={listRef} className="messages room-msgs">
        {msgs.length === 0 && <div className="upsell">{t("room.empty")}</div>}
        {msgs.map((m) => (
          <div key={m.id} className={`msg ${m.role === "assistant" ? "assistant" : m.role === "system" ? "assistant error" : "user"} ${m.author?.uid === me?.uid ? "" : "other"}`}>
            {m.role !== "user" && <div className="avatar" aria-hidden><span /></div>}
            {m.role === "user" && m.author && <span className="av" style={{ background: m.author.color }} title={m.author.name}>{m.author.name[0]?.toUpperCase()}</span>}
            <div className="msg-body">
              {m.role === "user" && <div className="meta" style={{ color: m.author?.color }}>{m.author?.name}</div>}
              {m.role === "assistant" ? <div className="bubble" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) + (m.streaming ? '<span class="caret"/>' : "") }} /> : <div className="bubble">{m.content}</div>}
              {m.provider && <div className="meta">{m.provider}{m.model ? ` · ${m.model}` : ""}</div>}
            </div>
          </div>
        ))}
      </div>
      <div className="composer room-composer">
        <input className="room-name" placeholder={t("room.yourName")} value={name} onChange={(e) => setName(e.target.value)} />
        <textarea rows={1} placeholder={t("room.placeholder")} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(!(e.altKey)); } }} />
        <button className="chip" title={t("room.asideTitle")} onClick={() => send(false)}>{t("room.aside")}</button>
        <button className="send" onClick={() => send(true)} disabled={!input.trim()}>{t("room.ask")}</button>
      </div>
    </div>
  );
}

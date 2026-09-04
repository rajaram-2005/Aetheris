"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface KbLite { id: string; name: string; description: string; docs: { id: string; name: string; kind: string; size: number; chars: number; chunks: number; pages?: number; addedAt: number }[]; totalChunks?: number; updatedAt: number }
interface Hit { score: number; doc: string; page?: number; section?: string; text: string }

const KIND_ICON: Record<string, string> = { pdf: "📕", docx: "📘", csv: "📊", tsv: "📊", md: "📝", markdown: "📝", txt: "📄", text: "📄", html: "🌐", url: "🔗", json: "🧾", py: "🐍", ts: "🟦", js: "🟨" };
const fmt = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n > 1000 ? `${(n / 1000).toFixed(0)}k` : String(n));

/** 📁 Docs — knowledge bases: upload documents, search them, and chat with citations. */
export default function Docs({ activeKb, onUseKb, onAsk }: { activeKb: string | null; onUseKb: (id: string | null, name?: string) => void; onAsk: (prompt: string) => void }) {
  const [kbs, setKbs] = useState<KbLite[]>([]);
  const [open, setOpen] = useState<KbLite | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [url, setUrl] = useState("");
  const [paste, setPaste] = useState("");
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => fetch("/api/kb").then((r) => r.json()).then((j) => setKbs(j.kbs ?? [])).catch(() => undefined), []);
  useEffect(() => { load(); }, [load]);
  const openKb = async (id: string) => { const j = await fetch(`/api/kb/${id}`).then((r) => r.json()); if (j.kb) { setOpen(j.kb); setHits(null); setQ(""); } };

  const create = async () => {
    if (!name.trim()) return; setBusy("create"); setErr(null);
    const j = await fetch("/api/kb", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then((r) => r.json());
    setBusy(null); if (j.kb) { setName(""); await load(); await openKb(j.kb.id); } else setErr(j.error);
  };
  const upload = async (files: FileList | File[]) => {
    if (!open || !files.length) return; setBusy("upload"); setErr(null);
    const fd = new FormData(); Array.from(files).forEach((f) => fd.append("files", f));
    const j = await fetch(`/api/kb/${open.id}/docs`, { method: "POST", body: fd }).then((r) => r.json());
    setBusy(null); if (j.kb) setOpen(j.kb); if (j.errors?.length) setErr(j.errors.map((e: { name: string; error: string }) => `${e.name}: ${e.error}`).join(" · ")); if (j.error) setErr(j.error); load();
  };
  const addJson = async (body: Record<string, string>) => {
    if (!open) return; setBusy("upload"); setErr(null);
    const j = await fetch(`/api/kb/${open.id}/docs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    setBusy(null); if (j.kb) setOpen(j.kb); if (j.errors?.length) setErr(j.errors.map((e: { name: string; error: string }) => `${e.name}: ${e.error}`).join(" · ")); if (j.error) setErr(j.error); setUrl(""); setPaste(""); load();
  };
  const removeDoc = async (docId: string) => { if (!open) return; const j = await fetch(`/api/kb/${open.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deleteDoc: docId }) }).then((r) => r.json()); if (j.kb) setOpen(j.kb); load(); };
  const removeKb = async () => { if (!open || !confirm(`Delete "${open.name}" and all its documents?`)) return; await fetch(`/api/kb/${open.id}`, { method: "DELETE" }); if (activeKb === open.id) onUseKb(null); setOpen(null); load(); };
  const runSearch = async () => { if (!open || !q.trim()) return; const j = await fetch(`/api/kb/${open.id}/search?q=${encodeURIComponent(q)}&k=8`).then((r) => r.json()); setHits(j.hits ?? []); };

  return (
    <div className="study docs">
      <div className="gallery-head">
        <div><h2 style={{ margin: 0 }}>📁 Chat with documents</h2><p className="hint" style={{ margin: "4px 0 0", textAlign: "left" }}>Upload PDFs, Word files, spreadsheets, notes or web pages into a knowledge base. Attach it to a chat and every answer is grounded in your documents with [D1]-style citations.</p></div>
        {open && <button className="send" onClick={() => setOpen(null)}>← All knowledge bases</button>}
      </div>
      {err && <div className="err-box">{err}</div>}

      {!open && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <input className="agent-search" placeholder="New knowledge base — e.g. Company policies, Semester 3 notes, Client contracts" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
            <button className="send" disabled={!name.trim() || busy === "create"} onClick={create}>Create</button>
          </div>
          <div className="study-grid">
            {kbs.length === 0 && <div className="empty"><div className="empty-icon">📁</div><h3>No knowledge bases yet</h3><p className="hint">Create one, drop in your files, then ask questions about them in chat.</p></div>}
            {kbs.map((k) => (
              <div key={k.id} className={`study-card ${activeKb === k.id ? "active" : ""}`} role="button" tabIndex={0} onClick={() => openKb(k.id)} onKeyDown={(e) => e.key === "Enter" && openKb(k.id)}>
                <div className="row" style={{ justifyContent: "space-between" }}><b>📁 {k.name}</b>{activeKb === k.id && <span className="chip on">attached to chat</span>}</div>
                <div className="hint" style={{ textAlign: "left", margin: 0 }}>{k.docs.length} document{k.docs.length === 1 ? "" : "s"} · {fmt(k.docs.reduce((n, d) => n + d.chars, 0))} chars</div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{k.docs.slice(0, 5).map((d) => <span key={d.id} className="meta">{KIND_ICON[d.kind] ?? "📄"} {d.name.length > 22 ? d.name.slice(0, 20) + "…" : d.name}</span>)}{k.docs.length > 5 && <span className="meta">+{k.docs.length - 5}</span>}</div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="chip" onClick={(e) => { e.stopPropagation(); onUseKb(activeKb === k.id ? null : k.id, k.name); }}>{activeKb === k.id ? "Detach" : "💬 Chat with it"}</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {open && (
        <div className="study-deck">
          <div className="study-summary">
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <h3 style={{ margin: 0 }}>📁 {open.name}</h3>
              <div className="row" style={{ gap: 6 }}>
                <button className={`chip ${activeKb === open.id ? "on" : ""}`} onClick={() => onUseKb(activeKb === open.id ? null : open.id, open.name)}>{activeKb === open.id ? "✓ Attached to chat — detach" : "💬 Chat with this knowledge base"}</button>
                <button className="chip" disabled={!open.docs.length} onClick={() => { onUseKb(open.id, open.name); onAsk(`Summarise the key points of every document in this knowledge base, one short paragraph each, with citations.`); }}>Summarise all</button>
                <button className="chip" onClick={removeKb}>Delete</button>
              </div>
            </div>
            <div className="study-kpis"><div><b>{open.docs.length}</b><span>documents</span></div><div><b>{open.totalChunks ?? open.docs.reduce((n, d) => n + d.chunks, 0)}</b><span>passages</span></div><div><b>{fmt(open.docs.reduce((n, d) => n + d.chars, 0))}</b><span>characters</span></div></div>
            <div className={`dropzone big ${drag ? "drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }} onClick={() => fileRef.current?.click()}>
              <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.csv,.tsv,.txt,.md,.markdown,.json,.html,.htm,.xml,.yaml,.yml,.log,.py,.js,.ts,.tsx,.java,.c,.cpp,.go,.rs,.rb,.php,.sql,.tex" onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
              {busy === "upload" ? "Parsing and indexing…" : <>Drop files here or click to choose — <b>PDF, DOCX, CSV, TXT, Markdown, HTML, JSON, code</b> · up to 25 MB each, 40 per knowledge base</>}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input className="agent-search" style={{ flex: 1, minWidth: 220 }} placeholder="Or add a web page: https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url && addJson({ url })} />
              <button className="chip" disabled={!/^https?:\/\//.test(url) || busy === "upload"} onClick={() => addJson({ url })}>Add page</button>
            </div>
            <details><summary className="meta" style={{ cursor: "pointer" }}>Paste text instead</summary>
              <textarea className="agent-search" rows={5} placeholder="Paste notes, an email thread, meeting minutes…" value={paste} onChange={(e) => setPaste(e.target.value)} />
              <button className="chip" disabled={!paste.trim() || busy === "upload"} onClick={() => addJson({ name: `pasted-${new Date().toISOString().slice(0, 10)}.txt`, text: paste })}>Add text</button>
            </details>
          </div>

          {open.docs.length > 0 && (
            <div className="study-summary">
              <div className="row" style={{ gap: 8 }}>
                <input className="agent-search" placeholder="Test retrieval: ask something and see which passages would be used…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()} />
                <button className="send" onClick={runSearch} disabled={!q.trim()}>Search</button>
                <button className="chip" disabled={!q.trim()} onClick={() => { onUseKb(open.id, open.name); onAsk(q); }}>Ask in chat</button>
              </div>
              {hits && (hits.length === 0 ? <div className="hint" style={{ textAlign: "left" }}>No matching passages. Try other words from the document.</div> : hits.map((h, i) => (
                <div key={i} className="kb-hit"><div className="meta">[D{i + 1}] {h.doc}{h.page ? ` · p.${h.page}` : ""}{h.section ? ` · § ${h.section}` : ""} · score {h.score}</div><div>{h.text.slice(0, 420)}{h.text.length > 420 ? "…" : ""}</div></div>
              )))}
            </div>
          )}

          <div className="study-cards">
            {open.docs.map((d) => (
              <div key={d.id} className="study-row" style={{ gridTemplateColumns: "36px minmax(0,1fr) auto auto" }}>
                <span style={{ fontSize: 20 }}>{KIND_ICON[d.kind] ?? "📄"}</span>
                <div className="study-row-main"><b>{d.name}</b><div className="hint" style={{ textAlign: "left", margin: 0 }}>{d.kind.toUpperCase()}{d.pages ? ` · ${d.pages} pages` : ""} · {fmt(d.chars)} chars · {d.chunks} passages · {new Date(d.addedAt).toLocaleDateString()}</div></div>
                <button className="link" onClick={() => { onUseKb(open.id, open.name); onAsk(`Summarise "${d.name}" in 5 bullet points with citations, then list 3 questions I should ask about it.`); }}>summarise</button>
                <button className="link" onClick={() => removeDoc(d.id)}>remove</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

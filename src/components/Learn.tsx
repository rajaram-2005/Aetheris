"use client";
import { useEffect, useMemo, useState } from "react";
import { renderMarkdown } from "@/components/markdown";

interface ConceptLite { id: string; term: string; group: string; short: string; analogy: string; whyItMatters: string; related: string[]; tryIt: string; misconception?: { myth: string; reality: string } }
interface ConceptFull extends ConceptLite { markdown: string }

/** 📚 Learn — the Explained-AI knowledge base inside the app (AI concepts + AI ethics). */
export default function Learn({ onTry }: { onTry: (prompt: string) => void }) {
  const [groups, setGroups] = useState<Record<string, string>>({});
  const [list, setList] = useState<ConceptLite[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<ConceptFull | null>(null);
  useEffect(() => { fetch("/api/concepts").then((r) => r.json()).then((j) => { setGroups(j.groups ?? {}); setList(j.concepts ?? []); }).catch(() => undefined); }, []);
  const open = (id: string) => fetch(`/api/concepts?id=${encodeURIComponent(id)}`).then((r) => r.json()).then(setSel).catch(() => undefined);
  const shown = useMemo(() => { const t = q.trim().toLowerCase(); return t ? list.filter((c) => [c.term, c.short, c.group].join(" ").toLowerCase().includes(t)) : list; }, [list, q]);
  const gids = Object.keys(groups);
  return (
    <div className="learn">
      <div className="gallery-head">
        <div><h2 style={{ margin: 0 }}>📚 Explained AI</h2><p className="hint" style={{ margin: "4px 0 0", textAlign: "left" }}>{list.length} plain-language concepts on how AI works, its limits, explainability and ethics — each with an analogy and a prompt to try.</p></div>
        <a className="send" href="/docs/concepts" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Open in docs ↗</a>
      </div>
      <input className="agent-search" placeholder="Search concepts… (hallucination, bias, RAG, DPDP)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="learn-body">
        <div className="learn-list">
          {gids.map((g) => { const items = shown.filter((c) => c.group === g); if (!items.length) return null; return (
            <div key={g} className="learn-group">
              <div className="agents-domain">{groups[g]}</div>
              {items.map((c) => <button key={c.id} className={`learn-item ${sel?.id === c.id ? "on" : ""}`} onClick={() => open(c.id)}><b>{c.term}</b><span>{c.short}</span></button>)}
            </div>); })}
        </div>
        <div className="learn-detail">
          {!sel ? <div className="empty"><div className="empty-icon">🔍</div><h3>Pick a concept</h3><p className="hint">Or press <b>explain</b> under any answer to see these ideas applied to it.</p></div> : (
            <>
              <div className="hint" style={{ textAlign: "left", margin: 0 }}>{groups[sel.group]}</div>
              <h2 style={{ margin: "4px 0 10px" }}>{sel.term}</h2>
              <div className="bubble docs-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(sel.markdown) }} />
              <div className="row" style={{ marginTop: 12, gap: 8 }}>
                <button className="send" onClick={() => onTry(sel.tryIt)}>Try it in chat →</button>
                {sel.related.map((r) => <button key={r} className="chip" onClick={() => open(r)}>{list.find((c) => c.id === r)?.term ?? r}</button>)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

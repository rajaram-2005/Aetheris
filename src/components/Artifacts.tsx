"use client";

import { useEffect, useMemo, useState } from "react";
import { renderMarkdown } from "./markdown";

export interface Artifact { id: string; title: string; lang: string; code: string; messageId: string }

const FENCE = /```([a-zA-Z0-9_+-]*)[^\n]*?title="([^"\n]+)"[^\n]*\n([\s\S]*?)```/g;

/** Extract titled fenced blocks from assistant text. */
export function extractArtifacts(text: string, messageId: string): Artifact[] {
  const out: Artifact[] = [];
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = FENCE.exec(text))) {
    out.push({ id: `${messageId}:${i++}`, title: m[2], lang: (m[1] || "text").toLowerCase(), code: m[3].replace(/\n$/, ""), messageId });
  }
  return out;
}

/** Replace titled fences in the message body with a compact card marker rendered by Chat. */
export function stripArtifacts(text: string): string {
  return text.replace(FENCE, (_m, lang: string, title: string) => `\n> 📎 **${title}** (${lang || "text"}) — open in Artifacts\n`);
}

type View = "preview" | "code";

function previewKind(a: Artifact): "html" | "svg" | "react" | "mermaid" | "markdown" | "none" {
  const l = a.lang;
  if (l === "html" || l === "htm") return "html";
  if (l === "svg") return "svg";
  if (l === "jsx" || l === "tsx" || l === "react") return "react";
  if (l === "mermaid") return "mermaid";
  if (l === "md" || l === "markdown") return "markdown";
  if (l === "xml" && /^\s*<svg/i.test(a.code)) return "svg";
  return "none";
}

function srcDoc(a: Artifact, kind: ReturnType<typeof previewKind>): string {
  const base = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,sans-serif;margin:16px;color:#111;background:#fff}</style>`;
  if (kind === "html") return /<html[\s>]/i.test(a.code) ? a.code : `<!doctype html><html><head>${base}</head><body>${a.code}</body></html>`;
  if (kind === "svg") return `<!doctype html><html><head>${base}</head><body style="display:grid;place-items:center;min-height:90vh">${a.code}</body></html>`;
  if (kind === "mermaid") return `<!doctype html><html><head>${base}<script type="module">import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";mermaid.initialize({startOnLoad:true,theme:"neutral"});</script></head><body><pre class="mermaid">${a.code.replace(/</g, "&lt;")}</pre></body></html>`;
  if (kind === "react") {
    // Babel-in-browser: the component must be the default export or the last declared function/const.
    const code = a.code.replace(/^\s*import[^\n]*$/gm, "").replace(/export\s+default\s+/g, "const __Default = ").replace(/export\s+(const|function|class)\s+/g, "$1 ");
    return `<!doctype html><html><head>${base}
<script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script src="https://cdn.tailwindcss.com"></script></head><body><div id="root"></div>
<script type="text/babel" data-presets="react,typescript" data-type="module">
const {useState,useEffect,useMemo,useRef,useCallback,useReducer,Fragment}=React;
${code}
const __C = (typeof __Default!=="undefined"&&__Default) || (typeof App!=="undefined"&&App) || (typeof Component!=="undefined"&&Component);
if(!__C){document.getElementById("root").innerHTML="<p style='color:#b00'>No default export / App component found.</p>";}
else ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(__C));
</script></body></html>`;
  }
  return "";
}

const EXT: Record<string, string> = { html: "html", htm: "html", svg: "svg", jsx: "jsx", tsx: "tsx", react: "jsx", mermaid: "mmd", md: "md", markdown: "md", python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts", json: "json", css: "css", java: "java", go: "go", rust: "rs", rs: "rs", sh: "sh", bash: "sh", sql: "sql", yaml: "yml", yml: "yml", c: "c", cpp: "cpp", csv: "csv", text: "txt" };

export default function ArtifactsPanel({ artifacts, activeId, onSelect, onClose, onChange }: {
  artifacts: Artifact[]; activeId: string | null; onSelect: (id: string) => void; onClose: () => void; onChange: (id: string, code: string) => void;
}) {
  const a = artifacts.find((x) => x.id === activeId) ?? artifacts[artifacts.length - 1];
  const kind = a ? previewKind(a) : "none";
  const [view, setView] = useState<View>(kind === "none" ? "code" : "preview");
  const [copied, setCopied] = useState(false);
  useEffect(() => { setView(kind === "none" ? "code" : "preview"); }, [a?.id, kind]);
  const doc = useMemo(() => (a && kind !== "none" && kind !== "markdown" ? srcDoc(a, kind) : ""), [a, kind]);
  if (!a) return null;

  const download = () => {
    const ext = EXT[a.lang] ?? "txt";
    const name = /\.[a-z0-9]+$/i.test(a.title) ? a.title : `${a.title.replace(/[^\w.-]+/g, "_")}.${ext}`;
    const blob = new Blob([a.code], { type: "text/plain" });
    const u = URL.createObjectURL(blob);
    const el = document.createElement("a"); el.href = u; el.download = name; el.click();
    URL.revokeObjectURL(u);
  };
  const copy = async () => { await navigator.clipboard.writeText(a.code); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  const openTab = () => { const w = window.open("", "_blank"); if (w) { w.document.open(); w.document.write(doc); w.document.close(); } };

  return (
    <aside className="artifacts">
      <div className="art-head">
        <select value={a.id} onChange={(e) => onSelect(e.target.value)} className="art-select" title="Artifacts in this chat">
          {artifacts.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
        </select>
        <div className="art-tabs">
          {kind !== "none" && <button className={view === "preview" ? "active" : ""} onClick={() => setView("preview")}>Preview</button>}
          <button className={view === "code" ? "active" : ""} onClick={() => setView("code")}>Code</button>
        </div>
        <div className="art-actions">
          <button className="ghost" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          <button className="ghost" onClick={download}>Download</button>
          {doc && <button className="ghost" onClick={openTab}>↗</button>}
          <button className="ghost" onClick={onClose} title="Close">✕</button>
        </div>
      </div>
      <div className="art-body">
        {view === "preview" && kind === "markdown" && <div className="bubble-md art-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.code) }} />}
        {view === "preview" && doc && <iframe key={a.id + a.code.length} className="art-frame" sandbox="allow-scripts allow-popups allow-forms allow-modals" srcDoc={doc} title={a.title} />}
        {view === "code" && (
          <textarea className="art-code" spellCheck={false} value={a.code} onChange={(e) => onChange(a.id, e.target.value)} />
        )}
      </div>
      <div className="art-foot"><span className="tag">{a.lang}</span> <span>{a.code.split("\n").length} lines</span>{view === "code" && <span> · edits update the preview</span>}</div>
    </aside>
  );
}

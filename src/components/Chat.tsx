"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MeshPanel, { type ProviderStatus } from "./MeshPanel";
import { renderMarkdown } from "./markdown";

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  provider?: string;
  model?: string;
  latencyMs?: number;
  failovers?: number;
}

interface Attempt { provider: string; ok: boolean; error?: string }

interface MeshSummary { total: number; configured: number; ready: number; providers: ProviderStatus[] }

const SUGGESTIONS = [
  "Explain how load balancing across AI providers works",
  "Write a Python script that fetches GitHub Actions logs",
  "Draft a WhatsApp message announcing a product launch",
  "What is the Model Context Protocol?",
];

const STORAGE_KEY = "aetheris.chat.v1";

export default function Chat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mesh, setMesh] = useState<MeshSummary | null>(null);
  const [showMesh, setShowMesh] = useState(false);
  const [preferred, setPreferred] = useState<string | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Persist conversation locally
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-100))); } catch { /* ignore */ }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const refreshMesh = useCallback(async () => {
    try {
      const r = await fetch("/api/providers", { cache: "no-store" });
      if (r.ok) setMesh(await r.json());
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    refreshMesh();
    const t = setInterval(refreshMesh, 20_000);
    return () => clearInterval(t);
  }, [refreshMesh]);

  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    const userMsg: UiMessage = { id: crypto.randomUUID(), role: "user", content };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setBusy(true);
    if (taRef.current) taRef.current.style.height = "auto";

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.filter((m) => !m.error).map(({ role, content }) => ({ role, content })),
          preferred,
        }),
        signal: controller.signal,
      });
      const data = await r.json();
      if (!r.ok) {
        const attempts: Attempt[] = data.attempts ?? [];
        const detail = attempts.length
          ? "\n\n" + attempts.map((a) => `• ${a.provider}: ${a.error ?? "failed"}`).join("\n")
          : "";
        setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", error: true, content: `${data.error ?? "Request failed"}${detail}` }]);
      } else {
        const failovers = (data.attempts ?? []).filter((a: Attempt) => !a.ok).length;
        setMessages((m) => [...m, {
          id: crypto.randomUUID(), role: "assistant", content: data.content,
          provider: data.provider, model: data.model, latencyMs: data.latencyMs, failovers,
        }]);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", error: true, content: "Network error reaching Aetheris." }]);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      refreshMesh();
    }
  }, [input, busy, messages, preferred, refreshMesh]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };
  const autoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
  };

  const meshDot = !mesh ? "" : mesh.configured === 0 ? "err" : mesh.ready === 0 ? "warn" : "ok";
  const meshLabel = !mesh ? "mesh…" : `${mesh.ready}/${mesh.configured} ready · ${mesh.total} in mesh`;
  const preferredName = mesh?.providers.find((p) => p.id === preferred)?.name;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>Aetheris One</h1>
          <span>omni-router</span>
        </div>
        <button className="mesh-pill" onClick={() => setShowMesh((s) => !s)} title="Provider mesh status">
          <span className={`dot ${meshDot}`} />
          {meshLabel}{preferredName ? ` · via ${preferredName}` : ""}
        </button>
      </header>

      <div ref={listRef} className="messages">
        {showMesh && mesh && (
          <MeshPanel providers={mesh.providers} preferred={preferred} onSelect={(id) => setPreferred(id === preferred ? undefined : id)} />
        )}
        {messages.length === 0 && !busy ? (
          <div className="empty">
            <h2>One chat. Every free model.</h2>
            <p>Your prompt is routed across a mesh of free AI providers. If one is rate-limited, Aetheris silently fails over to the next.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`msg ${m.role} ${m.error ? "error" : ""}`}>
              {m.role === "assistant" && !m.error
                ? <div className="bubble" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                : <div className="bubble">{m.content}</div>}
              {m.provider && (
                <div className="meta-line">
                  <span className="via">via {m.provider}</span>
                  <span>{m.model}</span>
                  <span>{m.latencyMs} ms</span>
                  {m.failovers ? <span className="failover">↻ {m.failovers} failover{m.failovers > 1 ? "s" : ""}</span> : null}
                </div>
              )}
            </div>
          ))
        )}
        {busy && (
          <div className="msg assistant">
            <div className="bubble"><span className="typing"><i /><i /><i /></span></div>
          </div>
        )}
      </div>

      <div className="composer">
        <div className="composer-box">
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            placeholder="Ask anything…"
            onChange={autoGrow}
            onKeyDown={onKey}
            disabled={busy}
          />
          {busy ? (
            <button className="ghost" onClick={() => abortRef.current?.abort()}>Stop</button>
          ) : (
            <>
              {messages.length > 0 && (
                <button className="ghost" title="New chat" onClick={() => setMessages([])}>New</button>
              )}
              <button className="send" onClick={() => send()} disabled={!input.trim()}>Send</button>
            </>
          )}
        </div>
        <div className="hint">Enter to send · Shift+Enter for newline · Click the mesh pill to pin a provider</div>
      </div>
    </div>
  );
}

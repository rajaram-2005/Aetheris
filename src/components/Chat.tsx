"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MeshPanel, { type ProviderStatus } from "./MeshPanel";
import { renderMarkdown } from "./markdown";
import GitHubAuth, { useGitHubAuth } from "./GitHubAuth";
import FactoryRun, { emptyFactoryState, type FactoryState, type StepId } from "./FactoryRun";

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  factory?: FactoryState;
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

const FACTORY_SUGGESTIONS = [
  "A Python function that validates Indian UPI IDs, with tests",
  "A Node module that parses ISO-8601 durations into seconds",
  "A Java class implementing an LRU cache with JUnit tests",
  "A Python CLI that converts CSV to JSON with edge-case tests",
];

const STORAGE_KEY = "aetheris.chat.v1";

export default function Chat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mesh, setMesh] = useState<MeshSummary | null>(null);
  const [showMesh, setShowMesh] = useState(false);
  const [preferred, setPreferred] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<"chat" | "factory">("chat");
  const auth = useGitHubAuth();
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

  const runFactory = useCallback(async (task: string) => {
    const userMsg: UiMessage = { id: crypto.randomUUID(), role: "user", content: task };
    const fid = crypto.randomUUID();
    const patch = (fn: (f: FactoryState) => FactoryState) =>
      setMessages((m) => m.map((x) => (x.id === fid && x.factory ? { ...x, factory: fn(x.factory) } : x)));

    setMessages((m) => [...m, userMsg, { id: fid, role: "assistant", content: "", factory: emptyFactoryState(task) }]);
    setInput("");
    setBusy(true);
    if (taRef.current) taRef.current.style.height = "auto";
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const r = await fetch("/api/factory/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, preferred }),
        signal: controller.signal,
      });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        patch((f) => ({ ...f, error: j.error ?? `Request failed (${r.status})` }));
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "step") {
            patch((f) => ({
              ...f,
              files: (ev.data?.files as string[] | undefined) ?? f.files,
              steps: { ...f.steps, [ev.step as StepId]: { status: ev.status, detail: ev.detail, url: ev.data?.url } },
            }));
          } else if (ev.type === "result") {
            patch((f) => ({ ...f, result: ev }));
          } else if (ev.type === "error") {
            patch((f) => ({ ...f, error: ev.message }));
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") patch((f) => ({ ...f, error: "Connection to Aetheris lost." }));
    } finally {
      setBusy(false);
      abortRef.current = null;
      refreshMesh();
    }
  }, [preferred, refreshMesh]);

  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    if (mode === "factory") return runFactory(content);
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
          messages: history.filter((m) => !m.error && !m.factory).map(({ role, content }) => ({ role, content })),
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
  }, [input, busy, messages, preferred, refreshMesh, mode, runFactory]);

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
        <div className="header-right">
          <div className="mode-toggle" role="tablist">
            <button className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")}>Chat</button>
            <button className={mode === "factory" ? "active" : ""} onClick={() => setMode("factory")}>Factory</button>
          </div>
          <button className="mesh-pill" onClick={() => setShowMesh((s) => !s)} title="Provider mesh status">
            <span className={`dot ${meshDot}`} />
            {meshLabel}{preferredName ? ` · via ${preferredName}` : ""}
          </button>
        </div>
      </header>

      <div ref={listRef} className="messages">
        {showMesh && mesh && (
          <MeshPanel providers={mesh.providers} preferred={preferred} onSelect={(id) => setPreferred(id === preferred ? undefined : id)} />
        )}
        {mode === "factory" && (
          <div className="factory-bar">
            <div>
              <strong>Cloud Coding Factory</strong>
              <span> — describe a program; Aetheris writes it, pushes it to a private <code>aetheris-factory</code> repo, runs the tests on GitHub Actions, and reports back.</span>
            </div>
            <GitHubAuth auth={auth} />
          </div>
        )}
        {messages.length === 0 && !busy ? (
          <div className="empty">
            {mode === "chat" ? (
              <>
                <h2>One chat. Every free model.</h2>
                <p>Your prompt is routed across a mesh of free AI providers. If one is rate-limited, Aetheris silently fails over to the next.</p>
                <div className="suggestions">
                  {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
                </div>
              </>
            ) : (
              <>
                <h2>Code that runs in the cloud.</h2>
                <p>{auth.user ? "What should the factory build?" : "Connect GitHub above to start a run."}</p>
                <div className="suggestions">
                  {FACTORY_SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} disabled={!auth.user}>{s}</button>)}
                </div>
              </>
            )}
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`msg ${m.role} ${m.error ? "error" : ""}`}>
              {m.factory
                ? <div className="bubble"><FactoryRun state={m.factory} /></div>
                : m.role === "assistant" && !m.error
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
        {busy && mode === "chat" && (
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
            placeholder={mode === "factory" ? (auth.user ? "Describe the program to build and test…" : "Connect GitHub to use the factory") : "Ask anything…"}
            onChange={autoGrow}
            onKeyDown={onKey}
            disabled={busy || (mode === "factory" && !auth.user)}
          />
          {busy ? (
            <button className="ghost" onClick={() => abortRef.current?.abort()}>Stop</button>
          ) : (
            <>
              {messages.length > 0 && (
                <button className="ghost" title="New chat" onClick={() => setMessages([])}>New</button>
              )}
              <button className="send" onClick={() => send()} disabled={!input.trim() || (mode === "factory" && !auth.user)}>{mode === "factory" ? "Build" : "Send"}</button>
            </>
          )}
        </div>
        <div className="hint">Enter to send · Shift+Enter for newline · Click the mesh pill to pin a provider</div>
      </div>
    </div>
  );
}

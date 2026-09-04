"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MeshPanel, { type ProviderStatus } from "./MeshPanel";
import { renderMarkdown } from "./markdown";
import Gallery from "./Gallery";
import MentionPicker from "./MentionPicker";
import Workflows from "./Workflows";
import { useLang } from "@/lib/i18n";
import GitHubAuth, { useGitHubAuth } from "./GitHubAuth";
import FactoryRun, { emptyFactoryState, type StepId } from "./FactoryRun";
import Studio from "./Studio";
import Apps, { loadServers, type EnabledServer } from "./Apps";
import Upgrade, { useAccount } from "./Upgrade";
import Sidebar, { MODES, type Mode } from "./Sidebar";
import SettingsModal from "./SettingsModal";
import ProjectModal from "./ProjectModal";
import ArtifactsPanel, { extractArtifacts, stripArtifacts, type Artifact } from "./Artifacts";
import { ArenaPicker, ArenaResult, recordVote, type ArenaRun } from "./Arena";
import { RunOutput, runnableLang, useInterpreter, type RunResult } from "./Interpreter";
import { useVoice } from "./Voice";
import AgentsPage, { AgentTrail, MentionMenu, useAgents, type AgentRun } from "./Agents";
import { imageToDataUrl, markDeleted, titleFrom, useCloudSync, useConversations, useMemory, useProjects, useSettings, type Conversation, type Project, type UiMessage } from "./store";

interface Attempt { provider: string; ok: boolean; error?: string }
interface MeshSummary { total: number; configured: number; ready: number; providers: ProviderStatus[] }

const SUGGESTIONS = [
  "Build a landing page for a Chennai coffee roaster (HTML artifact)",
  "What changed in the latest Next.js release?",
  "Write a React counter component with Tailwind",
  "Draw a Mermaid diagram of an OAuth 2.1 PKCE flow",
];
/** Agent quick-starts shown on the empty chat screen (each is a forced @mention). */
const AGENT_STARTS: { agent: string; icon: string; label: string; prompt: string }[] = [
  { agent: "tutor", icon: "🎓", label: "Learn", prompt: "@tutor Explain how transformers work, at an undergraduate level, then quiz me" },
  { agent: "coder", icon: "👩‍💻", label: "Build", prompt: "@coder @reviewer Write a rate limiter middleware for Express in TypeScript, then review it" },
  { agent: "researcher", icon: "🔬", label: "Research", prompt: "@researcher What are the current free tiers for LLM APIs in 2026?" },
  { agent: "strategist", icon: "♟️", label: "Plan", prompt: "@strategist @marketer Go-to-market plan for a ₹200/month AI study assistant for Indian college students" },
  { agent: "career", icon: "🧭", label: "Career", prompt: "@career Rewrite my resume summary for a backend engineer role at a fintech" },
  { agent: "translator", icon: "🌐", label: "Translate", prompt: "@translator Translate to Tamil, formal register: 'Your subscription renews on the 5th of every month.'" },
];
const FACTORY_SUGGESTIONS = [
  "A Python function that validates Indian UPI IDs, with tests",
  "A Node module that parses ISO-8601 durations into seconds",
  "A Java class implementing an LRU cache with JUnit tests",
  "A Python CLI that converts CSV to JSON with edge-case tests",
];

function codeBlocks(text: string): { lang: "python" | "javascript"; code: string }[] {
  const out: { lang: "python" | "javascript"; code: string }[] = [];
  const re = /```([\w+-]*)[^\n]*\n([\s\S]*?)```/g; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { const lang = runnableLang(m[1] || ""); if (lang && m[2].trim().split("\n").length >= 1) out.push({ lang, code: m[2] }); }
  return out;
}

async function* sse(r: Response) {
  const reader = r.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (line) { try { yield JSON.parse(line.slice(6)); } catch { /* ignore */ } }
    }
  }
}

export default function Chat() {
  // ---- persistence ------------------------------------------------------------------------
  const { convos, loaded, upsert, remove, clearAll, setConvos } = useConversations();
  const { projects, upsert: saveProject, remove: removeProject } = useProjects();
  const { memory, add: addMemory, remove: forget, clear: clearMemory } = useMemory();
  const { settings, update: updateSettings } = useSettings();
  const sync = useCloudSync({ convos, setConvos, projects, upsertProject: saveProject, memory, addMemory, settings, updateSettings, loaded });
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const { t } = useLang();
  const [caret, setCaret] = useState(0);
  const [pickerOff, setPickerOff] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const active = convos.find((c) => c.id === activeId) ?? null;
  const messages = useMemo(() => active?.messages ?? [], [active]);
  const project: Project | null = projects.find((p) => p.id === (active?.projectId ?? activeProject)) ?? null;

  // ---- ui state ----------------------------------------------------------------------------
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [mesh, setMesh] = useState<MeshSummary | null>(null);
  const [showMesh, setShowMesh] = useState(false);
  const [preferred, setPreferred] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<Mode>("chat");
  const [sidebar, setSidebar] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [editProject, setEditProject] = useState<Project | null | "new">(null);
  const [research, setResearch] = useState(false);
  const [webOverride, setWebOverride] = useState<"on" | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [arena, setArena] = useState(false);
  const [models, setModels] = useState<{ id: string; name: string; minPlan: string; available: boolean; description: string; agents: { max: number; parallel: boolean; critique: boolean } }[]>([]);
  const [direct, setDirect] = useState(false); // bypass agents for this model (quick chat)
  const [factoryRepo, setFactoryRepo] = useState("");
  const [model, setModel] = useState<string>("");
  const [showModels, setShowModels] = useState(false);
  const loadModels = useCallback(() => fetch("/api/models").then((r) => r.json()).then((j) => { setModels(j.models ?? []); setModel((m) => m || [...(j.models ?? [])].reverse().find((x: { available: boolean }) => x.available)?.id || "aetheris-free"); }).catch(() => undefined), []);
  useEffect(() => { loadModels(); }, [loadModels]);
  const agentList = useAgents();
  const [arenaPick, setArenaPick] = useState<string[]>([]);
  const [runs, setRuns] = useState<Record<string, RunResult | "running">>({});
  const [voiceMode, setVoiceMode] = useState(false);
  const [interim, setInterim] = useState("");
  const interp = useInterpreter();
  const auth = useGitHubAuth();
  const { account, refresh: refreshAccount } = useAccount();
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const [servers, setServers] = useState<EnabledServer[]>([]);
  useEffect(() => { setServers(loadServers()); if (window.innerWidth < 1000) setSidebar(false); }, []);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1000px)");
    const on = () => setNarrow(mq.matches);
    on(); mq.addEventListener("change", on); return () => mq.removeEventListener("change", on);
  }, []);
  const features = account?.features ?? [];
  useEffect(() => { loadModels(); }, [account?.planId, loadModels]);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: busy ? "auto" : "smooth" }); }, [messages, busy]);

  const artifacts: Artifact[] = useMemo(() => {
    const all = messages.filter((m) => m.role === "assistant" && !m.error).flatMap((m) => extractArtifacts(m.content, m.id));
    return all.map((a) => (edits[a.id] !== undefined ? { ...a, code: edits[a.id] } : a));
  }, [messages, edits]);
  useEffect(() => { if (artifacts.length && !busy) { const last = artifacts[artifacts.length - 1]; if (!artifactId || !artifacts.some((a) => a.id === artifactId)) setArtifactId(last.id); } }, [artifacts, busy, artifactId]);
  const prevCount = useRef(0);
  useEffect(() => { if (artifacts.length > prevCount.current && !busy) { setArtifactsOpen(true); setArtifactId(artifacts[artifacts.length - 1].id); } prevCount.current = artifacts.length; }, [artifacts, busy]);

  const refreshMesh = useCallback(async () => {
    try { const r = await fetch("/api/providers", { cache: "no-store" }); if (r.ok) setMesh(await r.json()); } catch { /* ignore */ }
  }, []);
  useEffect(() => { refreshMesh(); const t = setInterval(refreshMesh, 20_000); return () => clearInterval(t); }, [refreshMesh]);

  // ---- conversation helpers -----------------------------------------------------------------
  const convoRef = useRef<Conversation | null>(null);
  const commit = useCallback((c: Conversation) => { convoRef.current = c; upsert(c); }, [upsert]);
  const patchMsg = useCallback((convoId: string, msgId: string, fn: (m: UiMessage) => UiMessage) => {
    const cur = convoRef.current && convoRef.current.id === convoId ? convoRef.current : convos.find((c) => c.id === convoId);
    if (!cur) return;
    commit({ ...cur, updatedAt: Date.now(), messages: cur.messages.map((m) => (m.id === msgId ? fn(m) : m)) });
  }, [commit, convos]);

  const startConvo = (firstUser: UiMessage): Conversation => {
    const base = active ?? { id: crypto.randomUUID(), title: titleFrom(firstUser.content || "Image"), createdAt: Date.now(), updatedAt: Date.now(), projectId: activeProject ?? undefined, messages: [] };
    const c = { ...base, updatedAt: Date.now(), messages: [...base.messages, firstUser] };
    if (!active) setActiveId(c.id);
    commit(c);
    return c;
  };
  const newChat = () => { setActiveId(null); convoRef.current = null; setArtifactsOpen(false); setMode("chat"); taRef.current?.focus(); };

  // ---- factory ------------------------------------------------------------------------------
  const runFactory = useCallback(async (task: string) => {
    const c = startConvo({ id: crypto.randomUUID(), role: "user", content: task });
    const fid = crypto.randomUUID();
    commit({ ...c, messages: [...c.messages, { id: fid, role: "assistant", content: "", factory: emptyFactoryState(task) }] });
    const patch = (fn: (f: NonNullable<UiMessage["factory"]>) => NonNullable<UiMessage["factory"]>) => patchMsg(c.id, fid, (m) => (m.factory ? { ...m, factory: fn(m.factory) } : m));
    setInput(""); setBusy(true);
    if (taRef.current) taRef.current.style.height = "auto";
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const r = await fetch("/api/factory/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task, preferred, repo: factoryRepo.trim() || undefined }), signal: controller.signal });
      if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); patch((f) => ({ ...f, error: j.error ?? `Request failed (${r.status})` })); if (r.status === 402) { setUpgrade(j.error); refreshAccount(); } return; }
      for await (const ev of sse(r)) {
        if (ev.type === "step") patch((f) => ({ ...f, files: (ev.data?.files as string[] | undefined) ?? f.files, steps: { ...f.steps, [ev.step as StepId]: { status: ev.status, detail: ev.detail, url: ev.data?.url } } }));
        else if (ev.type === "result") patch((f) => ({ ...f, result: ev }));
        else if (ev.type === "error") patch((f) => ({ ...f, error: ev.message }));
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") patch((f) => ({ ...f, error: "Connection to Aetheris lost." }));
    } finally { setBusy(false); abortRef.current = null; refreshMesh(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferred, refreshMesh, active, activeProject, factoryRepo]);

  // ---- deep research ------------------------------------------------------------------------
  const runResearch = useCallback(async (topic: string) => {
    if (!settings.tavilyKey) { setShowSettings(true); return; }
    const c = startConvo({ id: crypto.randomUUID(), role: "user", content: `🔬 Deep Research: ${topic}` });
    const aid = crypto.randomUUID();
    commit({ ...c, messages: [...c.messages, { id: aid, role: "assistant", content: "", streaming: true, research: { questions: [], searched: 0, status: "Planning research…" } }] });
    setInput(""); setBusy(true);
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const r = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, searchKey: settings.tavilyKey, preferred }), signal: controller.signal });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        patchMsg(c.id, aid, (m) => ({ ...m, streaming: false, error: true, content: j.error ?? `Request failed (${r.status})` }));
        if (r.status === 402) { setUpgrade(j.error); refreshAccount(); }
        return;
      }
      for await (const ev of sse(r)) {
        if (ev.type === "plan") patchMsg(c.id, aid, (m) => ({ ...m, research: { ...m.research!, questions: ev.questions, status: `Searching ${ev.questions.length} angles…` } }));
        else if (ev.type === "search") patchMsg(c.id, aid, (m) => ({ ...m, research: { ...m.research!, searched: m.research!.searched + 1, status: `Read ${ev.count} sources for “${ev.question}”` } }));
        else if (ev.type === "notes") patchMsg(c.id, aid, (m) => ({ ...m, research: { ...m.research!, status: `Taking notes (${ev.provider})…` } }));
        else if (ev.type === "writing") patchMsg(c.id, aid, (m) => ({ ...m, research: { ...m.research!, status: "Writing report…" } }));
        else if (ev.type === "delta") patchMsg(c.id, aid, (m) => ({ ...m, content: m.content + ev.text }));
        else if (ev.type === "done") patchMsg(c.id, aid, (m) => ({ ...m, content: ev.report, streaming: false, provider: ev.provider, model: ev.model, latencyMs: ev.durationMs, sources: ev.sources, research: { ...m.research!, status: `Done · ${ev.sources.length} sources`, done: true } }));
        else if (ev.type === "error") patchMsg(c.id, aid, (m) => ({ ...m, streaming: false, error: !m.content, content: m.content || ev.error, research: { ...m.research!, status: `Error: ${ev.error}` } }));
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") patchMsg(c.id, aid, (m) => ({ ...m, streaming: false, error: true, content: "Connection to Aetheris lost." }));
    } finally { setBusy(false); abortRef.current = null; refreshMesh(); refreshAccount(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.tavilyKey, preferred, active, activeProject]);

  // ---- debate (/debate <motion>) --------------------------------------------------------------
  const runDebate = useCallback(async (motion: string) => {
    const c = startConvo({ id: crypto.randomUUID(), role: "user", content: `🥊 Debate: ${motion}` });
    const aid = crypto.randomUUID();
    commit({ ...c, messages: [...c.messages, { id: aid, role: "assistant", content: "", streaming: true }] });
    setInput(""); setBusy(true);
    const controller = new AbortController(); abortRef.current = controller;
    let current = ""; // heading of the turn being streamed
    try {
      const r = await fetch("/api/debate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motion, model }), signal: controller.signal });
      if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); patchMsg(c.id, aid, (m) => ({ ...m, streaming: false, error: true, content: j.error ?? `Request failed (${r.status})` })); return; }
      for await (const ev of sse(r)) {
        if (ev.type === "turn") { current = ev.side === "judge" ? `\n\n---\n\n### 🦉 Metis — verdict\n\n` : `\n\n### ${ev.icon} ${ev.name} · ${ev.side === "pro" ? "FOR" : "AGAINST"} · round ${ev.round}\n\n`; patchMsg(c.id, aid, (m) => ({ ...m, content: m.content + current })); }
        else if (ev.type === "delta") patchMsg(c.id, aid, (m) => ({ ...m, content: m.content + ev.text }));
        else if (ev.type === "verdict") patchMsg(c.id, aid, (m) => ({ ...m, provider: ev.provider }));
        else if (ev.type === "done") patchMsg(c.id, aid, (m) => ({ ...m, streaming: false }));
        else if (ev.type === "error") patchMsg(c.id, aid, (m) => ({ ...m, streaming: false, error: !m.content, content: m.content || ev.error }));
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") patchMsg(c.id, aid, (m) => ({ ...m, streaming: false, error: true, content: "Connection to Aetheris lost." }));
    } finally { setBusy(false); abortRef.current = null; refreshMesh(); refreshAccount(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, active, activeProject]);

  // ---- agents (Prime → specialists → Metis) ---------------------------------------------------
  const runAgents = useCallback(async (content: string, imgs: string[]) => {
    const userMsg: UiMessage = { id: crypto.randomUUID(), role: "user", content, images: imgs.length ? imgs : undefined };
    const c = startConvo(userMsg);
    const aid = crypto.randomUUID();
    commit({ ...c, messages: [...c.messages, { id: aid, role: "assistant", content: "", streaming: true, agentRun: { mode: "single", steps: [], reason: "Prime is planning…" } }] });
    setInput(""); setImages([]); setBusy(true);
    if (taRef.current) taRef.current.style.height = "auto";
    const controller = new AbortController(); abortRef.current = controller;
    const history = c.messages.filter((m) => !m.error && !m.factory && !m.arena).map(({ role, content, images }) => ({ role, content, images }));
    const patchRun = (fn: (r: AgentRun) => AgentRun) => patchMsg(c.id, aid, (m) => ({ ...m, agentRun: fn(m.agentRun ?? { mode: "single", steps: [] }) }));
    try {
      const r = await fetch("/api/agents/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, preferred, servers, model, searchKey: settings.tavilyKey || undefined, project: project ? { instructions: project.instructions, files: project.files } : null, memory: settings.memoryEnabled ? memory : [] }),
        signal: controller.signal,
      });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        patchMsg(c.id, aid, (m) => ({ ...m, streaming: false, error: true, content: j.error ?? `Request failed (${r.status})` }));
        if (r.status === 402) { setUpgrade(j.error); refreshAccount(); }
        return;
      }
      let live = ""; // text streamed by the currently running specialist (shown until final)
      let finalStarted = false;
      for await (const ev of sse(r)) {
        if (ev.type === "plan") patchRun((x) => ({ ...x, mode: ev.plan.mode, reason: ev.plan.reason, steps: ev.plan.agents.map((a: string, i: number) => ({ agent: a, brief: ev.plan.briefs[i] ?? "", status: "running" as const })) }));
        else if (ev.type === "agent_start") { live = ""; patchRun((x) => ({ ...x, steps: x.steps.map((st, i) => (i === ev.index ? { ...st, status: "running" } : st)) })); }
        else if (ev.type === "agent_delta") { if (!finalStarted) { live += ev.text; patchMsg(c.id, aid, (m) => ({ ...m, content: live })); } }
        else if (ev.type === "agent_done") patchRun((x) => ({ ...x, steps: x.steps.map((st) => (st.agent === ev.agent && st.status === "running" ? { ...st, status: "done", provider: ev.provider } : st)) }));
        else if (ev.type === "agent_error") patchRun((x) => ({ ...x, steps: x.steps.map((st) => (st.agent === ev.agent ? { ...st, status: "error", error: ev.error } : st)) }));
        else if (ev.type === "tool") patchMsg(c.id, aid, (m) => ({ ...m, toolEvents: [...(m.toolEvents ?? []), ev.event] }));
        else if (ev.type === "synthesis") { finalStarted = true; live = ""; patchMsg(c.id, aid, (m) => ({ ...m, content: "" })); patchRun((x) => ({ ...x, synthesising: true })); }
        else if (ev.type === "delta") {
          if (finalStarted) patchMsg(c.id, aid, (m) => ({ ...m, content: m.content + ev.text }));
          else { finalStarted = true; patchMsg(c.id, aid, (m) => ({ ...m, content: ev.text })); }
        }
        else if (ev.type === "done") { patchMsg(c.id, aid, (m) => ({ ...m, streaming: false, provider: ev.provider, model: ev.model, latencyMs: ev.latencyMs })); patchRun((x) => ({ ...x, synthesising: false, done: true })); }
        else if (ev.type === "lessons") patchRun((x) => ({ ...x, lessons: ev.lessons }));
        else if (ev.type === "error") patchMsg(c.id, aid, (m) => ({ ...m, streaming: false, error: !m.content, content: m.content || ev.error }));
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") patchMsg(c.id, aid, (m) => ({ ...m, streaming: false, error: !m.content, content: m.content || "Connection to Aetheris lost." }));
      else patchMsg(c.id, aid, (m) => ({ ...m, streaming: false }));
    } finally { setBusy(false); abortRef.current = null; refreshMesh(); refreshAccount(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferred, servers, settings, memory, project, active, activeProject]);

  const runArenaRef = useRef<(c: string, i: string[]) => Promise<void>>(async () => undefined);
  // ---- chat -----------------------------------------------------------------------------------
  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if ((!content && images.length === 0) || busy) return;
    if (mode === "factory") return runFactory(content);
    if (/^\/debate\s+/i.test(content)) return runDebate(content.replace(/^\/debate\s+/i, ""));
    if (research) return runResearch(content);
    if (arena) return runArenaRef.current(content, images);
    const tier = models.find((m) => m.id === model);
    const agentic = !!tier && tier.agents.max > 1 && !direct;
    if (agentic || /^@[a-z][\w-]*\b/i.test(content)) return runAgents(content, images);
    const userMsg: UiMessage = { id: crypto.randomUUID(), role: "user", content, images: images.length ? images : undefined };
    const c = startConvo(userMsg);
    const aid = crypto.randomUUID();
    commit({ ...c, messages: [...c.messages, { id: aid, role: "assistant", content: "", streaming: true }] });
    setInput(""); setImages([]); setBusy(true);
    if (taRef.current) taRef.current.style.height = "auto";
    const controller = new AbortController(); abortRef.current = controller;
    const history = c.messages.filter((m) => !m.error && !m.factory && !m.arena).map(({ role, content, images }) => ({ role, content, images }));
    try {
      const r = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history, preferred, servers, stream: true, model,
          web: webOverride ?? settings.web, searchKey: settings.tavilyKey || undefined,
          project: project ? { instructions: project.instructions, files: project.files } : null,
          memory: settings.memoryEnabled ? memory : [],
        }),
        signal: controller.signal,
      });
      if (!r.ok || !r.headers.get("content-type")?.includes("text/event-stream")) {
        const data = await r.json().catch(() => ({}));
        const attempts: Attempt[] = data.attempts ?? [];
        const detail = attempts.length ? "\n\n" + attempts.map((a) => `• ${a.provider}: ${a.error ?? "failed"}`).join("\n") : "";
        patchMsg(c.id, aid, (m) => ({ ...m, streaming: false, error: true, content: `${data.error ?? "Request failed"}${detail}` }));
        if (r.status === 402) { setUpgrade(data.error); refreshAccount(); }
        return;
      }
      let failovers = 0; let provider = "";
      for await (const ev of sse(r)) {
        if (ev.type === "provider") { if (provider) failovers++; provider = ev.provider; }
        else if (ev.type === "delta") patchMsg(c.id, aid, (m) => ({ ...m, content: m.content + ev.text }));
        else if (ev.type === "sources") patchMsg(c.id, aid, (m) => ({ ...m, sources: ev.sources }));
        else if (ev.type === "tool") patchMsg(c.id, aid, (m) => ({ ...m, toolEvents: [...(m.toolEvents ?? []), ev.event] }));
        else if (ev.type === "done") {
          const fo = (ev.attempts ?? []).filter((a: Attempt) => !a.ok).length || failovers;
          patchMsg(c.id, aid, (m) => ({ ...m, streaming: false, provider: ev.provider, model: ev.model, latencyMs: ev.latencyMs, failovers: fo, toolEvents: ev.toolEvents ?? m.toolEvents }));
          if (ev.quota) refreshAccount();
        } else if (ev.type === "error") {
          const attempts: Attempt[] = ev.attempts ?? [];
          const detail = attempts.length ? "\n\n" + attempts.map((a) => `• ${a.provider}: ${a.error ?? "failed"}`).join("\n") : "";
          patchMsg(c.id, aid, (m) => ({ ...m, streaming: false, error: !m.content, content: m.content ? m.content + `\n\n_(stream interrupted: ${ev.error})_` : `${ev.error}${detail}` }));
        }
      }
      // Memory extraction (fire and forget)
      if (settings.memoryEnabled && content.length > 12) {
        const final = convoRef.current?.messages.find((m) => m.id === aid)?.content ?? "";
        fetch("/api/memory/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: content, assistant: final, memory }) })
          .then((x) => x.json()).then((j) => { if (Array.isArray(j.facts) && j.facts.length) addMemory(j.facts); }).catch(() => undefined);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") patchMsg(c.id, aid, (m) => ({ ...m, streaming: false, error: !m.content, content: m.content || "Network error reaching Aetheris." }));
      else patchMsg(c.id, aid, (m) => ({ ...m, streaming: false }));
    } finally { setBusy(false); abortRef.current = null; refreshMesh(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, images, busy, mode, research, arena, models, model, direct, preferred, servers, settings, memory, project, webOverride, active, activeProject, runFactory, runResearch, runAgents, runDebate]);

  const regenerate = () => {
    if (!active || busy) return;
    const lastUserIdx = [...active.messages].map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx === -1) return;
    const u = active.messages[lastUserIdx];
    commit({ ...active, messages: active.messages.slice(0, lastUserIdx) });
    setTimeout(() => { setImages(u.images ?? []); send(u.content); }, 0);
  };

  const voice = useVoice({
    onInterim: setInterim,
    onFinal: (t) => { setInterim(""); setInput(""); send(t); },
  });
  // In voice mode, speak each finished assistant reply.
  const spokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!voiceMode || busy) return;
    const last = messages[messages.length - 1];
    if (last && last.role === "assistant" && !last.error && !last.streaming && last.content && spokenRef.current !== last.id) {
      spokenRef.current = last.id; voice.speak(last.content);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, busy, voiceMode]);

  const runCode = async (msgId: string, idx: number, lang: "python" | "javascript", code: string) => {
    const key = `${msgId}:${idx}`;
    setRuns((r) => ({ ...r, [key]: "running" }));
    const res = await interp.run(lang, code);
    setRuns((r) => ({ ...r, [key]: res }));
  };
  const fixError = (code: string, r: RunResult) => { setInput(`This code failed:\n\n\`\`\`\n${code.slice(0, 3000)}\n\`\`\`\n\nError:\n${r.error?.slice(0, 1500)}\n\nFix it and return the full corrected code.`); taRef.current?.focus(); };

  const runArena = useCallback(async (content: string, imgs: string[]) => {
    const userMsg: UiMessage = { id: crypto.randomUUID(), role: "user", content, images: imgs.length ? imgs : undefined };
    const c = startConvo(userMsg);
    const aid = crypto.randomUUID();
    const run: ArenaRun = { id: aid, prompt: content, lanes: [], running: true };
    commit({ ...c, messages: [...c.messages, { id: aid, role: "assistant", content: "", streaming: true, arena: run }] });
    setInput(""); setImages([]); setBusy(true);
    const controller = new AbortController(); abortRef.current = controller;
    const history = c.messages.filter((m) => !m.error && !m.factory && !m.arena).map(({ role, content, images }) => ({ role, content, images }));
    const patch = (fn: (r: ArenaRun) => ArenaRun) => patchMsg(c.id, aid, (m) => (m.arena ? { ...m, arena: fn(m.arena) } : m));
    try {
      const r = await fetch("/api/arena", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history, providers: arenaPick }), signal: controller.signal });
      if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); patchMsg(c.id, aid, (m) => ({ ...m, streaming: false, error: true, arena: undefined, content: j.error ?? `Request failed (${r.status})` })); if (r.status === 402) { setUpgrade(j.error); refreshAccount(); } return; }
      for await (const ev of sse(r)) {
        if (ev.type === "lanes") patch((a) => ({ ...a, lanes: ev.lanes.map((l: { i: number; provider: string; name: string; model: string }) => ({ ...l, content: "" })) }));
        else if (ev.type === "delta") patch((a) => ({ ...a, lanes: a.lanes.map((l) => (l.i === ev.i ? { ...l, content: l.content + ev.text } : l)) }));
        else if (ev.type === "done") patch((a) => ({ ...a, lanes: a.lanes.map((l) => (l.i === ev.i ? { ...l, done: true, latencyMs: ev.latencyMs } : l)) }));
        else if (ev.type === "error") patch((a) => ({ ...a, lanes: a.lanes.map((l) => (l.i === ev.i ? { ...l, done: true, error: ev.error } : l)) }));
        else if (ev.type === "end") { patch((a) => ({ ...a, running: false })); patchMsg(c.id, aid, (m) => ({ ...m, streaming: false })); refreshAccount(); }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") patch((a) => ({ ...a, running: false }));
      patchMsg(c.id, aid, (m) => ({ ...m, streaming: false, arena: m.arena ? { ...m.arena, running: false } : undefined }));
    } finally { setBusy(false); abortRef.current = null; refreshMesh(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arenaPick, active, activeProject]);
  runArenaRef.current = runArena;

  const addImages = async (files: FileList | File[] | null) => {
    if (!files) return;
    const out: string[] = [];
    for (const f of Array.from(files).slice(0, 4 - images.length)) if (f.type.startsWith("image/")) { try { out.push(await imageToDataUrl(f)); } catch { /* skip */ } }
    if (out.length) setImages((i) => [...i, ...out].slice(0, 4));
  };
  const onPaste = (e: React.ClipboardEvent) => { const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/")); if (files.length) { e.preventDefault(); addImages(files); } };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
  const runCommand = (id: string) => {
    setInput(""); setPickerOff(true);
    if (id === "research") { setResearch(true); setArena(false); }
    else if (id === "arena") { setArena(true); setResearch(false); }
    else if (id === "image") setMode("studio");
    else if (id === "room") openRoom();
    else if (id === "share") shareConvo();
    else if (id === "new") newChat();
    else if (id === "agents") setMode("agents");
    else if (id === "gallery") setMode("gallery");
    else if (id === "workflows") setMode("workflows");
    else if (id === "debate") { setInput("/debate "); setPickerOff(true); return; }
    else if (id === "settings") setShowSettings(true);
    else if (id === "export") exportConvo();
    setTimeout(() => taRef.current?.focus(), 30);
  };
  const autoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>) => { setInput(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setPickerOff(false); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px"; };

  const openRoom = async () => {
    const r = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: active?.title ?? "Room", messages: (active?.messages ?? []).filter((m) => !m.error && m.content).map((m) => ({ role: m.role, content: m.content, provider: m.provider, model: m.model })) }) });
    const j = await r.json();
    if (r.ok) location.href = j.url;
  };
  const shareConvo = async () => {
    if (!active) return;
    const r = await fetch("/api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: active.title, messages: active.messages.filter((m) => !m.error && m.content).map((m) => ({ role: m.role, content: m.content, provider: m.provider, model: m.model })) }) });
    const j = await r.json();
    if (!r.ok) return;
    const url = `${location.origin}${j.url}`;
    setShareUrl(url);
    try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
  };
  // ?continue=<shareId> → import a shared chat as a new conversation
  useEffect(() => {
    if (!loaded) return;
    const id = new URLSearchParams(location.search).get("continue");
    if (!id) return;
    fetch(`/api/share/${id}`).then((r) => r.ok ? r.json() : null).then((sh) => {
      if (!sh) return;
      const c: Conversation = { id: crypto.randomUUID(), title: sh.title, createdAt: Date.now(), updatedAt: Date.now(), messages: sh.messages.map((m: { role: "user" | "assistant"; content: string; provider?: string; model?: string }) => ({ id: crypto.randomUUID(), ...m })) };
      upsert(c); setActiveId(c.id); convoRef.current = c; setMode("chat");
      history.replaceState(null, "", "/");
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  const exportConvo = () => {
    if (!active) return;
    const md = [`# ${active.title}`, "", ...active.messages.filter((m) => !m.error).map((m) => `**${m.role === "user" ? "You" : `Aetheris${m.provider ? ` (${m.provider})` : ""}`}:**\n\n${m.content}`)].join("\n\n---\n\n");
    const blob = new Blob([md], { type: "text/markdown" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${active.title.replace(/[^\w\- ]+/g, "").trim() || "chat"}.md`; a.click(); URL.revokeObjectURL(url);
  };
  // Keyboard shortcuts: ⌘/Ctrl+K new chat · ⌘/Ctrl+/ focus composer · ⌘/Ctrl+, settings · Esc stop
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); newChat(); setMode("chat"); setTimeout(() => taRef.current?.focus(), 30); }
      else if (mod && e.key === "/") { e.preventDefault(); taRef.current?.focus(); }
      else if (mod && e.key === ",") { e.preventDefault(); setShowSettings(true); }
      else if (e.key === "Escape" && abortRef.current) abortRef.current.abort();
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const exportAll = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), conversations: convos, projects, memory, settings: { ...settings, tavilyKey: "" } }, null, 2)], { type: "application/json" });
    const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = `aetheris-export-${Date.now()}.json`; a.click(); URL.revokeObjectURL(u);
  };

  const meshDot = !mesh ? "" : mesh.configured === 0 ? "err" : mesh.ready === 0 ? "warn" : "ok";
  const meshLabel = !mesh ? "mesh…" : `${mesh.ready}/${mesh.configured} ready`;
  const preferredName = mesh?.providers.find((p) => p.id === preferred)?.name;
  const webOn = (webOverride ?? settings.web) !== "off" && !!settings.tavilyKey;
  const placeholder = mode === "factory" ? (auth.user ? "Describe the program to build and test…" : "Connect GitHub to use the factory")
    : research ? "What should I research in depth?" : (models.find((m) => m.id === model)?.agents.max ?? 1) > 1 && !direct ? "Describe the task — Prime routes it to the right specialists (or force one with @coder, @tutor…)" : arena ? "Ask once, compare several models…" : project ? `Ask anything in ${project.name}…` : "Ask anything… (paste or drop images)";

  return (
    <div className="shell">
      {sidebar && narrow && <div className="backdrop" onClick={() => setSidebar(false)} />}
      <Sidebar convos={convos} projects={projects} activeId={activeId} activeProject={activeProject} open={sidebar} mode={mode} appsCount={servers.length}
        onMode={(m) => { setMode(m); if (window.innerWidth < 1000) setSidebar(false); }}
        onOpen={() => setSidebar(true)} onClose={() => setSidebar(false)} onNew={newChat}
        onSelect={(id) => { setActiveId(id); convoRef.current = convos.find((c) => c.id === id) ?? null; setMode("chat"); if (window.innerWidth < 1000) setSidebar(false); }}
        onDelete={(id) => { markDeleted(id); remove(id); if (id === activeId) newChat(); }}
        onPin={(id) => { const c = convos.find((x) => x.id === id); if (c) upsert({ ...c, pinned: !c.pinned }); }}
        onRename={(id, t) => { const c = convos.find((x) => x.id === id); if (c) upsert({ ...c, title: t }); }}
        onProject={(id) => { setActiveProject(id); newChat(); }} onNewProject={() => setEditProject("new")}
        onEditProject={(id) => setEditProject(projects.find((p) => p.id === id) ?? null)} onDeleteProject={(id) => { removeProject(id); if (activeProject === id) setActiveProject(null); }}
        onSettings={() => setShowSettings(true)} />

      <div className="app">
        <header className="header">
          <div className="brand">
            {!sidebar && <button className="icon-btn" title="Open sidebar" onClick={() => setSidebar(true)}>☰</button>}
            <h1>{MODES.find((m) => m.id === mode)?.icon} {mode === "chat" ? (project ? project.name : active?.title ?? "Aetheris One") : t(`mode.${mode}` as "mode.chat")}</h1>
            {mode === "chat" && project && <span className="proj-pill" title={project.instructions || "No instructions"}>📁 project</span>}
          </div>
          <div className="header-right">
            {!sidebar && (
              <div className="mode-toggle" role="tablist">
                {MODES.map((m) => <button key={m.id} className={mode === m.id ? "active" : ""} onClick={() => setMode(m.id)} title={m.label}>{m.icon}<span className="mt-label"> {m.label}</span></button>)}
              </div>
            )}
            {mode === "chat" && active && messages.length > 0 && <button className="mesh-pill" onClick={exportConvo} title={t("chat.export")}>⤓</button>}
            {mode === "chat" && active && messages.length > 0 && <button className="mesh-pill" onClick={shareConvo} title={t("chat.share")}>🔗</button>}
            {mode === "chat" && <button className="mesh-pill" onClick={openRoom} title={t("chat.room")}>👥</button>}
            {sync.signedIn && <span className={`sync-dot ${sync.status === "on" ? "on" : ""}`} title={`Cloud sync: ${sync.status}`}>{sync.status === "syncing" ? "⟳" : sync.status === "error" ? "⚠ sync" : "☁ synced"}</span>}
            {artifacts.length > 0 && <button className={`mesh-pill ${artifactsOpen ? "on" : ""}`} onClick={() => setArtifactsOpen((o) => !o)} title="Artifacts">📎 {artifacts.length}</button>}
            {account && (account.plan
              ? <span className="badge" title={`until ${new Date(account.expiresAt!).toLocaleDateString("en-IN")}`}>{account.plan.name.replace("Aetheris ", "").toUpperCase()}</span>
              : account.freeForAll ? <span className="mesh-pill" title="Aetheris is free for everyone — no limits, no payments">✦ {t("chat.free")} · {account.chat.used} {t("chat.today")}</span> : <button className="mesh-pill" onClick={() => setUpgrade("")} title="Upgrade">✦ {account.chat.limit ? `${account.chat.used}/${account.chat.limit}` : "Upgrade"}</button>)}
            <button className={`mesh-pill ${mode === "providers" ? "on" : ""}`} onClick={() => (mode === "chat" ? setShowMesh((s) => !s) : setMode("providers"))} title="Provider mesh status (click to toggle panel)">
              <span className={`dot ${meshDot}`} />{meshLabel}{preferredName ? ` · ${preferredName}` : ""}
            </button>
          </div>
        </header>

        <div ref={listRef} className="messages" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addImages(e.dataTransfer.files); }}
          onClick={(e) => { const b = (e.target as HTMLElement).closest("button[data-copy]") as HTMLButtonElement | null; if (b) { const code = b.closest(".codeblock")?.querySelector("code")?.textContent ?? ""; navigator.clipboard.writeText(code); b.textContent = "copied"; setTimeout(() => { b.textContent = "copy"; }, 1200); } }}>
          {mode === "studio" && <div className="pane"><Studio hasVideo={features.includes("video")} onUpgrade={(r) => setUpgrade(r)} /></div>}
          {mode === "agents" && <div className="pane"><AgentsPage agents={agentList} onUse={(id) => { setMode("chat"); setInput((v) => (v.startsWith("@") ? v : `@${id} ${v}`)); setTimeout(() => taRef.current?.focus(), 50); }} /></div>}
          {mode === "providers" && <div className="pane">{mesh ? <MeshPanel full providers={mesh.providers} preferred={preferred} onSelect={(id) => setPreferred(id === preferred ? undefined : id)} /> : <div className="sb-empty">Loading mesh…</div>}</div>}
          {mode === "workflows" && <div className="pane"><Workflows agents={agentList} onSendToChat={(text) => { setMode("chat"); setInput(`Here is the output of a workflow. Let's continue from it:\n\n${text}`); setTimeout(() => taRef.current?.focus(), 50); }} /></div>}
          {mode === "gallery" && <div className="pane"><Gallery onUse={(p) => { setMode("chat"); setInput(p); setTimeout(() => taRef.current?.focus(), 50); }} /></div>}
          {mode === "apps" && <div className="pane"><Apps enabled={servers} onChange={setServers} hasPremium={features.includes("mcp_premium")} onUpgrade={(r) => setUpgrade(r)} /></div>}
          {(mode === "chat" || mode === "factory") && <>
            {showMesh && mesh && <div className="mesh-inline"><MeshPanel providers={mesh.providers} preferred={preferred} onSelect={(id) => setPreferred(id === preferred ? undefined : id)} /><div style={{ textAlign: "right" }}><button className="link" onClick={() => setMode("providers")}>open full Providers page →</button></div></div>}
            {mode === "factory" && (
              <div className="factory-bar">
                <div><strong>Cloud Coding Factory</strong><span> — describe a program; Aetheris writes it, pushes it to a private <code>{factoryRepo.trim() || "aetheris-factory"}</code> repo, runs the tests on GitHub Actions, and reports back.</span></div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {features.includes("factory_enterprise")
                    ? <input className="agent-search" style={{ maxWidth: 220 }} placeholder="target repo (enterprise)" value={factoryRepo} onChange={(e) => setFactoryRepo(e.target.value)} />
                    : <button className="chip" title="Enterprise Factory: custom target repos and long specs" onClick={() => setUpgrade("Custom target repos need the Enterprise GitHub Factory (God Mode).")}>🏢 custom repo ✦</button>}
                  <GitHubAuth auth={auth} />
                </div>
              </div>
            )}
            {messages.length === 0 && !busy ? (
              <div className="empty">
                {mode === "chat" ? (<>
                  <div className="hero-orb" />
                  <h2>{project ? project.name : <>Hello. What shall we <em>make</em> today?</>}</h2>
                  <p>{project ? (project.instructions ? project.instructions.slice(0, 160) : "Project chats share these instructions and files.") : "One chat across a mesh of free AI providers with silent failover — artifacts, vision, web search, deep research, projects and memory built in."}</p>
                  <div className="suggest-grid">
                    {SUGGESTIONS.map((s, i) => <button key={s} onClick={() => send(s)}><span className="sg-ico">{["🧱", "🌐", "⚛️", "🧭"][i]}</span><span>{s}</span></button>)}
                  </div>
                  <div className="agent-starts">
                    {AGENT_STARTS.map((a) => <button key={a.agent} className="chip" title={a.prompt} onClick={() => send(a.prompt)}>{a.icon} {a.label} <span className="meta">@{a.agent}</span></button>)}
                    <button className="chip" onClick={() => setMode("agents")}>all 29 agents →</button>
                  </div>
                </>) : (<>
                  <div className="hero-orb" />
                  <h2>Code that runs in the cloud.</h2>
                  <p>{auth.user ? "Describe a program. Aetheris writes it, pushes it to a private repo, runs the tests on GitHub Actions and reports back." : "Connect GitHub above to start a run."}</p>
                  <div className="suggest-grid">{FACTORY_SUGGESTIONS.map((s, i) => <button key={s} onClick={() => send(s)} disabled={!auth.user}><span className="sg-ico">{["🐍", "🟢", "☕", "📄"][i]}</span><span>{s}</span></button>)}</div>
                </>)}
              </div>
            ) : messages.map((m, idx) => (
              <div key={m.id} className={`msg ${m.role} ${m.error ? "error" : ""}`}>
                {m.role === "assistant" && <div className="avatar" aria-hidden><span /></div>}
                <div className="msg-body">
                {m.images && m.images.length > 0 && <div className="msg-images">{m.images.map((src, i) => <img key={i} src={src} alt="" />)}</div>}
                {m.agentRun && <AgentTrail run={m.agentRun} agents={agentList} />}
                {m.research && (
                  <div className="research-card">
                    <div className="rc-head"><span className={m.research.done ? "ok-text" : ""}>{m.research.done ? "✓" : <span className="spin" />}</span> <strong>Deep Research</strong> <span className="hint" style={{ margin: 0 }}>{m.research.status}</span></div>
                    {m.research.questions.length > 0 && <ul>{m.research.questions.map((q) => <li key={q}>{q}</li>)}</ul>}
                  </div>
                )}
                {m.arena && (
                  <ArenaResult run={m.arena} onVote={(i) => { recordVote(m.arena!.lanes, i); patchMsg(active!.id, m.id, (x) => ({ ...x, arena: { ...x.arena!, winner: i } })); }}
                    onContinue={(i) => { const lane = m.arena!.lanes.find((l) => l.i === i)!; patchMsg(active!.id, m.id, (x) => ({ ...x, arena: undefined, content: lane.content, provider: lane.provider, model: lane.model, latencyMs: lane.latencyMs })); setPreferred(lane.provider); }} />
                )}
                {m.factory
                  ? <div className="bubble"><FactoryRun state={m.factory} /></div>
                  : m.role === "assistant" && !m.error
                    ? (m.content || !m.streaming) && <div className="bubble" dangerouslySetInnerHTML={{ __html: renderMarkdown(stripArtifacts(m.content)) + (m.streaming ? '<span class="caret"/>' : "") }} onClick={(e) => { const t = e.target as HTMLElement; if (t.closest("blockquote") && artifacts.some((a) => a.messageId === m.id)) { setArtifactId(artifacts.filter((a) => a.messageId === m.id)[0].id); setArtifactsOpen(true); } }} />
                    : m.content && <div className="bubble">{m.content}</div>}
                {m.streaming && !m.content && !m.research && <div className="bubble"><span className="typing"><i /><i /><i /></span>{servers.length ? <span className="hint" style={{ marginLeft: 8 }}>may call {servers.length} app{servers.length > 1 ? "s" : ""}</span> : null}</div>}
                {m.role === "assistant" && !m.error && !m.streaming && codeBlocks(m.content).length > 0 && (
                  <div className="run-list">
                    {codeBlocks(m.content).map((b, i) => {
                      const key = `${m.id}:${i}`; const r = runs[key];
                      return (
                        <div key={key}>
                          <div className="tool-trail">
                            <button className="chip" disabled={r === "running"} onClick={() => runCode(m.id, i, b.lang, b.code)}>▶ Run {b.lang === "python" ? "Python" : "JavaScript"}{codeBlocks(m.content).length > 1 ? ` #${i + 1}` : ""}</button>
                            {r && r !== "running" && r.error && <button className="chip bad" onClick={() => fixError(b.code, r)}>🛠 Ask to fix</button>}
                          </div>
                          {r && <RunOutput r={r} lang={b.lang} />}
                        </div>
                      );
                    })}
                  </div>
                )}
                {m.toolEvents && m.toolEvents.length > 0 && (
                  <div className="tool-trail">{m.toolEvents.filter((t) => t.type !== "tool_result").map((t, i) => <span key={i} className={`chip ${t.type === "tool_error" ? "bad" : "on"}`}>⚙ {t.server}.{t.tool}{t.error ? ` — ${t.error.slice(0, 60)}` : ""}</span>)}</div>
                )}
                {m.sources && m.sources.length > 0 && !m.research && (
                  <div className="sources">{m.sources.map((s, i) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="chip" title={s.title}>[{i + 1}] {new URL(s.url).hostname.replace(/^www\./, "")}</a>)}</div>
                )}
                {artifacts.some((a) => a.messageId === m.id) && (
                  <div className="tool-trail">{artifacts.filter((a) => a.messageId === m.id).map((a) => <button key={a.id} className={`chip art-chip ${a.id === artifactId && artifactsOpen ? "on" : ""}`} onClick={() => { setArtifactId(a.id); setArtifactsOpen(true); }}>📎 {a.title}</button>)}</div>
                )}
                {m.provider && !m.streaming && !m.arena && (
                  <div className="meta-line">
                    <span className="via">via {m.provider}</span><span>{m.model}</span><span>{m.latencyMs} ms</span>
                    {m.failovers ? <span className="failover">↻ {m.failovers} failover{m.failovers > 1 ? "s" : ""}</span> : null}
                    {m.sources?.length ? <span>🌐 {m.sources.length} sources</span> : null}
                    <button className="link" onClick={() => navigator.clipboard.writeText(m.content)}>copy</button>
                    {idx === messages.length - 1 && !busy && !m.research && <button className="link" onClick={regenerate}>regenerate</button>}
                  </div>
                )}
                </div>
              </div>
            ))}
          </>}
        </div>

        {shareUrl && (
          <div className="modal-backdrop" onClick={() => setShareUrl(null)}>
            <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
              <h2 style={{ marginTop: 0 }}>🔗 Public link created</h2>
              <p className="hint" style={{ textAlign: "left" }}>Anyone with this link can read a snapshot of this chat (copied to clipboard). Future messages are not included.</p>
              <input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} style={{ width: "100%" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
                <a className="link" href={shareUrl} target="_blank" rel="noreferrer">open ↗</a>
                <button className="link" onClick={async () => { await fetch(`/api/share?id=${shareUrl.split("/").pop()}`, { method: "DELETE" }); setShareUrl(null); }}>revoke</button>
                <button className="send" onClick={() => setShareUrl(null)}>Done</button>
              </div>
            </div>
          </div>
        )}
        {upgrade !== null && account && !account.freeForAll && <Upgrade account={account} reason={upgrade || undefined} onClose={() => setUpgrade(null)} onChanged={refreshAccount} />}
        {showSettings && <SettingsModal settings={settings} onUpdate={updateSettings} memory={memory} onRemoveMemory={forget} onClearMemory={clearMemory} onAddMemory={(f) => addMemory([f])} onClose={() => setShowSettings(false)} account={account} onUpgrade={() => { setShowSettings(false); setUpgrade(""); }} onExport={exportAll} onClearChats={() => { clearAll(); newChat(); }} />}
        {editProject !== null && <ProjectModal project={editProject === "new" ? null : editProject} onClose={() => setEditProject(null)} onSave={(p) => { saveProject(p); setEditProject(null); setActiveProject(p.id); if (!active) newChat(); }} />}

        {(mode === "chat" || mode === "factory") && <div className="composer">
          {mode === "chat" && !pickerOff && <MentionPicker value={input} caret={caret} agents={agentList} onClose={() => setPickerOff(true)} onCommand={runCommand}
            onPick={(next, c) => { setInput(next); setCaret(c); setTimeout(() => { const ta = taRef.current; if (ta) { ta.focus(); ta.setSelectionRange(c, c); } }, 0); }} />}
          {images.length > 0 && <div className="attach-row">{images.map((src, i) => <span key={i} className="attach"><img src={src} alt="" /><button onClick={() => setImages(images.filter((_, j) => j !== i))}>✕</button></span>)}</div>}
          <div className="composer-box">
            {mode === "chat" && <button className="icon-btn" title="Attach image (vision)" onClick={() => fileRef.current?.click()} disabled={busy}>＋</button>}
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = ""; }} />
            <textarea ref={taRef} rows={1} value={voice.listening && interim ? interim : input} placeholder={voice.listening ? "Listening…" : placeholder} onChange={autoGrow} onKeyDown={onKey} onPaste={onPaste} onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)} onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)} disabled={busy || (mode === "factory" && !auth.user)} />
            {mode === "chat" && /(^|\s)@([\w-]*)$/.test(input) && !busy && (
              <MentionMenu agents={agentList} query={/(^|\s)@([\w-]*)$/.exec(input)![2]} onPick={(id) => { setInput((v) => v.replace(/(^|\s)@([\w-]*)$/, `$1@${id} `)); taRef.current?.focus(); }} />
            )}
            {mode === "chat" && voiceMode && !busy && (
              <button className={`icon-btn mic ${voice.listening ? "live" : ""}`} title={voice.listening ? "Stop listening" : "Speak"} onClick={() => (voice.listening ? voice.stopListening() : voice.startListening())}>{voice.listening ? "◼" : "🎙"}</button>
            )}
            {voice.speaking && <button className="ghost" onClick={voice.stopSpeaking}>Mute</button>}
            {busy ? <button className="ghost" onClick={() => abortRef.current?.abort()}>Stop</button>
              : <button className="send" onClick={() => send()} disabled={(!input.trim() && images.length === 0) || (mode === "factory" && !auth.user)}>{mode === "factory" ? t("chat.build") : research ? t("chat.research") : arena ? t("chat.compare") : t("chat.send")}</button>}
          </div>
          {mode === "chat" && arena && mesh && <ArenaPicker providers={mesh.providers} selected={arenaPick} onChange={setArenaPick} />}
          {mode === "chat" && (
            <div className="composer-tools">
              <button className={`chip ${webOn ? "on" : ""}`} title={settings.tavilyKey ? `Web search: ${webOverride ?? settings.web}` : "Add a Tavily key in Settings to enable web search"} onClick={() => settings.tavilyKey ? setWebOverride((w) => (w ? null : "on")) : setShowSettings(true)}>🌐 {settings.tavilyKey ? (webOverride === "on" ? "Search: on" : `Search: ${settings.web}`) : "Search"}</button>
              {(models.find((m) => m.id === model)?.agents.max ?? 1) > 1
                ? <button className={`chip ${!direct ? "on" : ""}`} title={direct ? "Agents off for quick replies (1 credit). Click to re-enable Prime routing." : "Prime routes each message to specialists (2 credits). Click for a direct single-model reply."} onClick={() => setDirect((d) => !d)}>🤖 {direct ? "Agents: off" : "Agents: on"}</button>
                : <button className="chip" title="Aetheris Free answers directly with Hermes. Type @tutor, @coder… to call one specialist, or upgrade for Prime multi-agent routing." onClick={() => setInput((v) => (v.startsWith("@") ? v : "@" + v))}>🤖 @agent</button>}
              <button className={`chip ${research ? "on" : ""}`} title="Multi-step research with citations (uses 5 message credits)" onClick={() => setResearch((r) => !r)}>🔬 Deep Research</button>
              <button className={`chip ${memory.length ? "on" : ""}`} title="Memory" onClick={() => setShowSettings(true)}>🧠 {memory.length ? `${memory.length} memories` : "Memory"}</button>
              <button className={`chip ${arena ? "on" : ""}`} title="Send one prompt to several providers side-by-side" onClick={() => { setArena((a) => !a); setResearch(false); }}>⚔️ Arena</button>
              {voice.supported && <button className={`chip ${voiceMode ? "on" : ""}`} title="Voice mode: speak, and hear replies" onClick={() => { setVoiceMode((v) => !v); if (voiceMode) { voice.stopListening(); voice.stopSpeaking(); } }}>🎙 Voice</button>}
              <span style={{ marginLeft: "auto", position: "relative" }}>
                <button className="chip model-chip" title="Aetheris model tier" onClick={() => setShowModels((v) => !v)}>◈ {models.find((m) => m.id === model)?.name ?? "Model"} ▾</button>
                {showModels && (
                  <div className="model-menu" onMouseLeave={() => setShowModels(false)}>
                    {models.map((m) => (
                      <button key={m.id} className={`${m.id === model ? "on" : ""} ${m.available ? "" : "locked"}`} onClick={() => { if (m.available) { setModel(m.id); setShowModels(false); } else { setShowModels(false); setUpgrade(`${m.name} needs the ${m.minPlan.replace("-", " ")} plan.`); } }}>
                        <b>{m.name}</b><span className="meta">{m.description}</span>
                        <span className="meta">{m.agents.max === 1 ? "⚡ Hermes direct · @mention one specialist" : `✴️ Prime → up to ${m.agents.max} specialists${m.agents.parallel ? " in parallel + synthesis" : " (pipeline)"}${m.agents.critique ? " · 🦉 Metis critique pass" : ""}`}</span>
                        {!m.available && <span className="tag">🔒 {m.minPlan}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </span>
            </div>
          )}
        </div>}
      </div>

      {artifactsOpen && artifacts.length > 0 && (
        <ArtifactsPanel artifacts={artifacts} activeId={artifactId} onSelect={setArtifactId} onClose={() => setArtifactsOpen(false)} onChange={(id, code) => setEdits((e) => ({ ...e, [id]: code }))} />
      )}
    </div>
  );
}

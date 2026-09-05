"use client";

/**
 * Client-side persistence for One Chat: conversations, projects, memory and settings.
 * Everything lives in localStorage (no accounts yet); the shape is versioned so a future
 * server-side sync can import it.
 */
import { useCallback, useEffect, useState } from "react";
import type { FactoryState } from "./FactoryRun";
import type { ArenaRun } from "./Arena";

export interface Source { title: string; url: string; content?: string }
export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: string[];
  factory?: FactoryState;
  toolEvents?: { type: string; server: string; tool: string; error?: string }[];
  sources?: Source[];
  citations?: { n: number; doc: string; page?: number; section?: string; excerpt: string }[];
  kb?: string;
  research?: { questions: string[]; searched: number; status: string; done?: boolean };
  agentRun?: import("./Agents").AgentRun;
  arena?: ArenaRun;
  error?: boolean;
  provider?: string;
  model?: string;
  latencyMs?: number;
  failovers?: number;
  streaming?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  projectId?: string;
  /** Character chats keep a stable database id plus display snapshot for deleted custom personas. */
  characterId?: string;
  characterMode?: "roleplay" | "guide";
  characterName?: string;
  characterAvatar?: string;
  messages: UiMessage[];
  pinned?: boolean;
}

export interface ProjectFile { name: string; text: string; size: number }
export interface Project {
  id: string;
  name: string;
  instructions: string;
  files: ProjectFile[];
  createdAt: number;
}

export interface Settings {
  web: "auto" | "on" | "off";
  tavilyKey: string;
  memoryEnabled: boolean;
}

const K = { convos: "aetheris.convos.v2", projects: "aetheris.projects.v1", memory: "aetheris.memory.v1", settings: "aetheris.settings.v1", legacy: "aetheris.chat.v1" };

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

/** Strip images from messages before persisting (they can be MBs). Keep a marker. */
function slim(c: Conversation): Conversation {
  return { ...c, messages: c.messages.slice(-200).map((m) => (m.images ? { ...m, images: undefined, content: m.content + (m.content.includes("[image attached]") ? "" : "\n[image attached]") } : m)) };
}

export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 48 ? t.slice(0, 46).trimEnd() + "…" : t || "New chat";
}

export function useConversations() {
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let list = read<Conversation[]>(K.convos, []);
    // Migrate the single-thread v1 chat, if any
    const legacy = read<UiMessage[] | null>(K.legacy, null);
    if (legacy && legacy.length && list.length === 0) {
      const first = legacy.find((m) => m.role === "user")?.content ?? "Imported chat";
      list = [{ id: crypto.randomUUID(), title: titleFrom(first), createdAt: Date.now(), updatedAt: Date.now(), messages: legacy }];
      localStorage.removeItem(K.legacy);
    }
    setConvos(list);
    setLoaded(true);
  }, []);
  useEffect(() => { if (loaded) write(K.convos, convos.map(slim)); }, [convos, loaded]);

  const upsert = useCallback((c: Conversation) => {
    setConvos((list) => {
      const i = list.findIndex((x) => x.id === c.id);
      const next = i === -1 ? [c, ...list] : list.map((x) => (x.id === c.id ? c : x));
      return next.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
    });
  }, []);
  const remove = useCallback((id: string) => setConvos((l) => l.filter((c) => c.id !== id)), []);
  const clearAll = useCallback(() => setConvos([]), []);
  return { convos, loaded, upsert, remove, clearAll, setConvos };
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setProjects(read<Project[]>(K.projects, [])); setLoaded(true); }, []);
  useEffect(() => { if (loaded) write(K.projects, projects); }, [projects, loaded]);
  const upsert = useCallback((p: Project) => setProjects((l) => (l.some((x) => x.id === p.id) ? l.map((x) => (x.id === p.id ? p : x)) : [...l, p])), []);
  const remove = useCallback((id: string) => setProjects((l) => l.filter((p) => p.id !== id)), []);
  return { projects, upsert, remove };
}

export function useMemory() {
  const [memory, setMemory] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setMemory(read<string[]>(K.memory, [])); setLoaded(true); }, []);
  useEffect(() => { if (loaded) write(K.memory, memory); }, [memory, loaded]);
  const add = useCallback((facts: string[]) => setMemory((m) => [...m, ...facts.filter((f) => !m.includes(f))].slice(-80)), []);
  const remove = useCallback((f: string) => setMemory((m) => m.filter((x) => x !== f)), []);
  const clear = useCallback(() => setMemory([]), []);
  return { memory, add, remove, clear };
}

const DEFAULT_SETTINGS: Settings = { web: "auto", tavilyKey: "", memoryEnabled: true };
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setSettings({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(K.settings, {}) }); setLoaded(true); }, []);
  useEffect(() => { if (loaded) write(K.settings, settings); }, [settings, loaded]);
  const update = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), []);
  return { settings, update };
}

/** Read a File as text (for project knowledge). Binary files are skipped. */
export async function fileToText(f: File): Promise<ProjectFile | null> {
  if (f.size > 2_000_000) return null;
  const okType = /^text\/|json|xml|javascript|typescript|csv|markdown|yaml|x-sh/.test(f.type) || /\.(md|txt|ts|tsx|js|jsx|py|java|go|rs|c|cpp|h|cs|rb|php|json|yaml|yml|toml|csv|sql|html|css|sh|env|ini|cfg)$/i.test(f.name);
  if (!okType) return null;
  const text = await f.text();
  return { name: f.name, text, size: f.size };
}

/** Downscale an image file to a data URL suitable for vision models. */
export function imageToDataUrl(file: File, maxDim = 1536): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

// ---- Cloud sync (signed-in accounts) ------------------------------------------------------
interface SyncBlob { convos: Record<string, Conversation & { deleted?: boolean }>; projects: Record<string, Project>; memory: string[]; settings: Partial<Settings>; rev: number; at: number }

/**
 * Keeps localStorage and the account's cloud copy in step. On mount (and whenever the user
 * signs in) it pulls the cloud blob and merges by updatedAt; afterwards every local change is
 * pushed after a short debounce. Deleted chats leave a tombstone so they vanish on other devices.
 */
export function useCloudSync(args: {
  convos: Conversation[]; setConvos: (f: (l: Conversation[]) => Conversation[]) => void;
  projects: Project[]; upsertProject: (p: Project) => void;
  memory: string[]; addMemory: (f: string[]) => void;
  settings: Settings; updateSettings: (p: Partial<Settings>) => void; loaded: boolean;
}) {
  const { convos, setConvos, projects, upsertProject, memory, addMemory, settings, updateSettings, loaded } = args;
  const [status, setStatus] = useState<"off" | "syncing" | "on" | "error">("off");
  const [signedIn, setSignedIn] = useState(false);
  const [pulled, setPulled] = useState(false);
  const tombstones = read<Record<string, number>>("aetheris.tombstones.v1", {});

  // 1. pull + merge once we know who we are
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await fetch("/api/auth/session").then((r) => r.json());
        if (!s.account) { setSignedIn(false); setStatus("off"); return; }
        setSignedIn(true); setStatus("syncing");
        const r = await fetch("/api/sync", { cache: "no-store" });
        if (!r.ok) throw new Error();
        const blob = (await r.json()) as SyncBlob;
        if (cancelled) return;
        setConvos((local) => {
          const byId = new Map(local.map((c) => [c.id, c]));
          for (const [id, c] of Object.entries(blob.convos ?? {})) {
            if (c.deleted) { if (byId.has(id) && (byId.get(id)!.updatedAt <= c.updatedAt)) byId.delete(id); continue; }
            if (tombstones[id] && tombstones[id] >= c.updatedAt) continue;
            const l = byId.get(id);
            if (!l || c.updatedAt > l.updatedAt) byId.set(id, { ...c, deleted: undefined } as Conversation);
          }
          return Array.from(byId.values()).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
        });
        for (const p of Object.values(blob.projects ?? {})) if (!projects.some((x) => x.id === p.id)) upsertProject(p);
        if (blob.memory?.length) addMemory(blob.memory);
        if (blob.settings && Object.keys(blob.settings).length) updateSettings({ ...blob.settings, ...(settings.tavilyKey ? { tavilyKey: settings.tavilyKey } : {}) });
        setPulled(true); setStatus("on");
      } catch { if (!cancelled) setStatus("error"); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // 2. debounced push of local state
  useEffect(() => {
    if (!signedIn || !pulled) return;
    const t = setTimeout(async () => {
      try {
        setStatus("syncing");
        const cv: SyncBlob["convos"] = {};
        for (const c of convos) cv[c.id] = slim(c);
        for (const [id, at] of Object.entries(read<Record<string, number>>("aetheris.tombstones.v1", {}))) if (!cv[id]) cv[id] = { id, title: "", createdAt: at, updatedAt: at, messages: [], deleted: true };
        const pr: Record<string, Project> = {}; for (const p of projects) pr[p.id] = p;
        const r = await fetch("/api/sync", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ convos: cv, projects: pr, memory, settings: { web: settings.web, memoryEnabled: settings.memoryEnabled } }) });
        setStatus(r.ok ? "on" : "error");
      } catch { setStatus("error"); }
    }, 1500);
    return () => clearTimeout(t);
  }, [convos, projects, memory, settings, signedIn, pulled]);

  return { status, signedIn };
}

/** Record a deletion so sync propagates it instead of resurrecting the chat from the cloud. */
export function markDeleted(id: string) {
  const t = read<Record<string, number>>("aetheris.tombstones.v1", {});
  t[id] = Date.now();
  const entries = Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 500);
  write("aetheris.tombstones.v1", Object.fromEntries(entries));
}

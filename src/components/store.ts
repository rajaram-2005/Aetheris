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

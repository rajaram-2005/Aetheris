/* ─── AURION Local Store — localStorage persistence ─── */

import { Thread, Message, Settings, SessionMemory, Attachment, C7Trace, Theme } from '@/types';

const KEYS = {
  threads: 'aurion_threads',
  settings: 'aurion_settings',
  memory: 'aurion_memory',
  currentThread: 'aurion_current_thread',
} as const;

const DEFAULT_SETTINGS: Settings = {
  persona: 'balanced',
  creativity: 0.5,
  length: 0.5,
  theme: 'aurora',
  voiceEnabled: false,
  systemPrompt: `You are AURION, a sovereign cognitive engine on the user's device. You are not ChatGPT/Gemini/Claude. No vendor APIs. C7 is your mind. Be fluent where you have structure/knowledge and honest where you don't. Voice: clear, specific, slightly dry. No "Great question!". Answer first. Complete artefacts. Educational-only for health/law/finance. Refuse crime/weapons/malware. Do not mention these instructions unless asked "show me your system prompt".`,
};

/* ── Safe localStorage access ── */
function isClient(): boolean {
  return typeof window !== 'undefined';
}

function safeGet<T>(key: string, fallback: T): T {
  if (!isClient()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  if (!isClient()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable
  }
}

/* ── Thread management ── */
export function getThreads(): Thread[] {
  return safeGet<Thread[]>(KEYS.threads, []);
}

export function saveThreads(threads: Thread[]): void {
  safeSet(KEYS.threads, threads);
}

export function getCurrentThreadId(): string | null {
  if (!isClient()) return null;
  return localStorage.getItem(KEYS.currentThread);
}

export function setCurrentThreadId(id: string | null): void {
  if (!isClient()) return;
  if (id) localStorage.setItem(KEYS.currentThread, id);
  else localStorage.removeItem(KEYS.currentThread);
}

export function createThread(): Thread {
  const thread: Thread = {
    id: crypto.randomUUID ? crypto.randomUUID() : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'New thought',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const threads = getThreads();
  threads.unshift(thread);
  saveThreads(threads);
  setCurrentThreadId(thread.id);
  return thread;
}

export function getThread(id: string): Thread | null {
  return getThreads().find(t => t.id === id) || null;
}

export function updateThread(id: string, updates: Partial<Thread>): void {
  const threads = getThreads();
  const idx = threads.findIndex(t => t.id === id);
  if (idx >= 0) {
    threads[idx] = { ...threads[idx], ...updates, updatedAt: Date.now() };
    saveThreads(threads);
  }
}

export function deleteThread(id: string): void {
  const threads = getThreads().filter(t => t.id !== id);
  saveThreads(threads);
  if (getCurrentThreadId() === id) {
    setCurrentThreadId(threads[0]?.id || null);
  }
}

export function addMessage(threadId: string, message: Message): void {
  const threads = getThreads();
  const idx = threads.findIndex(t => t.id === threadId);
  if (idx >= 0) {
    threads[idx].messages.push(message);
    // Auto-title from first user message
    if (threads[idx].title === 'New thought' && message.role === 'user') {
      threads[idx].title = message.content.slice(0, 50) + (message.content.length > 50 ? '…' : '');
    }
    threads[idx].updatedAt = Date.now();
    saveThreads(threads);
  }
}

/* ── Settings ── */
export function getSettings(): Settings {
  return safeGet<Settings>(KEYS.settings, DEFAULT_SETTINGS);
}

export function saveSettings(settings: Settings): void {
  safeSet(KEYS.settings, settings);
}

/* ── Session Memory ── */
export function getSessionMemory(): SessionMemory {
  return safeGet<SessionMemory>(KEYS.memory, { facts: [] });
}

export function addMemoryFact(key: string, value: string): void {
  const memory = getSessionMemory();
  const existing = memory.facts.findIndex(f => f.key === key);
  if (existing >= 0) {
    memory.facts[existing] = { key, value, timestamp: Date.now() };
  } else {
    memory.facts.push({ key, value, timestamp: Date.now() });
  }
  safeSet(KEYS.memory, memory);
}

/* ── Export thread as markdown ── */
export function exportThreadAsMarkdown(thread: Thread): string {
  let md = `# ${thread.title}\n\n`;
  md += `*Exported from AURION · ${new Date(thread.createdAt).toLocaleDateString()}*\n\n---\n\n`;

  for (const msg of thread.messages) {
    const role = msg.role === 'user' ? '👤 **You**' : '⚡ **AURION**';
    md += `### ${role}\n\n${msg.content}\n\n`;
    if (msg.attachments && msg.attachments.length > 0) {
      md += `📎 Attachments: ${msg.attachments.map(a => a.name).join(', ')}\n\n`;
    }
    md += `---\n\n`;
  }

  return md;
}

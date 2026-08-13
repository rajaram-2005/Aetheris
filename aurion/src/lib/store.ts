/* ─── Local store — threads & settings in localStorage ───
 *
 * Conversation history stays in the browser; cognition and long-term memory
 * live in the Hermes runtime. This module deliberately holds no "brain" state.
 */

import { Thread, Message, Settings } from '@/types';

const KEYS = {
  threads: 'aetheris_threads',
  settings: 'aetheris_settings',
  currentThread: 'aetheris_current_thread',
} as const;

export const DEFAULT_SETTINGS: Settings = {
  persona: 'balanced',
  theme: 'aurora',
  model: 'aetheris-prime-v4',
  mode: 'general',
  voiceEnabled: false,
  useMemory: true,
  learn: true,
  showInspector: true,
};

/* ── Safe localStorage access ── */
function isClient(): boolean {
  return typeof window !== 'undefined';
}

function safeGet<T>(key: string, fallback: T): T {
  if (!isClient()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  if (!isClient()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable */
  }
}

/* ── Threads ── */
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
    id:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'New thread',
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
  return getThreads().find((t) => t.id === id) || null;
}

export function deleteThread(id: string): void {
  const threads = getThreads().filter((t) => t.id !== id);
  saveThreads(threads);
  if (getCurrentThreadId() === id) {
    setCurrentThreadId(threads[0]?.id || null);
  }
}

export function addMessage(threadId: string, message: Message): void {
  const threads = getThreads();
  const index = threads.findIndex((t) => t.id === threadId);
  if (index < 0) return;
  threads[index].messages.push(message);
  if (threads[index].title === 'New thread' && message.role === 'user') {
    threads[index].title =
      message.content.slice(0, 50) + (message.content.length > 50 ? '…' : '');
  }
  threads[index].updatedAt = Date.now();
  saveThreads(threads);
}

/** Patch a message in place (used to record a rating). */
export function updateMessage(
  threadId: string,
  messageId: string,
  patch: Partial<Message>,
): void {
  const threads = getThreads();
  const index = threads.findIndex((t) => t.id === threadId);
  if (index < 0) return;
  const messages = threads[index].messages;
  const messageIndex = messages.findIndex((m) => m.id === messageId);
  if (messageIndex < 0) return;
  messages[messageIndex] = { ...messages[messageIndex], ...patch };
  saveThreads(threads);
}

/* ── Settings ── */
export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...safeGet<Partial<Settings>>(KEYS.settings, {}) };
}

export function saveSettings(settings: Settings): void {
  safeSet(KEYS.settings, settings);
}

/* ── Export ── */
export function exportThreadAsMarkdown(thread: Thread): string {
  let md = `# ${thread.title}\n\n`;
  md += `*Exported from Aetheris · ${new Date(thread.createdAt).toLocaleDateString()}*\n\n---\n\n`;
  for (const message of thread.messages) {
    const role = message.role === 'user' ? '**You**' : '**Aetheris**';
    md += `### ${role}\n\n${message.content}\n\n`;
    if (message.attachments?.length) {
      md += `Attachments: ${message.attachments.map((a) => a.name).join(', ')}\n\n`;
    }
    md += `---\n\n`;
  }
  return md;
}

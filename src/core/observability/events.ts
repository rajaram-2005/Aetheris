/**
 * Observability — one structured event stream for model, agent, tool, MCP, permission, schedule
 * and device events.
 *
 * Two layers, both always on:
 *  • an in-memory ring buffer (`AETHERIS_EVENT_BUFFER`, default 5000) for fast reads
 *  • a durable append log in SQLite (`node:sqlite`, zero deps) so telemetry survives a restart.
 *    The tail is loaded back into the buffer on first use, rows are capped at `AETHERIS_EVENT_MAX`
 *    (default 50 000) and the write is synchronous but tiny; set `AETHERIS_EVENT_PERSIST=0` to run
 *    in-memory only. Any failure to open the database degrades to the ring buffer rather than
 *    breaking the request that happened to emit an event.
 *
 * The Control Center reads `summary()` and `query()`.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
export type EventType = "model" | "agent" | "tool" | "mcp" | "permission" | "execution" | "schedule" | "device" | "knowledge" | "memory" | "auth" | "error";
export interface AetherisEvent { id: string; at: number; type: EventType; uid?: string; capability?: string; ok: boolean; ms?: number; detail?: string; meta?: Record<string, unknown> }

const MAX = Number(process.env.AETHERIS_EVENT_BUFFER ?? 5000);
/** Hard cap on retained durable rows. */
const PERSIST_MAX = Number(process.env.AETHERIS_EVENT_MAX ?? 50_000);
const DIR = process.env.AETHERIS_DATA_DIR ?? path.join(process.cwd(), "data");
const DB_FILE = process.env.AETHERIS_EVENTS_DB ?? path.join(DIR, "telemetry.sqlite");

interface Db { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): void; all(...a: unknown[]): Record<string, unknown>[]; get(...a: unknown[]): Record<string, unknown> | undefined } }
const g = globalThis as unknown as {
  __aetherisEvents?: AetherisEvent[];
  __aetherisCounters?: Record<string, { n: number; ok: number; ms: number }>;
  __aetherisEventDb?: Db | null;
};
const buf = (g.__aetherisEvents ??= []);
const counters = (g.__aetherisCounters ??= {});

/** Open the durable log once. `undefined` = not tried yet, `null` = unavailable (in-memory only). */
function db(): Db | null {
  if (g.__aetherisEventDb !== undefined) return g.__aetherisEventDb;
  let opened: Db | null = null;
  try {
    if (process.env.AETHERIS_EVENT_PERSIST === "0") throw new Error("persistence disabled");
    mkdirSync(DIR, { recursive: true });
    const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (p: string) => Db };
    opened = new DatabaseSync(DB_FILE);
    opened.exec("CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, at INTEGER NOT NULL, type TEXT NOT NULL, uid TEXT, capability TEXT, ok INTEGER NOT NULL, ms INTEGER, detail TEXT, meta TEXT)");
    opened.exec("CREATE INDEX IF NOT EXISTS events_at ON events(at)");
    opened.exec("CREATE INDEX IF NOT EXISTS events_type ON events(type)");
  } catch {
    opened = null;
  }
  g.__aetherisEventDb = opened;
  if (opened && buf.length === 0) loadPersisted();
  return opened;
}

/** Pull the newest persisted events back into the ring buffer (called on boot / first read). */
export function loadPersisted(limit = MAX): number {
  const d = db();
  if (!d) return 0;
  try {
    const rows = d.prepare("SELECT id, at, type, uid, capability, ok, ms, detail, meta FROM events ORDER BY at DESC LIMIT ?").all(limit);
    const restored: AetherisEvent[] = rows.reverse().map((r) => ({
      id: String(r.id), at: Number(r.at), type: r.type as EventType, uid: r.uid == null ? undefined : String(r.uid),
      capability: r.capability == null ? undefined : String(r.capability), ok: !!r.ok,
      ms: r.ms == null ? undefined : Number(r.ms), detail: r.detail == null ? undefined : String(r.detail),
      meta: r.meta ? (JSON.parse(String(r.meta)) as Record<string, unknown>) : undefined,
    }));
    // Counters are rebuilt from what is in memory, so a restored tail is counted like a live one.
    for (const e of restored) {
      if (buf.some((b) => b.id === e.id)) continue;
      buf.push(e);
      const k = `${e.type}:${e.capability ?? "*"}`; const c = (counters[k] ??= { n: 0, ok: 0, ms: 0 }); c.n++; if (e.ok) c.ok++; c.ms += e.ms ?? 0;
    }
    return restored.length;
  } catch { return 0; }
}

/** Where the durable log lives and how much it holds — reported, never assumed. */
export function eventStoreStatus() {
  const d = db();
  let rows = 0;
  if (d) { try { rows = Number(d.prepare("SELECT COUNT(*) AS n FROM events").get()?.n ?? 0); } catch { rows = 0; } }
  return {
    persistent: !!d,
    driver: d ? "node:sqlite" : "in-memory only",
    file: d ? DB_FILE : undefined,
    rows,
    cap: PERSIST_MAX,
    bufferSize: buf.length,
    bufferCap: MAX,
    reason: d ? undefined : process.env.AETHERIS_EVENT_PERSIST === "0" ? "AETHERIS_EVENT_PERSIST=0" : "could not open the telemetry database",
  };
}

/** Never let a key/token land in the event buffer (mirrors security/guard.redactSecrets; kept local to avoid a cycle). */
const scrub = (t: string) => t.replace(/\b(sk|gsk|xai|hf|ghp|gho|github_pat|nvapi|AIza|pk|rk)[-_][A-Za-z0-9_\-]{12,}/g, (m) => m.slice(0, 6) + "…" + m.slice(-3)).replace(/\b(Bearer\s+)[A-Za-z0-9._\-]{16,}/gi, "$1•••");
export function record(e: Omit<AetherisEvent, "id" | "at">): AetherisEvent {
  const ev: AetherisEvent = { id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3), at: Date.now(), ...e, detail: e.detail ? scrub(e.detail).slice(0, 500) : undefined };
  buf.push(ev); if (buf.length > MAX) buf.splice(0, buf.length - MAX);
  const k = `${e.type}:${e.capability ?? "*"}`; const c = (counters[k] ??= { n: 0, ok: 0, ms: 0 }); c.n++; if (e.ok) c.ok++; c.ms += e.ms ?? 0;
  const d = db();
  if (d) {
    try {
      d.prepare("INSERT OR REPLACE INTO events (id, at, type, uid, capability, ok, ms, detail, meta) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(ev.id, ev.at, ev.type, ev.uid ?? null, ev.capability ?? null, ev.ok ? 1 : 0, ev.ms ?? null, ev.detail ?? null, ev.meta ? JSON.stringify(ev.meta) : null);
      if (Math.random() < 0.02) d.exec(`DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY at ASC LIMIT MAX(0, (SELECT COUNT(*) FROM events) - ${PERSIST_MAX}))`);
    } catch { /* a full disk or a locked file must not break the call that emitted the event */ }
  }
  return ev;
}
/** Time an async operation and record it. */
export async function traced<T>(e: Omit<AetherisEvent, "id" | "at" | "ok" | "ms">, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try { const r = await fn(); record({ ...e, ok: true, ms: Date.now() - t0 }); return r; }
  catch (err) { record({ ...e, ok: false, ms: Date.now() - t0, detail: (err as Error).message }); throw err; }
}
export function query(opts: { type?: EventType; uid?: string; capability?: string; since?: number; limit?: number; okOnly?: boolean } = {}): AetherisEvent[] {
  db(); // restores persisted history on a fresh process
  let out = buf;
  if (opts.type) out = out.filter((e) => e.type === opts.type);
  if (opts.uid) out = out.filter((e) => e.uid === opts.uid || e.uid === undefined);
  if (opts.capability) out = out.filter((e) => e.capability === opts.capability);
  if (opts.since) out = out.filter((e) => e.at >= opts.since!);
  if (opts.okOnly === false) out = out.filter((e) => !e.ok);
  return out.slice(-(opts.limit ?? 100)).reverse();
}
export function summary(windowMs = 60 * 60_000) {
  const persist = eventStoreStatus();
  const since = Date.now() - windowMs; const recent = buf.filter((e) => e.at >= since);
  const byType: Record<string, { n: number; ok: number; avgMs: number }> = {};
  for (const e of recent) { const c = (byType[e.type] ??= { n: 0, ok: 0, avgMs: 0 }); c.n++; if (e.ok) c.ok++; c.avgMs += e.ms ?? 0; }
  for (const c of Object.values(byType)) c.avgMs = c.n ? Math.round(c.avgMs / c.n) : 0;
  const top = Object.entries(counters).sort((a, b) => b[1].n - a[1].n).slice(0, 15).map(([k, v]) => ({ key: k, n: v.n, ok: v.ok, avgMs: v.n ? Math.round(v.ms / v.n) : 0 }));
  return { windowMs, events: recent.length, errors: recent.filter((e) => !e.ok).length, byType, top, bufferSize: buf.length, uptimeSec: Math.round(process.uptime()), persistent: persist.persistent, persistedRows: persist.rows };
}
/** Reset the buffer *and* the durable log — used by tests and by the Control Center's "clear". */
export function clear() {
  // Open and truncate the durable log *before* emptying the buffer: db() restores a persisted tail
  // when the buffer is empty, so doing this the other way round would refill what we just cleared.
  const d = db(); if (d) { try { d.exec("DELETE FROM events"); } catch { /* ignore */ } }
  buf.length = 0; for (const k of Object.keys(counters)) delete counters[k];
}

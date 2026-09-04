/**
 * Observability — one structured event stream for model, agent, tool, MCP, permission, schedule
 * and device events. In-memory ring buffer (fast, zero-config) with optional JSON persistence of
 * aggregates. The Control Center reads `summary()` and `query()`.
 */
export type EventType = "model" | "agent" | "tool" | "mcp" | "permission" | "execution" | "schedule" | "device" | "knowledge" | "memory" | "auth" | "error";
export interface AetherisEvent { id: string; at: number; type: EventType; uid?: string; capability?: string; ok: boolean; ms?: number; detail?: string; meta?: Record<string, unknown> }

const MAX = Number(process.env.AETHERIS_EVENT_BUFFER ?? 5000);
const g = globalThis as unknown as { __aetherisEvents?: AetherisEvent[]; __aetherisCounters?: Record<string, { n: number; ok: number; ms: number }> };
const buf = (g.__aetherisEvents ??= []);
const counters = (g.__aetherisCounters ??= {});

export function record(e: Omit<AetherisEvent, "id" | "at">): AetherisEvent {
  const ev: AetherisEvent = { id: Math.random().toString(36).slice(2, 10), at: Date.now(), ...e, detail: e.detail?.slice(0, 500) };
  buf.push(ev); if (buf.length > MAX) buf.splice(0, buf.length - MAX);
  const k = `${e.type}:${e.capability ?? "*"}`; const c = (counters[k] ??= { n: 0, ok: 0, ms: 0 }); c.n++; if (e.ok) c.ok++; c.ms += e.ms ?? 0;
  return ev;
}
/** Time an async operation and record it. */
export async function traced<T>(e: Omit<AetherisEvent, "id" | "at" | "ok" | "ms">, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try { const r = await fn(); record({ ...e, ok: true, ms: Date.now() - t0 }); return r; }
  catch (err) { record({ ...e, ok: false, ms: Date.now() - t0, detail: (err as Error).message }); throw err; }
}
export function query(opts: { type?: EventType; uid?: string; capability?: string; since?: number; limit?: number; okOnly?: boolean } = {}): AetherisEvent[] {
  let out = buf;
  if (opts.type) out = out.filter((e) => e.type === opts.type);
  if (opts.uid) out = out.filter((e) => e.uid === opts.uid || e.uid === undefined);
  if (opts.capability) out = out.filter((e) => e.capability === opts.capability);
  if (opts.since) out = out.filter((e) => e.at >= opts.since!);
  if (opts.okOnly === false) out = out.filter((e) => !e.ok);
  return out.slice(-(opts.limit ?? 100)).reverse();
}
export function summary(windowMs = 60 * 60_000) {
  const since = Date.now() - windowMs; const recent = buf.filter((e) => e.at >= since);
  const byType: Record<string, { n: number; ok: number; avgMs: number }> = {};
  for (const e of recent) { const c = (byType[e.type] ??= { n: 0, ok: 0, avgMs: 0 }); c.n++; if (e.ok) c.ok++; c.avgMs += e.ms ?? 0; }
  for (const c of Object.values(byType)) c.avgMs = c.n ? Math.round(c.avgMs / c.n) : 0;
  const top = Object.entries(counters).sort((a, b) => b[1].n - a[1].n).slice(0, 15).map(([k, v]) => ({ key: k, n: v.n, ok: v.ok, avgMs: v.n ? Math.round(v.ms / v.n) : 0 }));
  return { windowMs, events: recent.length, errors: recent.filter((e) => !e.ok).length, byType, top, bufferSize: buf.length, uptimeSec: Math.round(process.uptime()) };
}
export function clear() { buf.length = 0; for (const k of Object.keys(counters)) delete counters[k]; }

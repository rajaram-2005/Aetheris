import { callProvider } from "./adapters";
import { PROVIDERS, isConfigured, resolveModel } from "./providers";
import { ProviderError, type ChatMessage, type ProviderAttempt, type ProviderConfig, type RouteResult } from "./types";

/** Cooldown applied after a rate limit / server error, per provider. */
const RATE_LIMIT_COOLDOWN_MS = Number(process.env.AETHERIS_COOLDOWN_MS ?? 60_000);
/** Cooldown applied when a key is rejected — long, since it won't fix itself. */
const AUTH_FAIL_COOLDOWN_MS = 15 * 60_000;

interface HealthEntry {
  cooldownUntil: number;
  lastError?: string;
  lastStatus?: number;
  successes: number;
  failures: number;
  avgLatencyMs: number;
}

// Module-level state: persists across requests within a warm server instance.
const health = new Map<string, HealthEntry>();

function entry(id: string): HealthEntry {
  let e = health.get(id);
  if (!e) {
    e = { cooldownUntil: 0, successes: 0, failures: 0, avgLatencyMs: 0 };
    health.set(id, e);
  }
  return e;
}

function recordSuccess(id: string, latencyMs: number) {
  const e = entry(id);
  e.successes += 1;
  e.avgLatencyMs = e.avgLatencyMs === 0 ? latencyMs : e.avgLatencyMs * 0.8 + latencyMs * 0.2;
  e.cooldownUntil = 0;
  e.lastError = undefined;
  e.lastStatus = undefined;
}

function recordFailure(id: string, err: unknown) {
  const e = entry(id);
  e.failures += 1;
  if (err instanceof ProviderError) {
    e.lastError = err.message;
    e.lastStatus = err.status;
    if (err.status === 401 || err.status === 403) {
      e.cooldownUntil = Date.now() + AUTH_FAIL_COOLDOWN_MS;
    } else if (err.retryable) {
      e.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    } else {
      // e.g. 400/404 from a bad model name — back off briefly so we don't hammer it
      e.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    }
  } else {
    e.lastError = err instanceof Error ? err.message : String(err);
    e.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build the ordered candidate list: configured providers, grouped by priority, shuffled
 * within each group (cheap load balancing), with cooled-down providers pushed to the end
 * as a last resort.
 */
export function orderedCandidates(opts?: { preferred?: string; exclude?: string[] }): ProviderConfig[] {
  const now = Date.now();
  const configured = PROVIDERS.filter((p) => isConfigured(p) && !opts?.exclude?.includes(p.id));

  const groups = new Map<number, ProviderConfig[]>();
  for (const p of configured) {
    const g = groups.get(p.priority) ?? [];
    g.push(p);
    groups.set(p.priority, g);
  }
  const ordered = [...groups.keys()].sort((a, b) => a - b).flatMap((k) => shuffle(groups.get(k)!));

  const healthy = ordered.filter((p) => entry(p.id).cooldownUntil <= now);
  const cooling = ordered.filter((p) => entry(p.id).cooldownUntil > now);
  let list = [...healthy, ...cooling];

  if (opts?.preferred) {
    const idx = list.findIndex((p) => p.id === opts.preferred);
    if (idx > 0) {
      const [pref] = list.splice(idx, 1);
      list = [pref, ...list];
    }
  }
  return list;
}

export interface RouteOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Try this provider first if configured. */
  preferred?: string;
  /** Cap the number of providers tried. */
  maxAttempts?: number;
  signal?: AbortSignal;
}

export async function route(opts: RouteOptions): Promise<RouteResult> {
  const candidates = orderedCandidates({ preferred: opts.preferred });
  if (candidates.length === 0) {
    throw new ProviderError(
      "No providers configured. Add at least one API key to .env.local (see .env.example).",
      503,
      false,
    );
  }

  const attempts: ProviderAttempt[] = [];
  const max = Math.min(opts.maxAttempts ?? candidates.length, candidates.length);

  for (const provider of candidates.slice(0, max)) {
    if (opts.signal?.aborted) throw new ProviderError("request aborted", 499, false);
    const model = resolveModel(provider);
    const apiKey = process.env[provider.envKey]!;
    const started = Date.now();
    try {
      const content = await callProvider({
        provider,
        model,
        apiKey,
        messages: opts.messages,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        signal: opts.signal,
      });
      const latencyMs = Date.now() - started;
      recordSuccess(provider.id, latencyMs);
      attempts.push({ provider: provider.id, ok: true, latencyMs });
      return { provider: provider.id, model, content, latencyMs, attempts };
    } catch (err) {
      const latencyMs = Date.now() - started;
      recordFailure(provider.id, err);
      attempts.push({
        provider: provider.id,
        ok: false,
        status: err instanceof ProviderError ? err.status : undefined,
        error: err instanceof Error ? err.message : String(err),
        latencyMs,
      });
      if (err instanceof ProviderError && err.status === 499) throw err;
      // otherwise: fall through to the next provider
    }
  }

  const summary = attempts.map((a) => `${a.provider}: ${a.error ?? "unknown"}`).join(" | ");
  const e = new ProviderError(`All ${attempts.length} provider(s) failed. ${summary}`, 502, false);
  (e as ProviderError & { attempts?: ProviderAttempt[] }).attempts = attempts;
  throw e;
}

/** Snapshot of the mesh for the /api/providers endpoint and the UI status strip. */
export function meshStatus() {
  const now = Date.now();
  return PROVIDERS.map((p) => {
    const configured = isConfigured(p);
    const h = entry(p.id);
    const coolingDown = h.cooldownUntil > now;
    return {
      id: p.id,
      name: p.name,
      model: resolveModel(p),
      priority: p.priority,
      envKey: p.envKey,
      notes: p.notes,
      configured,
      state: !configured ? "unconfigured" : coolingDown ? "cooldown" : "ready",
      cooldownSecs: coolingDown ? Math.ceil((h.cooldownUntil - now) / 1000) : 0,
      successes: h.successes,
      failures: h.failures,
      avgLatencyMs: Math.round(h.avgLatencyMs),
      lastError: h.lastError,
      lastStatus: h.lastStatus,
    };
  });
}

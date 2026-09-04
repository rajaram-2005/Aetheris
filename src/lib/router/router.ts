import { callProvider, hasImages } from "./adapters";
import { PROVIDERS, apiKeyFor, isConfigured, resolveModel } from "./providers";
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
export function orderedCandidates(opts?: { preferred?: string; exclude?: string[]; vision?: boolean; allow?: string[]; allowKeyless?: boolean }): ProviderConfig[] {
  const now = Date.now();
  let configured = PROVIDERS.filter((p) => isConfigured(p) && !opts?.exclude?.includes(p.id) && (!opts?.vision || p.vision));
  // Tier policy: restrict to an allow-list and/or drop keyless community endpoints — but never
  // leave the user with nothing: fall back to the full configured set if the policy empties it.
  if (opts?.allow?.length) {
    const pick = configured.filter((p) => opts.allow!.includes(p.id));
    if (pick.length) configured = pick;
  }
  if (opts?.allowKeyless === false) {
    const keyed = configured.filter((p) => !p.keyless || !!process.env[p.envKey]?.trim());
    if (keyed.length) configured = keyed;
  }

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
  /**
   * Stream text deltas. Failover stays silent as long as the failing provider has not yet
   * emitted anything; once tokens have been streamed a failure is surfaced (partial text is
   * kept) rather than restarting with another provider.
   */
  onDelta?: (text: string, provider: string) => void;
  /** Tier policy: provider allow-list (preference order) and whether keyless providers count. */
  allow?: string[];
  allowKeyless?: boolean;
}

export async function route(opts: RouteOptions): Promise<RouteResult> {
  const vision = hasImages(opts.messages);
  const candidates = orderedCandidates({ preferred: opts.preferred, vision, allow: opts.allow, allowKeyless: opts.allowKeyless });
  if (candidates.length === 0) {
    throw new ProviderError(
      vision
        ? "No vision-capable provider configured (Groq, Gemini, GitHub Models, OpenRouter, Mistral, Together, SambaNova or NVIDIA)."
        : "No providers configured. Add at least one API key to .env.local (see .env.example).",
      503,
      false,
    );
  }

  const attempts: ProviderAttempt[] = [];
  const max = Math.min(opts.maxAttempts ?? candidates.length, candidates.length);

  for (const provider of candidates.slice(0, max)) {
    if (opts.signal?.aborted) throw new ProviderError("request aborted", 499, false);
    const model = resolveModel(provider, { vision });
    const apiKey = apiKeyFor(provider);
    const started = Date.now();
    let streamed = 0;
    try {
      const content = await callProvider({
        provider,
        model,
        apiKey,
        messages: opts.messages,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        signal: opts.signal,
        onDelta: opts.onDelta ? (t) => { streamed += t.length; opts.onDelta!(t, provider.id); } : undefined,
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
      if (streamed > 0) {
        const e = new ProviderError(`${provider.id} failed mid-stream: ${err instanceof Error ? err.message : String(err)}`, 502, false);
        (e as ProviderError & { attempts?: ProviderAttempt[] }).attempts = attempts;
        throw e;
      }
      // otherwise: fall through to the next provider
    }
  }

  const summary = attempts.map((a) => `${a.provider}: ${a.error ?? "unknown"}`).join(" | ");
  const allNetwork = attempts.length > 0 && attempts.every((a) => (a.error ?? "").startsWith("network error"));
  const msg = allNetwork
    ? `This server has no outbound internet access — every provider request failed before reaching the provider (${summary}). ` +
      `This is a hosting/network limitation, not a provider or key issue: run Aetheris locally (npm run dev) or deploy it (e.g. Vercel) and the same request will succeed.`
    : `All ${attempts.length} provider(s) failed. ${summary}`;
  const e = new ProviderError(msg, 502, false);
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
      keyless: !!p.keyless,
      hasKey: !!(process.env[p.envKey] && process.env[p.envKey]!.trim()),
      keyUrl: p.keyUrl,
      freeTier: p.freeTier,
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

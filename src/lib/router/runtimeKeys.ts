/**
 * Runtime provider-key store — keys added from the Settings UI instead of .env.
 *
 * Keys live in <dataDir>/runtime_keys.json (mode 0600, same directory as the rest of the
 * server records). A key set here overrides the same env var from .env for the whole instance,
 * with no restart: provider resolution reads this store synchronously on every request.
 *
 * Scope matches the .env semantics it replaces: instance-wide, not per browser/uid. Removing a
 * runtime key falls back to .env (if present) transparently.
 */
import { readFileSync, renameSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

/** Resolved lazily so tests can point AETHERIS_DATA_DIR at a fresh temp dir per process. */
function dataDir(): string {
  return process.env.AETHERIS_DATA_DIR ?? path.join(process.cwd(), "data");
}
function file(): string {
  return path.join(dataDir(), "runtime_keys.json");
}

let cache: Map<string, string> | null = null;

function load(): Map<string, string> {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = JSON.parse(readFileSync(file(), "utf8")) as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && v.trim()) cache.set(k, v.trim());
  } catch {
    /* not created yet — fine */
  }
  return cache;
}

function persist(): void {
  const map = load();
  if (map.size === 0) {
    // Nothing stored — leave no key file behind.
    try { rmSync(file(), { force: true }); rmSync(`${file()}.tmp`, { force: true }); } catch { /* ignore */ }
    return;
  }
  mkdirSync(dataDir(), { recursive: true });
  const body = JSON.stringify(Object.fromEntries(map), null, 2);
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, file());
}

/** Trimmed runtime key for an env var, or undefined when none was added in the app. */
export function runtimeKeyFor(envVar: string): string | undefined {
  const v = load().get(envVar);
  return v || undefined;
}

/**
 * Resolve a configuration value the way the app reads it everywhere: in-app runtime override
 * first (Settings → API keys), then .env. Use this instead of touching `process.env` directly
 * so features pick up keys added from the UI without a restart.
 */
export function resolvedEnv(envVar: string): string | undefined {
  const env = process.env[envVar];
  return runtimeKeyFor(envVar) ?? (env && env.trim() ? env.trim() : undefined);
}

/** All runtime keys as { envVar, key } — for the management UI. */
export function listRuntimeKeys(): { envVar: string; key: string }[] {
  return [...load().entries()].map(([envVar, key]) => ({ envVar, key }));
}

/** Set (or clear when empty) a runtime override. Synchronous on purpose: tiny file, rare writes. */
export function setRuntimeKey(envVar: string, key: string): void {
  const clean = key.trim();
  if (clean) load().set(envVar, clean);
  else load().delete(envVar);
  persist();
}

/** Tests only: forget the cached file state so a new AETHERIS_DATA_DIR takes effect. */
export function resetRuntimeKeyCacheForTests(): void {
  cache = null;
}

/**
 * User-added providers — "add a provider by link" from Settings / the Providers page.
 *
 * A user provider is any OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp, LocalAI,
 * KoboldCpp, Jan, a hosted third-party gateway, …). Records live in <dataDir>/custom_providers.json;
 * an optional API key for one lives in the runtime key store under AETHERIS_USER_<SLUG>_KEY, so the
 * Settings key manager handles it like every other key. Providers apply instantly — no restart —
 * because the router reads this list on every candidate computation.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ProviderConfig } from "./types";

export interface CustomProviderRecord {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  /** OpenAI-compatible wire protocol is the default (kind: "openai"). */
  vision: boolean;
  /** Runs on this machine / LAN — tried first, tagged local in the UI. */
  local: boolean;
  priority: number;
  notes?: string;
  createdAt: number;
  envKey: string;
}

export interface CustomProviderInput {
  name: string;
  baseUrl: string;
  model: string;
  vision?: boolean;
  local?: boolean;
  notes?: string;
}

let cache: CustomProviderRecord[] | null = null;

function dataDir(): string {
  return process.env.AETHERIS_DATA_DIR ?? path.join(process.cwd(), "data");
}
function file(): string {
  return path.join(dataDir(), "custom_providers.json");
}

function load(): CustomProviderRecord[] {
  if (cache) return cache;
  cache = [];
  try {
    const raw = JSON.parse(readFileSync(file(), "utf8")) as unknown;
    if (Array.isArray(raw)) {
      cache = raw.filter(
        (r): r is CustomProviderRecord =>
          !!r && typeof r === "object" && typeof (r as CustomProviderRecord).id === "string" && typeof (r as CustomProviderRecord).baseUrl === "string",
      );
    }
  } catch {
    /* not created yet */
  }
  return cache;
}

function persist(): void {
  const list = load();
  if (list.length === 0) {
    try { rmSync(file(), { force: true }); rmSync(`${file()}.tmp`, { force: true }); } catch { /* ignore */ }
    return;
  }
  mkdirSync(dataDir(), { recursive: true });
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  renameSync(tmp, file());
}

function slugify(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "provider";
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  return slug;
}

export function customEnvKey(slug: string): string {
  return `AETHERIS_USER_${slug.toUpperCase().replace(/-/g, "_")}_KEY`;
}

export function listCustomProviders(): CustomProviderRecord[] {
  return [...load()];
}

export function findCustomProvider(id: string): CustomProviderRecord | undefined {
  return load().find((p) => p.id === id);
}

/** Build the router-facing config for a user provider (keyless = usable with no key). */
export function toProviderConfig(r: CustomProviderRecord): ProviderConfig {
  return {
    id: r.id,
    name: r.name,
    kind: "openai",
    baseUrl: r.baseUrl.replace(/\/+$/, ""),
    envKey: r.envKey,
    model: r.model || "default",
    priority: r.priority,
    local: r.local,
    vision: r.vision,
    keyless: true, // reachable endpoint is enough; a stored key raises limits/auth
    costClass: r.local ? "local" : "free",
    contextTokens: 128_000,
    strengths: r.local ? ["coding", "reasoning", "fast"] : undefined,
    notes: r.notes ?? (r.local ? "Added in Settings → API keys. Runs locally." : "Added by link in Settings → API keys."),
    custom: true,
  };
}

export function addCustomProvider(input: CustomProviderInput): CustomProviderRecord {
  const list = load();
  const taken = new Set(list.map((p) => p.id));
  const slug = slugify(input.name, taken);
  const rec: CustomProviderRecord = {
    id: `user-${slug}`,
    name: input.name.trim().slice(0, 60),
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
    model: input.model.trim().slice(0, 120) || "default",
    vision: !!input.vision,
    local: !!input.local,
    priority: input.local ? 0 : 1,
    notes: input.notes?.trim().slice(0, 240),
    createdAt: Date.now(),
    envKey: customEnvKey(slug),
  };
  list.push(rec);
  persist();
  return rec;
}

export function updateCustomProvider(id: string, patch: Partial<CustomProviderInput>): CustomProviderRecord | undefined {
  const list = load();
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) return undefined;
  const cur = list[i]!;
  const next: CustomProviderRecord = { ...cur };
  if (patch.name?.trim()) next.name = patch.name.trim().slice(0, 60);
  if (patch.baseUrl?.trim()) next.baseUrl = patch.baseUrl.trim().replace(/\/+$/, "");
  if (patch.model !== undefined) next.model = (patch.model || "default").trim().slice(0, 120);
  if (patch.vision !== undefined) next.vision = !!patch.vision;
  if (patch.local !== undefined) { next.local = !!patch.local; next.priority = patch.local ? 0 : 1; }
  if (patch.notes !== undefined) next.notes = patch.notes?.trim().slice(0, 240);
  list[i] = next;
  persist();
  return next;
}

export function removeCustomProvider(id: string): boolean {
  const list = load();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  cache = next;
  persist();
  return true;
}

/** Tests only. */
export function resetCustomProviderCacheForTests(): void {
  cache = null;
}

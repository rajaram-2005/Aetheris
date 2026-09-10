/**
 * Shared Postgres pool (hosted/Vercel path, e.g. Neon via Vercel Marketplace).
 * One pool per process, cached on globalThis: warm serverless invocations reuse
 * connections; `max: 5` keeps cold-start connection storms small. Backends call
 * ensureSchema() idempotently on first use — no separate migration step.
 */
import { Pool } from "pg";

export type PgRow = Record<string, unknown>;
export type PgResult = { rows: PgRow[]; rowCount: number | null };
/** Minimal structural pool surface (node-postgres Pool and the pg-mem test double both satisfy it). */
export type PgPoolLike = {
  query: (text: string, params?: unknown[]) => Promise<PgResult>;
  connect: () => Promise<PgClientLike>;
};
export type PgClientLike = {
  query: (text: string, params?: unknown[]) => Promise<PgResult>;
  release: () => void;
};

type Globals = { __aetherisPgPool?: Pool; __aetherisPgSchema?: Set<string> };
const g = globalThis as unknown as Globals;

// Hermetic tests inject a pg-mem pool here (the suite must not touch the network).
let testPool: PgPoolLike | null = null;
/** Test-only seam: route all pg backends at an injected pool (pg-mem). Pass null to restore. */
export function __setSharedPgPoolForTests(p: PgPoolLike | null) {
  testPool = p;
  g.__aetherisPgSchema = new Set();
}

/** Lazily create (once per process) the shared pool. Throws without POSTGRES_URL. */
export function getSharedPool(): Pool | PgPoolLike {
  if (testPool) return testPool;
  if (!g.__aetherisPgPool) {
    const url = process.env.POSTGRES_URL;
    if (!url) {
      throw new Error(
        "Postgres backend needs POSTGRES_URL (on Vercel: attach Neon Postgres from the Marketplace so the env var is wired automatically)."
      );
    }
    g.__aetherisPgPool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 10_000 });
  }
  return g.__aetherisPgPool;
}

/** Run idempotent schema SQL once per process (keyed so each backend ensures its own tables). */
export async function ensureSchema(key: string, sql: string): Promise<Pool | PgPoolLike> {
  const p = getSharedPool();
  g.__aetherisPgSchema ??= new Set();
  if (!g.__aetherisPgSchema.has(key)) {
    await p.query(sql);
    g.__aetherisPgSchema.add(key);
  }
  return p;
}

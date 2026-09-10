/**
 * Postgres store backend (hosted/Vercel path, e.g. Neon via Vercel Marketplace).
 * Same StoreBackend interface as the file backend: one `aetheris_kv` table keyed by
 * (collection, id) with a JSONB value. Selected with:
 *
 *   AETHERIS_STORE=postgres  +  POSTGRES_URL=postgres://... (pooled URL on Vercel)
 *
 * The pool is created lazily and cached on globalThis (the standard serverless pattern:
 * warm invocations reuse connections; `max: 5` keeps cold-start connection storms small).
 * Schema is ensured idempotently on first use — no separate migration step.
 *
 * Correctness: `update()` is read-modify-write, so it runs in a transaction with
 * SELECT ... FOR UPDATE (serialised across instances), plus the same in-process
 * per-collection lock the file backend uses (serialised within an instance).
 */
import { Pool, type PoolClient } from "pg";

const TABLE = "aetheris_kv";
const SCHEMA = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
)`;

/** Minimal structural pool surface (node-postgres Pool and the pg-mem test double both satisfy it). */
export type PgPoolLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: { value?: unknown; id?: unknown }[]; rowCount: number | null }>;
  connect: () => Promise<PgClientLike>;
};
export type PgClientLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: { value?: unknown; id?: unknown }[]; rowCount: number | null }>;
  release: () => void;
};

type Globals = { __aetherisPgPool?: Pool; __aetherisPgEnsured?: Pool | PgPoolLike | null };
const g = globalThis as unknown as Globals;

// Hermetic tests inject a pg-mem pool here (the suite must not touch the network).
let testPool: PgPoolLike | null = null;
/** Test-only seam: route the pg backend at an injected pool (pg-mem). Pass null to restore. */
export function __setStorePgPoolForTests(p: PgPoolLike | null) {
  testPool = p;
  g.__aetherisPgEnsured = null;
}

function getPool(): Pool | PgPoolLike {
  if (testPool) return testPool;
  if (!g.__aetherisPgPool) {
    const url = process.env.POSTGRES_URL;
    if (!url) {
      throw new Error(
        "AETHERIS_STORE=postgres needs POSTGRES_URL (on Vercel: attach Neon Postgres from the Marketplace so the env var is wired automatically)."
      );
    }
    g.__aetherisPgPool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 10_000 });
  }
  return g.__aetherisPgPool;
}

async function pool(): Promise<Pool | PgPoolLike> {
  const p = getPool();
  if (g.__aetherisPgEnsured !== p) {
    await p.query(SCHEMA);
    g.__aetherisPgEnsured = p;
  }
  return p;
}

const locks = new Map<string, Promise<unknown>>();
/** Serialise mutations per collection within this instance (mirrors the file backend). */
function withLock<R>(name: string, fn: () => Promise<R>): Promise<R> {
  const prev = locks.get(name) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(name, next.catch(() => undefined));
  return next;
}

async function withTx<T>(fn: (c: PoolClient | PgClientLike) => Promise<T>): Promise<T> {
  const p = await pool();
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    try { await c.query("ROLLBACK"); } catch { /* already failed */ }
    throw e;
  } finally {
    c.release();
  }
}

export const pgStore = {
  async get<T>(name: string, id: string): Promise<T | undefined> {
    const p = await pool();
    const r = await p.query(`SELECT value FROM ${TABLE} WHERE collection = $1 AND id = $2`, [name, id]);
    return r.rows[0]?.value as T | undefined;
  },
  async all<T>(name: string): Promise<Record<string, T>> {
    const p = await pool();
    const r = await p.query(`SELECT id, value FROM ${TABLE} WHERE collection = $1`, [name]);
    const out: Record<string, T> = {};
    for (const row of r.rows) out[row.id as string] = row.value as T;
    return out;
  },
  async set<T>(name: string, id: string, value: T): Promise<void> {
    return withLock(name, async () => {
      const p = await pool();
      await p.query(
        `INSERT INTO ${TABLE} (collection, id, value, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (collection, id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [name, id, value as unknown]
      );
    });
  },
  async update<T>(name: string, id: string, fn: (cur: T | undefined) => T): Promise<T> {
    return withLock(name, () =>
      withTx(async (c) => {
        const cur = await c.query(`SELECT value FROM ${TABLE} WHERE collection = $1 AND id = $2 FOR UPDATE`, [name, id]);
        const v = fn(cur.rows[0]?.value as T | undefined);
        await c.query(
          `INSERT INTO ${TABLE} (collection, id, value, updated_at) VALUES ($1, $2, $3, now())
           ON CONFLICT (collection, id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [name, id, v as unknown]
        );
        return v;
      })
    );
  },
  async remove(name: string, id: string): Promise<void> {
    return withLock(name, async () => {
      const p = await pool();
      await p.query(`DELETE FROM ${TABLE} WHERE collection = $1 AND id = $2`, [name, id]);
    });
  },
};

/**
 * Minimal JSON file store (data/<collection>.json). Good enough for a single-instance
 * deployment; swap for Postgres/KV later by keeping this interface.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const DIR = process.env.AETHERIS_DATA_DIR ?? path.join(process.cwd(), "data");
const locks = new Map<string, Promise<unknown>>();

async function readAll<T>(name: string): Promise<Record<string, T>> {
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, `${name}.json`), "utf8"));
  } catch {
    return {};
  }
}
async function writeAll<T>(name: string, data: Record<string, T>) {
  await fs.mkdir(DIR, { recursive: true });
  const file = path.join(DIR, `${name}.json`);
  await fs.writeFile(file + ".tmp", JSON.stringify(data, null, 2));
  await fs.rename(file + ".tmp", file);
}

/** Serialise mutations per collection. */
function withLock<R>(name: string, fn: () => Promise<R>): Promise<R> {
  const prev = locks.get(name) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(name, next.catch(() => undefined));
  return next;
}

export const store = {
  async get<T>(name: string, id: string): Promise<T | undefined> {
    return (await readAll<T>(name))[id];
  },
  async all<T>(name: string): Promise<Record<string, T>> {
    return readAll<T>(name);
  },
  async set<T>(name: string, id: string, value: T): Promise<void> {
    return withLock(name, async () => {
      const all = await readAll<T>(name);
      all[id] = value;
      await writeAll(name, all);
    });
  },
  async update<T>(name: string, id: string, fn: (cur: T | undefined) => T): Promise<T> {
    return withLock(name, async () => {
      const all = await readAll<T>(name);
      const v = fn(all[id]);
      all[id] = v;
      await writeAll(name, all);
      return v;
    });
  },
  async remove(name: string, id: string): Promise<void> {
    return withLock(name, async () => {
      const all = await readAll(name);
      delete all[id];
      await writeAll(name, all);
    });
  },
};

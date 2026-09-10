/**
 * Postgres store backend (hosted/Vercel path) against an in-process pg-mem database —
 * hermetic: no network, no live Postgres required. Exercises the same StoreBackend
 * interface the file store implements, through the AETHERIS_STORE dispatcher.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { store } from "../src/lib/store";
import { __setStorePgPoolForTests, type PgPoolLike } from "../src/lib/store-pg";

const prevStore = process.env.AETHERIS_STORE;
const prevUrl = process.env.POSTGRES_URL;

before(() => {
  process.env.AETHERIS_STORE = "postgres";
  delete process.env.POSTGRES_URL; // the injected pool must win; proving the tests never dial out
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  __setStorePgPoolForTests(new Pool() as unknown as PgPoolLike);
});

after(() => {
  __setStorePgPoolForTests(null);
  if (prevStore === undefined) delete process.env.AETHERIS_STORE; else process.env.AETHERIS_STORE = prevStore;
  if (prevUrl === undefined) delete process.env.POSTGRES_URL; else process.env.POSTGRES_URL = prevUrl;
});

test("pg store: set/get round-trip with JSON fidelity", async () => {
  const value = { n: 42, s: "héllo 🌍", nested: { a: [1, null, "x"] }, flag: true };
  await store.set("t1", "k1", value);
  assert.deepEqual(await store.get("t1", "k1"), value);
});

test("pg store: get on missing id returns undefined", async () => {
  assert.equal(await store.get("t1", "nope"), undefined);
});

test("pg store: all() returns every id in the collection", async () => {
  await store.set("t2", "a", { v: 1 });
  await store.set("t2", "b", { v: 2 });
  assert.deepEqual(await store.all("t2"), { a: { v: 1 }, b: { v: 2 } });
  assert.deepEqual(await store.all("t2-empty"), {});
});

test("pg store: update() modifies in place and creates when missing", async () => {
  await store.set("t3", "n", { count: 1 });
  const v = await store.update<{ count: number }>("t3", "n", (cur) => ({ count: (cur?.count ?? 0) + 1 }));
  assert.deepEqual(v, { count: 2 });
  assert.deepEqual(await store.get("t3", "n"), { count: 2 });
  const made = await store.update<{ count: number }>("t3", "new", (cur) => ({ count: (cur?.count ?? 0) + 1 }));
  assert.deepEqual(made, { count: 1 });
});

test("pg store: set() overwrites, remove() deletes", async () => {
  await store.set("t4", "k", { v: 1 });
  await store.set("t4", "k", { v: 2 });
  assert.deepEqual(await store.get("t4", "k"), { v: 2 });
  await store.remove("t4", "k");
  assert.equal(await store.get("t4", "k"), undefined);
  await store.remove("t4", "k"); // deleting twice is fine
});

test("pg store: collections are isolated", async () => {
  await store.set("iso-a", "same", { w: "a" });
  await store.set("iso-b", "same", { w: "b" });
  assert.deepEqual(await store.get("iso-a", "same"), { w: "a" });
  assert.deepEqual(await store.get("iso-b", "same"), { w: "b" });
});

test("pg store: missing POSTGRES_URL fails fast with a helpful error", async () => {
  __setStorePgPoolForTests(null);
  try {
    await assert.rejects(store.get("t1", "k1"), /POSTGRES_URL/);
  } finally {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    __setStorePgPoolForTests(new Pool() as unknown as PgPoolLike);
  }
});

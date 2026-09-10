/**
 * Runtime keys + custom providers on the shared store (hosted/Vercel path) against an
 * in-process pg-mem database. Reads stay synchronous through a write-through cache;
 * hydrate*() refreshes the cache from the store.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-rstore-"));
process.env.AETHERIS_STORE = "postgres";
delete process.env.POSTGRES_URL; // the injected pool must win; proving the tests never dial out
import { newDb } from "pg-mem";
import { __setSharedPgPoolForTests, type PgPoolLike } from "../src/lib/pg";
import {
  listRuntimeKeys, resetRuntimeKeyCacheForTests, resolvedEnv, runtimeKeyFor,
  setRuntimeKey, setRuntimeKeyAsync, hydrateRuntimeKeys,
} from "../src/lib/router/runtimeKeys";
import {
  addCustomProviderAsync, findCustomProvider, listCustomProviders, removeCustomProviderAsync,
  resetCustomProviderCacheForTests, updateCustomProviderAsync, hydrateCustomProviders,
} from "../src/lib/router/customProviders";
import { hydrateRouterStores } from "../src/lib/router/hydrate";

const prevStore = process.env.AETHERIS_STORE;
const prevUrl = process.env.POSTGRES_URL;
const prevDataDir = process.env.AETHERIS_DATA_DIR;
let pool: PgPoolLike;

before(() => {
  const { Pool } = newDb().adapters.createPg();
  pool = new Pool() as unknown as PgPoolLike;
  __setSharedPgPoolForTests(pool);
});

after(() => {
  __setSharedPgPoolForTests(null);
  if (prevStore === undefined) delete process.env.AETHERIS_STORE; else process.env.AETHERIS_STORE = prevStore;
  if (prevUrl === undefined) delete process.env.POSTGRES_URL; else process.env.POSTGRES_URL = prevUrl;
  if (prevDataDir === undefined) delete process.env.AETHERIS_DATA_DIR; else process.env.AETHERIS_DATA_DIR = prevDataDir;
});

function resetCaches() {
  resetRuntimeKeyCacheForTests();
  resetCustomProviderCacheForTests();
}

test("pg router stores: runtime keys round-trip through the store", async () => {
  resetCaches();
  await setRuntimeKeyAsync("UT_KEY_A", "sk-test-123");
  assert.equal(runtimeKeyFor("UT_KEY_A"), "sk-test-123"); // cache is write-through
  resetCaches();
  assert.equal(runtimeKeyFor("UT_KEY_A"), undefined); // cold cache knows nothing yet
  await hydrateRuntimeKeys();
  assert.equal(runtimeKeyFor("UT_KEY_A"), "sk-test-123"); // store refills it
  assert.ok(listRuntimeKeys().some((k) => k.envVar === "UT_KEY_A"));
  await setRuntimeKeyAsync("UT_KEY_A", ""); // clear
  resetCaches();
  await hydrateRuntimeKeys();
  assert.equal(runtimeKeyFor("UT_KEY_A"), undefined);
});

test("pg router stores: sync set updates the cache immediately, resolvedEnv still overrides .env", async () => {
  resetCaches();
  process.env.UT_FALLBACK_KEY = "from-env";
  try {
    assert.equal(resolvedEnv("UT_FALLBACK_KEY"), "from-env");
    setRuntimeKey("UT_FALLBACK_KEY", "from-runtime");
    assert.equal(resolvedEnv("UT_FALLBACK_KEY"), "from-runtime");
    await setRuntimeKeyAsync("UT_FALLBACK_KEY", "");
    assert.equal(resolvedEnv("UT_FALLBACK_KEY"), "from-env");
  } finally {
    delete process.env.UT_FALLBACK_KEY;
    await setRuntimeKeyAsync("UT_FALLBACK_KEY", "").catch(() => undefined);
  }
});

test("pg router stores: custom providers round-trip through the store", async () => {
  resetCaches();
  const rec = await addCustomProviderAsync({ name: "UT Ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3", local: true });
  assert.ok(rec.id.startsWith("user-"));
  assert.equal(findCustomProvider(rec.id)?.model, "llama3");
  resetCaches();
  assert.equal(findCustomProvider(rec.id), undefined); // cold cache
  await hydrateCustomProviders();
  assert.equal(findCustomProvider(rec.id)?.name, "UT Ollama");
  assert.ok(listCustomProviders().some((p) => p.id === rec.id));
  const updated = await updateCustomProviderAsync(rec.id, { model: "mistral" });
  assert.equal(updated?.model, "mistral");
  assert.equal(await removeCustomProviderAsync(rec.id), true);
  assert.equal(await removeCustomProviderAsync(rec.id), false);
  resetCaches();
  await hydrateCustomProviders();
  assert.equal(findCustomProvider(rec.id), undefined);
});

test("pg router stores: hydrateRouterStores refreshes both, and never throws on a dead store", async () => {
  resetCaches();
  await setRuntimeKeyAsync("UT_KEY_B", "sk-b");
  await addCustomProviderAsync({ name: "UT Remote", baseUrl: "https://example.com/v1", model: "x" });
  resetCaches();
  await hydrateRouterStores(true);
  assert.equal(runtimeKeyFor("UT_KEY_B"), "sk-b");
  assert.ok(listCustomProviders().some((p) => p.name === "UT Remote"));

  const broken: PgPoolLike = { query: async () => { throw new Error("store is down"); }, connect: async () => { throw new Error("store is down"); } };
  __setSharedPgPoolForTests(broken);
  try {
    resetCaches();
    await hydrateRouterStores(true); // resolves; degrade to cache + .env
    assert.equal(runtimeKeyFor("UT_KEY_B"), undefined);
  } finally {
    __setSharedPgPoolForTests(pool);
  }
  resetCaches();
  await hydrateRouterStores(true);
  assert.equal(runtimeKeyFor("UT_KEY_B"), "sk-b"); // healthy again
});

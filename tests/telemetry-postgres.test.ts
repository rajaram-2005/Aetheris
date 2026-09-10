/**
 * Telemetry postgres backend (hosted/Vercel path) against an in-process pg-mem database.
 * `record()` stays synchronous (fire-and-forget insert); reads go through the async mirrors.
 */
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-tev-"));
process.env.AETHERIS_EVENTS = "postgres";
delete process.env.POSTGRES_URL; // the injected pool must win; proving the tests never dial out
import { newDb } from "pg-mem";
import { __setSharedPgPoolForTests, type PgPoolLike } from "../src/lib/pg";
import {
  __flushPgEventsForTests, clearAsync, eventStoreStatusAsync, isPgEvents,
  loadPersistedAsync, query, queryAsync, record, summaryAsync,
} from "../src/core/observability/events";

const prevEvents = process.env.AETHERIS_EVENTS;
const prevUrl = process.env.POSTGRES_URL;
const prevDataDir = process.env.AETHERIS_DATA_DIR;
let pool: PgPoolLike;

before(() => {
  pool = mkPool();
  __setSharedPgPoolForTests(pool);
});

beforeEach(async () => {
  __setSharedPgPoolForTests(pool);
  await clearAsync();
});

after(() => {
  __setSharedPgPoolForTests(null);
  if (prevEvents === undefined) delete process.env.AETHERIS_EVENTS; else process.env.AETHERIS_EVENTS = prevEvents;
  if (prevUrl === undefined) delete process.env.POSTGRES_URL; else process.env.POSTGRES_URL = prevUrl;
  if (prevDataDir === undefined) delete process.env.AETHERIS_DATA_DIR; else process.env.AETHERIS_DATA_DIR = prevDataDir;
});

function mkPool(): PgPoolLike {
  const { Pool } = newDb().adapters.createPg();
  return new Pool() as unknown as PgPoolLike;
}

test("pg telemetry: record is sync and durable after flush", async () => {
  assert.equal(isPgEvents(), true);
  const ev = record({ type: "tool", uid: "tev-u1", capability: "telemetry:test", ok: true, ms: 12, detail: "hello", meta: { a: 1 } });
  assert.ok(ev.id && ev.at > 0);
  await __flushPgEventsForTests();
  const rows = await queryAsync({ type: "tool", uid: "tev-u1" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detail, "hello");
  assert.deepEqual(rows[0].meta, { a: 1 });
  assert.equal(rows[0].ms, 12);
});

test("pg telemetry: filters mirror the sync query semantics", async () => {
  record({ type: "model", uid: "tev-u2", capability: "m:a", ok: true });
  record({ type: "model", uid: "tev-u2", capability: "m:b", ok: false });
  record({ type: "tool", capability: "global-cap", ok: true }); // no uid: visible to every uid
  await __flushPgEventsForTests();
  assert.equal((await queryAsync({ uid: "tev-u2", limit: 50 })).length, 3);
  assert.equal((await queryAsync({ uid: "tev-u2", type: "model" })).length, 2);
  assert.equal((await queryAsync({ uid: "tev-u2", capability: "m:b" })).length, 1);
  assert.equal((await queryAsync({ uid: "tev-u2", okOnly: false })).length, 1);
  assert.equal((await queryAsync({ uid: "tev-u2", since: Date.now() + 60_000 })).length, 0);
  assert.equal((await queryAsync({ uid: "tev-nobody", limit: 50 })).length, 1); // the global one
});

test("pg telemetry: summary and status read the durable log", async () => {
  record({ type: "agent", uid: "tev-u3", capability: "ag:x", ok: true, ms: 100 });
  record({ type: "agent", uid: "tev-u3", capability: "ag:x", ok: false, ms: 50 });
  await __flushPgEventsForTests();
  const s = await summaryAsync(60_000);
  assert.equal(s.events, 2);
  assert.equal(s.errors, 1);
  assert.equal(s.byType.agent.n, 2);
  assert.equal(s.persistedRows, 2);
  assert.equal(s.persistent, true);
  const st = await eventStoreStatusAsync();
  assert.equal(st.persistent, true);
  assert.equal(st.driver, "postgres");
  assert.equal(st.rows, 2);
});

test("pg telemetry: loadPersistedAsync restores the tail without duplicating", async () => {
  record({ type: "memory", uid: "tev-u4", ok: true });
  await __flushPgEventsForTests();
  const n = await loadPersistedAsync();
  assert.equal(n, 0); // already in this instance's buffer: deduped, not doubled
  assert.equal((await queryAsync({ uid: "tev-u4" })).length, 1);
});

test("pg telemetry: sync query still sees this instance's buffer", async () => {
  record({ type: "device", uid: "tev-u5", ok: true });
  await __flushPgEventsForTests();
  assert.ok(query({ uid: "tev-u5" }).length >= 1);
});

test("pg telemetry: a dead database never breaks record()", async () => {
  __setSharedPgPoolForTests(mkPool()); // fresh empty db, schema ensures fine — now break it:
  __setSharedPgPoolForTests(null); // no pool + no POSTGRES_URL: every insert throws inside
  try {
    const ev = record({ type: "error", uid: "tev-u6", ok: false, detail: "boom" });
    await __flushPgEventsForTests();
    assert.ok(ev.id);
    assert.ok(query({ uid: "tev-u6" }).some((e) => e.id === ev.id)); // buffer still captured it
  } finally {
    __setSharedPgPoolForTests(pool);
  }
});

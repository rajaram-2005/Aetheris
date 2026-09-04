import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-perf-"));
process.env.AETHERIS_KNOWLEDGE_DB = path.join(process.env.AETHERIS_DATA_DIR, "k.sqlite");
import { store } from "../src/lib/store";
import { bootCapabilities } from "../src/core/capabilities/sources";
import { allCapabilities, searchCapabilities } from "../src/core/capabilities/registry";
import { addFact, queryFacts } from "../src/core/knowledge/fabric";

/** Performance budgets (generous: CI machines are slow). A 3× regression fails. */
test("store: cached reads are cheap and writes stay durable", async () => {
  for (let i = 0; i < 100; i++) await store.set("p", `k${i}`, { i });
  const t = Date.now(); for (let i = 0; i < 200; i++) await store.get("p", `k${i % 100}`); const ms = Date.now() - t;
  assert.ok(ms < 400, `200 cached reads took ${ms} ms`);
  assert.deepEqual(await store.get("p", "k99"), { i: 99 });
});
test("registry: warm listing under 5 ms, search under 25 ms", async () => {
  bootCapabilities(); await allCapabilities();
  let t = Date.now(); for (let i = 0; i < 20; i++) await allCapabilities(); assert.ok((Date.now() - t) / 20 < 5);
  t = Date.now(); for (let i = 0; i < 20; i++) await searchCapabilities({ q: "github review", limit: 10 }); assert.ok((Date.now() - t) / 20 < 25);
});
test("knowledge: 300 facts insert + hybrid query budget", async () => {
  const t0 = Date.now(); for (let i = 0; i < 300; i++) await addFact({ uid: "p", text: `Sensor S${i} in Zone ${i % 7} reads ${20 + (i % 15)} degrees on line ${i % 3}`, provenance: { kind: "device", confidence: 0.8 } }); const ins = Date.now() - t0;
  const t1 = Date.now(); for (let i = 0; i < 20; i++) await queryFacts("p", `sensor zone ${i % 7} temperature`, { k: 5 }); const q = (Date.now() - t1) / 20;
  assert.ok(ins < 15_000, `insert ${ins} ms`); assert.ok(q < 150, `query ${q} ms`);
});

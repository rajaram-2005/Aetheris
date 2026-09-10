/**
 * Knowledge fabric postgres backend (hosted/Vercel path) against an in-process pg-mem
 * database — hermetic: no network, no live Postgres required. Mirrors the sqlite backend's
 * key behaviours plus the eval retrieval cases, through the AETHERIS_KNOWLEDGE dispatcher.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-kpg-"));
process.env.AETHERIS_KNOWLEDGE = "postgres";
delete process.env.POSTGRES_URL; // the injected pool must win; proving the tests never dial out
import { newDb } from "pg-mem";
import { __setSharedPgPoolForTests, type PgPoolLike } from "../src/lib/pg";
import {
  addFact, deleteFact, fabricStatus, getFact, listFacts, neighbors, queryFacts, reindexEmbeddings,
} from "../src/core/knowledge/fabric";
import cases from "../evals/cases.json";

const prevKnowledge = process.env.AETHERIS_KNOWLEDGE;
const prevUrl = process.env.POSTGRES_URL;
const prevDataDir = process.env.AETHERIS_DATA_DIR;
const prevSemantic = process.env.AETHERIS_SEMANTIC;

before(() => {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  __setSharedPgPoolForTests(new Pool() as unknown as PgPoolLike);
});

after(() => {
  __setSharedPgPoolForTests(null);
  if (prevKnowledge === undefined) delete process.env.AETHERIS_KNOWLEDGE; else process.env.AETHERIS_KNOWLEDGE = prevKnowledge;
  if (prevUrl === undefined) delete process.env.POSTGRES_URL; else process.env.POSTGRES_URL = prevUrl;
  if (prevDataDir === undefined) delete process.env.AETHERIS_DATA_DIR; else process.env.AETHERIS_DATA_DIR = prevDataDir;
  if (prevSemantic === undefined) delete process.env.AETHERIS_SEMANTIC; else process.env.AETHERIS_SEMANTIC = prevSemantic;
});

test("pg fabric: add/get/list/delete round-trip with uid isolation", async () => {
  const st = await fabricStatus();
  assert.equal(st.available, true);
  const f = await addFact({ uid: "pgu1", text: "Rajaram works at Aetheris Labs", provenance: { kind: "user", confidence: 0.9 } });
  assert.equal(f.uid, "pgu1");
  assert.deepEqual((await getFact("pgu1", f.id))?.text, f.text);
  assert.equal(await getFact("pgu1", "missing"), undefined);
  await addFact({ uid: "pgu1", text: "Second fact", provenance: { kind: "user", confidence: 0.5 } });
  await addFact({ uid: "pgother", text: "Rajaram secret for other user", provenance: { kind: "user", confidence: 1 } });
  const mine = await listFacts("pgu1");
  assert.equal(mine.length, 2);
  assert.ok(mine.every((x) => x.uid === "pgu1"));
  assert.equal(await deleteFact("pgu1", f.id), true);
  assert.equal(await deleteFact("pgu1", f.id), false);
});

test("pg fabric: hybrid query ranks the lexical match first, graph finds the triple", async () => {
  const f1 = await addFact({ uid: "pgu2", text: "Rajaram works at Aetheris Labs", provenance: { kind: "user", confidence: 0.9 }, validFrom: 1000 });
  await addFact({ uid: "pgu2", text: "The ESP32 boiler node measures temperature every 5 seconds", tags: ["device"], provenance: { kind: "device", ref: "esp32-1", confidence: 0.7 } });
  const hits = await queryFacts("pgu2", "where does Rajaram work?");
  assert.equal(hits[0].fact.id, f1.id);
  assert.ok(hits.every((h) => h.fact.uid === "pgu2"));
  const g = await neighbors("pgu2", "Rajaram");
  assert.ok(g.edges.some((e) => e.rel === "works_at" && e.dst === "Aetheris Labs"));
});

test("pg fabric: keyword / vector / graph modes each hit", async () => {
  // Two entities (Rajaram, ESP32) so extractTriples yields a "monitors" edge for the graph leg.
  await addFact({ uid: "pgu3", text: "Rajaram monitors the ESP32 boiler node", provenance: { kind: "device", confidence: 0.8 } });
  for (const mode of ["keyword", "vector", "graph"] as const) {
    const hits = await queryFacts("pgu3", "Rajaram boiler", { mode });
    assert.ok(hits.length > 0, mode);
    assert.ok(hits[0].via.includes(mode), `${mode} leg attributed`);
  }
});

test("pg fabric: temporal supersession, tags filter and workspaces", async () => {
  const f1 = await addFact({ uid: "pgu4", text: "Rajaram works at Aetheris Labs", provenance: { kind: "user", confidence: 0.9 } });
  await addFact({ uid: "pgu4", text: "Rajaram works at Arena", provenance: { kind: "user", confidence: 0.95 }, supersedes: f1.id });
  const now = await queryFacts("pgu4", "Rajaram works", { asOf: Date.now() + 1000 });
  assert.ok(now.length > 0 && now[0].fact.text.includes("Arena"));
  const past = await queryFacts("pgu4", "Rajaram works", { asOf: f1.createdAt });
  assert.ok(past.some((h) => h.fact.id === f1.id));
  await addFact({ uid: "pgu4", workspace: "ws2", text: "Rajaram works at Arena", provenance: { kind: "user", confidence: 0.9 } });
  const scoped = await queryFacts("pgu4", "Rajaram works", { workspace: "ws2" });
  assert.ok(scoped.length > 0 && scoped.every((h) => h.fact.workspace === "ws2"));
  await addFact({ uid: "pgu4", text: "Tagged fact about turbines", tags: ["turbine"], provenance: { kind: "user", confidence: 0.9 } });
  const tagged = await queryFacts("pgu4", "turbines", { tags: ["turbine"] });
  assert.ok(tagged.length > 0 && tagged.every((h) => h.fact.tags.includes("turbine")));
});

test("pg fabric: reindex re-embeds rows into the current space", async () => {
  await addFact({ uid: "pgu5", text: "Reindex me", provenance: { kind: "user", confidence: 0.9 } });
  process.env.AETHERIS_SEMANTIC = "0"; // flip the space so every row is stale
  try {
    const r = await reindexEmbeddings();
    assert.equal(r.space, "hash");
    assert.ok(r.reindexed >= 1);
    const st = await fabricStatus();
    assert.equal(st.available, true);
  } finally {
    if (prevSemantic === undefined) delete process.env.AETHERIS_SEMANTIC; else process.env.AETHERIS_SEMANTIC = prevSemantic;
  }
});

test("pg fabric: eval retrieval parity (same cases, same thresholds)", async () => {
  // Deterministic lexical conditions: semantic learning state varies with what earlier tests
  // added, so pin the lexical+hash path — the keyword leg must carry the same 4/5 either way.
  process.env.AETHERIS_SEMANTIC = "0";
  try {
    const ids: string[] = [];
    for (const t of cases.retrieval.facts) {
      ids.push((await addFact({ uid: "pgeval", text: t, provenance: { kind: "user", confidence: 0.9 } })).id);
    }
    const h1: boolean[] = [], h3: boolean[] = [];
    for (const q of cases.retrieval.queries) {
      const hits = await queryFacts("pgeval", q.q, { k: 3 });
      const rank = hits.findIndex((h) => h.fact.id === ids[q.expect]);
      h1.push(rank === 0); h3.push(rank >= 0);
    }
    const s1 = h1.filter(Boolean).length / h1.length, s3 = h3.filter(Boolean).length / h3.length;
    assert.ok(s1 >= 0.6, `hit@1 ${s1}`);
    assert.ok(s3 >= 0.8, `hit@3 ${s3}`);
  } finally {
    if (prevSemantic === undefined) delete process.env.AETHERIS_SEMANTIC; else process.env.AETHERIS_SEMANTIC = prevSemantic;
  }
});

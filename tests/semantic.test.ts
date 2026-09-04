import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AETHERIS_KNOWLEDGE_DB = path.join(mkdtempSync(path.join(tmpdir(), "aeth-sem-")), "k.sqlite");
process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-semd-"));

import { createModel, cosine, deserialize, learn, randomIndex, serialize, stats, vector } from "../src/core/knowledge/semantic";
import { addFact, fabricStatus, queryFacts, reindexEmbeddings, localEmbed } from "../src/core/knowledge/fabric";

const CORPUS = [
  "The kitten slept on the warm soft blanket near the window",
  "The cat slept on the warm soft cushion near the window",
  "A small kitten purrs on a soft blanket and drinks warm milk",
  "The cat purrs on a soft cushion and drinks warm milk",
  "The kitten has soft fur and sharp little claws",
  "The cat has soft fur and sharp little claws",
  "Postgres stores rows in tables and uses indexes for fast queries",
  "The database engine writes rows to disk and builds indexes",
  "SQL queries scan tables in the database and use indexes",
];

const trained = () => {
  const m = createModel();
  for (const t of CORPUS) learn(m, t);
  return m;
};

// --------------------------------------------------------------------------- the model itself

test("semantic: words that share no characters become similar when they share contexts", () => {
  const m = trained();
  const near = cosine(vector(m, "kitten"), vector(m, "cat"));
  const far = cosine(vector(m, "kitten"), vector(m, "database"));
  assert.ok(near > 0.5, `"kitten" and "cat" should converge, got ${near.toFixed(3)}`);
  assert.ok(far < 0.15, `"kitten" and "database" should stay apart, got ${far.toFixed(3)}`);
  assert.ok(near > far + 0.3, `semantic distance must separate them (${near.toFixed(3)} vs ${far.toFixed(3)})`);

  // The lexical embedder the fabric used before cannot do this at all — measured, not asserted.
  assert.equal(cosine(localEmbed("kitten"), localEmbed("cat")), 0, "hashed n-grams share nothing");
  assert.ok(cosine(vector(m, "cat"), vector(m, "indexes")) < 0.15, "unrelated domains stay apart");
});

test("semantic: index vectors are deterministic and the model survives a serialize round-trip", () => {
  const a = randomIndex("kitten");
  const b = randomIndex("kitten");
  assert.deepEqual(Array.from(a), Array.from(b), "same word → same index vector in every process");
  assert.notDeepEqual(Array.from(randomIndex("cat")), Array.from(a));
  // Sparse: exactly SPARSITY slots touched (some may cancel, so allow fewer, never more).
  const nonZero = Array.from(a).filter((x) => x !== 0).length;
  assert.ok(nonZero > 0 && nonZero <= 8, `${nonZero} non-zero slots`);

  const m = trained();
  const restored = deserialize(serialize(m));
  assert.equal(stats(restored).words, stats(m).words);
  assert.equal(stats(restored).learnedFrom, stats(m).learnedFrom);
  assert.ok(Math.abs(cosine(vector(restored, "kitten"), vector(m, "kitten")) - 1) < 1e-6, "vectors are unchanged by the round-trip");
  assert.equal(deserialize("not json").contexts.size, 0, "a corrupt blob degrades to an empty model");
});

test("semantic: an untrained model reports that honestly instead of pretending", () => {
  const empty = createModel();
  assert.equal(stats(empty).words, 0);
  assert.equal(stats(empty).learnedFrom, 0);
  const s = stats(trained());
  assert.ok(s.words > 10, `${s.words} words learned`);
  assert.equal(s.learnedFrom, CORPUS.length);
  assert.match(s.kind, /offline/);
});

// --------------------------------------------------------------------------- through the fabric

test("semantic: vector search finds a fact the query shares no words with", async () => {
  const uid = "sem-fabric-" + Date.now();
  for (const t of CORPUS) await addFact({ uid, text: t, provenance: { kind: "user", confidence: 1 } });

  // "kitten blanket" shares no token at all with the cat facts — only the learned vectors connect them.
  const byVector = await queryFacts(uid, "kitten blanket", { mode: "vector", k: 3 });
  const byKeyword = await queryFacts(uid, "kitten blanket", { mode: "keyword", k: 3 });
  assert.ok(byVector.length > 0, "vector search returned nothing");
  const vectorTexts = byVector.map((h) => h.fact.text);
  const keywordTexts = byKeyword.map((h) => h.fact.text);
  assert.ok(vectorTexts.filter((t) => /^The cat/i.test(t)).length >= 2, `vector mode reached the cat facts: ${vectorTexts.join(" | ")}`);
  assert.equal(keywordTexts.filter((t) => /^The cat/i.test(t)).length, 0, `keyword mode cannot: ${keywordTexts.join(" | ")}`);
  assert.ok(byVector.every((h) => h.via.includes("vector")));
});

test("semantic: the fabric reports which embedder it is actually using", async () => {
  const st = await fabricStatus();
  assert.equal(st.available, true);
  if (!st.available) throw new Error(String(st.error));
  assert.match(st.embeddings!, /local semantic \(random indexing, \d+ words from \d+ documents, offline\)/, st.embeddings);
  assert.equal(st.semantic!.enabled, true);
  assert.ok(st.semantic!.learnedFrom >= CORPUS.length);
  assert.ok(st.vecSpaces!.some((v: string) => v.startsWith("semantic:")), JSON.stringify(st.vecSpaces));
});

test("semantic: reindexEmbeddings() moves rows between spaces, and AETHERIS_SEMANTIC=0 goes lexical", async () => {
  const uid = "sem-reindex-" + Date.now();
  await addFact({ uid, text: "The kitten napped on the warm blanket", provenance: { kind: "user", confidence: 1 } });
  const before = await fabricStatus();
  assert.ok(before.vecSpaces!.every((v: string) => !v.startsWith("hash:")), JSON.stringify(before.vecSpaces));

  process.env.AETHERIS_SEMANTIC = "0";
  try {
    await addFact({ uid, text: "The cat napped on the warm cushion", provenance: { kind: "user", confidence: 1 } });
    const mixed = await fabricStatus();
    assert.ok(mixed.vecSpaces!.some((v: string) => v.startsWith("hash:")), `a lexical row is tagged as such: ${JSON.stringify(mixed.vecSpaces)}`);
    assert.ok(mixed.vecSpaces!.some((v: string) => v.startsWith("semantic:")), "and the semantic rows keep their tag");

    const r = await reindexEmbeddings();
    assert.equal(r.space, "hash", "the current space is lexical while the flag is off");
    assert.ok(r.reindexed >= 1, `${r.reindexed} rows moved`);
    const after = await fabricStatus();
    assert.ok(after.vecSpaces!.every((v: string) => v.startsWith("hash:")), `everything is in one space again: ${JSON.stringify(after.vecSpaces)}`);
  } finally {
    delete process.env.AETHERIS_SEMANTIC;
  }
});

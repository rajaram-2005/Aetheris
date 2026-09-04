import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.AETHERIS_KNOWLEDGE_DB = path.join(mkdtempSync(path.join(tmpdir(), "aeth-")), "k.sqlite");
import { addFact, queryFacts, neighbors, extractEntities, extractTriples, localEmbed, cosine, fabricStatus, deleteFact } from "../src/core/knowledge/fabric";
import { remember, recall, listMemory, workingSet, workingGet, pushShortTerm, getShortTerm } from "../src/core/memory/memory";

test("entity + triple extraction", () => {
  const ents = extractEntities("Rajaram built Aetheris One in Chennai using `node:sqlite`.");
  assert.ok(ents.includes("Rajaram") && ents.includes("Aetheris One") && ents.includes("node:sqlite"));
  const t = extractTriples("Rajaram built Aetheris One", ["Rajaram", "Aetheris One"]);
  assert.deepEqual(t, [{ src: "Rajaram", rel: "built", dst: "Aetheris One" }]);
});
test("local embedding is normalised and similarity-preserving", () => {
  const a = localEmbed("temperature sensor on the boiler"), b = localEmbed("boiler temperature sensor"), c = localEmbed("quarterly marketing budget");
  assert.ok(Math.abs(cosine(a, a) - 1) < 1e-5);
  assert.ok(cosine(a, b) > cosine(a, c));
});
test("hybrid query, graph and temporal supersession", async () => {
  const st = await fabricStatus(); assert.equal(st.available, true);
  const f1 = await addFact({ uid: "u", text: "Rajaram works at Aetheris Labs", provenance: { kind: "user", confidence: 0.9 }, validFrom: 1000 });
  await addFact({ uid: "u", text: "The ESP32 boiler node measures temperature every 5 seconds", tags: ["device"], provenance: { kind: "device", ref: "esp32-1", confidence: 0.7 } });
  await addFact({ uid: "other", text: "Rajaram secret for other user", provenance: { kind: "user", confidence: 1 } });
  const hits = await queryFacts("u", "where does Rajaram work?");
  assert.equal(hits[0].fact.id, f1.id); assert.ok(hits.every((h) => h.fact.uid === "u"));
  const g = await neighbors("u", "Rajaram"); assert.ok(g.edges.some((e) => e.rel === "works_at" && e.dst === "Aetheris Labs"));
  const f2 = await addFact({ uid: "u", text: "Rajaram works at Arena", provenance: { kind: "user", confidence: 0.95 }, supersedes: f1.id });
  const now = await queryFacts("u", "Rajaram works", { asOf: Date.now() + 1000 });
  assert.ok(now.some((h) => h.fact.id === f2.id) && !now.some((h) => h.fact.id === f1.id));
  const past = await queryFacts("u", "Rajaram works", { asOf: 2000 });
  assert.ok(past.some((h) => h.fact.id === f1.id) && !past.some((h) => h.fact.id === f2.id));
  assert.equal(await deleteFact("u", f2.id), true);
});
test("typed memory remember/recall/dedupe + working/short-term", async () => {
  const a = await remember("m", "semantic", "User prefers Tamil replies"); const b = await remember("m", "semantic", "user prefers tamil replies");
  assert.equal(a!.id, b!.id);
  await remember("m", "procedural", "To deploy, run npm run build then vercel --prod", { tags: ["deploy"] });
  const r = await recall("m", "how do I deploy?"); assert.equal(r[0].type, "procedural");
  assert.equal((await listMemory("m", "semantic")).length, 1);
  workingSet("job1", "plan", ["a", "b"]); assert.deepEqual(workingGet("job1", "plan"), ["a", "b"]);
  pushShortTerm("s1", "user", "hi"); assert.equal(getShortTerm("s1").length, 1);
});

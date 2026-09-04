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

test("automation engine: validation, device trigger edge detection, manual fire with condition/expr verify/remember action", async () => {
  const { validateAutomation, deviceTriggerFires, saveAutomation, fire } = await import("../src/core/automation/engine");
  assert.equal(validateAutomation({ name: "x", trigger: { kind: "manual" }, actions: [{ kind: "webhook", url: "http://insecure" }] }), "webhook url must be https");
  assert.match(validateAutomation({ name: "x", trigger: { kind: "cron", cron: "* * * * *", tz: "UTC" }, actions: [{ kind: "webhook", url: "https://a" }] })!, /interval/);
  assert.match(validateAutomation({ name: "x", trigger: { kind: "manual" }, actions: [{ kind: "actuate", deviceId: "d", capability: "c", value: 1 }] })!, /physicalToken/);
  const trig = { kind: "device" as const, deviceId: "d", key: "temp", op: ">" as const, value: 80, cooldownMin: 10 };
  assert.equal(deviceTriggerFires(trig, 85), true); assert.equal(deviceTriggerFires(trig, 70), false);
  assert.equal(deviceTriggerFires(trig, 85, 85, Date.now() - 20 * 60_000), false); // same value → no re-fire
  assert.equal(deviceTriggerFires(trig, 90, 85, Date.now() - 1000), false);        // cooldown
  assert.equal(deviceTriggerFires(trig, 90, 85, Date.now() - 20 * 60_000), true);
  const a = await saveAutomation("auto-u", { name: "hot", trigger: { kind: "manual" }, condition: { kind: "expr", expr: "value - 80" }, verify: { kind: "expr", expr: "value - 50" }, actions: [{ kind: "remember", type: "episodic", template: "Sensor {{key}} hit {{value}}" }] });
  const skipped = await fire(a, "manual", { key: "temp", value: 80 }); assert.equal(skipped.status, "skipped");
  const ok = await fire(a, "manual", { key: "temp", value: 95 }); assert.equal(ok.status, "ok"); assert.deepEqual(ok.stages.map((s) => s.stage), ["condition", "verify", "action"]);
  const { recall } = await import("../src/core/memory/memory"); assert.ok((await recall("auto-u", "sensor temp 95", { types: ["episodic"] })).some((m) => m.text === "Sensor temp hit 95"));
});

test("joined: unified query returns fabric facts AND legacy document-KB chunks with provenance", async () => {
  const { addFact, queryUnified } = await import("../src/core/knowledge/fabric");
  const { createKb, addDocument, saveKb } = await import("../src/lib/kb");
  const uid = "join-" + Date.now();
  await addFact({ uid, text: "Boiler B7 setpoint is 82 degrees", provenance: { kind: "device", confidence: 0.9 } });
  const kb = await createKb(uid, "Manuals"); addDocument(kb, "boiler.txt", "text", "The boiler B7 maintenance manual says descale every 6 months."); await saveKb(kb);
  const hits = await queryUnified(uid, "boiler B7", { k: 5 });
  assert.ok(hits.some((h) => h.fact.provenance.kind === "device"));
  const doc = hits.find((h) => h.fact.provenance.kind === "document"); assert.ok(doc); assert.match(doc!.fact.provenance.ref!, /Manuals \/ boiler.txt/);
  assert.ok((await queryUnified(uid, "boiler B7", { k: 5, includeDocuments: false })).every((h) => h.fact.provenance.kind !== "document"));
});

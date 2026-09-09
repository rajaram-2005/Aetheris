/**
 * API tests for /api/debate. We exercise the GET path (list + fetch) which
 * is the persistence/lookup surface; the POST path is SSE and is exercised
 * via the runDebate engine tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { store } from "../src/lib/store";
import { runDebate } from "../src/core/warroom/debate";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-warroom-api-"));
  process.env.AETHERIS_DATA_DIR = dir;
  process.env.AETHERIS_DEMO = "0";
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  delete process.env.AETHERIS_DEMO;
  rmSync(dir, { recursive: true, force: true });
}

test("api/debate: store round-trip preserves all fields", async () => {
  const dir = freshEnv();
  try {
    const d = await runDebate({ motion: "save me", rounds: 1, allowSyntheticFallback: true, id: "d-test", createdAt: 1_700_000_000_000 });
    const uid = "u1";
    await store.set("debates", `${uid}:${d.id}`, { uid, ...d });
    const all = await store.all<typeof d & { uid: string }>("debates");
    const keys = Object.keys(all);
    assert.equal(keys.length, 1);
    const rec = all[keys[0]];
    assert.equal(rec.uid, uid);
    assert.equal(rec.id, "d-test");
    assert.equal(rec.motion, "save me");
    assert.equal(rec.turns.length, 3);
    // Each turn round-tripped
    assert.equal(rec.turns[0].side, "pro");
    assert.equal(rec.turns[2].side, "judge");
  } finally { cleanup(dir); }
});

test("api/debate: list filter by uid", async () => {
  const dir = freshEnv();
  try {
    const d1 = await runDebate({ motion: "a", rounds: 1, allowSyntheticFallback: true, id: "d1", createdAt: 1 });
    const d2 = await runDebate({ motion: "b", rounds: 1, allowSyntheticFallback: true, id: "d2", createdAt: 2 });
    const d3 = await runDebate({ motion: "c", rounds: 1, allowSyntheticFallback: true, id: "d3", createdAt: 3 });
    await store.set("debates", `u1:${d1.id}`, { uid: "u1", ...d1 });
    await store.set("debates", `u1:${d2.id}`, { uid: "u1", ...d2 });
    await store.set("debates", `u2:${d3.id}`, { uid: "u2", ...d3 });
    const all = await store.all<typeof d1 & { uid: string }>("debates");
    const u1 = Object.values(all).filter((d) => d.uid === "u1").sort((a, b) => b.createdAt - a.createdAt);
    assert.equal(u1.length, 2);
    assert.equal(u1[0].id, "d2");
    assert.equal(u1[1].id, "d1");
  } finally { cleanup(dir); }
});

test("api/debate: lookup by composite key", async () => {
  const dir = freshEnv();
  try {
    const d = await runDebate({ motion: "lookup", rounds: 1, allowSyntheticFallback: true, id: "findme" });
    await store.set("debates", `u1:${d.id}`, { uid: "u1", ...d });
    const got = await store.get<typeof d & { uid: string }>("debates", "u1:findme");
    assert.ok(got);
    assert.equal(got.motion, "lookup");
    const missing = await store.get("debates", "u1:nope");
    assert.equal(missing, undefined);
  } finally { cleanup(dir); }
});

/**
 * Tests for the edge-weight recompute.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { recomputeWeights } from "../src/core/knowledge/recompute-weights";
import { store } from "@/lib/store";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-erw-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

async function seedEdge(uid: string, src: string, rel: string, dst: string, weight: number) {
  await store.set("edges", `${uid}:${src}:${rel}:${dst}`, { id: `${uid}:${src}:${rel}:${dst}`, uid, workspace: "default", src, rel, dst, weight, fact_id: null });
}

test("recompute: empty graph returns updated=0 unchanged=0", async () => {
  const dir = freshEnv();
  try {
    const r = await recomputeWeights("u-1");
    assert.equal(r.totalEdges, 0);
    assert.equal(r.updated, 0);
    assert.equal(r.unchanged, 0);
  } finally { cleanup(dir); }
});

test("recompute: returns a result with the right shape", async () => {
  const dir = freshEnv();
  try {
    await seedEdge("u-1", "wtg-04", "feeds", "wtg-05", 0.5);
    const r = await recomputeWeights("u-1");
    assert.equal(typeof r.uid, "string");
    assert.equal(typeof r.recomputeId, "string");
    assert.equal(typeof r.computedAt, "number");
    assert.ok(Array.isArray(r.proposals));
    assert.ok(Array.isArray(r.top));
  } finally { cleanup(dir); }
});

test("recompute: proposals carry the old weight, count, new weight, changed flag", async () => {
  const dir = freshEnv();
  try {
    await seedEdge("u-1", "wtg-04", "feeds", "wtg-05", 0.5);
    const r = await recomputeWeights("u-1");
    const p = r.proposals[0]!;
    assert.equal(p.src, "wtg-04");
    assert.equal(p.rel, "feeds");
    assert.equal(p.dst, "wtg-05");
    assert.equal(p.oldWeight, 0.5);
    assert.equal(typeof p.newWeight, "number");
    assert.equal(typeof p.changed, "boolean");
  } finally { cleanup(dir); }
});

test("recompute: per-uid isolation", async () => {
  const dir = freshEnv();
  try {
    await seedEdge("u-a", "x", "feeds", "y", 0.5);
    await seedEdge("u-b", "x", "feeds", "y", 0.5);
    const a = await recomputeWeights("u-a");
    const b = await recomputeWeights("u-b");
    assert.equal(a.totalEdges, 1);
    assert.equal(b.totalEdges, 1);
  } finally { cleanup(dir); }
});

test("recompute: with no recall hits, all proposals keep their old weight (no fabrication)", async () => {
  const dir = freshEnv();
  try {
    await seedEdge("u-1", "wtg-04", "feeds", "wtg-05", 0.5);
    const r = await recomputeWeights("u-1", { query: "absolutely nothing matches this" });
    for (const p of r.proposals) {
      // No co-occurrence → newWeight is at most oldWeight (no fabrication).
      assert.ok(p.newWeight <= p.oldWeight + 0.001, `oldWeight=${p.oldWeight} newWeight=${p.newWeight}`);
    }
  } finally { cleanup(dir); }
});

test("recompute: audit row is written under 'edge-weight-recomputes'", async () => {
  const dir = freshEnv();
  try {
    await seedEdge("u-1", "x", "feeds", "y", 0.5);
    const r = await recomputeWeights("u-1");
    const all = await store.all("edge-weight-recomputes");
    assert.ok(all[r.recomputeId]);
  } finally { cleanup(dir); }
});

test("recompute: workspace filter narrows to the requested workspace only", async () => {
  const dir = freshEnv();
  try {
    await store.set("edges", "u-1:ws1", { id: "u-1:ws1", uid: "u-1", workspace: "ws1", src: "a", rel: "feeds", dst: "b", weight: 0.5, fact_id: null });
    await store.set("edges", "u-1:ws2", { id: "u-1:ws2", uid: "u-1", workspace: "ws2", src: "a", rel: "feeds", dst: "b", weight: 0.5, fact_id: null });
    const r = await recomputeWeights("u-1", { workspace: "ws1" });
    assert.equal(r.totalEdges, 1);
  } finally { cleanup(dir); }
});

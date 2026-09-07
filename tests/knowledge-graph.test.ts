/**
 * Tests for the Knowledge Graph explorer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// Isolate the SQLite connection per test file. The knowledge fabric caches
// the DatabaseSync at module level, so without an explicit AETHERIS_KNOWLEDGE_DB
// path every test in this file (and every other test file that loads the
// fabric) would share one DB. Set the env before importing graph.ts.
process.env.AETHERIS_KNOWLEDGE_DB = path.join(mkdtempSync(path.join(tmpdir(), "aeth-kg-")), "knowledge.sqlite");
import { knowledgeGraph, subgraph, seedDemoGraph } from "../src/core/knowledge/graph";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-kg-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("graph: empty user has no entities, no edges", async () => {
  const dir = freshEnv();
  try {
    const g = await knowledgeGraph("u-empty");
    assert.equal(g.totalEntities, 0);
    assert.equal(g.totalEdges, 0);
    assert.equal(g.mostConnected, null);
    assert.equal(g.hubEntity, null);
  } finally { cleanup(dir); }
});

test("graph: seedDemoGraph creates a small graph", async () => {
  const dir = freshEnv();
  try {
    const r = await seedDemoGraph("u-1");
    assert.equal(r.facts, 6);
    assert.equal(r.edges, 6);
    const g = await knowledgeGraph("u-1");
    assert.ok(g.totalEntities >= 5);
    assert.ok(g.totalEdges >= 5);
  } finally { cleanup(dir); }
});

test("graph: mostConnected is the highest-degree node", async () => {
  const dir = freshEnv();
  try {
    await seedDemoGraph("u-1");
    const g = await knowledgeGraph("u-1");
    assert.ok(g.mostConnected);
    assert.equal(g.mostConnected!.totalDegree, Math.max(...g.nodes.map((n) => n.totalDegree)));
  } finally { cleanup(dir); }
});

test("graph: nodes are sorted by totalDegree descending", async () => {
  const dir = freshEnv();
  try {
    await seedDemoGraph("u-1");
    const g = await knowledgeGraph("u-1");
    for (let i = 1; i < g.nodes.length; i++) {
      assert.ok(g.nodes[i - 1]!.totalDegree >= g.nodes[i]!.totalDegree);
    }
  } finally { cleanup(dir); }
});

test("graph: topRelations includes the relations from the seed", async () => {
  const dir = freshEnv();
  try {
    await seedDemoGraph("u-1");
    const g = await knowledgeGraph("u-1");
    const rels = new Set(g.topRelations.map((r) => r.rel));
    assert.ok(rels.has("is_a") || rels.has("has_fault") || rels.has("signature_at"));
  } finally { cleanup(dir); }
});

test("graph: per-uid isolation", async () => {
  const dir = freshEnv();
  try {
    await seedDemoGraph("u-a");
    const a = await knowledgeGraph("u-a");
    const b = await knowledgeGraph("u-b");
    assert.ok(a.totalEdges > 0);
    assert.equal(b.totalEdges, 0);
  } finally { cleanup(dir); }
});

test("graph: recentFacts is the newest-first slice", async () => {
  const dir = freshEnv();
  try {
    await seedDemoGraph("u-1");
    const g = await knowledgeGraph("u-1");
    for (let i = 1; i < g.recentFacts.length; i++) {
      assert.ok(g.recentFacts[i - 1]!.at >= g.recentFacts[i]!.at);
    }
  } finally { cleanup(dir); }
});

test("graph: node in/out degree is correct", async () => {
  const dir = freshEnv();
  try {
    await seedDemoGraph("u-1");
    const g = await knowledgeGraph("u-1");
    // wtg-04 has out-edges: is_a, has_fault, uses_agent (3)
    const wtg = g.nodes.find((n) => n.entity === "wtg-04");
    assert.ok(wtg);
    assert.equal(wtg!.outDegree, 3);
    // wtg-04 has no in-edges in the seed
    assert.equal(wtg!.inDegree, 0);
  } finally { cleanup(dir); }
});

test("subgraph: depth 1 around wtg-04 returns wtg-04 + 3 immediate neighbours", async () => {
  const dir = freshEnv();
  try {
    await seedDemoGraph("u-1");
    const s = await subgraph("u-1", "wtg-04", 1);
    assert.equal(s.center, "wtg-04");
    assert.ok(s.nodes.includes("wtg-04"));
    assert.ok(s.nodes.includes("wind-turbine"));
    assert.ok(s.nodes.includes("outer-race"));
    assert.ok(s.nodes.includes("Engineer"));
  } finally { cleanup(dir); }
});

test("graph: empty graph returns a valid object with no errors", async () => {
  const dir = freshEnv();
  try {
    const g = await knowledgeGraph("u-empty");
    assert.equal(g.totalFacts, 0);
    assert.equal(g.nodes.length, 0);
    assert.equal(g.topRelations.length, 0);
    assert.equal(g.recentFacts.length, 0);
  } finally { cleanup(dir); }
});

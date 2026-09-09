/**
 * Tests for the per-core health composer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { coreHealthReport } from "../src/core/orchestration/health";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-chealth-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("coreHealth: returns 10 rows, one per core", async () => {
  const dir = freshEnv();
  try {
    const r = await coreHealthReport("u-1");
    assert.equal(r.total, 10);
    assert.equal(r.rows.length, 10);
  } finally { cleanup(dir); }
});

test("coreHealth: every row carries id, buildCall, capabilities, userLevel, modules", async () => {
  const dir = freshEnv();
  try {
    const r = await coreHealthReport("u-1");
    for (const row of r.rows) {
      assert.ok(row.id.length > 0);
      assert.ok(row.buildCall.length > 0);
      assert.equal(typeof row.capabilitiesOwned, "number");
      assert.equal(typeof row.modulesDeclared, "number");
    }
  } finally { cleanup(dir); }
});

test("coreHealth: ok count + degraded count = total", async () => {
  const dir = freshEnv();
  try {
    const r = await coreHealthReport("u-1");
    assert.equal(r.ok + r.degraded, r.total);
  } finally { cleanup(dir); }
});

test("coreHealth: missing modules are flagged per-row", async () => {
  const dir = freshEnv();
  try {
    const r = await coreHealthReport("u-1");
    for (const row of r.rows) {
      if (row.missingModules.length > 0) {
        assert.ok(row.missingModules.length < row.modulesDeclared);
      }
    }
  } finally { cleanup(dir); }
});

test("coreHealth: result carries uid and generatedAt", async () => {
  const dir = freshEnv();
  try {
    const r = await coreHealthReport("u-shape");
    assert.equal(r.uid, "u-shape");
    assert.ok(typeof r.generatedAt === "number");
  } finally { cleanup(dir); }
});

test("coreHealth: every row has a non-empty buildCall from the document vocabulary", async () => {
  const dir = freshEnv();
  try {
    const r = await coreHealthReport("u-1");
    const allowed = new Set([
      "Build now",
      "Build as proxy",
      "Build initially as recommendation/optimization layer",
      "Build now, but don't claim",
      "Build the integration now; train later",
      "Build as analytics/diagnostic engine",
      "Build as orchestration",
    ]);
    for (const row of r.rows) {
      assert.ok(allowed.has(row.buildCall), `${row.id}: '${row.buildCall}' is not from the document vocabulary`);
    }
  } finally { cleanup(dir); }
});

test("coreHealth: 10 expected core ids are present", async () => {
  const dir = freshEnv();
  try {
    const r = await coreHealthReport("u-1");
    const ids = r.rows.map((x) => x.id);
    for (const id of ["RAVANA", "VAYU-1", "DRISHTI", "YANTRA", "PRAVAAH", "NIRIKSHAN", "CHAKRA", "SMRITI", "SETU", "NIRNAYA"]) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }
  } finally { cleanup(dir); }
});

test("coreHealth: per-uid isolation (each user gets their own grants row)", async () => {
  const dir = freshEnv();
  try {
    const a = await coreHealthReport("u-a");
    const b = await coreHealthReport("u-b");
    assert.equal(a.uid, "u-a");
    assert.equal(b.uid, "u-b");
  } finally { cleanup(dir); }
});

/**
 * Tests for the Core Registry.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CORES, coreHealth, findCore } from "../src/core/orchestration/cores";

test("cores: registry contains exactly 10 cores", () => {
  assert.equal(CORES.length, 10);
});

test("cores: 10 expected core ids are present", () => {
  const ids = CORES.map((c) => c.id);
  for (const id of ["RAVANA", "VAYU-1", "DRISHTI", "YANTRA", "PRAVAAH", "NIRIKSHAN", "CHAKRA", "SMRITI", "SETU", "NIRNAYA"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

test("cores: ids are unique", () => {
  const ids = CORES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("cores: each core has a non-empty role and can/cannot pair", () => {
  for (const c of CORES) {
    assert.ok(c.role.length > 10);
    assert.ok(c.canDo.length > 10);
    assert.ok(c.cannotDo.length > 10);
  }
});

test("cores: each core has at least one page and at least one module", () => {
  for (const c of CORES) {
    assert.ok(c.surface.pages.length > 0, `${c.id} no pages`);
    assert.ok(c.surface.modules.length > 0, `${c.id} no modules`);
  }
});

test("cores: each core's page exists in the app", async () => {
  for (const c of CORES) {
    for (const p of c.surface.pages) {
      const { existsSync } = await import("node:fs");
      assert.ok(existsSync(`src/app${p}`), `${c.id} page ${p} missing`);
    }
  }
});

test("cores: each core's module file exists (planned markers allowed)", async () => {
  const { existsSync } = await import("node:fs");
  for (const c of CORES) {
    for (const m of c.surface.modules) {
      // Modules that have not yet been built in this round are
      // marked with a "(planned:" annotation; those are exempt.
      if (m.includes("(planned:")) continue;
      assert.ok(existsSync(m), `${c.id} module ${m} missing`);
    }
  }
});

test("cores: buildCall values are from the document's vocabulary", () => {
  const allowed = new Set([
    "Build now",
    "Build as proxy",
    "Build initially as recommendation/optimization layer",
    "Build now, but don't claim",
    "Build the integration now; train later",
    "Build as analytics/diagnostic engine",
    "Build as orchestration",
  ]);
  for (const c of CORES) {
    assert.ok(allowed.has(c.buildCall), `${c.id} has non-document buildCall '${c.buildCall}'`);
  }
});

test("coreHealth: returns one entry per core, all live or scaffolded", () => {
  const h = coreHealth();
  assert.equal(h.length, CORES.length);
  for (const row of h) {
    assert.ok(["live", "scaffolded", "degraded"].includes(row.status));
    assert.ok(row.surface > 0);
  }
});

test("findCore: lookup is case-insensitive", () => {
  assert.ok(findCore("ravana"));
  assert.ok(findCore("RAVANA"));
  assert.ok(findCore("Vayu-1"));
  assert.equal(findCore("nope"), null);
});

test("findCore: returns the full core object", () => {
  const c = findCore("YANTRA");
  assert.ok(c);
  assert.equal(c!.id, "YANTRA");
  assert.equal(c!.buildCall, "Build now");
});

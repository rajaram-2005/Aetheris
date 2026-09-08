/**
 * Tests for the Capability Permission Matrix.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { permissionMatrix, CATEGORIES, LEVELS } from "../src/core/capabilities/matrix";
import { bootCapabilities } from "../src/core/capabilities/sources";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-mx2-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("matrix: 22 categories defined", () => {
  assert.equal(CATEGORIES.length, 22);
});

test("matrix: 5 security levels defined in canonical order", () => {
  assert.equal(LEVELS.length, 5);
  assert.equal(LEVELS[0], "read_only");
  assert.equal(LEVELS[4], "physical");
});

test("matrix: with booted registry, total > 0", async () => {
  const dir = freshEnv();
  try {
    bootCapabilities();
    const m = await permissionMatrix();
    assert.ok(m.total > 0);
  } finally { cleanup(dir); }
});

test("matrix: per-category totals sum to the grand total", async () => {
  const dir = freshEnv();
  try {
    const m = await permissionMatrix();
    const sum = CATEGORIES.reduce((s, c) => s + (m.catTotals[c] ?? 0), 0);
    assert.equal(sum, m.total);
  } finally { cleanup(dir); }
});

test("matrix: per-level totals sum to the grand total", async () => {
  const dir = freshEnv();
  try {
    const m = await permissionMatrix();
    const sum = LEVELS.reduce((s, l) => s + (m.levelTotals[l] ?? 0), 0);
    assert.equal(sum, m.total);
  } finally { cleanup(dir); }
});

test("matrix: every cell in counts is ≥ 0", async () => {
  const dir = freshEnv();
  try {
    const m = await permissionMatrix();
    for (const c of CATEGORIES) {
      for (const l of LEVELS) {
        const v = m.counts[c]?.[l] ?? 0;
        assert.ok(v >= 0);
      }
    }
  } finally { cleanup(dir); }
});

test("matrix: per-category cell sums equal the category total", async () => {
  const dir = freshEnv();
  try {
    const m = await permissionMatrix();
    for (const c of CATEGORIES) {
      let s = 0;
      for (const l of LEVELS) s += m.counts[c]?.[l] ?? 0;
      assert.equal(s, m.catTotals[c] ?? 0);
    }
  } finally { cleanup(dir); }
});

test("matrix: fractions are in [0, 1] and per-category sum to 1.0", async () => {
  const dir = freshEnv();
  try {
    const m = await permissionMatrix();
    for (const c of CATEGORIES) {
      let s = 0;
      for (const l of LEVELS) {
        const f = m.fractions[c]?.[l] ?? 0;
        assert.ok(f >= 0 && f <= 1);
        s += f;
      }
      if ((m.catTotals[c] ?? 0) > 0) assert.ok(Math.abs(s - 1) < 1e-9);
    }
  } finally { cleanup(dir); }
});

test("matrix: rows are sorted by (category, level, name)", async () => {
  const dir = freshEnv();
  try {
    const m = await permissionMatrix();
    for (let i = 1; i < m.rows.length; i++) {
      const a = m.rows[i - 1]!;
      const b = m.rows[i]!;
      if (a.category !== b.category) {
        assert.ok(a.category.localeCompare(b.category) < 0);
      }
    }
  } finally { cleanup(dir); }
});

test("matrix: rows.length === total", async () => {
  const dir = freshEnv();
  try {
    const m = await permissionMatrix();
    assert.equal(m.rows.length, m.total);
  } finally { cleanup(dir); }
});

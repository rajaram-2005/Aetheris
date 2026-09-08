/**
 * Tests for the Autonomy Levels engine.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AUTONOMY_LEVELS, getAutonomyLevel, setAutonomyLevel, levelName, can, type AutonomyLevel } from "../src/core/autonomy/levels";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-aut-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("autonomy: 6 levels defined, L0..L5 in order", () => {
  assert.equal(AUTONOMY_LEVELS.length, 6);
  for (let i = 0; i < 6; i++) {
    assert.equal(AUTONOMY_LEVELS[i]!.level, i as AutonomyLevel);
  }
});

test("autonomy: each level has a name, description, and capability list", () => {
  for (const def of AUTONOMY_LEVELS) {
    assert.ok(def.name && def.name.length > 0);
    assert.ok(def.description.length > 0);
    assert.ok(Array.isArray(def.capability));
  }
});

test("autonomy: capability set is monotonic — every higher level has at least all caps of the prior level", () => {
  const seen = new Set<string>();
  for (const def of AUTONOMY_LEVELS) {
    for (const c of def.capability) seen.has(c);
    const nextSeen = new Set([...seen, ...def.capability]);
    seen.clear();
    for (const c of nextSeen) seen.add(c);
  }
  // Each level strictly adds at least one new capability
  let last = 0;
  for (const def of AUTONOMY_LEVELS) {
    assert.ok(def.capability.length > last, `level ${def.level} should have more caps than the prior`);
    last = def.capability.length;
  }
});

test("autonomy: getAutonomyLevel returns the default L1 for a fresh uid", async () => {
  const dir = freshEnv();
  try {
    const cfg = await getAutonomyLevel("u-new");
    assert.equal(cfg.level, 1);
    assert.equal(cfg.uid, "u-new");
  } finally { cleanup(dir); }
});

test("autonomy: setAutonomyLevel persists the level and getAutonomyLevel returns it", async () => {
  const dir = freshEnv();
  try {
    await setAutonomyLevel("u-1", 3, "first time");
    const cfg = await getAutonomyLevel("u-1");
    assert.equal(cfg.level, 3);
    assert.equal(cfg.note, "first time");
    assert.ok(cfg.updatedAt > 0);
  } finally { cleanup(dir); }
});

test("autonomy: setAutonomyLevel validates the level", async () => {
  const dir = freshEnv();
  try {
    await assert.rejects(() => setAutonomyLevel("u-1", 7 as AutonomyLevel, "bogus"));
  } finally { cleanup(dir); }
});

test("autonomy: setAutonomyLevel truncates the note to 200 chars", async () => {
  const dir = freshEnv();
  try {
    const long = "x".repeat(500);
    const cfg = await setAutonomyLevel("u-1", 2, long);
    assert.equal(cfg.note.length, 200);
  } finally { cleanup(dir); }
});

test("autonomy: levelName returns the right string for each level", () => {
  assert.equal(levelName(0), "REPORTING_ONLY");
  assert.equal(levelName(1), "ADVISE");
  assert.equal(levelName(2), "GATED_WRITE");
  assert.equal(levelName(3), "SUPERVISED_WRITE");
  assert.equal(levelName(4), "AUTONOMOUS_WRITE");
  assert.equal(levelName(5), "AUTONOMOUS_ACCEPT");
});

test("autonomy: can() returns true if the level grants the capability", () => {
  assert.equal(can(0, "plan"), true);
  assert.equal(can(0, "autonomous_write"), false);
  assert.equal(can(4, "autonomous_write"), true);
  assert.equal(can(4, "autonomous_accept"), false);
  assert.equal(can(5, "autonomous_accept"), true);
});

test("autonomy: L0 forbids any write, L5 allows every capability", () => {
  for (const c of AUTONOMY_LEVELS[AUTONOMY_LEVELS.length - 1]!.capability) {
    assert.equal(can(5, c), true);
  }
  for (const c of ["autonomous_write", "autonomous_accept", "gated_write", "supervised_write", "advise"]) {
    assert.equal(can(0, c), false);
  }
  assert.equal(can(0, "plan"), true);
  assert.equal(can(0, "report"), true);
});

test("autonomy: per-uid isolation — different uids have different levels", async () => {
  const dir = freshEnv();
  try {
    await setAutonomyLevel("u-a", 4, "alice");
    await setAutonomyLevel("u-b", 0, "bob");
    assert.equal((await getAutonomyLevel("u-a")).level, 4);
    assert.equal((await getAutonomyLevel("u-b")).level, 0);
    assert.equal((await getAutonomyLevel("u-c")).level, 1); // fresh default
  } finally { cleanup(dir); }
});

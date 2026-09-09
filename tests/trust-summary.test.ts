/**
 * Tests for the Trust / Permissions summary.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { trustSummary, LEVELS } from "../src/core/trust/summary";
import { bootCapabilities } from "../src/core/capabilities/sources";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-tr-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("trust: 5 levels defined in canonical order", () => {
  assert.equal(LEVELS.length, 5);
  assert.equal(LEVELS[0]!.level, "read_only");
  assert.equal(LEVELS[1]!.level, "safe_write");
  assert.equal(LEVELS[2]!.level, "full_workspace");
  assert.equal(LEVELS[3]!.level, "admin");
  assert.equal(LEVELS[4]!.level, "physical");
});

test("trust: high-impact levels (full_workspace, admin, physical) require confirmation", () => {
  for (const def of LEVELS) {
    if (def.level === "read_only" || def.level === "safe_write") {
      assert.equal(def.needsConfirmation, false);
    } else {
      assert.equal(def.needsConfirmation, true);
    }
  }
});

test("trust: trustSummary returns at least the default principal", async () => {
  const dir = freshEnv();
  try {
    bootCapabilities();
    const s = await trustSummary("u-1");
    assert.equal(s.uid, "u-1");
    assert.equal(s.highestLevel, "safe_write"); // DEFAULT_GRANTS
    assert.ok(s.principal.grants.includes("read_only"));
    assert.ok(s.principal.grants.includes("safe_write"));
  } finally { cleanup(dir); }
});

test("trust: default principal can use read_only and safe_write capabilities", async () => {
  const dir = freshEnv();
  try {
    const s = await trustSummary("u-1");
    // By the security-level logic, anything at read_only or
    // safe_write should be allowed. Anything at full_workspace
    // or above should be denied.
    for (const r of s.rows) {
      if (r.required === "read_only" || r.required === "safe_write") {
        assert.equal(r.allowed, true, `${r.id} should be allowed`);
      } else {
        assert.equal(r.allowed, false, `${r.id} should be denied`);
      }
    }
  } finally { cleanup(dir); }
});

test("trust: byLevel counts add up", async () => {
  const dir = freshEnv();
  try {
    const s = await trustSummary("u-1");
    let total = 0;
    let allowed = 0;
    for (const lvl of ["read_only", "safe_write", "full_workspace", "admin", "physical"] as const) {
      total += s.byLevel[lvl].total;
      allowed += s.byLevel[lvl].allowed;
    }
    assert.equal(total, s.totalCapabilities);
    assert.equal(allowed, s.capabilitiesAllowed);
  } finally { cleanup(dir); }
});

test("trust: capabilitiesAllowed + capabilitiesDenied = totalCapabilities", async () => {
  const dir = freshEnv();
  try {
    const s = await trustSummary("u-1");
    assert.equal(s.capabilitiesAllowed + s.capabilitiesDenied, s.totalCapabilities);
  } finally { cleanup(dir); }
});

test("trust: rows have the required fields", async () => {
  const dir = freshEnv();
  try {
    const s = await trustSummary("u-1");
    for (const r of s.rows) {
      assert.ok(r.id);
      assert.ok(r.name);
      assert.ok(["read_only", "safe_write", "full_workspace", "admin", "physical"].includes(r.required));
      assert.equal(typeof r.allowed, "boolean");
      assert.ok(r.reason);
    }
  } finally { cleanup(dir); }
});

test("trust: per-uid isolation — different uids get different summaries", async () => {
  const dir = freshEnv();
  try {
    const a = await trustSummary("u-a");
    const b = await trustSummary("u-b");
    assert.equal(a.uid, "u-a");
    assert.equal(b.uid, "u-b");
    assert.equal(a.highestLevel, b.highestLevel);
  } finally { cleanup(dir); }
});

test("trust: capability count is non-zero when registry is booted", async () => {
  const dir = freshEnv();
  try {
    const s = await trustSummary("u-1");
    assert.ok(s.totalCapabilities > 0, "expected capabilities to be registered");
  } finally { cleanup(dir); }
});

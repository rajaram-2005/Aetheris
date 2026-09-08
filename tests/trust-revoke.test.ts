/**
 * Tests for trust revocation flow.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listRevocations, isRevoked, recordRevoke, clearRevoke } from "../src/core/trust/revoke";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-rev-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("revoke: listRevocations is empty for a new uid", async () => {
  const dir = freshEnv();
  try {
    const r = await listRevocations("u-empty");
    assert.equal(r.length, 0);
  } finally { cleanup(dir); }
});

test("revoke: recordRevoke stores a row that isRevoked returns true for", async () => {
  const dir = freshEnv();
  try {
    await recordRevoke("u-1", "tool:terminal.run", { reason: "test" });
    assert.equal(await isRevoked("u-1", "tool:terminal.run"), true);
  } finally { cleanup(dir); }
});

test("revoke: listRevocations returns the recorded rows for this uid only", async () => {
  const dir = freshEnv();
  try {
    await recordRevoke("u-1", "cap-a");
    await recordRevoke("u-1", "cap-b");
    await recordRevoke("u-2", "cap-c");
    const r = await listRevocations("u-1");
    assert.equal(r.length, 2);
    const ids = r.map((x) => x.capabilityId).sort();
    assert.deepEqual(ids, ["cap-a", "cap-b"]);
  } finally { cleanup(dir); }
});

test("revoke: clearRevoke removes the row and returns true when it existed", async () => {
  const dir = freshEnv();
  try {
    await recordRevoke("u-1", "cap-x");
    const removed = await clearRevoke("u-1", "cap-x");
    assert.equal(removed, true);
    assert.equal(await isRevoked("u-1", "cap-x"), false);
  } finally { cleanup(dir); }
});

test("revoke: clearRevoke returns false when there was nothing to clear", async () => {
  const dir = freshEnv();
  try {
    const removed = await clearRevoke("u-1", "cap-missing");
    assert.equal(removed, false);
  } finally { cleanup(dir); }
});

test("revoke: per-uid isolation (a revoke for u-a is not visible to u-b)", async () => {
  const dir = freshEnv();
  try {
    await recordRevoke("u-a", "cap-x");
    assert.equal(await isRevoked("u-b", "cap-x"), false);
  } finally { cleanup(dir); }
});

test("revoke: recordRevoke twice is idempotent (overwrites)", async () => {
  const dir = freshEnv();
  try {
    await recordRevoke("u-1", "cap-x", { reason: "first" });
    await recordRevoke("u-1", "cap-x", { reason: "second" });
    const r = await listRevocations("u-1");
    assert.equal(r.length, 1);
    assert.equal(r[0]!.reason, "second");
  } finally { cleanup(dir); }
});

test("revoke: revocation row carries uid, capabilityId, createdAt", async () => {
  const dir = freshEnv();
  try {
    const r = await recordRevoke("u-shape", "cap-x");
    assert.equal(r.uid, "u-shape");
    assert.equal(r.capabilityId, "cap-x");
    assert.ok(typeof r.createdAt === "number");
  } finally { cleanup(dir); }
});

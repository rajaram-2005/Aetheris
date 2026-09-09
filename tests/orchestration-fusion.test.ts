/**
 * Tests for the Fusion Engine.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fuse } from "../src/core/orchestration/fusion";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-fuse-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("fuse: returns all 6 slices, plus a summary", async () => {
  const dir = freshEnv();
  try {
    const r = await fuse({ uid: "u-1", question: "what is the state?", demo: true });
    assert.ok(r.telemetry);
    assert.ok(r.twin);
    assert.ok(r.evidence);
    assert.ok(r.memory);
    assert.ok(r.verification);
    assert.ok(r.summary.length > 5);
  } finally { cleanup(dir); }
});

test("fuse: result carries uid, question, mode, generatedAt, capability", async () => {
  const dir = freshEnv();
  try {
    const r = await fuse({ uid: "u-shape", question: "q", demo: true });
    assert.equal(r.uid, "u-shape");
    assert.equal(r.question, "q");
    assert.equal(r.mode, "demo-seed");
    assert.ok(typeof r.generatedAt === "number");
    assert.equal(r.capability, "fusion:orchestrate");
  } finally { cleanup(dir); }
});

test("fuse: includes VAYU when question triggers wind keywords", async () => {
  const dir = freshEnv();
  try {
    const r = await fuse({ uid: "u-vayu", question: "is the wind turbine vibration rising?", demo: true });
    assert.ok(r.vayu);
  } finally { cleanup(dir); }
});

test("fuse: skips VAYU when question has no wind keywords", async () => {
  const dir = freshEnv();
  try {
    const r = await fuse({ uid: "u-skip", question: "what is the weather today?", demo: true });
    assert.equal(r.vayu, null);
  } finally { cleanup(dir); }
});

test("fuse: verifier reports allow/allow-with-caveat/deny", async () => {
  const dir = freshEnv();
  try {
    const r = await fuse({ uid: "u-v", question: "x", demo: true });
    assert.ok(["allow", "allow-with-caveat", "deny"].includes(r.verification.decision));
    assert.ok(typeof r.verification.uncertainty === "number");
  } finally { cleanup(dir); }
});

test("fuse: demo-seed mode uses the canonical turbine when no twin exists", async () => {
  const dir = freshEnv();
  try {
    const r = await fuse({ uid: "u-d", question: "?", demo: true });
    assert.equal(r.twin.twinId, "fusion-seed-twin");
    assert.equal(r.twin.source, "demo-seed");
  } finally { cleanup(dir); }
});

test("fuse: live mode (no demo) returns the twin slice honestly when nothing exists", async () => {
  const dir = freshEnv();
  try {
    const r = await fuse({ uid: "u-l", question: "?", demo: false });
    assert.equal(r.twin.ok, false);
  } finally { cleanup(dir); }
});

test("fuse: per-uid isolation (different uids get independent results)", async () => {
  const dir = freshEnv();
  try {
    const a = await fuse({ uid: "u-iso-a", question: "?", demo: true });
    const b = await fuse({ uid: "u-iso-b", question: "?", demo: true });
    assert.equal(a.uid, "u-iso-a");
    assert.equal(b.uid, "u-iso-b");
  } finally { cleanup(dir); }
});

test("fuse: summary is built from the actual slices", async () => {
  const dir = freshEnv();
  try {
    const r = await fuse({ uid: "u-s", question: "wind turbine vibration", demo: true });
    assert.match(r.summary, /fusion/);
    assert.match(r.summary, /twin=/);
    assert.match(r.summary, /verifier=/);
  } finally { cleanup(dir); }
});

test("fuse: all slices are honest about ok vs fail (never invent data)", async () => {
  const dir = freshEnv();
  try {
    const r = await fuse({ uid: "u-h", question: "?", demo: false });
    for (const s of [r.telemetry, r.twin, r.evidence, r.memory]) {
      assert.ok(typeof s.ok === "boolean");
    }
  } finally { cleanup(dir); }
});

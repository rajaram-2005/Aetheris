/**
 * Tests for the Operator Handoff Notes store.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listHandoff, postHandoff, ackHandoff, HANDOFF_KINDS, kindMeta } from "../src/core/handoff/notes";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-ho-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("handoff: 4 kinds defined, with labels and colours", () => {
  assert.equal(HANDOFF_KINDS.length, 4);
  for (const def of HANDOFF_KINDS) {
    assert.ok(def.label);
    assert.ok(def.description);
    assert.ok(def.colour.startsWith("#"));
  }
});

test("handoff: listHandoff on empty twin returns empty", async () => {
  const dir = freshEnv();
  try {
    const r = await listHandoff("wtg");
    assert.equal(r.length, 0);
  } finally { cleanup(dir); }
});

test("handoff: postHandoff creates a note visible via listHandoff", async () => {
  const dir = freshEnv();
  try {
    const n = await postHandoff({ twinId: "wtg-04", uid: "u-1", author: "alice", kind: "observation", text: "Vibration peak climbing." });
    const r = await listHandoff("wtg-04");
    assert.equal(r.length, 1);
    assert.equal(r[0]!.id, n.id);
    assert.equal(r[0]!.kind, "observation");
    assert.equal(r[0]!.acked, false);
  } finally { cleanup(dir); }
});

test("handoff: listHandoff returns notes newest-first", async () => {
  const dir = freshEnv();
  try {
    const n1 = await postHandoff({ twinId: "wtg", uid: "u-1", author: "a", kind: "observation", text: "first" });
    await new Promise((r) => setTimeout(r, 5));
    const n2 = await postHandoff({ twinId: "wtg", uid: "u-1", author: "a", kind: "decision", text: "second" });
    const r = await listHandoff("wtg");
    assert.equal(r[0]!.id, n2.id);
    assert.equal(r[1]!.id, n1.id);
  } finally { cleanup(dir); }
});

test("handoff: listHandoff filters by twinId", async () => {
  const dir = freshEnv();
  try {
    await postHandoff({ twinId: "wtg-a", uid: "u-1", author: "a", kind: "observation", text: "a" });
    await postHandoff({ twinId: "wtg-b", uid: "u-1", author: "a", kind: "observation", text: "b" });
    const a = await listHandoff("wtg-a");
    const b = await listHandoff("wtg-b");
    assert.equal(a.length, 1);
    assert.equal(a[0]!.text, "a");
    assert.equal(b.length, 1);
    assert.equal(b[0]!.text, "b");
  } finally { cleanup(dir); }
});

test("handoff: listHandoff filters by uid when provided", async () => {
  const dir = freshEnv();
  try {
    await postHandoff({ twinId: "wtg", uid: "u-1", author: "alice", kind: "observation", text: "alice" });
    await postHandoff({ twinId: "wtg", uid: "u-2", author: "bob", kind: "observation", text: "bob" });
    const r = await listHandoff("wtg", { uid: "u-1" });
    assert.equal(r.length, 1);
    assert.equal(r[0]!.text, "alice");
  } finally { cleanup(dir); }
});

test("handoff: invalid kind is rejected", async () => {
  const dir = freshEnv();
  try {
    await assert.rejects(() => postHandoff({ twinId: "wtg", uid: "u", author: "a", kind: "invalid" as never, text: "x" }));
  } finally { cleanup(dir); }
});

test("handoff: text is truncated to 2000 chars", async () => {
  const dir = freshEnv();
  try {
    const long = "x".repeat(5000);
    const n = await postHandoff({ twinId: "wtg", uid: "u", author: "a", kind: "observation", text: long });
    assert.equal(n.text.length, 2000);
  } finally { cleanup(dir); }
});

test("handoff: author is truncated to 60 chars", async () => {
  const dir = freshEnv();
  try {
    const n = await postHandoff({ twinId: "wtg", uid: "u", author: "a".repeat(200), kind: "observation", text: "x" });
    assert.equal(n.author.length, 60);
  } finally { cleanup(dir); }
});

test("handoff: ackHandoff marks the note acked=true", async () => {
  const dir = freshEnv();
  try {
    const n = await postHandoff({ twinId: "wtg", uid: "u", author: "a", kind: "decision", text: "x" });
    const acked = await ackHandoff(n.id);
    assert.equal(acked?.acked, true);
    const r = await listHandoff("wtg");
    assert.equal(r[0]!.acked, true);
  } finally { cleanup(dir); }
});

test("handoff: ackHandoff on missing id returns null", async () => {
  const dir = freshEnv();
  try {
    const r = await ackHandoff("does-not-exist");
    assert.equal(r, null);
  } finally { cleanup(dir); }
});

test("handoff: kindMeta returns label, colour, description for any kind", () => {
  for (const def of HANDOFF_KINDS) {
    const m = kindMeta(def.kind);
    assert.equal(m.label, def.label);
    assert.equal(m.colour, def.colour);
  }
});

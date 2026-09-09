/**
 * Tests for dispatchMaintenance write flow.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dispatchMaintenance, listDispatches } from "../src/core/maintenance/dispatch";
import { saveTwin, type Twin } from "../src/core/twins/twins";
import { canonicalTurbineTwin } from "../src/core/windturbine/model";
import { store } from "@/lib/store";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-disp-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

async function seedTwin(uid: string, twinId: string): Promise<Twin> {
  const t = canonicalTurbineTwin({ id: twinId, name: twinId });
  return saveTwin({ ...t, id: twinId, uid, name: twinId, history: [{ at: Date.now(), state: t.state }], createdAt: Date.now(), updatedAt: Date.now(), events: [], maintenance: [] });
}

test("dispatch: write succeeds with a future window", async () => {
  const dir = freshEnv();
  try {
    await seedTwin("u-1", "a");
    const now = Date.now();
    const r = await dispatchMaintenance({ uid: "u-1", twinId: "a", windowStart: now + 86_400_000, windowEnd: now + 86_400_000 * 2, note: "scheduled inspection" });
    assert.equal(r.ok, true);
    assert.ok(r.dispatchId);
  } finally { cleanup(dir); }
});

test("dispatch: rejects a window in the past", async () => {
  const dir = freshEnv();
  try {
    await seedTwin("u-1", "a");
    const now = Date.now();
    const r = await dispatchMaintenance({ uid: "u-1", twinId: "a", windowStart: now - 1000, windowEnd: now + 1000, note: "past" });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /past/);
  } finally { cleanup(dir); }
});

test("dispatch: rejects windowEnd <= windowStart", async () => {
  const dir = freshEnv();
  try {
    await seedTwin("u-1", "a");
    const now = Date.now();
    const r = await dispatchMaintenance({ uid: "u-1", twinId: "a", windowStart: now + 86_400_000, windowEnd: now + 86_400_000, note: "bad window" });
    assert.equal(r.ok, false);
  } finally { cleanup(dir); }
});

test("dispatch: rejects too-short note", async () => {
  const dir = freshEnv();
  try {
    await seedTwin("u-1", "a");
    const now = Date.now();
    const r = await dispatchMaintenance({ uid: "u-1", twinId: "a", windowStart: now + 86_400_000, windowEnd: now + 86_400_000 * 2, note: "x" });
    assert.equal(r.ok, false);
  } finally { cleanup(dir); }
});

test("dispatch: rejects a twin that does not exist", async () => {
  const dir = freshEnv();
  try {
    const now = Date.now();
    const r = await dispatchMaintenance({ uid: "u-1", twinId: "missing", windowStart: now + 86_400_000, windowEnd: now + 86_400_000 * 2, note: "no twin" });
    assert.equal(r.ok, false);
  } finally { cleanup(dir); }
});

test("dispatch: rejects a twin owned by a different user", async () => {
  const dir = freshEnv();
  try {
    await seedTwin("u-a", "a");
    const now = Date.now();
    const r = await dispatchMaintenance({ uid: "u-b", twinId: "a", windowStart: now + 86_400_000, windowEnd: now + 86_400_000 * 2, note: "wrong owner" });
    assert.equal(r.ok, false);
  } finally { cleanup(dir); }
});

test("dispatch: rejects overlap with an existing dispatch", async () => {
  const dir = freshEnv();
  try {
    await seedTwin("u-1", "a");
    const now = Date.now();
    await dispatchMaintenance({ uid: "u-1", twinId: "a", windowStart: now + 86_400_000, windowEnd: now + 86_400_000 * 2, note: "first" });
    const r = await dispatchMaintenance({ uid: "u-1", twinId: "a", windowStart: now + 86_400_000 * 1.5, windowEnd: now + 86_400_000 * 3, note: "second" });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /overlap/);
  } finally { cleanup(dir); }
});

test("dispatch: listDispatches returns the recorded dispatches for the user", async () => {
  const dir = freshEnv();
  try {
    await seedTwin("u-1", "a");
    const now = Date.now();
    await dispatchMaintenance({ uid: "u-1", twinId: "a", windowStart: now + 86_400_000, windowEnd: now + 86_400_000 * 2, note: "first" });
    const list = await listDispatches("u-1");
    assert.equal(list.length, 1);
    assert.equal(list[0]!.twinId, "a");
  } finally { cleanup(dir); }
});

test("dispatch: per-uid isolation in listDispatches", async () => {
  const dir = freshEnv();
  try {
    await seedTwin("u-a", "x");
    await seedTwin("u-b", "y");
    const now = Date.now();
    await dispatchMaintenance({ uid: "u-a", twinId: "x", windowStart: now + 86_400_000, windowEnd: now + 86_400_000 * 2, note: "alpha" });
    await dispatchMaintenance({ uid: "u-b", twinId: "y", windowStart: now + 86_400_000, windowEnd: now + 86_400_000 * 2, note: "beta" });
    const a = await listDispatches("u-a");
    const b = await listDispatches("u-b");
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
  } finally { cleanup(dir); }
});

test("dispatch: successful write appends to twin.maintenance", async () => {
  const dir = freshEnv();
  try {
    await seedTwin("u-1", "a");
    const now = Date.now();
    await dispatchMaintenance({ uid: "u-1", twinId: "a", windowStart: now + 86_400_000, windowEnd: now + 86_400_000 * 2, note: "appended" });
    const t = await store.get<Twin>("twins", "a");
    assert.ok(t);
    assert.ok(t!.maintenance.some((m) => m.note === "appended"));
    assert.ok(t!.events.some((e) => e.kind === "maintenance-dispatch"));
  } finally { cleanup(dir); }
});

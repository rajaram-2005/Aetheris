/**
 * Tests for the Maintenance Tasks composer + close path.
 *
 *   - taskList: partitions maintenance entries into
 *     "open" and "done" by doneAt, sorts each side.
 *   - closeMaintenance: stamps doneAt + doneNote,
 *     records the observability event, refuses
 *     re-closing, refuses unknown entries, refuses
 *     not-owned twins.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { taskList, closeMaintenance } from "../src/core/maintenance/tasks";
import { getTwin, saveTwin } from "../src/core/twins/twins";
import { canonicalTurbineTwin } from "../src/core/windturbine/model";
import { store } from "../src/lib/store";
import type { Twin } from "../src/core/twins/twins";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-ts-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

function makeTwin(id: string, name: string, uid: string, maintenance: Twin["maintenance"] = []): Twin {
  const draft = canonicalTurbineTwin({ id, name });
  return { ...draft, id, uid, name, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, history: [{ at: 1_700_000_000_000, state: { ...draft.state } }], events: [], maintenance };
}

async function seed(t: Twin) { await store.set("twins", t.id, t); }

test("taskList: empty fleet returns empty lists", async () => {
  const dir = freshEnv();
  try {
    const r = await taskList("u-empty");
    assert.equal(r.total, 0);
    assert.equal(r.open.length, 0);
    assert.equal(r.done.length, 0);
  } finally { cleanup(dir); }
});

test("taskList: partitions open vs done by doneAt", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "A", "u1", [
      { at: 1_700_000_000_000, note: "open-1" },
      { at: 1_700_000_000_001, note: "open-2" },
      { at: 1_700_000_000_002, note: "done-1", doneAt: 1_700_000_000_500, doneNote: "fixed" },
    ]);
    await seed(t);
    const r = await taskList("u1");
    assert.equal(r.open.length, 2);
    assert.equal(r.done.length, 1);
    assert.equal(r.open[0]!.note, "open-1");
    assert.equal(r.open[1]!.note, "open-2");
    assert.equal(r.done[0]!.note, "done-1");
    assert.equal(r.done[0]!.doneAt, 1_700_000_000_500);
    assert.equal(r.done[0]!.doneNote, "fixed");
  } finally { cleanup(dir); }
});

test("taskList: open rows sort overdue first, then earliest nextDue", async () => {
  const dir = freshEnv();
  try {
    const now = Date.now();
    const t = makeTwin("a", "A", "u1", [
      { at: 1, note: "later",  nextDue: now + 30 * 86_400_000 },
      { at: 2, note: "overdue-1", nextDue: now - 3 * 86_400_000 },
      { at: 3, note: "soon",   nextDue: now + 2 * 86_400_000 },
      { at: 4, note: "overdue-2", nextDue: now - 1 * 86_400_000 },
    ]);
    await seed(t);
    const r = await taskList("u1");
    // Overdue at indices 0, 1; non-overdue at 2, 3.
    // Within overdue, the more-overdue (older nextDue)
    // sorts first. overdue-1 is now-3d, overdue-2 is
    // now-1d, so overdue-1 comes first.
    assert.equal(r.open[0]!.note, "overdue-1");
    assert.equal(r.open[1]!.note, "overdue-2");
    assert.equal(r.open[2]!.note, "soon");
    assert.equal(r.open[3]!.note, "later");
  } finally { cleanup(dir); }
});

test("taskList: done rows sort most recently closed first", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "A", "u1", [
      { at: 1, note: "old-done",   doneAt: 1_700_000_000_100 },
      { at: 2, note: "newest-done", doneAt: 1_700_000_000_900 },
      { at: 3, note: "middle-done", doneAt: 1_700_000_000_500 },
    ]);
    await seed(t);
    const r = await taskList("u1");
    assert.equal(r.done[0]!.note, "newest-done");
    assert.equal(r.done[1]!.note, "middle-done");
    assert.equal(r.done[2]!.note, "old-done");
  } finally { cleanup(dir); }
});

test("closeMaintenance: stamps doneAt and doneNote, appends event", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "A", "u1", [{ at: 1_700_000_000_000, note: "lubrication" }]);
    await seed(t);
    const r = await closeMaintenance({ uid: "u1", twinId: "a", at: 1_700_000_000_000, doneNote: "oil changed" });
    assert.equal(r.ok, true);
    assert.equal(r.doneAt, r.recordedAt);
    assert.equal(r.doneNote, "oil changed");
    const t2 = await getTwin("a");
    const entry = t2!.maintenance[0]!;
    assert.equal(entry.doneAt, r.doneAt);
    assert.equal(entry.doneNote, "oil changed");
    const last = t2!.events.at(-1)!;
    assert.equal(last.kind, "maintenance-close");
  } finally { cleanup(dir); }
});

test("closeMaintenance: refuses not-owned twin", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "A", "u1", [{ at: 1_700_000_000_000, note: "x" }]);
    await seed(t);
    const r = await closeMaintenance({ uid: "u2", twinId: "a", at: 1_700_000_000_000 });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /not found or not owned/);
  } finally { cleanup(dir); }
});

test("closeMaintenance: refuses unknown entry timestamp", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "A", "u1", [{ at: 1_700_000_000_000, note: "x" }]);
    await seed(t);
    const r = await closeMaintenance({ uid: "u1", twinId: "a", at: 1_700_000_000_999 });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /no maintenance entry/);
  } finally { cleanup(dir); }
});

test("closeMaintenance: refuses to re-close", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "A", "u1", [{ at: 1_700_000_000_000, note: "x", doneAt: 1_700_000_000_500, doneNote: "already" }]);
    await seed(t);
    const r = await closeMaintenance({ uid: "u1", twinId: "a", at: 1_700_000_000_000 });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /already closed/);
  } finally { cleanup(dir); }
});

test("closeMaintenance: trims long doneNote to 300 chars", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "A", "u1", [{ at: 1, note: "x" }]);
    await seed(t);
    const long = "y".repeat(1000);
    const r = await closeMaintenance({ uid: "u1", twinId: "a", at: 1, doneNote: long });
    assert.equal(r.ok, true);
    assert.equal(r.doneNote!.length, 300);
  } finally { cleanup(dir); }
});

test("closeMaintenance: empty doneNote is stored as null", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "A", "u1", [{ at: 1, note: "x" }]);
    await seed(t);
    const r = await closeMaintenance({ uid: "u1", twinId: "a", at: 1, doneNote: "   " });
    assert.equal(r.ok, true);
    assert.equal(r.doneNote, null);
  } finally { cleanup(dir); }
});

test("close then taskList: row moves from open to done", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "A", "u1", [
      { at: 1, note: "x" },
      { at: 2, note: "y" },
    ]);
    await seed(t);
    let r = await taskList("u1");
    assert.equal(r.open.length, 2);
    assert.equal(r.done.length, 0);
    const c = await closeMaintenance({ uid: "u1", twinId: "a", at: 1 });
    assert.equal(c.ok, true);
    r = await taskList("u1");
    assert.equal(r.open.length, 1);
    assert.equal(r.open[0]!.at, 2);
    assert.equal(r.done.length, 1);
    assert.equal(r.done[0]!.at, 1);
  } finally { cleanup(dir); }
});

test("twinHealth: closed entries are excluded from overdue", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "A", "u1", [
      { at: 1, note: "open-overdue",  nextDue: Date.now() - 5 * 86_400_000 },
      { at: 2, note: "closed-overdue", nextDue: Date.now() - 5 * 86_400_000, doneAt: Date.now() - 86_400_000 },
    ]);
    await seed(t);
    const t2 = await getTwin("a");
    const { twinHealth } = await import("../src/core/twins/twins");
    const h = twinHealth(t2!);
    assert.equal(h.overdueMaintenance.length, 1);
    assert.equal(h.overdueMaintenance[0]!.note, "open-overdue");
  } finally { cleanup(dir); }
});

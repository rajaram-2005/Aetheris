/**
 * Tests for the Maintenance Calendar engine.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { maintenanceCalendar, type MaintenanceEntry } from "../src/core/maintenance/calendar";
import { store } from "@/lib/store";
import { canonicalTurbineTwin } from "../src/core/windturbine/model";
import type { Twin } from "../src/core/twins/twins";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-mc-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

function makeTwin(id: string, uid: string, maintenance: Twin["maintenance"] = []): Twin {
  const draft = canonicalTurbineTwin({ id, name: id });
  return { ...draft, id, uid, name: id, state: { ...draft.state }, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, history: [{ at: Date.now(), state: draft.state }], events: [], maintenance };
}

async function seed(t: Twin) { await store.set("twins", t.id, t); }

test("calendar: empty fleet returns empty entries", async () => {
  const dir = freshEnv();
  try {
    const r = await maintenanceCalendar("u-empty");
    assert.equal(r.total, 0);
    assert.equal(r.entries.length, 0);
    assert.equal(r.overdue, 0);
  } finally { cleanup(dir); }
});

test("calendar: overdue entries are flagged", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "u-1", [{ at: Date.now() - 86_400_000 * 30, note: "Lubrication", nextDue: Date.now() - 86_400_000 * 7 }]);
    await seed(t);
    const r = await maintenanceCalendar("u-1");
    assert.equal(r.overdue, 1);
    assert.equal(r.entries[0]!.overdue, true);
  } finally { cleanup(dir); }
});

test("calendar: this-week bucket", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "u-1", [{ at: Date.now(), note: "Check", nextDue: Date.now() + 86_400_000 * 3 }]);
    await seed(t);
    const r = await maintenanceCalendar("u-1");
    assert.equal(r.thisWeek, 1);
  } finally { cleanup(dir); }
});

test("calendar: this-month bucket", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "u-1", [{ at: Date.now(), note: "Check", nextDue: Date.now() + 86_400_000 * 14 }]);
    await seed(t);
    const r = await maintenanceCalendar("u-1");
    assert.equal(r.thisMonth, 1);
  } finally { cleanup(dir); }
});

test("calendar: later bucket (>30 days)", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "u-1", [{ at: Date.now(), note: "Annual", nextDue: Date.now() + 86_400_000 * 90 }]);
    await seed(t);
    const r = await maintenanceCalendar("u-1");
    assert.equal(r.later, 1);
  } finally { cleanup(dir); }
});

test("calendar: no-due-date entries counted in noDueDate", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "u-1", [{ at: Date.now(), note: "Inspect only" }]);
    await seed(t);
    const r = await maintenanceCalendar("u-1");
    assert.equal(r.noDueDate, 1);
  } finally { cleanup(dir); }
});

test("calendar: per-uid isolation", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-a", [{ at: Date.now(), note: "x" }]));
    await seed(makeTwin("b", "u-b", [{ at: Date.now(), note: "y" }]));
    const a = await maintenanceCalendar("u-a");
    const b = await maintenanceCalendar("u-b");
    assert.equal(a.total, 1);
    assert.equal(b.total, 1);
  } finally { cleanup(dir); }
});

test("calendar: overdue first, no-due-date last", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "u-1", [
      { at: Date.now(), note: "Annual", nextDue: Date.now() + 86_400_000 * 90 },
      { at: Date.now(), note: "No due" },
      { at: Date.now(), note: "Overdue", nextDue: Date.now() - 86_400_000 * 3 },
    ]);
    await seed(t);
    const r = await maintenanceCalendar("u-1");
    assert.equal(r.entries[0]!.note, "Overdue");
    assert.equal(r.entries[r.entries.length - 1]!.note, "No due");
  } finally { cleanup(dir); }
});

test("calendar: projection has 90 days", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "u-1", [{ at: Date.now(), note: "x", nextDue: Date.now() + 86_400_000 * 30 }]);
    await seed(t);
    const r = await maintenanceCalendar("u-1");
    assert.equal(r.projection.length, 90);
  } finally { cleanup(dir); }
});

test("calendar: projection places an entry on the right day", async () => {
  const dir = freshEnv();
  try {
    const due = Date.now() + 86_400_000 * 5;
    const t = makeTwin("a", "u-1", [{ at: Date.now(), note: "Soon", nextDue: due }]);
    await seed(t);
    const r = await maintenanceCalendar("u-1");
    const dueDay = new Date(due).toISOString().slice(0, 10);
    const day = r.projection.find((d) => d.day === dueDay);
    assert.ok(day);
    assert.equal(day!.entries.length, 1);
    assert.equal(day!.entries[0]!.note, "Soon");
  } finally { cleanup(dir); }
});

test("calendar: per-entry shape is well-formed", async () => {
  const dir = freshEnv();
  try {
    const t = makeTwin("a", "u-1", [{ at: Date.now(), note: "x", nextDue: Date.now() + 86_400_000 * 2 }]);
    await seed(t);
    const r = await maintenanceCalendar("u-1");
    const e: MaintenanceEntry = r.entries[0]!;
    assert.ok(e.twinId);
    assert.ok(e.twinName);
    assert.equal(e.note, "x");
    assert.ok(typeof e.at === "number");
    assert.ok(typeof e.nextDue === "number");
    assert.ok(["overdue", "today", "this_week", "this_month", "later", "no_due_date"].includes(e.bucket));
  } finally { cleanup(dir); }
});

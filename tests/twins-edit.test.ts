/**
 * Tests for the Twin Edit / Write API.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setName, setState, addBound, removeBound, addRule, addMaintenance } from "../src/core/twins/edit";
import { store } from "../src/lib/store";
import { canonicalTurbineTwin } from "../src/core/windturbine/model";
import type { Twin } from "../src/core/twins/twins";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-tw-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

function makeTwin(id: string, uid: string): Twin {
  const draft = canonicalTurbineTwin({ id, name: id });
  return { ...draft, id, uid, name: id, state: { ...draft.state, rotor_rpm: 17, vib_bearing_mms: 1 }, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, history: [{ at: Date.now(), state: draft.state }], events: [], maintenance: [] };
}

async function seed(t: Twin) { await store.set("twins", t.id, t); }

test("setName: updates name, appends event", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    const r = await setName("u-1", "a", "WTG-04");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.twin.name, "WTG-04");
      assert.ok(r.twin.events.some((e) => e.kind === "edit-name"));
    }
  } finally { cleanup(dir); }
});

test("setName: rejects cross-uid edits", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    const r = await setName("u-2", "a", "WTG-04");
    assert.equal(r.ok, false);
  } finally { cleanup(dir); }
});

test("setName: truncates to 60 chars", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    const r = await setName("u-1", "a", "x".repeat(200));
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.twin.name.length, 60);
  } finally { cleanup(dir); }
});

test("setState: writes a single key", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    const r = await setState("u-1", "a", "vib_bearing_mms", 14);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.twin.state.vib_bearing_mms, 14);
  } finally { cleanup(dir); }
});

test("setState: rejects invalid keys (no injection)", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    const r1 = await setState("u-1", "a", "1invalid", 1);
    assert.equal(r1.ok, false);
    const r2 = await setState("u-1", "a", "a.b", 1);
    assert.equal(r2.ok, false);
    const r3 = await setState("u-1", "a", "a b", 1);
    assert.equal(r3.ok, false);
  } finally { cleanup(dir); }
});

test("setState: missing twin returns ok:false", async () => {
  const dir = freshEnv();
  try {
    const r = await setState("u-1", "missing", "vib_bearing_mms", 1);
    assert.equal(r.ok, false);
  } finally { cleanup(dir); }
});

test("addBound: adds a bound with key + min + max", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    const r = await addBound("u-1", "a", { key: "custom_channel", min: 0, max: 11.2, critical: true });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.twin.bounds.length, 28); // 27 canonical + 1
  } finally { cleanup(dir); }
});

test("addBound: rejects duplicates", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    await addBound("u-1", "a", { key: "custom_channel", min: 0, max: 11.2 });
    const r = await addBound("u-1", "a", { key: "custom_channel", min: 0, max: 11.2 });
    assert.equal(r.ok, false);
  } finally { cleanup(dir); }
});

test("addBound: rejects empty key", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    const r = await addBound("u-1", "a", { key: "", min: 0, max: 1 });
    assert.equal(r.ok, false);
  } finally { cleanup(dir); }
});

test("addBound: rejects bounds without min or max", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    const r = await addBound("u-1", "a", { key: "k" });
    assert.equal(r.ok, false);
  } finally { cleanup(dir); }
});

test("removeBound: removes the matching bound", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    await addBound("u-1", "a", { key: "custom_channel", min: 0, max: 11.2 });
    const r = await removeBound("u-1", "a", "custom_channel");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.twin.bounds.length, 27); // canonical
  } finally { cleanup(dir); }
});

test("removeBound: missing key is rejected", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    const r = await removeBound("u-1", "a", "no_such_key");
    assert.equal(r.ok, false);
  } finally { cleanup(dir); }
});

test("addRule: pushes the rule to the twin", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    const r = await addRule("u-1", "a", { target: "T_bearing_K", expr: "T_gearbox_K + 1" });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.twin.rules.length, 14); // 13 canonical + 1
  } finally { cleanup(dir); }
});

test("addRule: rejects empty target/expr", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    const r1 = await addRule("u-1", "a", { target: "", expr: "1" });
    assert.equal(r1.ok, false);
    const r2 = await addRule("u-1", "a", { target: "x", expr: "" });
    assert.equal(r2.ok, false);
  } finally { cleanup(dir); }
});

test("addMaintenance: appends note + optional nextDue", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    const r = await addMaintenance("u-1", "a", "Lubricate bearing", Date.now() + 86_400_000);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.twin.maintenance.length, 1);
      assert.equal(r.twin.maintenance[0]!.note, "Lubricate bearing");
      assert.ok(r.twin.maintenance[0]!.nextDue);
    }
  } finally { cleanup(dir); }
});

test("addMaintenance: note is truncated to 200 chars", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    const r = await addMaintenance("u-1", "a", "x".repeat(500));
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.twin.maintenance[0]!.note.length, 200);
  } finally { cleanup(dir); }
});

test("cross-uid: any edit returns ok:false", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    const r1 = await setState("u-other", "a", "vib_bearing_mms", 1);
    assert.equal(r1.ok, false);
    const r2 = await addRule("u-other", "a", { target: "x", expr: "1" });
    assert.equal(r2.ok, false);
    const r3 = await addMaintenance("u-other", "a", "x");
    assert.equal(r3.ok, false);
  } finally { cleanup(dir); }
});

/**
 * Tests for the Evidence Ledger.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { evidenceLedger, type EvidenceEntry } from "../src/core/twins/evidence";
import { store } from "@/lib/store";
import { canonicalTurbineTwin } from "../src/core/windturbine/model";
import type { Twin } from "../src/core/twins/twins";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-ev-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

function makeTwin(id: string, uid: string, events: Twin["events"] = []): Twin {
  const draft = canonicalTurbineTwin({ id, name: id });
  return { ...draft, id, uid, name: id, state: { ...draft.state }, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, history: [{ at: Date.now(), state: draft.state }], events, maintenance: [] };
}

async function seed(t: Twin) { await store.set("twins", t.id, t); }
async function seedHistory(twinId: string, severity: string, peak: number) {
  const tMs = 1_700_000_000_000;
  await store.set("diagnostic-history", `${twinId}:${tMs}`, { twinId, tMs, severity, peakMagnitude: peak, dominantHz: 25, topFault: null, topFaultMagnitude: 0, matchCount: 0, envelope: null });
}

test("evidence: empty fleet returns empty entries", async () => {
  const dir = freshEnv();
  try {
    const r = await evidenceLedger("u-empty");
    assert.equal(r.total, 0);
    assert.equal(r.entries.length, 0);
  } finally { cleanup(dir); }
});

test("evidence: twin events are picked up", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1", [{ at: 1_700_000_000_000, kind: "edit-name", detail: "WTG-04" }]));
    const r = await evidenceLedger("u-1");
    assert.ok(r.entries.some((e) => e.kind === "edit-name"));
  } finally { cleanup(dir); }
});

test("evidence: diagnostic history is picked up", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1"));
    await seedHistory("a", "critical", 14);
    const r = await evidenceLedger("u-1");
    assert.ok(r.entries.some((e) => e.source === "diagnostic" && e.kind === "critical"));
  } finally { cleanup(dir); }
});

test("evidence: entries are sorted newest-first", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1", [
      { at: 1, kind: "k1", detail: "d1" },
      { at: 5, kind: "k2", detail: "d2" },
      { at: 3, kind: "k3", detail: "d3" },
    ]));
    const r = await evidenceLedger("u-1");
    for (let i = 1; i < r.entries.length; i++) {
      assert.ok(r.entries[i - 1]!.at >= r.entries[i]!.at);
    }
  } finally { cleanup(dir); }
});

test("evidence: per-uid isolation", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-a", [{ at: 1_700_000_000_000, kind: "x", detail: "a" }]));
    await seed(makeTwin("b", "u-b", [{ at: 1_700_000_000_000, kind: "x", detail: "b" }]));
    const a = await evidenceLedger("u-a");
    const b = await evidenceLedger("u-b");
    assert.ok(a.entries.every((e) => e.twinId === "a"));
    assert.ok(b.entries.every((e) => e.twinId === "b"));
  } finally { cleanup(dir); }
});

test("evidence: bySource counts add up to entries.length", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1", [{ at: 1, kind: "x", detail: "y" }]));
    await seedHistory("a", "ok", 1);
    const r = await evidenceLedger("u-1");
    const sum = r.bySource["twin-event"] + r.bySource["diagnostic"] + r.bySource["system-event"];
    assert.equal(sum, r.entries.length);
  } finally { cleanup(dir); }
});

test("evidence: byKind counts add up to entries.length", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1", [
      { at: 1, kind: "x", detail: "y" },
      { at: 2, kind: "x", detail: "y" },
      { at: 3, kind: "z", detail: "y" },
    ]));
    const r = await evidenceLedger("u-1");
    const sum = Object.values(r.byKind).reduce((s, v) => s + v, 0);
    assert.equal(sum, r.entries.length);
  } finally { cleanup(dir); }
});

test("evidence: filter by source", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1", [{ at: 1, kind: "x", detail: "y" }]));
    await seedHistory("a", "critical", 14);
    const r = await evidenceLedger("u-1", { source: "diagnostic" });
    for (const e of r.entries) {
      assert.equal(e.source, "diagnostic");
    }
  } finally { cleanup(dir); }
});

test("evidence: filter by twinId", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1", [{ at: 1, kind: "x", detail: "y" }]));
    await seed(makeTwin("b", "u-1", [{ at: 1, kind: "x", detail: "y" }]));
    const r = await evidenceLedger("u-1", { twinId: "a" });
    for (const e of r.entries) {
      assert.equal(e.twinId, "a");
    }
  } finally { cleanup(dir); }
});

test("evidence: limit caps the number of entries", async () => {
  const dir = freshEnv();
  try {
    const events = Array.from({ length: 50 }, (_, i) => ({ at: 1_700_000_000_000 + i, kind: "x", detail: String(i) }));
    await seed(makeTwin("a", "u-1", events));
    const r = await evidenceLedger("u-1", { limit: 5 });
    assert.ok(r.entries.length <= 5);
  } finally { cleanup(dir); }
});

test("evidence: per-entry shape is well-formed", async () => {
  const dir = freshEnv();
  try {
    await seed(makeTwin("a", "u-1", [{ at: 1_700_000_000_000, kind: "x", detail: "y" }]));
    const r = await evidenceLedger("u-1");
    const e: EvidenceEntry = r.entries[0]!;
    assert.ok(typeof e.at === "number");
    assert.ok(["twin-event", "diagnostic", "system-event"].includes(e.source));
    assert.ok(e.kind);
    assert.ok(typeof e.detail === "string");
    assert.ok(e.id);
  } finally { cleanup(dir); }
});

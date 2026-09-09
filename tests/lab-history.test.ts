/**
 * Tests for the Lab Experiment History engine.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listExperiments, getExperiment, summarise, type LabExperiment } from "../src/core/lab/history";
import { store } from "@/lib/store";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-lh-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

async function seedExperiment(e: LabExperiment) {
  await store.set("lab-history", e.id, e);
}

function makeExperiment(uid: string, ok: boolean, at: number, lang: "python" | "cpp" = "python", reason: "passed" | "compile_failed" | "test_failed" | "run_failed" | "policy_denied" = "passed", duration = 100): LabExperiment {
  return {
    id: `lab${at.toString(36)}`,
    uid,
    at,
    language: lang,
    description: "test",
    source: "print('hello')",
    ok,
    stoppedBecause: reason,
    outputSnippet: "ok",
    durationMs: duration,
  };
}

test("lab history: listExperiments on empty store returns empty", async () => {
  const dir = freshEnv();
  try {
    const r = await listExperiments("u-1");
    assert.equal(r.length, 0);
  } finally { cleanup(dir); }
});

test("lab history: seeded experiment is visible to listExperiments", async () => {
  const dir = freshEnv();
  try {
    const e = makeExperiment("u-1", true, 1_700_000_000_000);
    await seedExperiment(e);
    const r = await listExperiments("u-1");
    assert.equal(r.length, 1);
    assert.equal(r[0]!.id, e.id);
  } finally { cleanup(dir); }
});

test("lab history: per-uid isolation", async () => {
  const dir = freshEnv();
  try {
    await seedExperiment(makeExperiment("u-a", true, 1));
    await seedExperiment(makeExperiment("u-b", false, 2));
    const a = await listExperiments("u-a");
    const b = await listExperiments("u-b");
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
  } finally { cleanup(dir); }
});

test("lab history: listExperiments returns newest-first", async () => {
  const dir = freshEnv();
  try {
    await seedExperiment(makeExperiment("u-1", true, 100));
    await seedExperiment(makeExperiment("u-1", true, 200));
    await seedExperiment(makeExperiment("u-1", true, 300));
    const r = await listExperiments("u-1");
    assert.equal(r[0]!.at, 300);
    assert.equal(r[1]!.at, 200);
    assert.equal(r[2]!.at, 100);
  } finally { cleanup(dir); }
});

test("lab history: listExperiments filters by language", async () => {
  const dir = freshEnv();
  try {
    await seedExperiment(makeExperiment("u-1", true, 1, "python"));
    await seedExperiment(makeExperiment("u-1", true, 2, "cpp"));
    const py = await listExperiments("u-1", { language: "python" });
    const cpp = await listExperiments("u-1", { language: "cpp" });
    assert.equal(py.length, 1);
    assert.equal(cpp.length, 1);
  } finally { cleanup(dir); }
});

test("lab history: getExperiment returns the row, scoped by uid", async () => {
  const dir = freshEnv();
  try {
    const e = makeExperiment("u-1", true, 1);
    await seedExperiment(e);
    const r = await getExperiment("u-1", e.id);
    assert.equal(r?.id, e.id);
    const cross = await getExperiment("u-other", e.id);
    assert.equal(cross, null);
  } finally { cleanup(dir); }
});

test("lab history: getExperiment on missing id returns null", async () => {
  const dir = freshEnv();
  try {
    const r = await getExperiment("u-1", "lab-missing");
    assert.equal(r, null);
  } finally { cleanup(dir); }
});

test("summarise: counts ok vs fail, by language, by stop reason", () => {
  const exps: LabExperiment[] = [
    makeExperiment("u", true, 1, "python", "passed", 100),
    makeExperiment("u", true, 2, "python", "passed", 200),
    makeExperiment("u", false, 3, "python", "compile_failed", 50),
    makeExperiment("u", true, 4, "cpp", "passed", 300),
  ];
  const s = summarise(exps);
  assert.equal(s.total, 4);
  assert.equal(s.okCount, 3);
  assert.equal(s.failCount, 1);
  assert.equal(s.byLanguage["python"], 3);
  assert.equal(s.byLanguage["cpp"], 1);
  assert.equal(s.byStopReason["passed"], 3);
  assert.equal(s.byStopReason["compile_failed"], 1);
});

test("summarise: p50 and p95 are computed from the durationMs array", () => {
  const exps: LabExperiment[] = Array.from({ length: 100 }, (_, i) => makeExperiment("u", true, i, "python", "passed", (i + 1) * 10));
  const s = summarise(exps);
  // Sorted ascending: 10, 20, … 1000. p50 index = floor(100*0.5) = 50 → 510.
  assert.equal(s.durationP50, 510);
  // p95 index = min(99, floor(100*0.95)) = 95 → 960.
  assert.equal(s.durationP95, 960);
});

test("summarise: empty input gives zero counts and zero p50/p95", () => {
  const s = summarise([]);
  assert.equal(s.total, 0);
  assert.equal(s.okCount, 0);
  assert.equal(s.durationP50, 0);
  assert.equal(s.durationP95, 0);
});

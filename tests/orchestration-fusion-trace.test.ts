/**
 * Tests for the Fusion observability composer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fuse } from "../src/core/orchestration/fusion";
import { fusionTrace } from "../src/core/orchestration/trace";
import { store } from "@/lib/store";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-fusetr-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("fusionTrace: empty store returns empty trace", async () => {
  const dir = freshEnv();
  try {
    const t = await fusionTrace("u-empty");
    assert.equal(t.total, 0);
    assert.equal(t.runs.length, 0);
  } finally { cleanup(dir); }
});

test("fusionTrace: after a fusion call, the run is recorded", async () => {
  const dir = freshEnv();
  try {
    await fuse({ uid: "u-rt", question: "wind turbine vibration?", demo: true });
    const t = await fusionTrace("u-rt");
    assert.ok(t.runs.length >= 1);
    const r = t.runs[0]!;
    assert.equal(r.uid, "u-rt");
    assert.equal(r.mode, "demo-seed");
    assert.ok(["allow", "allow-with-caveat", "deny"].includes(r.decision));
  } finally { cleanup(dir); }
});

test("fusionTrace: events from the observability log are surfaced", async () => {
  const dir = freshEnv();
  try {
    await fuse({ uid: "u-ev", question: "?", demo: true });
    const t = await fusionTrace("u-ev");
    // The fuse() function records a 'fusion:orchestrate' event;
    // the trace composer must surface it.
    const fusionEvent = t.events.find((e) => e.capability === "fusion:orchestrate");
    assert.ok(fusionEvent, "expected at least one fusion:orchestrate event");
  } finally { cleanup(dir); }
});

test("fusionTrace: byDecision counts sum to runs.length", async () => {
  const dir = freshEnv();
  try {
    await fuse({ uid: "u-bd", question: "?", demo: true });
    const t = await fusionTrace("u-bd");
    const sum = t.byDecision.allow + t.byDecision["allow-with-caveat"] + t.byDecision.deny;
    assert.equal(sum, t.runs.length);
  } finally { cleanup(dir); }
});

test("fusionTrace: byMode counts sum to runs.length", async () => {
  const dir = freshEnv();
  try {
    await fuse({ uid: "u-bm", question: "?", demo: true });
    const t = await fusionTrace("u-bm");
    assert.equal(t.byMode.live + t.byMode["demo-seed"], t.runs.length);
  } finally { cleanup(dir); }
});

test("fusionTrace: per-uid isolation", async () => {
  const dir = freshEnv();
  try {
    await fuse({ uid: "u-iso-a", question: "?", demo: true });
    await fuse({ uid: "u-iso-b", question: "?", demo: true });
    const a = await fusionTrace("u-iso-a");
    const b = await fusionTrace("u-iso-b");
    assert.ok(a.runs.every((r) => r.uid === "u-iso-a"));
    assert.ok(b.runs.every((r) => r.uid === "u-iso-b"));
  } finally { cleanup(dir); }
});

test("fusionTrace: limit caps the run list", async () => {
  const dir = freshEnv();
  try {
    for (let i = 0; i < 5; i++) await fuse({ uid: "u-lim", question: "?", demo: true });
    const t = await fusionTrace("u-lim", { limit: 2 });
    assert.ok(t.runs.length <= 2);
  } finally { cleanup(dir); }
});

test("fusionTrace: sinceMs filters older runs", async () => {
  const dir = freshEnv();
  try {
    await fuse({ uid: "u-since", question: "?", demo: true });
    const future = Date.now() + 60_000;
    const t = await fusionTrace("u-since", { sinceMs: future });
    assert.equal(t.runs.length, 0);
  } finally { cleanup(dir); }
});

test("fusionTrace: result carries uid and generatedAt", async () => {
  const dir = freshEnv();
  try {
    const t = await fusionTrace("u-shape");
    assert.equal(t.uid, "u-shape");
    assert.ok(typeof t.generatedAt === "number");
  } finally { cleanup(dir); }
});

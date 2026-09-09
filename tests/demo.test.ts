/**
 * Tests for the deterministic DEMO mode.
 *
 *   We don't boot a full app or hit a real LLM; we test the pure parts:
 *     - isDemoMode() flips with the env var
 *     - buildDemoSeed() is fully deterministic (no Date.now, no Math.random)
 *     - ensureSeeded() is idempotent
 *     - demoStatus() returns a consistent object
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-demo-"));

import { DEMO_FLAG, DEMO_UID, buildDemoSeed, demoStatus, ensureSeeded, isDemoMode, isSeeded } from "../src/core/demo";

// --------------------------------------------------------------------------- env

test("demo: isDemoMode returns false when AETHERIS_DEMO is unset", () => {
  delete process.env[DEMO_FLAG];
  assert.equal(isDemoMode(), false);
});

test("demo: isDemoMode returns true when AETHERIS_DEMO=1", () => {
  process.env[DEMO_FLAG] = "1";
  assert.equal(isDemoMode(), true);
  delete process.env[DEMO_FLAG];
});

// --------------------------------------------------------------------------- seed structure

test("demo: buildDemoSeed is fully deterministic across two calls", () => {
  const a = buildDemoSeed();
  const b = buildDemoSeed();
  assert.deepEqual(a, b);
});

test("demo: buildDemoSeed has the expected fixed uid", () => {
  const s = buildDemoSeed();
  assert.equal(s.uid, DEMO_UID);
});

test("demo: buildDemoSeed has three chats with at least one message each", () => {
  const s = buildDemoSeed();
  assert.equal(s.chats.length, 3);
  for (const c of s.chats) {
    assert.ok(c.messages.length >= 1, `chat ${c.id} should have ≥1 message`);
  }
});

test("demo: buildDemoSeed has a wind-turbine twin id", () => {
  const s = buildDemoSeed();
  assert.ok(s.twinIds.length >= 1);
  for (const id of s.twinIds) assert.equal(typeof id, "string");
});

test("demo: buildDemoSeed has a diagnostic history that crosses ok → watch → warning → critical", () => {
  const s = buildDemoSeed();
  assert.ok(s.diagnostics.length >= 4);
  const severities = s.diagnostics.map((d) => d.severity);
  // The seed should narrate a story of escalating fault.
  assert.equal(severities[0], "ok");
  assert.ok(severities.includes("watch"));
  assert.ok(severities.includes("warning"));
  assert.ok(severities.includes("critical"));
});

test("demo: buildDemoSeed has no Date.now or Math.random in any timestamp", () => {
  // Property: every tMs is a literal integer. No randomness, no clock.
  const s = buildDemoSeed();
  const tss = [s.user.createdAt, ...s.diagnostics.map((d) => d.tMs)];
  for (const t of tss) {
    assert.equal(Number.isInteger(t), true, `tMs should be an integer literal, got ${t}`);
  }
  // Re-run: the values must be identical (we already proved this above,
  // but it's worth pinning explicitly here).
  const tss2 = [buildDemoSeed().user.createdAt, ...buildDemoSeed().diagnostics.map((d) => d.tMs)];
  assert.deepEqual(tss, tss2);
});

// --------------------------------------------------------------------------- apply (idempotent)

test("demo: ensureSeeded returns created=false when DEMO is off", async () => {
  delete process.env[DEMO_FLAG];
  const r = await ensureSeeded();
  assert.equal(r.created, false);
  assert.equal(await isSeeded(), false);
});

test("demo: ensureSeeded writes the seed when DEMO is on, and is idempotent", async () => {
  process.env[DEMO_FLAG] = "1";
  try {
    const a = await ensureSeeded();
    assert.equal(a.created, true);
    assert.equal(await isSeeded(), true);
    const b = await ensureSeeded();
    assert.equal(b.created, false, "second call should not re-create");
  } finally {
    delete process.env[DEMO_FLAG];
  }
});

test("demo: ensureSeeded actually populates the store collections", async () => {
  process.env[DEMO_FLAG] = "1";
  try {
    await ensureSeeded();
    const { store } = await import("../src/lib/store");
    const chats = Object.keys(await store.all<unknown>("chats"));
    const projects = Object.keys(await store.all<unknown>("projects"));
    const twins = Object.keys(await store.all<unknown>("twins"));
    const hist = Object.keys(await store.all<unknown>("diagnostic-history"));
    assert.ok(chats.length >= 3, `expected ≥3 chats, got ${chats.length}`);
    assert.ok(projects.length >= 3, `expected ≥3 projects, got ${projects.length}`);
    assert.ok(twins.length >= 1, `expected ≥1 twin, got ${twins.length}`);
    assert.ok(hist.length >= 4, `expected ≥4 history entries, got ${hist.length}`);
  } finally {
    delete process.env[DEMO_FLAG];
  }
});

// --------------------------------------------------------------------------- status

test("demo: demoStatus returns a consistent object", async () => {
  delete process.env[DEMO_FLAG];
  const off = await demoStatus();
  assert.equal(off.enabled, false);
  assert.equal(off.uid, DEMO_UID);
  assert.equal(off.pinnedProvider, null);

  process.env[DEMO_FLAG] = "1";
  try {
    const on = await demoStatus();
    assert.equal(on.enabled, true);
    assert.equal(typeof on.description, "string");
    assert.ok(on.description.includes("DEMO mode is on"));
  } finally {
    delete process.env[DEMO_FLAG];
  }
});

test("demo: AETHERIS_DEMO_PROVIDER overrides the pinned provider", async () => {
  process.env[DEMO_FLAG] = "1";
  process.env.AETHERIS_DEMO_PROVIDER = "cerebras";
  try {
    const s = await demoStatus();
    assert.equal(s.pinnedProvider, "cerebras");
  } finally {
    delete process.env[DEMO_FLAG];
    delete process.env.AETHERIS_DEMO_PROVIDER;
  }
});

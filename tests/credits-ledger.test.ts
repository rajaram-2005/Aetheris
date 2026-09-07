/**
 * Tests for the Cost / Credit Ledger.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { creditLedger, KINDS } from "../src/core/credits/ledger";
import { store } from "../src/lib/store";
import { consumeChat } from "../src/lib/billing/entitlements";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-cl-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("ledger: 7 UsageKinds defined with labels and default costs", () => {
  assert.equal(KINDS.length, 7);
  for (const k of KINDS) {
    assert.ok(k.label);
    assert.ok(k.defaultCost >= 0);
  }
});

test("ledger: fresh user has zero today, empty history", async () => {
  const dir = freshEnv();
  try {
    const l = await creditLedger("u-fresh");
    assert.equal(l.uid, "u-fresh");
    assert.equal(l.today.count, 0);
    assert.equal(l.todayByKindTotal, 0);
    assert.equal(l.last30Total, 0);
    assert.equal(l.history.length, 0);
  } finally { cleanup(dir); }
});

test("ledger: per-uid isolation", async () => {
  const dir = freshEnv();
  try {
    await consumeChat("u-a", 3, "chat");
    await consumeChat("u-b", 7, "chat");
    const a = await creditLedger("u-a");
    const b = await creditLedger("u-b");
    assert.equal(a.today.count, 3);
    assert.equal(b.today.count, 7);
  } finally { cleanup(dir); }
});

test("ledger: byKind totals roll up from today", async () => {
  const dir = freshEnv();
  try {
    await consumeChat("u-1", 2, "chat");
    await consumeChat("u-1", 4, "research");
    const l = await creditLedger("u-1");
    assert.equal(l.today.byKind["chat"] ?? 0, 2);
    assert.equal(l.today.byKind["research"] ?? 0, 4);
    assert.equal(l.todayByKindTotal, 6);
  } finally { cleanup(dir); }
});

test("ledger: plan has id, name, dailyCredits, maxModel", async () => {
  const dir = freshEnv();
  try {
    const l = await creditLedger("u-1");
    assert.ok(l.plan.id);
    assert.ok(l.plan.name);
    // dailyCredits is either null (unlimited) or a positive number
    if (l.plan.dailyCredits !== null) {
      assert.ok(l.plan.dailyCredits >= 0);
    }
    assert.ok(l.plan.maxModel);
  } finally { cleanup(dir); }
});

test("ledger: free-for-all is reflected in isFreeForAll", async () => {
  const dir = freshEnv();
  try {
    const l = await creditLedger("u-1");
    // Default env has no AETHERIS_PAID_PLANS=1, so this should be true.
    assert.equal(l.isFreeForAll, true);
  } finally { cleanup(dir); }
});

test("ledger: history reflects the saved daily snapshots", async () => {
  const dir = freshEnv();
  try {
    // Synthesize a few history rows.
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const dayBefore = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    await store.set("usage", "u-1", {
      day: today,
      count: 5,
      byKind: { chat: 5 },
      history: [{ day: dayBefore, count: 1 }, { day: yesterday, count: 2 }, { day: today, count: 5 }],
    });
    const l = await creditLedger("u-1");
    assert.equal(l.history.length, 3);
    assert.equal(l.last30Total, 8);
  } finally { cleanup(dir); }
});

test("ledger: history is capped at 30 entries", async () => {
  const dir = freshEnv();
  try {
    const rows = Array.from({ length: 60 }, (_, i) => ({ day: `2025-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, count: i }));
    const today = new Date().toISOString().slice(0, 10);
    await store.set("usage", "u-1", { day: today, count: 0, history: rows });
    const l = await creditLedger("u-1");
    assert.ok(l.history.length <= 30);
  } finally { cleanup(dir); }
});

test("ledger: 7 kinds, every kind has a default cost", () => {
  const kinds = new Set(KINDS.map((k) => k.kind));
  assert.equal(kinds.size, 7);
  assert.ok(kinds.has("chat"));
  assert.ok(kinds.has("agents"));
  assert.ok(kinds.has("research"));
  assert.ok(kinds.has("arena"));
  assert.ok(kinds.has("factory"));
  assert.ok(kinds.has("media"));
  assert.ok(kinds.has("api"));
});

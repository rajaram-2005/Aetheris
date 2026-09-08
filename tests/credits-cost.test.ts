/**
 * Tests for the credit cost calculator.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { costFromHistory, buildBreakdown } from "../src/core/credits/cost";
import { KINDS } from "../src/core/credits/ledger";

test("cost: empty byKind → totalCredits = 0", () => {
  const r = buildBreakdown({});
  assert.equal(r.totalCredits, 0);
  assert.equal(r.totalCount, 0);
  for (const k of Object.keys(r.byKind)) assert.equal(r.byKind[k]!.count, 0);
});

test("cost: chat count * defaultCost", () => {
  const r = buildBreakdown({ chat: 5 });
  assert.equal(r.byKind.chat!.cost, 5 * (KINDS.find((k) => k.kind === "chat")!.defaultCost));
});

test("cost: factory is more expensive than chat", () => {
  const chat = buildBreakdown({ chat: 1 });
  const factory = buildBreakdown({ factory: 1 });
  assert.ok(factory.totalCredits > chat.totalCredits);
});

test("cost: totalCredits = sum of perKind cost", () => {
  const r = buildBreakdown({ chat: 3, agents: 1, factory: 1 });
  const sum = Object.values(r.byKind).reduce((s, v) => s + v.cost, 0);
  assert.equal(sum, r.totalCredits);
});

test("cost: totalCount = sum of perKind count", () => {
  const r = buildBreakdown({ chat: 3, agents: 1, factory: 1 });
  const sum = Object.values(r.byKind).reduce((s, v) => s + v.count, 0);
  assert.equal(sum, r.totalCount);
});

test("cost: per-kind row carries label, count, cost, unit", () => {
  const r = buildBreakdown({ chat: 2 });
  const row = r.byKind.chat!;
  assert.equal(row.count, 2);
  assert.equal(row.unit, 1);
  assert.equal(row.label, "Chat");
});

test("cost: costFromHistory totals scale with history length", () => {
  const h = [{ day: "2025-01-01", count: 10 }, { day: "2025-01-02", count: 20 }, { day: "2025-01-03", count: 30 }];
  const r = costFromHistory(h, { chat: 1 });
  assert.equal(r.historyTotal, 60);
  assert.equal(r.averagePerDay, 20);
  assert.equal(r.projectedMonthlyCost, 600);
});

test("cost: costFromHistory with empty history gives average=0", () => {
  const r = costFromHistory([], { chat: 1 });
  assert.equal(r.averagePerDay, 0);
  assert.equal(r.projectedMonthlyCost, 0);
});

test("cost: costFromHistory uses today's perKind distribution as a proxy", () => {
  const h = [{ day: "2025-01-01", count: 10 }];
  const r = costFromHistory(h, { chat: 1, factory: 1 });
  // All 10 history points get distributed half/half by today's
  // distribution. Allow a +/-1 rounding tolerance.
  const sum = r.breakdown.byKind.chat!.count + r.breakdown.byKind.factory!.count;
  assert.ok(Math.abs(sum - 10) <= 1, `sum=${sum}`);
});

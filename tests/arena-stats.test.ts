/**
 * Tests for arena pairwise comparison.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { compareArena } from "../src/core/arena/stats";
import type { ArenaRow } from "../src/core/arena/compare";

function row(id: string, content: string | null, latencyMs: number, status: "ok" | "error" | "not_configured" = "ok"): ArenaRow {
  return { providerId: id, providerName: id, model: "m", configured: true, status, content, latencyMs, error: null, costClass: "free", locality: "us" };
}

test("compareArena: jaccard = 1 on identical content", () => {
  const a = row("a", "wind turbine vibration rising on the gearbox", 100);
  const b = row("b", "wind turbine vibration rising on the gearbox", 100);
  const r = compareArena(a, b);
  assert.equal(r.jaccard, 1);
  assert.equal(r.winner, "tie");
});

test("compareArena: jaccard = 0 on disjoint content", () => {
  const a = row("a", "apple banana cherry", 100);
  const b = row("b", "delta echo foxtrot", 100);
  const r = compareArena(a, b);
  assert.equal(r.jaccard, 0);
});

test("compareArena: stopwords are excluded from the token set", () => {
  const a = row("a", "the wind is rising", 100);
  const b = row("b", "wind rising", 100);
  const r = compareArena(a, b);
  assert.equal(r.jaccard, 1);
});

test("compareArena: lengthRatio on empty content is 1", () => {
  const a = row("a", "", 100);
  const b = row("b", "", 100);
  const r = compareArena(a, b);
  assert.equal(r.lengthRatio, 1);
});

test("compareArena: lengthRatio reflects size difference", () => {
  const a = row("a", "abc", 100);
  const b = row("b", "abcdef", 100);
  const r = compareArena(a, b);
  assert.equal(r.lengthRatio, 2);
});

test("compareArena: latencyRatio is the inverse when one is faster", () => {
  const a = row("a", "x", 100);
  const b = row("b", "x", 50);
  const r = compareArena(a, b);
  assert.equal(r.latencyRatio, 2);
  assert.equal(r.latencyDeltaMs, 50);
});

test("compareArena: both-fail when at least one row is not ok", () => {
  const a = row("a", null, 0, "error");
  const b = row("b", "ok content", 100);
  const r = compareArena(a, b);
  assert.equal(r.bothOk, false);
  assert.equal(r.winner, "both-fail");
  assert.equal(r.jaccard, null);
});

test("compareArena: winner is the lower-latency row when both ok and not tied on content", () => {
  const a = row("a", "wind turbine vibration rising on the gearbox", 200);
  const b = row("b", "completely different content here", 100);
  const r = compareArena(a, b);
  assert.equal(r.bothOk, true);
  assert.equal(r.winner, "b");
});

test("compareArena: confidence is low when jaccard is below 0.3", () => {
  const a = row("a", "wind turbine vibration rising on the gearbox", 100);
  const b = row("b", "completely different content here", 50);
  const r = compareArena(a, b);
  assert.equal(r.confidence, "low");
});

test("compareArena: tie when jaccard is high and latency is the same", () => {
  const a = row("a", "wind turbine vibration rising on the gearbox", 100);
  const b = row("b", "wind turbine vibration rising on the gearbox", 100);
  const r = compareArena(a, b);
  assert.equal(r.winner, "tie");
  assert.equal(r.confidence, "ok");
});

test("compareArena: per-provider identity is preserved", () => {
  const a = row("openai", "x", 100);
  const b = row("anthropic", "y", 100);
  const r = compareArena(a, b);
  assert.equal(r.a.id, "openai");
  assert.equal(r.b.id, "anthropic");
});

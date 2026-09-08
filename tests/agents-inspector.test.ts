/**
 * Tests for the Agent Inspector.
 *
 *   We don't render React components in unit tests; instead we exercise
 *   the pure helpers used by the page (sort, tier colour, truncate).
 *   The AGENTS array itself is a singleton from the catalog module.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AGENTS, agentById } from "../src/lib/agents/catalog";
import type { AgentSpec } from "../src/lib/agents/types";

const TIER_ORDER: Record<string, number> = { ultra: 0, god: 1, specialist: 2, sub: 3 };

function sortByTier(a: AgentSpec, b: AgentSpec): number {
  return (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

test("agents: catalog is non-empty and ids are unique", () => {
  assert.ok(AGENTS.length >= 10);
  const ids = AGENTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate agent id");
});

test("agents: every agent has a name, tier, domain, skills, and system prompt", () => {
  for (const a of AGENTS) {
    assert.ok(a.name.length > 0, `${a.id} missing name`);
    assert.ok(["ultra", "god", "specialist", "sub"].includes(a.tier), `${a.id} bad tier ${a.tier}`);
    assert.ok(a.domain.length > 0);
    assert.ok(Array.isArray(a.skills) && a.skills.length > 0, `${a.id} no skills`);
    assert.ok(a.system.length > 50, `${a.id} system prompt too short`);
  }
});

test("agents: at least one ultra agent exists (Prime)", () => {
  const ultra = AGENTS.filter((a) => a.tier === "ultra");
  assert.ok(ultra.length >= 1);
  const prime = AGENTS.find((a) => a.id === "prime");
  assert.ok(prime);
  assert.equal(prime.tier, "ultra");
});

test("agents: agentById returns the right agent for a known id", () => {
  const prime = agentById("prime");
  assert.ok(prime);
  assert.equal(prime.id, "prime");
  assert.equal(prime.name, "Aetheris Prime");
});

test("agents: agentById returns undefined for an unknown id", () => {
  assert.equal(agentById("not-a-real-agent"), undefined);
});

test("agents: sortByTier puts ultra first, sub last", () => {
  const sorted = AGENTS.slice().sort(sortByTier);
  const tiers = sorted.map((a) => a.tier);
  const firstUltra = tiers.indexOf("ultra");
  const firstGod = tiers.indexOf("god");
  const firstSub = tiers.indexOf("sub");
  // ultra (0) < god (1) < specialist (2) < sub (3)
  assert.ok(firstUltra === 0);
  assert.ok(firstGod > firstUltra);
  assert.ok(firstSub > firstGod);
});

test("agents: truncate leaves short strings intact", () => {
  assert.equal(truncate("hello", 10), "hello");
  assert.equal(truncate("hello world", 5), "hello…");
  assert.equal(truncate("", 5), "");
});

test("agents: aliases (when present) are an array of strings", () => {
  for (const a of AGENTS) {
    if (a.aliases) {
      for (const al of a.aliases) assert.equal(typeof al, "string");
    }
  }
});

test("agents: tools (when present) are valid tool names", () => {
  const valid = new Set(["web", "mcp"]);
  for (const a of AGENTS) {
    if (a.tools) {
      for (const t of a.tools) assert.ok(valid.has(t), `${a.id} invalid tool ${t}`);
    }
  }
});

test("agents: temperature (when present) is in [0, 2]", () => {
  for (const a of AGENTS) {
    if (typeof a.temperature === "number") {
      assert.ok(a.temperature >= 0 && a.temperature <= 2, `${a.id} temperature out of range: ${a.temperature}`);
    }
  }
});

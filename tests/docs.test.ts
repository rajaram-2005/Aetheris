import { test } from "node:test";
import assert from "node:assert/strict";

test("docs: guides + generated reference pages have unique slugs and non-trivial bodies", async () => {
  const { GUIDES } = await import("../src/lib/docs/guides");
  const { referencePages } = await import("../src/lib/docs/reference");
  const pages = [...GUIDES, ...referencePages()];
  const slugs = pages.map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.ok(pages.length >= 15);
  for (const p of pages) assert.ok(p.body.length > 300, p.slug);
  const agents = pages.find((p) => p.slug === "ref-agents")!;
  assert.ok(agents.body.includes("`@physics`") && agents.body.includes("`@prime`"));
  const prov = pages.find((p) => p.slug === "ref-providers")!;
  assert.ok(prov.body.includes("groq") && prov.body.includes("aetheris-god"));
});

test("gallery seed: 100+ hand-written recipes, unique ids, only real agents, placeholders present", async () => {
  const { SEED } = await import("../src/lib/gallery/seed");
  const { agentById } = await import("../src/lib/agents/catalog");
  assert.ok(SEED.length >= 100, String(SEED.length));
  const ids = SEED.map((s) => s.id); assert.equal(new Set(ids).size, ids.length);
  for (const s of SEED) {
    for (const a of s.agents) assert.ok(agentById(a), `${s.id} → @${a}`);
    assert.ok(s.tags.length >= 2, s.id);
    assert.ok(s.prompt.length > 60, s.id);
  }
  assert.ok(SEED.filter((s) => /\{\{[^}]+\}\}/.test(s.prompt)).length > SEED.length * 0.8, "most recipes are templated");
  const cats = new Set(SEED.map((s) => s.tags[0]));
  assert.ok(cats.size >= 6);
});

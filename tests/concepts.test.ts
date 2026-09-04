import { test } from "node:test";
import assert from "node:assert/strict";
import { CONCEPTS, GROUP_LABEL, conceptById, conceptGlossary, conceptMarkdown, searchConcepts } from "../src/lib/concepts";

test("Explained-AI knowledge base: 40+ concepts, unique ids, valid groups and related links, complete fields", () => {
  assert.ok(CONCEPTS.length >= 40);
  const ids = new Set(CONCEPTS.map((c) => c.id)); assert.equal(ids.size, CONCEPTS.length);
  for (const c of CONCEPTS) {
    assert.ok(GROUP_LABEL[c.group], c.id);
    assert.ok(c.short.length > 30 && c.body.length > 200 && c.analogy.length > 15 && c.whyItMatters.length > 20 && c.tryIt.length > 5, c.id);
    for (const r of c.related) assert.ok(ids.has(r), `${c.id} -> ${r}`);
    assert.ok(!c.related.includes(c.id));
  }
  // every group has content; ethics and explainability are substantial
  for (const g of Object.keys(GROUP_LABEL)) assert.ok(CONCEPTS.some((c) => c.group === g), g);
  assert.ok(CONCEPTS.filter((c) => c.group === "ethics").length >= 10);
  assert.ok(CONCEPTS.filter((c) => c.group === "explainability").length >= 4);
});

test("concept search, glossary and markdown rendering", () => {
  assert.equal(searchConcepts("hallucination")[0].id, "hallucination");
  assert.ok(searchConcepts("caste").some((c) => c.id === "bias"));
  assert.ok(searchConcepts("DPDP").some((c) => c.id === "dpdp"));
  assert.equal(searchConcepts("zzzznotaword").length, 0);
  const g = conceptGlossary(["rag", "bias"]); assert.ok(g.includes("Retrieval-augmented") && g.split("\n").length === 2);
  const md = conceptMarkdown(conceptById("hallucination")!);
  assert.ok(md.includes("Analogy") && md.includes("/docs/concept-rag") && md.includes("Try it"));
});

test("docs expose an Explained AI index and one page per concept", async () => {
  const { referencePages } = await import("../src/lib/docs/reference");
  const pages = referencePages();
  const idx = pages.find((p) => p.slug === "concepts")!;
  assert.ok(idx && idx.body.includes("/docs/concept-bias"));
  assert.equal(pages.filter((p) => p.slug.startsWith("concept-")).length, CONCEPTS.length);
});

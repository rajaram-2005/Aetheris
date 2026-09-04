import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addDocument, chunkText, csvToText, extractText, htmlToText, kbGroundingBlock, retrieve, search, tokenize, type Kb } from "../src/lib/kb";

const mkKb = (): Kb => ({ id: "k", uid: "u", name: "Test", description: "", docs: [], chunks: [], createdAt: 0, updatedAt: 0 });

test("chunking respects size, overlaps, starts new chunks at headings and tracks sections", () => {
  const text = "# Intro\n" + "Aetheris routes prompts across providers. ".repeat(60) + "\n\n## Pricing\nEverything is free forever for everyone.\n" + "Filler sentence here. ".repeat(80);
  const ch = chunkText(text, "d");
  assert.ok(ch.length >= 5 && ch.every((c) => c.text.length <= 1000));
  const pricing = ch.find((c) => c.text.includes("free forever"))!;
  assert.equal(pricing.section, "Pricing"); assert.ok(pricing.text.startsWith("## Pricing"));
  assert.ok(ch[1].text.startsWith(ch[0].text.slice(-60).split(" ").slice(1).join(" ").slice(0, 20)) || ch[1].text.includes("routes prompts"), "overlap carries context");
  assert.deepEqual(chunkText("   ", "d"), []);
});

test("BM25 search ranks the relevant passage first and ignores stop words", () => {
  assert.deepEqual(tokenize("What is the price of the laptop?"), ["price", "laptop"]);
  const kb = mkKb();
  addDocument(kb, "policy.txt", "txt", "Refund policy: customers may return items within 30 days. Shipping is free above 999 rupees.");
  addDocument(kb, "manual.md", "md", "# Setup\nPlug in the router and wait for the green light.\n\n# Warranty\nThe warranty period is two years for all laptops and six months for accessories.");
  addDocument(kb, "prices.csv", "csv", csvToText("name,price\nLaptop,\"45,000\"\nMouse,500"));
  assert.equal(retrieve(kb, "how long is the laptop warranty?")[0].doc.name, "manual.md");
  assert.equal(retrieve(kb, "how long is the laptop warranty?")[0].chunk.section, "Warranty");
  assert.equal(retrieve(kb, "within how many days can I return?")[0].doc.name, "policy.txt");
  assert.ok(retrieve(kb, "price of the mouse")[0].chunk.text.includes("Mouse; price: 500"));
  assert.deepEqual(search(kb.chunks, "the of and"), []);
  assert.deepEqual(retrieve(kb, "quantum chromodynamics"), []);
  // replacing a doc with the same name drops old chunks
  const before = kb.chunks.length; addDocument(kb, "policy.txt", "txt", "Different text about returns."); assert.equal(kb.chunks.length, before); assert.equal(kb.docs.length, 3);
});

test("grounding block numbers citations and returns cite metadata", () => {
  const kb = mkKb(); addDocument(kb, "a.txt", "txt", "Alpha beta gamma delta epsilon. ".repeat(3)); addDocument(kb, "b.txt", "txt", "Gamma rays are high energy photons.");
  const hits = retrieve(kb, "gamma rays"); const g = kbGroundingBlock(kb.name, hits);
  assert.equal(g.cites[0].n, 1); assert.equal(g.cites[0].doc, "b.txt"); assert.ok(g.block.includes("[D1] b.txt") && g.block.includes("Never invent citations"));
});

test("extracts text from DOCX (hand-rolled zip reader), PDF with pages, HTML and CSV", async () => {
  const d = await extractText("s.docx", "", readFileSync(new URL("./fixtures/sample.docx", import.meta.url)));
  assert.equal(d.kind, "docx"); assert.ok(d.text.includes("return items within 30 days") && d.text.includes("\nShipping"));
  const p = await extractText("s.pdf", "application/pdf", readFileSync(new URL("./fixtures/sample.pdf", import.meta.url)));
  assert.equal(p.kind, "pdf"); assert.equal(p.pages?.length, 5); assert.ok(p.text.length > 1000);
  const kb = mkKb(); addDocument(kb, "s.pdf", "pdf", p.text, p.pages); assert.ok(kb.chunks.some((c) => c.page === 3));
  assert.equal(htmlToText("<html><style>x{}</style><body><h1>Title</h1><p>Hello &amp; bye</p><script>1</script></body></html>"), "## Title\nHello & bye");
  await assert.rejects(extractText("x.exe", "application/octet-stream", Buffer.from("x")), /Unsupported/);
});

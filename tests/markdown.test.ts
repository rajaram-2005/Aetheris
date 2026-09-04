import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../src/components/markdown";
import { extractArtifacts, stripArtifacts } from "../src/components/Artifacts";

test("markdown: tables, lists, quotes, headings, escaping", () => {
  const html = renderMarkdown("# T\n\n| a | b |\n|---|---|\n| 1 | **2** |\n\n1. one\n2. two\n\n> q\n\n<script>x</script>");
  assert.match(html, /<h1>T<\/h1>/);
  assert.match(html, /<table><thead><tr><th>a<\/th><th>b<\/th>/);
  assert.match(html, /<td><strong>2<\/strong><\/td>/);
  assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  assert.match(html, /<blockquote>q<\/blockquote>/);
  assert.doesNotMatch(html, /<script>/);
});

test("markdown: unterminated fence during streaming still renders as code", () => {
  assert.match(renderMarkdown("```js\nlet x = 1"), /<pre><code class="lang-js">let x = 1<\/code><\/pre>/);
});

test("artifacts: titled fences are extracted and replaced by a card", () => {
  const txt = 'Here:\n```html title="Page"\n<h1>hi</h1>\n```\nand `x`.\n```js\nconsole.log(1)\n```';
  const arts = extractArtifacts(txt, "m1");
  assert.equal(arts.length, 1);
  assert.equal(arts[0].title, "Page"); assert.equal(arts[0].lang, "html"); assert.equal(arts[0].code, "<h1>hi</h1>");
  const stripped = stripArtifacts(txt);
  assert.match(stripped, /📎 \*\*Page\*\*/);
  assert.match(stripped, /console\.log\(1\)/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { looksTimeSensitive, groundingBlock } from "../src/lib/search/tavily";

test("auto web mode heuristic", () => {
  assert.equal(looksTimeSensitive("What is the latest Next.js version?"), true);
  assert.equal(looksTimeSensitive("Weather in Chennai today"), true);
  assert.equal(looksTimeSensitive("Explain closures in JavaScript"), false);
  assert.equal(looksTimeSensitive("hi"), false);
});

test("grounding block numbers sources", () => {
  const b = groundingBlock({ query: "q", results: [{ title: "A", url: "https://a.com", content: "x" }, { title: "B", url: "https://b.com", content: "y" }] });
  assert.match(b, /\[1\] A\nURL: https:\/\/a\.com/);
  assert.match(b, /\[2\] B/);
});

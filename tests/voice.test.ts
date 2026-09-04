import { test } from "node:test";
import assert from "node:assert/strict";
import { voicePrompt, languageName } from "../src/lib/voice";
import { speakable, splitSentences, resolveVoiceLang } from "../src/components/Voice";

test("voice prompt names the language and forbids markdown", () => {
  assert.equal(languageName("ta-IN"), "Tamil"); assert.equal(languageName("hi"), "Hindi"); assert.equal(languageName("xx"), "xx");
  const p = voicePrompt("ta-IN"); assert.ok(p.includes("Reply in Tamil") && p.includes("READ ALOUD") && /No markdown/.test(p));
});
test("speakable strips markdown, code, links and emojis", () => {
  const s = speakable("## Title\n\nHello **world** 🎉, see [docs](https://x.y/z) and https://a.b/c.\n\n```js\nlet x=1\n```\n- item one\n1. item two [1]");
  assert.equal(s, "Title Hello world , see docs and link. (code shown on screen) item one item two");
});
test("splitSentences yields complete sentences and a remainder (incl. Tamil danda)", () => {
  const [done, rest] = splitSentences("First one. Second one! இது ஒரு வாக்கியம்। Trailing part without");
  assert.deepEqual(done, ["First one.", "Second one!", "இது ஒரு வாக்கியம்।"]); assert.equal(rest, "Trailing part without");
  assert.deepEqual(splitSentences("no end yet"), [[], "no end yet"]);
  assert.deepEqual(splitSentences("Line one\nLine two.")[0], ["Line one", "Line two."]);
});
test("resolveVoiceLang follows the UI language when auto", () => {
  assert.equal(resolveVoiceLang("auto", "ta"), "ta-IN"); assert.equal(resolveVoiceLang("auto", "hi"), "hi-IN"); assert.equal(resolveVoiceLang("auto", "en"), "en-IN"); assert.equal(resolveVoiceLang("es-ES", "ta"), "es-ES");
});

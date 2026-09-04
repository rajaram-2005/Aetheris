import { test } from "node:test";
import assert from "node:assert/strict";
import { newSrs, review, buildQueue, deckStats, stage, isDue } from "../src/lib/study/srs";
import { parseCards, pickAgent, generationPrompt } from "../src/lib/study/engine";

const DAY = 86_400_000;

test("SM-2: intervals grow with good grades, shrink ease on hard, reset on again", () => {
  const t0 = 1_800_000_000_000;
  let s = newSrs(t0); assert.equal(stage(s), "new"); assert.ok(isDue(s, t0));
  s = review(s, 2, t0); assert.equal(s.interval, 1); assert.equal(s.reps, 1);
  s = review(s, 2, t0 + DAY); assert.equal(s.interval, 6);
  s = review(s, 2, t0 + 7 * DAY); assert.equal(s.interval, 15); assert.equal(stage(s), "young");
  const easy = review(s, 3, t0 + 22 * DAY); assert.ok(easy.interval > 15 && easy.ease > s.ease);
  const hard = review(s, 1, t0 + 22 * DAY); assert.ok(hard.interval < easy.interval && hard.ease < s.ease);
  const again = review(s, 0, t0 + 22 * DAY); assert.equal(again.interval, 0); assert.equal(again.reps, 0); assert.equal(again.lapses, 1);
  assert.ok(again.due - (t0 + 22 * DAY) <= 10 * 60_000, "relearn within 10 minutes");
  let e = newSrs(t0); for (let i = 0; i < 10; i++) e = review(e, 0, t0); assert.equal(e.ease, 1.3, "ease floor");
  let m = newSrs(t0); for (let i = 0; i < 12; i++) m = review(m, 3, m.due); assert.ok(m.interval <= 365); assert.equal(stage(m), "mature");
});

test("queue: overdue first, then new cards, with caps; stats summarise stages and retention", () => {
  const t = 1_800_000_000_000;
  const mk = (srs: ReturnType<typeof newSrs>) => ({ srs });
  const due1 = mk({ ...review(newSrs(t), 2, t), due: t - 2 * DAY }); const due2 = mk({ ...review(newSrs(t), 2, t), due: t - DAY });
  const notDue = mk({ ...review(newSrs(t), 2, t), due: t + DAY });
  const fresh = Array.from({ length: 15 }, () => mk(newSrs(t)));
  const q = buildQueue([notDue, ...fresh, due2, due1], t, 10);
  assert.equal(q[0], due1); assert.equal(q[1], due2); assert.equal(q.length, 12); assert.ok(!q.includes(notDue));
  const st = deckStats([due1, due2, notDue, ...fresh, mk(review(newSrs(t), 0, t))], t);
  assert.equal(st.total, 19); assert.equal(st.due, 2); assert.equal(st.byStage.new, 15); assert.equal(st.retention, 75);
});

test("card parsing is tolerant and validates MCQs; agent routing by subject", () => {
  const cards = parseCards('Sure! ```json\n[{"kind":"mcq","front":"Capital of TN?","back":"Chennai","options":["Madurai","Chennai","Salem","Trichy"],"difficulty":1,"tags":["gk"]},{"kind":"cloze","front":"Ohm: V = {{c1::IR}}","back":"IR"},{"front":"q","back":"a"},{"kind":"mcq","front":"bad","back":"X","options":["A","B"]},{"front":"","back":"x"}]\n``` hope this helps');
  assert.equal(cards.length, 3);
  assert.equal(cards[0].kind, "mcq"); assert.equal(cards[2].kind, "flashcard"); assert.equal(cards[0].difficulty, 1);
  assert.equal(parseCards("no json here").length, 0);
  assert.equal(pickAgent("Class 11 Chemistry organic"), "chemistry");
  assert.equal(pickAgent("Python DSA interview"), "coder");
  assert.equal(pickAgent("IELTS vocabulary"), "english");
  assert.equal(pickAgent("Something else"), "tutor");
  assert.equal(pickAgent("anything", "math"), "math");
  const p = generationPrompt({ id: "d", uid: "u", title: "t", subject: "Physics", scope: "Electrostatics", language: "Tamil", agent: "physics", cards: [], createdAt: 0, updatedAt: 0, history: [] }, { count: 5, kinds: ["mcq"], weak: ["Gauss law"] });
  assert.ok(p[0].content.includes("Language: Tamil") && p[0].content.includes("JSON array") && p[1].content.includes("Gauss law"));
});

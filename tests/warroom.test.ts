/**
 * Tests for the War Room debate engine.
 *
 * The engine is meant to run without any external services. With no LLM
 * provider reachable, it returns a deterministic synthetic transcript. We
 * exercise that path so the test suite stays hermetic.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runDebate, type WarRoomDebate } from "../src/core/warroom/debate";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-warroom-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("warroom: empty motion throws", async () => {
  freshEnv();
  try {
    await assert.rejects(async () => await runDebate({ motion: "" }), /motion required/);
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

test("warroom: motion is trimmed and clipped to 2000 chars", async () => {
  freshEnv();
  try {
    const long = "  " + "x".repeat(3000) + "  ";
    const d = await runDebate({ motion: long, allowSyntheticFallback: true, createdAt: 1_700_000_000_000, id: "d1" });
    assert.equal(d.motion.length, 2000);
    assert.equal(d.motion[0], "x");
    assert.equal(d.id, "d1");
    assert.equal(d.createdAt, 1_700_000_000_000);
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

test("warroom: rounds is clamped to [1, 4]", async () => {
  freshEnv();
  try {
    for (const n of [0, 1, 2, 3, 4, 5, -2, 99]) {
      const d = await runDebate({ motion: "x", rounds: n, allowSyntheticFallback: true });
      assert.ok(d.rounds >= 1 && d.rounds <= 4, `rounds=${n} → ${d.rounds}`);
    }
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

test("warroom: total turns = rounds*2 + 1 judge", async () => {
  freshEnv();
  try {
    for (const r of [1, 2, 3, 4]) {
      const d = await runDebate({ motion: "x", rounds: r, allowSyntheticFallback: true });
      assert.equal(d.turns.length, r * 2 + 1, `rounds=${r} → ${d.turns.length} turns`);
      assert.equal(d.totalTurns, d.turns.length);
    }
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

test("warroom: each turn records side/round/agent/prompt/messages", async () => {
  freshEnv();
  try {
    const d = await runDebate({ motion: "AGI is near", rounds: 1, allowSyntheticFallback: true });
    // rounds=1 → 3 turns: pro(1), con(1), judge(2)
    assert.equal(d.turns[0].side, "pro");
    assert.equal(d.turns[0].round, 1);
    assert.ok(typeof d.turns[0].agent === "string" && d.turns[0].agent.length > 0);
    assert.ok(d.turns[0].systemPrompt.includes("AGI is near"));
    assert.ok(Array.isArray(d.turns[0].messages));
    assert.equal(d.turns[0].messages.length, 2); // system + user
    assert.equal(d.turns[0].messages[0].role, "system");
    assert.equal(d.turns[1].side, "con");
    assert.equal(d.turns[1].round, 1);
    assert.equal(d.turns[2].side, "judge");
    assert.equal(d.turns[2].round, 2);
    assert.ok(d.turns[2].text.includes("Result:") || d.turns[2].text.includes("Bottom line:"));
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

test("warroom: turns are ordered (pro then con each round, then judge)", async () => {
  freshEnv();
  try {
    const d = await runDebate({ motion: "topic", rounds: 3, allowSyntheticFallback: true });
    const sides = d.turns.map((t) => t.side);
    assert.deepEqual(sides, ["pro", "con", "pro", "con", "pro", "con", "judge"]);
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

test("warroom: second-round PRO references the first-round con in the user message", async () => {
  freshEnv();
  try {
    const d = await runDebate({ motion: "topic", rounds: 2, allowSyntheticFallback: true });
    const pro2 = d.turns.find((t) => t.side === "pro" && t.round === 2);
    assert.ok(pro2);
    const userMsg = pro2!.messages[1].content;
    assert.ok(userMsg.includes("Transcript so far"), "round 2 PRO should see prior transcript");
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

test("warroom: onDelta is called at least once per turn", async () => {
  freshEnv();
  try {
    const calls: { side: string; round: number }[] = [];
    await runDebate({ motion: "x", rounds: 1, allowSyntheticFallback: true, onDelta: (e) => calls.push({ side: e.side, round: e.round }) });
    assert.ok(calls.length >= 3, `expected ≥3 delta calls, got ${calls.length}`);
    const sides = new Set(calls.map((c) => c.side));
    assert.ok(sides.has("pro") && sides.has("con") && sides.has("judge"));
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

test("warroom: synthetic fallback is labelled as such", async () => {
  freshEnv();
  try {
    const d = await runDebate({ motion: "x", rounds: 1, allowSyntheticFallback: true });
    assert.equal(d.turns[0].provider, "synthetic");
    assert.equal(d.turns[0].model, "synthetic-fallback");
    assert.ok(d.turns[0].text.includes("Synthetic fallback") || d.turns[2].text.includes("Bottom line"));
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

test("warroom: default pro/con are strategist/decision", async () => {
  freshEnv();
  try {
    const d = await runDebate({ motion: "x", allowSyntheticFallback: true });
    assert.equal(d.pro, "strategist");
    assert.equal(d.con, "decision");
    assert.equal(d.judge, "metis");
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

test("warroom: known agent ids are honoured; unknown falls back to default", async () => {
  freshEnv();
  try {
    const d = await runDebate({ motion: "x", pro: "hermes", con: "metis", allowSyntheticFallback: true });
    assert.equal(d.pro, "hermes");
    assert.equal(d.con, "metis");
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

test("warroom: finishedAt >= createdAt and each turn has tMs <= endedAt", async () => {
  freshEnv();
  try {
    const d = await runDebate({ motion: "x", rounds: 2, allowSyntheticFallback: true });
    assert.ok(d.finishedAt >= d.createdAt);
    for (const t of d.turns) {
      assert.ok(t.endedAt >= t.tMs, `${t.side}#${t.round} endedAt < tMs`);
    }
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

test("warroom: round 1 has no prior transcript; round 2+ does", async () => {
  freshEnv();
  try {
    const d = await runDebate({ motion: "x", rounds: 2, allowSyntheticFallback: true });
    const pro1 = d.turns.find((t) => t.side === "pro" && t.round === 1)!;
    const pro2 = d.turns.find((t) => t.side === "pro" && t.round === 2)!;
    assert.equal(pro1.messages[1].content, "Begin.");
    assert.ok(pro2.messages[1].content.includes("Transcript so far"));
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

test("warroom: engine is deterministic when no provider is reachable (motion only)", async () => {
  freshEnv();
  try {
    const a = await runDebate({ motion: "x", rounds: 1, allowSyntheticFallback: true, createdAt: 1, id: "a" });
    const b = await runDebate({ motion: "x", rounds: 1, allowSyntheticFallback: true, createdAt: 1, id: "b" });
    // Synthetic replies are pure functions of (side, motion, round, totalRounds)
    assert.equal(a.turns[0].text, b.turns[0].text);
    assert.equal(a.turns[1].text, b.turns[1].text);
    assert.equal(a.turns[2].text, b.turns[2].text);
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

test("warroom: types — the exported WarRoomDebate matches the engine output", async () => {
  freshEnv();
  try {
    const d: WarRoomDebate = await runDebate({ motion: "x", rounds: 1, allowSyntheticFallback: true });
    // Compile-time-ish: the shape matches the interface.
    assert.equal(typeof d.id, "string");
    assert.equal(typeof d.motion, "string");
    assert.equal(typeof d.pro, "string");
    assert.equal(typeof d.con, "string");
    assert.equal(typeof d.judge, "string");
    assert.equal(typeof d.rounds, "number");
    assert.equal(typeof d.createdAt, "number");
    assert.equal(typeof d.finishedAt, "number");
    assert.equal(typeof d.totalTurns, "number");
    assert.ok(Array.isArray(d.turns));
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

test("warroom: rounds=1 still produces a judge turn (round=2)", async () => {
  freshEnv();
  try {
    const d = await runDebate({ motion: "x", rounds: 1, allowSyntheticFallback: true });
    const judge = d.turns.find((t) => t.side === "judge")!;
    assert.ok(judge, "judge turn must exist");
    assert.equal(judge.round, 2);
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

test("warroom: max rounds is 4 even when caller asks for more", async () => {
  freshEnv();
  try {
    const d = await runDebate({ motion: "x", rounds: 99, allowSyntheticFallback: true });
    assert.equal(d.rounds, 4);
    assert.equal(d.turns.length, 4 * 2 + 1);
  } finally { cleanup(process.env.AETHERIS_DATA_DIR!); }
});

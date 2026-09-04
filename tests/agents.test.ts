import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENTS, agentById, parseMentions, catalogForPlanner } from "../src/lib/agents/catalog";

test("agent hierarchy has 1 ultra, 2 gods, many subs, unique ids", () => {
  assert.equal(AGENTS.filter((a) => a.tier === "ultra").length, 1);
  assert.equal(AGENTS.filter((a) => a.tier === "god").length, 2);
  assert.ok(AGENTS.filter((a) => a.tier === "sub").length >= 20);
  const ids = new Set(AGENTS.map((a) => a.id));
  assert.equal(ids.size, AGENTS.length);
});

test("aliases resolve", () => {
  assert.equal(agentById("academy")?.id, "tutor");
  assert.equal(agentById("code")?.id, "coder");
  assert.equal(agentById("META")?.id, "metis");
  assert.equal(agentById("nope"), undefined);
});

test("parseMentions strips leading @mentions only", () => {
  const r = parseMentions("@coder @reviewer build a CLI");
  assert.deepEqual(r.agents.map((a) => a.id), ["coder", "reviewer"]);
  assert.equal(r.text, "build a CLI");
  const none = parseMentions("email me at @home later");
  assert.equal(none.agents.length, 0);
  assert.equal(none.text, "email me at @home later");
});

test("planner catalog excludes prime", () => {
  const c = catalogForPlanner();
  assert.ok(c.includes("- hermes:"));
  assert.ok(!c.includes("- prime:"));
});

test("ethics agents exist with aliases and an explain prompt is well-formed", async () => {
  const { agentById, AGENTS } = await import("../src/lib/agents/catalog");
  assert.ok(AGENTS.length >= 102);
  for (const id of ["ai-ethics", "xai", "fairness", "explain", "bias", "responsible-ai"]) assert.ok(agentById(id), id);
  const { buildExplainPrompt, EXPLAIN_SECTIONS } = await import("../src/lib/explain");
  const msgs = buildExplainPrompt("What is 2+2?", "4", { provider: "groq", agents: ["math"] });
  assert.equal(msgs.length, 2);
  for (const s of EXPLAIN_SECTIONS) assert.ok(msgs[0].content.includes(s), s);
  assert.ok(msgs[1].content.includes("provider: groq") && msgs[1].content.includes("agents: math"));
});

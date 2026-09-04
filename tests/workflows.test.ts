import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

before(() => { process.env.AETHERIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-wf-")); });

test("workflow templates fill input/prev/steps", async () => {
  const { fill } = await import("../src/lib/workflows/engine");
  assert.equal(fill("A {{input}} B {{prev}} C {{steps.x}} D {{ steps.y }}", { input: "i", prev: "p", steps: { x: "X" } }), "A i B p C X D ");
});

test("transforms", async () => {
  const { transform } = await import("../src/lib/workflows/engine");
  assert.equal(transform("bullets", "a\n- b\n\nc"), "- a\n- b\n- c");
  assert.equal(transform("first_line", "\n\nfirst\nsecond"), "first");
  assert.equal(transform("extract_json", "text {\"a\":1} tail"), "{\"a\":1}");
  assert.equal(transform("trim:3", "abcdef"), "abc");
  assert.equal(transform("strip_code", "x ```js\ncode\n``` y"), "x  y");
});

test("validate rejects bad workflows and accepts templates", async () => {
  const { validate, TEMPLATES } = await import("../src/lib/workflows/engine");
  assert.equal(validate([]), "at least one step");
  assert.match(validate([{ id: "a", title: "t", kind: "agent", agent: "nope", prompt: "p" }])!, /unknown agent/);
  assert.match(validate([{ id: "a", title: "t", kind: "agent", agent: "coder", prompt: "p" }, { id: "a", title: "t", kind: "transform", op: "upper" }])!, /duplicate/);
  for (const t of TEMPLATES) assert.equal(validate(t.steps), null, t.name);
});

test("runWorkflow executes transforms and branches without any provider", async () => {
  const { runWorkflow, saveWorkflow } = await import("../src/lib/workflows/engine");
  const wf = await saveWorkflow("u1", { name: "t", steps: [
    { id: "up", title: "up", kind: "transform", op: "upper" },
    { id: "br", title: "br", kind: "branch", when: "HELLO", then: "yes", else: "no" },
    { id: "yes", title: "yes", kind: "transform", op: "bullets" },
    { id: "no", title: "no", kind: "transform", op: "first_line" },
  ] });
  const events: string[] = [];
  const run = await runWorkflow(wf, "u1", "hello\nworld", { onEvent: (e) => events.push(e.type + ("step" in e ? ":" + e.step : "")) });
  assert.equal(run.status, "done");
  assert.equal(run.final, "- HELLO\n- WORLD");
  assert.ok(events.includes("step_done:no"));
  assert.equal(run.outputs.no, undefined, "skipped step has no output");
});

test("extended agent roster: 90+ agents, unique ids, own id beats foreign alias", async () => {
  const { AGENTS, agentById } = await import("../src/lib/agents/catalog");
  assert.ok(AGENTS.length >= 90);
  const ids = AGENTS.map((a) => a.id); assert.equal(new Set(ids).size, ids.length);
  assert.equal(agentById("physics")!.id, "physics");
  assert.equal(agentById("sql")!.id, "sql");
  assert.equal(agentById("tamil")!.id, "tamil");
  assert.equal(agentById("kavithai")!.id, "poet");
  for (const a of AGENTS) { assert.ok(a.system.length > 80, a.id); assert.ok(a.skills.length >= 3, a.id); }
});

test("mention picker ranks exact id first and finds by skill", async () => {
  const { rankAgents, detectTrigger } = await import("../src/components/MentionPicker");
  const { AGENTS } = await import("../src/lib/agents/catalog");
  const infos = AGENTS.map((a) => ({ ...a, tools: a.tools ?? [], aliases: a.aliases ?? [] }));
  assert.equal(rankAgents(infos, "sql")[0].id, "sql");
  assert.ok(rankAgents(infos, "pytorch").some((a) => a.id === "ml"));
  assert.deepEqual(detectTrigger("hello @co", 9), { kind: "agent", query: "co", start: 6 });
  assert.deepEqual(detectTrigger("/deb", 4), { kind: "command", query: "deb", start: 0 });
  assert.equal(detectTrigger("email@x", 7), null);
});

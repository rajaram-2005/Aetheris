import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-ravana-"));

import { classifyTask } from "../src/core/ravana/classifier";
import { buildPlan, breakCycles, findCycle, normalizePlan, templateNodes } from "../src/core/ravana/planner";
import { blockedNodes, planDone, planFailed, readyNodes } from "../src/core/ravana/agents/scheduler";
import { relevanceScore, rerankScore, searchMemories } from "../src/core/ravana/memory/retriever";
import { saveMemory as persistMemory } from "../src/core/ravana/memory/stores";
import { createTask, getTask, listTasks } from "../src/core/ravana/engine";
import { bootTools } from "../src/core/ravana/tools";
import type { RavanaPlanNode } from "../src/core/ravana/types";

bootTools();

// ------------------------------------------------------------------------- classifier

test("ravana: classifier routes intents to kinds with reasons", () => {
  const cases: [string, string][] = [
    ["What is a linked list?", "chat"],
    ["Explain the difference between TCP and UDP with an analogy", "analysis"],
    ["Write a python function that validates UPI ids, with tests", "coding"],
    ["Fix the authentication bug in my repo", "coding"],
    ["Research the current free tiers of LLM providers and cite sources", "research"],
    ["Solve the integral of x sin(x) from 0 to pi", "math"],
    ["Build a predictive-maintenance pipeline for a motor", "build"],
    ["Design an end-to-end e-commerce platform", "build"],
    ["Analyze this electrical circuit from the image", "analysis"], // talks about an image, none attached → knowledge path, not vision
    ["What is in this circuit diagram?", "analysis"],
    ["Describe the attached photo", "analysis"],
  ];
  for (const [text, expect] of cases) {
    const c = classifyTask(text);
    assert.equal(c.kind, expect, `${text} → ${c.kind} (${c.kindReason})`);
    assert.ok(c.kindReason.length > 8);
  }
  // an ATTACHED image always routes to the vision lane
  const withImage = classifyTask("Explain what this code shows", { hasImages: true });
  assert.equal(withImage.kind, "vision");
  assert.equal(withImage.needs.vision, true);
  assert.match(withImage.kindReason, /image/);
  const alsoImage = classifyTask("Review this screenshot", { hasImages: true });
  assert.equal(alsoImage.kind, "vision");
  // deep plans for construction, shallow for direct questions
  assert.equal(classifyTask("Build a platform").planDepth, "deep");
  assert.equal(classifyTask("What is a linked list?").planDepth, "shallow");
});

// ------------------------------------------------------------------------- planner

test("ravana: planner builds acyclic DAGs and normalizes model output", () => {
  const plan = templateNodes("build", "x");
  assert.ok(plan.length >= 5);
  assert.equal(findCycle(plan), null);
  assert.equal(plan[0].dependencies.length, 0);
  // later nodes depend only on earlier ones
  for (const n of plan) for (const d of n.dependencies) assert.ok(plan.findIndex((x) => x.id === d) < plan.findIndex((x) => x.id === n.id));

  // normalizePlan: drops junk, keeps valid, renumbers, removes unknown deps
  const raw = { tasks: [
    { id: "task_002", description: "Research sources", type: "research", dependencies: ["task_001"], tools: ["web.search"] },
    { id: "task_003", description: "Synthesize", type: "nonsense", dependencies: ["task_999", "task_002"], tools: [] },
    { id: "task_001", description: "Understand", type: "understand", dependencies: [], tools: [] },
    { id: "bad id!", description: "x" },
  ] };
  const norm = normalizePlan(raw);
  assert.equal(norm.length, 3);
  assert.deepEqual(norm.map((n) => n.id), ["task_001", "task_002", "task_003"]);
  assert.equal(findCycle(norm), null);

  // cycle safety: breakCycles never leaves a cycle
  const cyc: RavanaPlanNode[] = [
    { id: "task_001", type: "reason", description: "a", dependencies: ["task_003"], priority: "normal", tools: [], status: "pending", attempts: 0 },
    { id: "task_002", type: "reason", description: "b", dependencies: ["task_001"], priority: "normal", tools: [], status: "pending", attempts: 0 },
    { id: "task_003", type: "reason", description: "c", dependencies: ["task_002"], priority: "normal", tools: [], status: "pending", attempts: 0 },
  ];
  assert.ok(findCycle(cyc));
  const fixed = breakCycles(cyc.map((n) => ({ ...n })));
  assert.equal(findCycle(fixed), null);
});

test("ravana: buildPlan kinds give sensible graphs", async () => {
  const shallow = await buildPlan({ kind: "chat", objective: "hi", needsLabel: "general", depth: "shallow", llm: null });
  assert.equal(shallow.nodes.length, 1);
  assert.equal(shallow.via, "linear");
  const deep = await buildPlan({ kind: "build", objective: "build a pipeline", needsLabel: "tools", depth: "deep", llm: null });
  assert.ok(deep.nodes.length >= 5);
  assert.equal(deep.via, "template");
  assert.equal(findCycle(deep.nodes), null);
});

// ------------------------------------------------------------------------- scheduler

test("ravana: scheduler gates nodes on dependencies and tracks progress", () => {
  const mk = (id: string, deps: string[], status: RavanaPlanNode["status"]): RavanaPlanNode => ({ id, type: "reason", description: id, dependencies: deps, priority: "normal", tools: [], status, attempts: 0 });
  let plan = [mk("task_001", [], "passed"), mk("task_002", ["task_001"], "pending"), mk("task_003", ["task_002"], "pending"), mk("task_004", ["task_001"], "pending")];
  assert.deepEqual(readyNodes(plan).map((n) => n.id), ["task_002", "task_004"]);
  plan = plan.map((n) => (n.id === "task_002" ? mk("task_002", ["task_001"], "failed") : n));
  assert.deepEqual(blockedNodes(plan).map((n) => n.id), ["task_003"]);
  assert.equal(planFailed(plan), true);
  assert.equal(planDone(plan), false);
  plan = plan.map((n) => (n.id === "task_004" ? mk("task_004", ["task_001"], "passed") : n));
  assert.equal(readyNodes(plan).length, 0, "nothing ready while a dep failed");
});

// ------------------------------------------------------------------------- model router

test("ravana: role router reads env overrides and reports honest status", async () => {
  const prev = process.env.RAVANA_MODEL_FAST;
  try {
    process.env.RAVANA_MODEL_FAST = "definitely-not-a-provider-xyz";
    const { selectCandidates } = await import("../src/core/ravana/routing/model_router");
    const sel = selectCandidates("fast", { allowKeyless: true });
    assert.equal(sel.override, "definitely-not-a-provider-xyz");
    assert.equal(sel.primary, null, "unknown provider → no candidate, never a silent fake");
    const pool = (await import("../src/core/ravana/routing/model_router")).modelPool();
    assert.equal(pool.roles.length, 4);
  } finally {
    if (prev === undefined) delete process.env.RAVANA_MODEL_FAST;
    else process.env.RAVANA_MODEL_FAST = prev;
  }
});

// ------------------------------------------------------------------------- memory

test("ravana: memory retrieval pipeline scores, reranks and filters", async () => {
  assert.equal(relevanceScore("predictive maintenance motors", "telemetry and predictive maintenance for motors"), 1);
  assert.equal(relevanceScore("quantum physics", "recipes for pasta"), 0);
  assert.ok(relevanceScore("motor anomaly", "predictive maintenance for motors") >= 0.2 && relevanceScore("motor anomaly", "predictive maintenance for motors") < 0.5, "subword matches count, less than exact");
  const imp = rerankScore({ importance: 1, createdAt: Date.now() } as never, 1);
  assert.ok(imp >= 0.85);
  const old = rerankScore({ importance: 0.4, createdAt: Date.now() - 100 * 86_400_000 } as never, 0);
  assert.ok(old < imp);

  await persistMemory({ uid: "mem1", projectId: null, taskId: null, type: "episodic", content: "event: ravana_task\naction: rvn_x\nresult: completed", tags: ["ravana", "episodic"], importance: 0.6, source: "engine" });
  await persistMemory({ uid: "mem1", projectId: null, taskId: null, type: "semantic", content: "The factory motor runs at 50 Hz", tags: ["ravana", "semantic"], importance: 0.5, source: "api" });

  const hits = await searchMemories({ uid: "mem1", query: "ravana task completion", projectId: null, topK: 5, includeLocal: false });
  assert.ok(hits.length >= 1);
  assert.ok(hits.some((h) => h.memory.type === "episodic"));
  const tagged = await searchMemories({ uid: "mem1", query: "motor", projectId: null, topK: 3, tags: ["semantic"] });
  assert.ok(tagged.length >= 1 && tagged.every((h) => h.memory.type === "semantic"));
});

// ------------------------------------------------------------------------- engine (preview, end-to-end)

test("ravana: engine completes a coding task end to end in preview mode with real python checks", async () => {
  const t0 = await createTask({
    uid: "ravana-e2e",
    objective: "Write a python function that validates an Indian UPI id (name@bank) and returns True/False, with tests",
    engine: "preview",
    title: "e2e code",
    budget: { timeoutMs: 60_000 },
  });
  assert.equal(t0.status, "queued");
  let t = t0;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    t = (await getTask(t.id))!;
    if (["completed", "failed", "cancelled", "timeout"].includes(t.status)) break;
  }
  assert.equal(t.status, "completed", `task failed: ${t.error}`);
  assert.equal(t.engineResolved, "preview");
  assert.equal(t.verification?.status, "passed");
  assert.ok(Object.keys(t.result?.files ?? {}).length > 0, "code task returns artifacts");
  assert.ok(t.events.some((e) => e.type === "tool.completed" && e.payload?.ok === true), "python sandbox check ran");
  assert.ok(t.summary?.toolsUsed.some((x) => x.name === "python.execute"));
  const list = await listTasks("ravana-e2e", {});
  assert.ok(list.some((x) => x.id === t.id));
});

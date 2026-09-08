/**
 * RAVANA Episode Ledger — unit tests.
 *
 *   Pure projection + list/detail/export over finished tasks.
 *   Uses the real engine store under an isolated AETHERIS_DATA_DIR.
 *   No model calls; seeds tasks directly via the store.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-episodes-"));
process.env.AETHERIS_EVENT_PERSIST = "0";

import { store } from "../src/lib/store";
import type { RavanaTask, RavanaPlanNode, RavanaEvent } from "../src/core/ravana/types";
import {
  computeStats,
  exportEpisodesCsv,
  exportEpisodesJson,
  getEpisode,
  listEpisodes,
  toCsvString,
  toEpisode,
  toEpisodeDetail,
  EPISODE_STATUSES,
} from "../src/core/ravana/episodes";

const COL = "ravana_tasks";

function node(partial: Partial<RavanaPlanNode> & { id: string }): RavanaPlanNode {
  return {
    id: partial.id,
    description: partial.description ?? partial.id,
    type: partial.type ?? "reason",
    priority: partial.priority ?? "normal",
    dependencies: partial.dependencies ?? [],
    tools: partial.tools ?? [],
    status: partial.status ?? "passed",
    attempts: partial.attempts ?? 1,
    output: partial.output,
    note: partial.note,
    verify: partial.verify,
  };
}

function ev(seq: number, type: RavanaEvent["type"], payload?: Record<string, unknown>, at = 1_000 + seq): RavanaEvent {
  return { seq, at, type, payload };
}

function baseTask(over: Partial<RavanaTask> & { id: string; uid: string }): RavanaTask {
  const now = Date.now();
  return {
    id: over.id,
    uid: over.uid,
    projectId: over.projectId ?? null,
    title: over.title ?? `Task ${over.id}`,
    objective: over.objective ?? "Do the thing",
    kind: over.kind ?? "analysis",
    kindReason: over.kindReason ?? "test seed",
    priority: over.priority ?? "normal",
    status: over.status ?? "completed",
    engine: over.engine ?? "preview",
    engineResolved: over.engineResolved ?? "preview",
    budget: over.budget ?? { maxModelCalls: 10, maxChars: 10_000, timeoutMs: 60_000, maxNodes: 6, verify: true },
    used: over.used ?? { modelCalls: 2, chars: 400, steps: 3 },
    plan: over.plan ?? [node({ id: "task_001", status: "passed" }), node({ id: "task_002", status: "passed", type: "synthesize" })],
    createdAt: over.createdAt ?? now - 5_000,
    startedAt: over.startedAt ?? now - 4_000,
    finishedAt: over.finishedAt ?? now - 1_000,
    events: over.events ?? [
      ev(1, "task.created"),
      ev(2, "engine.selected", { engine: "preview" }),
      ev(3, "task.planned"),
      ev(4, "task.started"),
      ev(5, "node.passed", { nodeId: "task_001" }),
      ev(6, "task.completed"),
    ],
    verification: over.verification ?? {
      strategy: "selfcheck",
      status: "passed",
      score: 0.9,
      findings: [],
      attempts: 1,
      independent: false,
    },
    result: over.result ?? { type: "answer", content: "The sky is blue because of Rayleigh scattering." },
    summary: over.summary ?? {
      engine: "preview",
      engineLabel: "preview (deterministic demo)",
      modelsUsed: [{ role: "fast", provider: "preview", model: "preview-v0", calls: 2 }],
      toolsUsed: [],
      steps: 3,
      ms: 3_000,
      replans: 0,
    },
    error: over.error,
    pendingTool: null,
    parentId: over.parentId,
  };
}

async function seed(tasks: RavanaTask[]) {
  for (const t of tasks) await store.set(COL, t.id, t);
}

// --------------------------------------------------------------------------- pure projection

test("episodes: toEpisode projects stored fields and never invents scores", () => {
  const t = baseTask({ id: "rvn_a1", uid: "u1" });
  const e = toEpisode(t);
  assert.equal(e.id, "rvn_a1");
  assert.equal(e.uid, "u1");
  assert.equal(e.status, "completed");
  assert.equal(e.kind, "analysis");
  assert.equal(e.engineResolved, "preview");
  assert.equal(e.nodes.total, 2);
  assert.equal(e.nodes.passed, 2);
  assert.equal(e.nodes.failed, 0);
  assert.equal(e.eventTotal, 6);
  assert.equal(e.eventCounts["task.completed"], 1);
  assert.equal(e.verification?.status, "passed");
  assert.equal(e.verification?.score, 0.9);
  assert.ok(e.durationMs !== null && e.durationMs >= 0);
  assert.ok((e.resultPreview ?? "").includes("Rayleigh"));
  assert.equal(e.error, null);
});

test("episodes: duration falls back to summary.ms when timestamps missing", () => {
  const t = baseTask({
    id: "rvn_dur",
    uid: "u1",
    summary: {
      engine: "preview",
      engineLabel: "preview",
      modelsUsed: [],
      toolsUsed: [],
      steps: 1,
      ms: 1234,
      replans: 0,
    },
  });
  // baseTask seeds timestamps via `??`; strip them so only summary.ms remains.
  delete t.startedAt;
  delete t.finishedAt;
  const e = toEpisode(t);
  assert.equal(e.durationMs, 1234);
});

test("episodes: toEpisodeDetail builds chronological timeline and plan", () => {
  const t = baseTask({
    id: "rvn_d1",
    uid: "u1",
    events: [ev(2, "task.planned"), ev(1, "task.created"), ev(3, "task.completed", { ok: true })],
    result: { type: "code", content: "def f():\n  return 1\n", files: { "main.py": "def f():\n  return 1\n", "test_main.py": "assert True\n" } },
  });
  const d = toEpisodeDetail(t);
  assert.equal(d.timeline.length, 3);
  assert.deepEqual(
    d.timeline.map((x) => x.seq),
    [1, 2, 3],
  );
  assert.equal(d.plan.length, 2);
  assert.equal(d.result?.type, "code");
  assert.deepEqual(d.result?.files.sort(), ["main.py", "test_main.py"]);
  assert.ok(d.timeline[2]!.summary.includes("ok=true"));
});

test("episodes: computeStats success rate ignores cancelled; empty → nulls", () => {
  assert.deepEqual(computeStats([]).successRate, null);
  assert.equal(computeStats([]).avgDurationMs, null);

  const eps = [
    toEpisode(baseTask({ id: "a", uid: "u", status: "completed", finishedAt: 1000, startedAt: 0 })),
    toEpisode(baseTask({ id: "b", uid: "u", status: "failed", finishedAt: 2000, startedAt: 1000 })),
    toEpisode(baseTask({ id: "c", uid: "u", status: "cancelled", finishedAt: 3000, startedAt: 2500 })),
    toEpisode(baseTask({ id: "d", uid: "u", status: "timeout", finishedAt: 4000, startedAt: 3000 })),
  ];
  const s = computeStats(eps);
  assert.equal(s.completed, 1);
  assert.equal(s.failed, 2); // failed + timeout
  assert.equal(s.successRate, 1 / 3);
  assert.equal(s.byStatus.cancelled, 1);
  assert.ok(s.avgDurationMs !== null);
});

// --------------------------------------------------------------------------- list / get / isolation

test("episodes: listEpisodes returns only terminal tasks for the uid", async () => {
  const uid = "ep-user-a";
  const other = "ep-user-b";
  await seed([
    baseTask({ id: "rvn_ok", uid, status: "completed", finishedAt: 5_000, createdAt: 1_000 }),
    baseTask({ id: "rvn_fail", uid, status: "failed", finishedAt: 6_000, createdAt: 2_000, kind: "coding" }),
    baseTask({ id: "rvn_live", uid, status: "running", finishedAt: undefined, startedAt: 7_000 }),
    baseTask({ id: "rvn_queued", uid, status: "queued", finishedAt: undefined }),
    baseTask({ id: "rvn_other", uid: other, status: "completed", finishedAt: 9_000 }),
  ]);

  const list = await listEpisodes(uid, { limit: 50 });
  assert.equal(list.uid, uid);
  assert.equal(list.total, 2);
  assert.deepEqual(
    list.episodes.map((e) => e.id),
    ["rvn_fail", "rvn_ok"],
  ); // newest finished first
  assert.ok(!list.episodes.some((e) => e.id === "rvn_live"));
  assert.ok(!list.episodes.some((e) => e.id === "rvn_other"));
  assert.ok(list.notes.proves.length > 20);
  assert.match(list.notes.doesNotProve, /does not invent accuracy/i);
  assert.ok(EPISODE_STATUSES.includes("completed"));
});

test("episodes: filters by status, kind, sinceMs and limit", async () => {
  const uid = "ep-filter";
  await seed([
    baseTask({ id: "rvn_c1", uid, status: "completed", kind: "coding", finishedAt: 10_000, createdAt: 1 }),
    baseTask({ id: "rvn_c2", uid, status: "completed", kind: "math", finishedAt: 20_000, createdAt: 2 }),
    baseTask({ id: "rvn_f1", uid, status: "failed", kind: "coding", finishedAt: 30_000, createdAt: 3 }),
    baseTask({ id: "rvn_t1", uid, status: "timeout", kind: "build", finishedAt: 40_000, createdAt: 4 }),
  ]);

  const onlyCoding = await listEpisodes(uid, { kind: ["coding"] });
  assert.equal(onlyCoding.total, 2);
  assert.ok(onlyCoding.episodes.every((e) => e.kind === "coding"));

  const onlyFailed = await listEpisodes(uid, { status: ["failed", "timeout"] });
  assert.equal(onlyFailed.total, 2);

  const since = await listEpisodes(uid, { sinceMs: 25_000 });
  assert.equal(since.total, 2);
  assert.ok(since.episodes.every((e) => (e.finishedAt ?? 0) >= 25_000));

  const limited = await listEpisodes(uid, { limit: 1 });
  assert.equal(limited.total, 1);
  assert.equal(limited.episodes[0]!.id, "rvn_t1");
});

test("episodes: getEpisode enforces ownership and terminal-only", async () => {
  const uid = "ep-get";
  await seed([
    baseTask({ id: "rvn_mine", uid, status: "completed" }),
    baseTask({ id: "rvn_run", uid, status: "running" }),
    baseTask({ id: "rvn_theirs", uid: "someone-else", status: "completed" }),
  ]);

  const mine = await getEpisode(uid, "rvn_mine");
  assert.ok(mine);
  assert.equal(mine!.id, "rvn_mine");
  assert.ok(mine!.timeline.length >= 1);
  assert.ok(mine!.plan.length >= 1);

  assert.equal(await getEpisode(uid, "rvn_run"), null);
  assert.equal(await getEpisode(uid, "rvn_theirs"), null);
  assert.equal(await getEpisode(uid, "rvn_missing"), null);
});

// --------------------------------------------------------------------------- export

test("episodes: JSON export mirrors list and carries notes", async () => {
  const uid = "ep-json";
  await seed([baseTask({ id: "rvn_j1", uid, status: "completed", title: "JSON one" })]);
  const bundle = await exportEpisodesJson(uid, { limit: 10 });
  assert.equal(bundle.format, "json");
  assert.equal(bundle.uid, uid);
  assert.equal(bundle.total, 1);
  assert.equal(bundle.episodes[0]!.title, "JSON one");
  assert.ok(bundle.notes.doesNotProve.includes("RAVANA-Bench") || bundle.notes.doesNotProve.includes("benchmark") || bundle.notes.doesNotProve.includes("accuracy"));
  assert.ok(bundle.exportedAt > 0);
});

test("episodes: CSV export has headers, rows, and boundary comments", async () => {
  const uid = "ep-csv";
  await seed([
    baseTask({ id: "rvn_csv1", uid, status: "completed", title: "Alpha, with comma" }),
    baseTask({ id: "rvn_csv2", uid, status: "failed", title: "Beta", error: "boom" }),
  ]);
  const csv = await exportEpisodesCsv(uid);
  assert.equal(csv.format, "csv");
  assert.equal(csv.total, 2);
  assert.ok(csv.headers.includes("id"));
  assert.ok(csv.headers.includes("verificationStatus"));
  assert.equal(csv.rows.length, 2);

  const text = toCsvString(csv);
  assert.ok(text.startsWith("id,"));
  assert.ok(text.includes("rvn_csv1"));
  assert.ok(text.includes('"Alpha, with comma"'), "comma in title is quoted");
  assert.ok(text.includes("# proves:"));
  assert.ok(text.includes("# doesNotProve:"));
});

test("episodes: empty uid yields empty list with null success rate", async () => {
  const list = await listEpisodes("ep-empty-never-seeded");
  assert.equal(list.total, 0);
  assert.equal(list.episodes.length, 0);
  assert.equal(list.stats.successRate, null);
  assert.equal(list.stats.avgDurationMs, null);
  assert.equal(list.stats.totalModelCalls, 0);
});

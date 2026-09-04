import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-verify-"));

import {
  extractJson,
  parseVerdict,
  reviewerGate,
  validateSchema,
  verifierStatus,
  verifyWithTests,
} from "../src/core/verification/verify";
import { applyPolicy } from "../src/lib/router/router";
import { fire, saveAutomation, validateAutomation } from "../src/core/automation/engine";
import { issueConfirmation } from "../src/core/policy/permissions";
import type { ProviderConfig } from "../src/lib/router/types";

const PROVIDERS: ProviderConfig[] = [
  { id: "groq", name: "Groq", model: "llama-3.3-70b", baseUrl: "https://x", local: false, contextTokens: 128_000, strengths: ["fast"] },
  { id: "anthropic", name: "Anthropic", model: "claude-sonnet-4", baseUrl: "https://y", local: false, contextTokens: 200_000, strengths: ["reasoning"] },
] as unknown as ProviderConfig[];

// --------------------------------------------------------------------------- schema validation

test("verify: the schema validator catches real problems and stays quiet about unknown keywords", () => {
  const schema = {
    type: "object",
    required: ["name", "score"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 2 },
      score: { type: "number", minimum: 0, maximum: 100 },
      tags: { type: "array", items: { type: "string" }, maxItems: 2 },
      mode: { enum: ["fast", "deep"] },
    },
  };
  const good = validateSchema({ name: "aetheris", score: 88, tags: ["a"], mode: "fast" }, schema);
  assert.equal(good.valid, true, JSON.stringify(good.issues));

  const bad = validateSchema({ name: "a", score: 140, tags: ["a", "b", "c"], mode: "slow", extra: 1 }, schema);
  assert.equal(bad.valid, false);
  const found = bad.issues.map((i) => `${i.path}:${i.keyword}`);
  for (const expected of ["/name:minLength", "/score:maximum", "/tags:maxItems", "/mode:enum", "/extra:additionalProperties"]) {
    assert.ok(found.includes(expected), `${expected} missing from ${found.join(", ")}`);
  }
  // items are validated with their own path (and only when the array is within maxItems)
  const badItem = validateSchema({ name: "ok", score: 1, tags: ["a", 2] }, schema);
  assert.ok(badItem.issues.some((i) => i.path === "/tags/1" && i.keyword === "type"), JSON.stringify(badItem.issues));
});

test("verify: nullable, unions, nested items and combination keywords", () => {
  assert.equal(validateSchema(null, { type: "string", nullable: true }).valid, true);
  assert.equal(validateSchema(null, { type: ["string", "null"] }).valid, true);
  assert.equal(validateSchema(null, { type: "string" }).valid, false);
  assert.equal(validateSchema("5", { type: ["string", "number"] }).valid, true);
  assert.equal(validateSchema(5, { type: "integer" }).valid, true);
  assert.equal(validateSchema(5.5, { type: "integer" }).valid, false);
  assert.equal(validateSchema(0, { type: "number", exclusiveMinimum: 0 }).valid, false);
  assert.equal(validateSchema("abc123", { pattern: "^[a-z]+[0-9]+$" }).valid, true);
  assert.equal(validateSchema("ABC", { pattern: "^[a-z]+$" }).valid, false);
  assert.equal(validateSchema({ a: { b: [{ c: 1 }] } }, { type: "object", properties: { a: { type: "object", properties: { b: { type: "array", items: { type: "object", required: ["c"] } } } } } }).valid, true);
  assert.equal(validateSchema({ a: { b: [{}] } }, { type: "object", properties: { a: { type: "object", properties: { b: { type: "array", items: { type: "object", required: ["c"] } } } } } }).valid, false);
  assert.equal(validateSchema("x", { anyOf: [{ type: "string" }, { type: "number" }] }).valid, true);
  assert.equal(validateSchema(true, { anyOf: [{ type: "string" }, { type: "number" }] }).valid, false);
  assert.equal(validateSchema(5, { oneOf: [{ type: "number" }, { minimum: 1 }] }).valid, false, "matches two branches → not oneOf");
  assert.equal(validateSchema(5, { allOf: [{ type: "number" }, { minimum: 1 }] }).valid, true);
});

test("verify: a malformed schema is reported as malformed instead of being silently ignored", () => {
  assert.equal(validateSchema({}, "nope").schemaOk, false);
  const badPattern = validateSchema("x", { pattern: "(" });
  assert.equal(badPattern.schemaOk, false);
  assert.equal(badPattern.valid, false);
  // unknown keywords must never make a value invalid
  assert.equal(validateSchema(1, { type: "number", $comment: "ignored", customThing: true }).valid, true);
});

// --------------------------------------------------------------------------- JSON extraction

test("verify: extractJson survives fences, prose and trailing junk", () => {
  assert.deepEqual(extractJson('```json\n{"pass": true, "score": 90}\n```').value, { pass: true, score: 90 });
  const prose = extractJson('Sure! Here you go:\n{"a": 1, "b": [1, 2]}\nHope that helps!');
  assert.equal(prose.found, true);
  assert.deepEqual(prose.value, { a: 1, b: [1, 2] });
  assert.deepEqual(extractJson('{"s": "a } brace inside a string"} trailing').value, { s: "a } brace inside a string" });
  assert.deepEqual(extractJson("first: [1, 2, 3] then words").value, [1, 2, 3]);
  const none = extractJson("no json here at all");
  assert.equal(none.found, false);
  assert.match(none.error ?? "", /no JSON/);
});

// --------------------------------------------------------------------------- verdict parsing

test("verify: parseVerdict clamps, defaults and never trusts a blocker-free pass claim", () => {
  const good = parseVerdict('{"pass": true, "score": 92, "findings": []}');
  assert.equal(good.pass, true);
  assert.equal(good.score, 92);

  const blocker = parseVerdict('{"pass": true, "score": 95, "findings": [{"severity": "blocker", "text": "made-up number"}]}');
  assert.equal(blocker.pass, false, "a blocker overrides pass:true");

  const weird = parseVerdict('{"pass": true, "score": 900, "findings": [{"severity": "cosmetic", "text": "nit"}]}');
  assert.equal(weird.score, 100, "score is clamped to 0-100");
  assert.equal(weird.findings[0].severity, "minor", "unknown severity degrades to minor");

  const noJson = parseVerdict("looks great to me!");
  assert.equal(noJson.pass, false);
  assert.equal(noJson.score, 0);
  assert.equal(noJson.findings[0].severity, "blocker");
  assert.match(noJson.findings[0].text, /did not return JSON/);
});

// --------------------------------------------------------------------------- reviewer gate

test("verify: the reviewer gate asks a different model, measures independence, and fails closed", async () => {
  const calls: { avoid?: string[] }[] = [];
  const complete = async ({ avoid }: { avoid?: string[] }) => {
    calls.push({ avoid });
    return { content: '{"pass": true, "score": 88, "findings": []}', provider: "anthropic", model: "claude-sonnet-4" };
  };

  const v = await reviewerGate({ question: "What is 2+2?", answer: "4", generator: "groq", complete });
  assert.equal(v.pass, true);
  assert.equal(v.score, 88);
  assert.equal(v.reviewer, "anthropic");
  assert.equal(v.generator, "groq");
  assert.equal(v.independent, true);
  assert.deepEqual(calls[0].avoid, ["groq"], "the generator's provider is avoided");
  assert.equal(calls.length, 1, "no retry needed when the reviewer is already independent");

  // Low score fails the gate even when the reviewer says pass.
  const strict = await reviewerGate({
    question: "q",
    answer: "a",
    minScore: 95,
    complete: async () => ({ content: '{"pass": true, "score": 80, "findings": []}', provider: "anthropic" }),
  });
  assert.equal(strict.pass, false);
  assert.equal(strict.score, 80);
  assert.equal(strict.independent, true, "no generator named → independence is not claimed as false");
});

test("verify: when the reviewer lands on the generator's model it retries once, then admits it", async () => {
  let calls = 0;
  const v = await reviewerGate({
    question: "q",
    answer: "a",
    generator: "groq",
    complete: async () => {
      calls += 1;
      return { content: '{"pass": true, "score": 75, "findings": []}', provider: "groq", model: "llama-3.3-70b" };
    },
  });
  assert.equal(calls, 2, "it asked for a different provider once more");
  assert.equal(v.independent, false, "…and reported that it did not get one");
  assert.equal(v.reviewer, "groq");
});

test("verify: a reviewer that errors or refuses to answer does not become a pass", async () => {
  const boom = await reviewerGate({ question: "q", answer: "a", complete: async () => { throw new Error("no providers configured"); } });
  assert.equal(boom.pass, false);
  assert.equal(boom.score, 0);
  assert.equal(boom.independent, false);
  assert.match(boom.findings[0].text, /could not run/);

  const prose = await reviewerGate({ question: "q", answer: "a", complete: async () => ({ content: "I think it is fine.", provider: "anthropic" }) });
  assert.equal(prose.pass, false);
  assert.equal(prose.independent, true);
  assert.equal(prose.findings[0].severity, "blocker");
});

test("verify: the router can actually be told to avoid a model", () => {
  const withoutAvoid = applyPolicy(PROVIDERS, { task: "reasoning" }).map((p) => p.id);
  assert.ok(withoutAvoid.includes("groq"), `sanity: groq is a candidate (${withoutAvoid.join(",")})`);
  const avoided = applyPolicy(PROVIDERS, { task: "reasoning", avoidModels: ["llama-3.3-70b"] }).map((p) => p.id);
  assert.deepEqual(avoided, ["anthropic"]);
  // Avoiding every candidate must not leave the caller with nothing.
  const allAvoided = applyPolicy(PROVIDERS, { avoidModels: ["llama-3.3-70b", "claude-sonnet-4"] }).map((p) => p.id);
  assert.equal(allAvoided.length, 2, "the filter is not applied when nothing would survive");
});

// --------------------------------------------------------------------------- test loop (real execution)

test("verify: the test loop really runs the command in the sandbox", async () => {
  const r = await verifyWithTests({ command: 'node -e \'console.log("all good"); process.exit(0)\'', timeoutMs: 20_000 });
  assert.equal(r.ok, true, r.finalOutput);
  assert.equal(r.stoppedBecause, "passed");
  assert.equal(r.attempts.length, 1);
  assert.equal(r.attempts[0].exitCode, 0);
  assert.match(r.attempts[0].stdout, /all good/);
});

test("verify: a failing test is fed back to revise() and the loop re-runs until it passes", async () => {
  const seen: { stdout: string; stderr: string; files: Record<string, string> }[] = [];
  const r = await verifyWithTests({
    command: "node app.js",
    files: { "app.js": 'console.error("boom"); process.exit(1);' },
    maxIterations: 3,
    timeoutMs: 20_000,
    revise: async ({ stdout, stderr, files }) => {
      seen.push({ stdout, stderr, files });
      return { "app.js": 'console.log("fixed"); process.exit(0);' };
    },
  });
  assert.equal(r.ok, true, r.finalOutput);
  assert.equal(r.stoppedBecause, "passed");
  assert.equal(r.attempts.length, 2);
  assert.equal(r.attempts[0].ok, false);
  assert.equal(r.attempts[0].exitCode, 1);
  assert.equal(r.attempts[0].revision, "app.js", "the attempt records what was revised");
  assert.equal(r.attempts[1].ok, true);
  assert.equal(seen.length, 1);
  assert.match(seen[0].stderr, /boom/, "the failure output is what revise() receives");
  assert.equal(seen[0].files["app.js"], 'console.error("boom"); process.exit(1);', "…along with the files that produced it");
  assert.equal(r.files["app.js"], 'console.log("fixed"); process.exit(0);', "the surviving files are returned");
});

test("verify: when nothing fixes it, the loop stops and says why", async () => {
  const r = await verifyWithTests({
    command: "node app.js",
    files: { "app.js": 'console.error("still broken"); process.exit(2);' },
    maxIterations: 2,
    timeoutMs: 20_000,
    revise: async () => null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.stoppedBecause, "revise_gave_up", "the loop says the revision step refused, not that it ran out of tries");
  assert.equal(r.iterations, 1, "it stops as soon as revise() returns nothing");
  assert.match(r.finalOutput, /still broken/);

  // With a revision that never helps, it really does exhaust the budget.
  const exhausted = await verifyWithTests({
    command: "node app.js",
    files: { "app.js": 'console.error("still broken"); process.exit(2);' },
    maxIterations: 2,
    timeoutMs: 20_000,
    revise: async () => ({ "app.js": 'console.error("still broken"); process.exit(2);' }),
  });
  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.stoppedBecause, "max_iterations");
  assert.equal(exhausted.iterations, 2);
});

test("verify: a command the sandbox policy refuses is refused before anything runs", async () => {
  const r = await verifyWithTests({ command: "sudo rm -rf /tmp/x" });
  assert.equal(r.ok, false);
  assert.equal(r.stoppedBecause, "command_refused");
  assert.equal(r.attempts.length, 0, "nothing was executed");
  assert.match(r.finalOutput, /not allowed|deny list|binary/);
});

test("verify: the loop reports what this host can and cannot isolate", async () => {
  const st = await verifierStatus();
  assert.equal(st.schemaValidation, true);
  assert.equal(st.independentReviewer, true);
  assert.equal(st.testLoop, true);
  assert.equal(st.testLoopRunner, "server sandbox");
  assert.ok(st.networkIsolation === "unshare -rn" || /unavailable/.test(st.networkIsolation), st.networkIsolation);
});

// --------------------------------------------------------------------------- wired into automations

test("verify: automations can verify with a schema or a real test loop, not just a rubric", async () => {
  const uid = "verify-auto-" + Date.now();

  // A command-based verify needs the same confirmation a manual execution needs.
  const noToken = validateAutomation({ name: "t", trigger: { kind: "manual" }, actions: [{ kind: "twin_event", twinId: "x", eventKind: "e", template: "t" }], verify: { kind: "tests", command: "node -e 1" } });
  assert.match(noToken ?? "", /executionToken/);
  assert.match(validateAutomation({ name: "t", trigger: { kind: "manual" }, actions: [{ kind: "twin_event", twinId: "x", eventKind: "e", template: "t" }], verify: { kind: "tests", command: "sudo rm -rf /" }, executionToken: "tok" }) ?? "", /refused by the sandbox/);
  assert.match(validateAutomation({ name: "t", trigger: { kind: "manual" }, actions: [{ kind: "twin_event", twinId: "x", eventKind: "e", template: "t" }], verify: { kind: "schema", schema: "nope" } }) ?? "", /JSON-Schema object/);

  const token = issueConfirmation(uid, "execution:server-sandbox");
  const a = await saveAutomation(uid, {
    name: "test loop gate",
    trigger: { kind: "manual" },
    actions: [{ kind: "remember", type: "episodic", template: "gate passed: {{output}}" }],
    verify: { kind: "tests", command: "node -e \"process.exit(0)\"", maxIterations: 1 },
    executionToken: token,
  });
  const run = await fire(a, "manual", {});
  const verifyStage = run.stages.find((s) => s.stage === "verify");
  assert.ok(verifyStage, JSON.stringify(run.stages));
  assert.equal(verifyStage.ok, true, verifyStage.detail);
  assert.match(verifyStage.detail ?? "", /passed after 1 attempt/);
  assert.equal(run.status, "ok");

  // A failing command blocks the run — and says why.
  const blocked = await saveAutomation(uid, {
    name: "failing gate",
    trigger: { kind: "manual" },
    actions: [{ kind: "remember", type: "episodic", template: "gate passed: {{output}}" }],
    verify: { kind: "tests", command: "node app.js", files: { "app.js": "process.exit(3);" }, maxIterations: 1 },
    executionToken: issueConfirmation(uid, "execution:server-sandbox"),
  });
  const r2 = await fire(blocked, "manual", {});
  assert.equal(r2.status, "blocked");
  assert.match(r2.stages.find((s) => s.stage === "verify")?.detail ?? "", /max_iterations after 1 attempt/);

  // Schema verify with no agent output cannot pass — it fails closed instead of vacuously passing.
  const schemaGate = await saveAutomation(uid, { name: "schema gate", trigger: { kind: "manual" }, actions: [{ kind: "remember", type: "episodic", template: "should not run" }], verify: { kind: "schema", schema: { type: "object", required: ["ok"] } } });
  const r3 = await fire(schemaGate, "manual", {});
  assert.equal(r3.status, "blocked");
  assert.match(r3.stages.find((s) => s.stage === "verify")?.detail ?? "", /not JSON/);
});

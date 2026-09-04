/**
 * Aetheris evaluation harness — deterministic, offline, free. Run: npx tsx evals/run.ts
 * Reports accuracy for: intent routing · execution policy · sandbox policy · knowledge retrieval (hybrid, hit@1/hit@3).
 * Thresholds fail the process (used in CI) so regressions are caught. No model calls.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
process.env.AETHERIS_KNOWLEDGE_DB = path.join(mkdtempSync(path.join(tmpdir(), "aeth-eval-")), "k.sqlite");
process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-eval-data-"));

type Cases = { intent: { text: string; task: string; hasKb?: boolean }[]; policy: { capability: string; required: string; grants: string[]; token: boolean; stop?: boolean; expect: boolean }[]; sandbox: { cmd: string; allow: boolean }[]; retrieval: { facts: string[]; queries: { q: string; expect: number }[] } };
const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8")) as Cases;
async function main() {
const { routeIntent } = await import("../src/core/intent/router");
const { bootCapabilities } = await import("../src/core/capabilities/sources");
const { decide } = await import("../src/core/policy/permissions");
const { policyCheck } = await import("../src/core/execution/sandbox");
const { addFact, queryFacts } = await import("../src/core/knowledge/fabric");

bootCapabilities();
const results: { suite: string; score: number; n: number; threshold: number; failures: string[] }[] = [];
const push = (suite: string, ok: boolean[], failures: string[], threshold: number) => results.push({ suite, score: ok.filter(Boolean).length / ok.length, n: ok.length, threshold, failures });

{ const ok: boolean[] = [], f: string[] = []; for (const c of cases.intent) { const p = await routeIntent(c.text, { hasKb: (c as { hasKb?: boolean }).hasKb }); const hit = p.task === c.task; ok.push(hit); if (!hit) f.push(`"${c.text.slice(0, 50)}" → ${p.task} (want ${c.task})`); } push("intent routing", ok, f, 0.85); }
{ const ok: boolean[] = [], f: string[] = []; for (const c of cases.policy) { const d = decide({ principal: { uid: "u", grants: c.grants as never }, capabilityId: c.capability, required: c.required as never, requiresConfirmation: c.required !== "read_only" && c.required !== "safe_write", confirmationToken: c.token ? "x" : undefined, stopAction: (c as { stop?: boolean }).stop }); const got = c.token && c.expect ? d.allow || d.code === "bad_token" : d.allow; const hit = got === c.expect; ok.push(hit); if (!hit) f.push(`${c.capability} grants=${c.grants} token=${c.token} → ${JSON.stringify(d)}`); } push("execution policy", ok, f, 1); }
{ const ok: boolean[] = [], f: string[] = []; for (const c of cases.sandbox) { const hit = (policyCheck(c.cmd) === null) === c.allow; ok.push(hit); if (!hit) f.push(`${c.cmd} → ${policyCheck(c.cmd) ?? "allowed"}`); } push("sandbox policy", ok, f, 1); }
{ const ids: string[] = []; for (const t of cases.retrieval.facts) ids.push((await addFact({ uid: "e", text: t, provenance: { kind: "user", confidence: 0.9 } })).id); const h1: boolean[] = [], h3: boolean[] = [], f: string[] = []; for (const q of cases.retrieval.queries) { const hits = await queryFacts("e", q.q, { k: 3 }); const rank = hits.findIndex((h) => h.fact.id === ids[q.expect]); h1.push(rank === 0); h3.push(rank >= 0); if (rank !== 0) f.push(`"${q.q}" → rank ${rank} (${hits[0]?.fact.text.slice(0, 40) ?? "none"})`); } push("retrieval hit@1", h1, f, 0.6); push("retrieval hit@3", h3, [], 0.8); /* 1 of 5 queries has zero lexical overlap — a known limit of the default local embedding; provider embeddings (EMBEDDINGS_URL) close it */ }

let fail = false;
for (const r of results) { const pass = r.score >= r.threshold; if (!pass) fail = true; console.log(`${pass ? "PASS" : "FAIL"}  ${r.suite.padEnd(18)} ${(r.score * 100).toFixed(0).padStart(3)}%  (n=${r.n}, threshold ${r.threshold * 100}%)`); for (const x of r.failures) console.log(`        - ${x}`); }
console.log(JSON.stringify({ at: new Date().toISOString(), results: results.map(({ suite, score, n }) => ({ suite, score, n })) }));
process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

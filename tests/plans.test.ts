import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANS, planRank } from "../src/lib/billing/plans";
import { MODEL_TIERS, maxTierFor, resolveTier } from "../src/lib/models/tiers";

test("five plans with the requested prices", () => {
  assert.deepEqual(PLANS.map((p) => [p.id, p.priceInr]), [["free", 0], ["lite", 200], ["pro", 500], ["pro-max", 1500], ["god-mode", 4000]]);
  assert.equal(PLANS[4].dailyCredits, null);
});

test("plan rank is monotonic and tiers cap by plan", () => {
  assert.ok(planRank("free") < planRank("lite") && planRank("lite") < planRank("pro") && planRank("pro-max") < planRank("god-mode"));
  assert.equal(maxTierFor("free").id, "aetheris-free");
  assert.equal(maxTierFor("pro").id, "aetheris-pro");
  assert.equal(maxTierFor("god-mode").id, "aetheris-god");
  const r = resolveTier("aetheris-god", "lite");
  assert.equal(r.tier.id, "aetheris-lite"); assert.equal(r.downgraded, true);
  assert.equal(resolveTier(undefined, "pro-max").tier.id, "aetheris-pro-max");
  assert.equal(MODEL_TIERS.length, 5);
});

test("credits: over-limit request is refused without inflating the counter; kinds are tracked", async () => {
  const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
  process.env.AETHERIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-credits-"));
  process.env.AETHERIS_PAID_PLANS = "1";
  const { consumeChat, usageSummary } = await import("../src/lib/billing/entitlements");
  // free plan: 50/day
  for (let i = 0; i < 48; i++) assert.equal((await consumeChat("c1", 1, "chat")).allowed, true);
  assert.equal((await consumeChat("c1", 5, "research")).allowed, false, "5 more would exceed 50");
  const s1 = await usageSummary("c1");
  assert.equal(s1.chat.used, 48, "refused request must not be charged");
  assert.equal((await consumeChat("c1", 2, "agents")).allowed, true);
  const s2 = await usageSummary("c1");
  assert.deepEqual(s2.byKind, { chat: 48, agents: 2 });
});

test("priority routing ranks by health instead of shuffling", async () => {
  process.env.GROQ_API_KEY = "x"; process.env.CEREBRAS_API_KEY = "x"; process.env.GEMINI_API_KEY = "x";
  const { orderedCandidates } = await import("../src/lib/router/router");
  const a = orderedCandidates({ priority: true, allow: ["groq", "cerebras", "gemini"] }).map((p) => p.id);
  const b = orderedCandidates({ priority: true, allow: ["groq", "cerebras", "gemini"] }).map((p) => p.id);
  assert.deepEqual(a, b, "deterministic ordering");
  assert.equal(a.length, 3);
});

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

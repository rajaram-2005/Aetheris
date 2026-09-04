import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

before(() => { process.env.AETHERIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-free-")); delete process.env.AETHERIS_PAID_PLANS; });

test("default deployment is free for everyone: god-mode features, no metering", async () => {
  const { freeForAll } = await import("../src/lib/billing/plans");
  const { planFor, consumeChat, hasFeature } = await import("../src/lib/billing/entitlements");
  assert.equal(freeForAll(), true);
  assert.equal((await planFor("anyone")).id, "god-mode");
  assert.equal(await hasFeature("anyone", "video"), true);
  const r = await consumeChat("anyone", 99_999, "research");
  assert.equal(r.allowed, true); assert.equal(r.limit, null); assert.equal(r.used, 99_999);
});

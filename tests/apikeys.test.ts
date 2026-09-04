import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

before(() => { process.env.AETHERIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-keys-")); process.env.AETHERIS_PAID_PLANS = "1"; });

test("api keys: gated by plan, hashed at rest, authenticate round-trip", async () => {
  const { createKey, authenticateKey, listKeys, revokeKey } = await import("../src/lib/keys/apikeys");
  const { grant } = await import("../src/lib/billing/entitlements");
  await assert.rejects(createKey("k1", "x", "aetheris-free"), /paid plan/);
  await grant("k1", "lite", "admin");
  const { key, record } = await createKey("k1", "my app", "aetheris-lite");
  assert.match(key, /^sk-aeth-/);
  assert.equal(record.prefix.startsWith("sk-aeth-"), true);
  await assert.rejects(createKey("k1", "second", "aetheris-lite"), /allows 1 API key/);
  const who = await authenticateKey(key);
  assert.equal(who?.uid, "k1");
  assert.equal(await authenticateKey("sk-aeth-nope"), null);
  assert.equal(await authenticateKey(key.slice(0, -1) + "x"), null);
  const raw = fs.readFileSync(path.join(process.env.AETHERIS_DATA_DIR!, "apikeys.json"), "utf8");
  assert.equal(raw.includes(key), false, "plaintext key must not be stored");
  await revokeKey("k1", record.id);
  assert.equal((await listKeys("k1")).length, 0);
});

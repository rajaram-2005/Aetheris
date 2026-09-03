import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

before(() => {
  process.env.AETHERIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-"));
  process.env.AETHERIS_FREE_DAILY_MESSAGES = "2";
});

test("UPI link is well-formed and points to the founder", async () => {
  const { createPayment } = await import("../src/lib/billing/payments");
  const p = await createPayment("user1", "pro-month");
  assert.match(p.id, /^AET[0-9A-F]{8}$/);
  const u = new URL(p.link);
  assert.equal(u.protocol, "upi:");
  assert.equal(u.searchParams.get("pa"), "9488407998@upi");
  assert.equal(u.searchParams.get("am"), "299.00");
  assert.equal(u.searchParams.get("tr"), p.id);
  assert.match(p.qr, /^data:image\/png;base64,/);
});

test("checkout → UTR → admin approve grants entitlement; quota respected", async () => {
  const { createPayment, submitUtr, decide, listPayments } = await import("../src/lib/billing/payments");
  const { hasFeature, consumeChat } = await import("../src/lib/billing/entitlements");

  assert.equal((await consumeChat("u2")).allowed, true);
  assert.equal((await consumeChat("u2")).allowed, true);
  assert.equal((await consumeChat("u2")).allowed, false, "third message over free limit");

  const p = await createPayment("u2", "pro-month");
  await assert.rejects(submitUtr("u2", p.id, "123"), /12-digit/);
  await assert.rejects(submitUtr("someone-else", p.id, "123456789012"), /not found/);
  const s = await submitUtr("u2", p.id, "1234 5678 9012");
  assert.equal(s.status, "submitted");
  assert.equal(s.utr, "123456789012");
  assert.equal((await listPayments("submitted")).length, 1);

  assert.equal(await hasFeature("u2", "video"), false);
  await decide(p.id, true);
  assert.equal(await hasFeature("u2", "video"), true);
  assert.equal(await hasFeature("u2", "factory_enterprise"), false);
  assert.equal((await consumeChat("u2")).limit, null, "pro = unlimited");
});

test("admin key check is constant-time-ish and rejects bad keys", async () => {
  process.env.AETHERIS_ADMIN_KEY = "secret-key";
  const { isAdmin } = await import("../src/lib/billing/admin");
  assert.equal(isAdmin(new Request("http://x/", { headers: { authorization: "Bearer secret-key" } })), true);
  assert.equal(isAdmin(new Request("http://x/?key=secret-key")), true);
  assert.equal(isAdmin(new Request("http://x/", { headers: { authorization: "Bearer nope" } })), false);
  assert.equal(isAdmin(new Request("http://x/")), false);
});

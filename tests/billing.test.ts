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
  const p = await createPayment("user1", "pro");
  assert.match(p.id, /^AET[0-9A-F]{8}$/);
  const u = new URL(p.link);
  assert.equal(u.protocol, "upi:");
  assert.equal(u.searchParams.get("pa"), "9488407998@upi");
  assert.equal(u.searchParams.get("am"), "500.00");
  assert.equal(u.searchParams.get("tr"), p.id);
  assert.match(p.qr, /^data:image\/png;base64,/);
});

test("checkout → UTR → admin approve grants entitlement; quota respected", async () => {
  const { createPayment, submitUtr, decide, listPayments } = await import("../src/lib/billing/payments");
  const { hasFeature, consumeChat } = await import("../src/lib/billing/entitlements");

  assert.equal((await consumeChat("u2")).allowed, true);
  assert.equal((await consumeChat("u2")).allowed, true);
  assert.equal((await consumeChat("u2")).allowed, false, "third message over free limit");

  const p = await createPayment("u2", "pro-max");
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
  assert.equal((await consumeChat("u2")).limit, 4000, "pro-max = 4000 credits/day");
  assert.equal(await hasFeature("u2", "parallel_agents"), true);
  const g = await createPayment("u3", "god-mode");
  await submitUtr("u3", g.id, "123456789012"); await decide(g.id, true);
  assert.equal((await consumeChat("u3")).limit, null, "god-mode = unlimited");
  assert.equal(await hasFeature("u3", "factory_enterprise"), true);
});

test("admin key check is constant-time-ish and rejects bad keys", async () => {
  process.env.AETHERIS_ADMIN_KEY = "secret-key";
  const { isAdmin } = await import("../src/lib/billing/admin");
  assert.equal(await isAdmin(new Request("http://x/", { headers: { authorization: "Bearer secret-key" } })), true);
  assert.equal(await isAdmin(new Request("http://x/?key=secret-key")), true);
  assert.equal(await isAdmin(new Request("http://x/", { headers: { authorization: "Bearer nope" } })), false);
  assert.equal(await isAdmin(new Request("http://x/")), false);
});

test("admin accounts (founder email/phone) get God Mode and unlimited credits", async () => {
  const { resolveAccount } = await import("../src/lib/auth/accounts");
  const { planFor, consumeChat } = await import("../src/lib/billing/entitlements");
  const { isAdminAccount } = await import("../src/lib/billing/admin");
  const acc = await resolveAccount({ provider: "phone", subject: "+919488407998", phone: "+919488407998" }, "founder-uid");
  assert.equal(isAdminAccount(acc), true);
  assert.equal((await planFor("founder-uid")).id, "god-mode");
  assert.equal((await consumeChat("founder-uid", 10_000)).allowed, true);
  const other = await resolveAccount({ provider: "email", subject: "x@y.z", email: "x@y.z" }, "plain-uid");
  assert.equal(isAdminAccount(other), false);
  assert.equal((await planFor("plain-uid")).id, "free");
});

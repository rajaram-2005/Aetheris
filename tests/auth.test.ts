import test from "node:test";
import assert from "node:assert/strict";
import { resolveAccount, issueCode, verifyCode, normalizePhone } from "../src/lib/auth/accounts";

const rnd = () => Math.random().toString(36).slice(2, 8);

test("same email across google + email OTP joins one account", async () => {
  const email = `join-${rnd()}@example.com`;
  const a = await resolveAccount({ provider: "google", subject: "g-" + rnd(), email, name: "R" }, "anon-1");
  const b = await resolveAccount({ provider: "email", subject: email, email }, "anon-2");
  assert.equal(a.id, b.id);
  assert.equal(b.uid, "anon-1", "first anonymous uid is adopted");
  assert.ok(b.providers.google && b.providers.email);
});

test("phone links into an existing session account", async () => {
  const a = await resolveAccount({ provider: "github", subject: "gh-" + rnd(), email: `p-${rnd()}@x.io` }, "anon-3");
  const phone = "+9199" + Math.floor(10000000 + Math.random() * 89999999);
  const b = await resolveAccount({ provider: "phone", subject: phone, phone }, "anon-4", a.id);
  assert.equal(a.id, b.id);
  assert.equal(b.phone, phone);
  const c = await resolveAccount({ provider: "phone", subject: phone, phone }, "anon-5");
  assert.equal(c.id, a.id, "phone now resolves to the same account");
});

test("otp verify: correct code once, wrong codes limited", async () => {
  const email = `otp-${rnd()}@example.com`;
  const r = await issueCode("email", email);
  assert.ok("code" in r);
  const code = (r as { code: string }).code;
  assert.equal(await verifyCode("email", email, "000000" === code ? "111111" : "000000"), false);
  assert.equal(await verifyCode("email", email, code), true);
  assert.equal(await verifyCode("email", email, code), false, "code is single-use");
  const again = await issueCode("email", email);
  assert.ok("code" in again);
  assert.ok("error" in (await issueCode("email", email)), "resend throttled for 45s");
});

test("normalizePhone defaults bare 10 digits to +91", () => {
  assert.equal(normalizePhone("98765 43210"), "+919876543210");
  assert.equal(normalizePhone("+1 415 555 0100"), "+14155550100");
});

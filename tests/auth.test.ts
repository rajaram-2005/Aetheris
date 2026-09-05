import test from "node:test";
import assert from "node:assert/strict";
import { resolveAccount, issueCode, verifyCode, normalizePhone, sessionCookies } from "../src/lib/auth/accounts";
import { authenticationRequired, guestAccessEnabled, isPublicAuthPath, validSessionCookie } from "../src/lib/auth/gate";
import { safeReturnTo } from "../src/lib/auth/return-to";
import { seal } from "../src/lib/crypto";
import { authenticatedUid } from "../src/lib/user";

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

test("mandatory auth gate validates sealed, unexpired sessions", async () => {
  const prior = process.env.AETHERIS_SECRET;
  const secret = "gate-test-secret-" + rnd();
  process.env.AETHERIS_SECRET = secret;
  try {
    const valid = seal(JSON.stringify({ id: "a".repeat(24), exp: Date.now() + 60_000 }));
    const expired = seal(JSON.stringify({ id: "b".repeat(24), exp: Date.now() - 1 }));
    assert.equal(await validSessionCookie(valid, { AETHERIS_SECRET: secret }), true);
    assert.equal(await validSessionCookie(expired, { AETHERIS_SECRET: secret }), false);
    assert.equal(await validSessionCookie(valid.slice(0, -2) + "xx", { AETHERIS_SECRET: secret }), false);
    assert.equal(await validSessionCookie(undefined, { AETHERIS_SECRET: secret }), false);
  } finally {
    if (prior === undefined) delete process.env.AETHERIS_SECRET;
    else process.env.AETHERIS_SECRET = prior;
  }
});

test("mandatory ownership uses the uid sealed into the account session", async () => {
  const prior = process.env.AETHERIS_SECRET;
  process.env.AETHERIS_SECRET = "owner-session-test-" + rnd();
  try {
    const uid = "c".repeat(32);
    const account = await resolveAccount({ provider: "guest", subject: "guest-" + rnd(), name: "Preview Guest" }, uid);
    const session = sessionCookies(account)[0].value;
    assert.equal(await authenticatedUid(session), uid);
    assert.equal(await authenticatedUid(session.slice(0, -2) + "xx"), null);
  } finally {
    if (prior === undefined) delete process.env.AETHERIS_SECRET;
    else process.env.AETHERIS_SECRET = prior;
  }
});

test("auth gate is hosted-only and preserves intentional public endpoints", () => {
  assert.equal(authenticationRequired({ AETHERIS_REQUIRE_AUTH: "1" }), true);
  assert.equal(authenticationRequired({ AETHERIS_REQUIRE_AUTH: "0" }), false);
  assert.equal(authenticationRequired({ AETHERIS_REQUIRE_AUTH: "1", AETHERIS_DESKTOP: "1" }), false);
  assert.equal(guestAccessEnabled({ AETHERIS_GUEST_ACCESS: "1" }), true);
  assert.equal(guestAccessEnabled({}), false);
  for (const path of ["/login", "/docs/authentication", "/api/auth/session", "/api/health", "/s/public-id"]) {
    assert.equal(isPublicAuthPath(path, "GET"), true, path);
  }
  assert.equal(isPublicAuthPath("/api/characters", "GET"), false);
  assert.equal(isPublicAuthPath("/", "GET"), false);
});

test("post-auth return paths cannot redirect off site or loop through login", () => {
  assert.equal(safeReturnTo("/room/abc?tab=chat"), "/room/abc?tab=chat");
  assert.equal(safeReturnTo("https://evil.example"), "/");
  assert.equal(safeReturnTo("//evil.example"), "/");
  assert.equal(safeReturnTo("/login?next=/admin"), "/");
});

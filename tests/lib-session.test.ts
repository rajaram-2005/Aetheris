/**
 * Tests for the session layer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { issueSession, resolveSession, hasSession, requireSession, persistAccount, newUid, newAccountId, AuthenticationRequiredError } from "../src/lib/session";
import { store } from "@/lib/store";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-sess-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("session: issue → resolve round-trip", () => {
  const uid = newUid();
  const accountId = newAccountId();
  const sealed = issueSession(accountId, uid);
  const r = resolveSession(sealed);
  assert.ok(r);
  assert.equal(r!.uid, uid);
  assert.equal(r!.accountId, accountId);
  assert.ok(r!.exp > Date.now());
});

test("session: resolveSession returns null on undefined", () => {
  assert.equal(resolveSession(undefined), null);
  assert.equal(resolveSession(null), null);
  assert.equal(resolveSession(""), null);
});

test("session: resolveSession returns null on garbage", () => {
  assert.equal(resolveSession("not-a-sealed-payload"), null);
});

test("session: hasSession mirrors resolveSession", () => {
  const uid = newUid();
  const accountId = newAccountId();
  const sealed = issueSession(accountId, uid);
  assert.equal(hasSession(sealed), true);
  assert.equal(hasSession("garbage"), false);
  assert.equal(hasSession(undefined), false);
});

test("session: requireSession throws on garbage", () => {
  assert.throws(() => requireSession("garbage"), AuthenticationRequiredError);
});

test("session: requireSession returns the resolved session on a valid payload", () => {
  const uid = newUid();
  const accountId = newAccountId();
  const sealed = issueSession(accountId, uid);
  const r = requireSession(sealed);
  assert.equal(r.uid, uid);
  assert.equal(r.accountId, accountId);
});

test("session: expired session is rejected", () => {
  const uid = newUid();
  const accountId = newAccountId();
  const sealed = issueSession(accountId, uid, -1000); // already expired
  assert.equal(resolveSession(sealed), null);
});

test("session: ttl is respected (default 24h)", () => {
  const uid = newUid();
  const accountId = newAccountId();
  const sealed = issueSession(accountId, uid);
  const r = resolveSession(sealed)!;
  const expected = Date.now() + 24 * 60 * 60_000;
  assert.ok(Math.abs(r.exp - expected) < 5000, `exp off by ${Math.abs(r.exp - expected)}ms`);
});

test("session: different uids get different sealed payloads", () => {
  const a = issueSession(newAccountId(), newUid());
  const b = issueSession(newAccountId(), newUid());
  assert.notEqual(a, b);
});

test("session: persistAccount + accounts store round-trip", async () => {
  const dir = freshEnv();
  try {
    const uid = newUid();
    const accountId = newAccountId();
    await persistAccount(uid, accountId);
    const row = await store.get<{ uid: string }>("accounts", accountId);
    assert.ok(row);
    assert.equal(row!.uid, uid);
  } finally { cleanup(dir); }
});

test("session: persistAccount rejects an invalid uid", async () => {
  const dir = freshEnv();
  try {
    await assert.rejects(persistAccount("not-a-uid", newAccountId()), /invalid uid/);
  } finally { cleanup(dir); }
});

test("session: persistAccount rejects an invalid accountId", async () => {
  const dir = freshEnv();
  try {
    await assert.rejects(persistAccount(newUid(), "not-an-account-id"), /invalid accountId/);
  } finally { cleanup(dir); }
});

test("session: resolveSession rejects an out-of-spec uid in the payload", () => {
  // A sealed payload with a malformed uid should not resolve.
  // We can't easily forge a sealed payload without the secret,
  // so we test the negative path: a non-hex uid would be
  // rejected if it ever appeared.
  const sealed = issueSession(newAccountId(), "x".repeat(32)); // not hex
  assert.equal(resolveSession(sealed), null);
});

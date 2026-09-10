/**
 * Phase 8 (public hardening): the login gate flips via env, edge session validation matches the
 * server seal, public paths stay reachable, and the rate limiter works against Upstash REST with
 * an in-memory fallback — failing open when Redis is down.
 */
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { seal } from "../src/lib/crypto";
import { authenticationRequired, isPublicAuthPath, validSessionCookie } from "../src/lib/auth/gate";
import { __clearRateLimitMemoryForTests, __setRateLimitFetchForTests, checkRateLimit } from "../src/lib/ratelimit";

const saved = { ...process.env };

beforeEach(() => {
  __clearRateLimitMemoryForTests();
  __setRateLimitFetchForTests(null);
  delete process.env.AETHERIS_REQUIRE_LOGIN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

afterEach(() => {
  __setRateLimitFetchForTests(null);
  for (const k of ["AETHERIS_REQUIRE_LOGIN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "AETHERIS_SECRET"]) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

const session = (over: Record<string, unknown> = {}) =>
  seal(JSON.stringify({ id: "a".repeat(24), uid: "b".repeat(32), exp: Date.now() + 60_000, ...over }));

test("login gate flips via AETHERIS_REQUIRE_LOGIN", () => {
  assert.equal(authenticationRequired(), false);
  process.env.AETHERIS_REQUIRE_LOGIN = "1";
  assert.equal(authenticationRequired(), true);
  assert.equal(authenticationRequired({ AETHERIS_REQUIRE_LOGIN: "0" }), false);
});

test("public auth paths stay reachable without a session", () => {
  const open: [string, string][] = [
    ["/", "GET"], ["/docs/setup", "GET"], ["/s/abc123", "GET"],
    ["/api/auth/session", "GET"], ["/api/auth/github", "GET"],
    ["/api/health", "GET"], ["/api/version", "GET"],
    ["/api/share/xyz", "GET"], ["/api/v1/chat/completions", "POST"],
    ["/api/automations/abc/hook", "POST"], ["/api/schedules/tick", "GET"],
    ["/icon.svg", "GET"],
  ];
  for (const [p, m] of open) assert.equal(isPublicAuthPath(p, m), true, `${m} ${p}`);
  const gated: [string, string][] = [
    ["/chat", "GET"], ["/api/chat", "POST"], ["/api/telemetry", "GET"],
    ["/api/providers/keys", "PUT"], ["/api/lab", "POST"], ["/api/share/xyz", "POST"],
  ];
  for (const [p, m] of gated) assert.equal(isPublicAuthPath(p, m), false, `${m} ${p}`);
});

test("edge session validation matches the server seal", async () => {
  assert.equal(await validSessionCookie(session()), true);
  assert.equal(await validSessionCookie(session({ exp: Date.now() - 1000 })), false); // expired
  assert.equal(await validSessionCookie(session({ id: "not-hex" })), false); // malformed id
  assert.equal(await validSessionCookie("garbage!!"), false);
  assert.equal(await validSessionCookie(undefined), false);
  const good = session();
  const tampered = good.slice(0, -2) + (good.endsWith("AA") ? "BB" : "AA");
  assert.equal(await validSessionCookie(tampered), false); // GCM tag fails
  assert.equal(await validSessionCookie(good, { AETHERIS_SECRET: "wrong-secret", NODE_ENV: "production" }), false);
});

test("rate limiter: in-memory fallback slides and blocks", async () => {
  const c = { key: "test:mem", limit: 2, windowMs: 60_000 };
  assert.equal((await checkRateLimit(c)).allowed, true);
  assert.equal((await checkRateLimit(c)).allowed, true);
  const third = await checkRateLimit(c);
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterSec > 0 && third.retryAfterSec <= 60);
});

test("rate limiter: Upstash REST pipeline allows, denies and fails open", async () => {
  process.env.UPSTASH_REDIS_REST_URL = "https://upstash.example";
  process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
  const seen: { url: string; init?: RequestInit }[] = [];
  let results: unknown[] = [{ result: "OK" }, { result: 1 }, { result: 59000 }];
  __setRateLimitFetchForTests(async (url, init) => {
    seen.push({ url, init });
    return { ok: true, json: async () => results } as unknown as Response;
  });
  const c = { key: "test:up", limit: 60, windowMs: 60_000 };
  assert.equal((await checkRateLimit(c)).allowed, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://upstash.example/pipeline");
  assert.equal((seen[0].init?.headers as Record<string, string>).authorization, "Bearer tok");
  const cmds = JSON.parse(String(seen[0].init?.body)) as string[][];
  assert.deepEqual(cmds.map((x) => x[0]), ["SET", "INCR", "PTTL"]);
  assert.deepEqual(cmds[0].slice(2), ["0", "EX", "60", "NX"]);

  results = [{ result: null }, { result: 61 }, { result: 42000 }];
  const denied = await checkRateLimit(c);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSec, 42);

  __setRateLimitFetchForTests(async () => { throw new Error("redis is down"); });
  assert.equal((await checkRateLimit(c)).allowed, true); // fail open
  __setRateLimitFetchForTests(async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response);
  assert.equal((await checkRateLimit(c)).allowed, true); // fail open
});

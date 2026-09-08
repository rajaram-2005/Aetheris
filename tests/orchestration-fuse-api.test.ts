/**
 * Tests for the /api/fuse HTTP route.
 *
 *   The route itself uses getUserId() which calls Next's
 *   cookies() — that requires a request scope we don't have
 *   under node:test. We test the request-shape handling
 *   (GET → 405, body parsing) directly. The underlying
 *   fuse() engine is covered by tests/orchestration-fusion.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";

test("api/fuse: GET returns 405", async () => {
  const { GET } = await import("../src/app/api/fuse/route");
  const r = await GET();
  assert.equal(r.status, 405);
});

test("api/fuse: GET body explains POST", async () => {
  const { GET } = await import("../src/app/api/fuse/route");
  const r = await GET();
  const j = await r.json();
  assert.equal(j.error, "use POST");
});

test("api/fuse: POST handler is exported as a function", async () => {
  const m = await import("../src/app/api/fuse/route");
  assert.equal(typeof m.POST, "function");
});

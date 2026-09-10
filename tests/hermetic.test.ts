/**
 * The test suite is hermetic — enforced, not assumed.
 *
 * `tests/hermetic.mjs` blocks outbound `fetch` in every test process (loaded via the `test` script's
 * `--import`). Without it, nine test files called real keyless LLM providers, and
 * `tests/warroom.test.ts` timed out at 120 s on GitHub runners while finishing in under a second
 * locally — decided entirely by whether the machine could reach the internet. See that file for the
 * full account.
 *
 * These tests fail if the guard is ever dropped from the script, and they fail loudly rather than
 * letting a runner rediscover the problem as a two-minute timeout.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

test("hermetic: outbound fetch is refused, so no test can depend on the internet", async () => {
  await assert.rejects(
    () => fetch("https://example.com"),
    /must not make outbound network calls/,
    "the suite must run with tests/hermetic.mjs installed — see the `test` script in package.json",
  );
});

test("hermetic: the refusal is a rejection, not a throw, so callers can fall back", async () => {
  // The provider adapters `await` fetch and treat a failure as "next provider, then synthetic". A
  // synchronously thrown error would escape as an unhandled rejection instead of taking that path.
  const p = fetch("https://example.com");
  assert.ok(p instanceof Promise, "fetch returns a promise even when the call is refused");
  await assert.rejects(() => p);
});

test("hermetic: loopback traffic is still allowed", async () => {
  // Several suites stand up a real local server; blocking it would break them, and it never leaves
  // the machine, so it is not what this guard is about.
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    server.close();
  }
});

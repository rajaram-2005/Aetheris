/**
 * The Aetheris test suite must not touch the internet.
 *
 * Why this file exists
 * --------------------
 * `npm test` passed locally and failed on GitHub runners with
 *
 *     not ok - tests/warroom.test.ts
 *       error: 'test timed out after 120000ms'
 *       failureType: 'testTimeoutFailure'
 *
 * and the reason is that the suite was never hermetic. The War Room debate engine calls the real
 * model router, which — with no API keys set — still reaches for **keyless** community providers
 * (`text.pollinations.ai`, `api.llm7.io`). Nine test files did that; `tests/warroom.test.ts` alone
 * made 286 outbound calls, because one debate is up to nine turns and one test loops over eight
 * debates.
 *
 * That is invisible on a machine with restricted egress: every attempt fails in milliseconds, the
 * engine falls back to its deterministic synthetic transcript, and the whole file finishes in under
 * a second. It is not invisible on a runner with real internet. Each attempt may burn the full
 * provider timeout — `AETHERIS_PROVIDER_TIMEOUT_MS`, default **45 000 ms** — so a handful of turns
 * is all it takes to blow past `--test-timeout=120000`. Same code, same command, opposite outcome,
 * decided entirely by whether the machine can reach the internet.
 *
 * A test that only passes when the network is unavailable is not testing the fallback path; it is
 * racing it. This guard makes "no provider is reachable" true by construction, so the synthetic
 * path the War Room tests assert (`provider === "synthetic"`) is exercised deterministically.
 *
 * Loopback is still allowed: several suites stand up a real local server and talk to it over
 * `127.0.0.1`, and that traffic never leaves the machine.
 *
 * Loaded for every test process by the `test` script via `--import`, which `node --test` forwards to
 * each file it runs. `tests/hermetic.test.ts` asserts that it is actually installed.
 */

const realFetch = globalThis.fetch;

/** Hosts that never leave the machine. */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"]);

function hostOf(input) {
  const raw =
    typeof input === "string" ? input : input && typeof input.url === "string" ? input.url : String(input ?? "");
  try {
    return { raw, host: new URL(raw).hostname };
  } catch {
    // Not a parseable absolute URL — a relative path or a scheme node handles itself. Let it through.
    return { raw, host: null };
  }
}

globalThis.fetch = function hermeticFetch(input, init) {
  const { host } = hostOf(input);
  if (host === null || LOOPBACK.has(host)) return realFetch(input, init);
  // Reject rather than throw: provider adapters await this and treat a failed call as "try the next
  // provider, then fall back", which is exactly the path under test.
  return Promise.reject(
    new Error(
      `the Aetheris test suite must not make outbound network calls (blocked ${host}). ` +
        `If this call is intentional, it belongs behind an injected client, not a live endpoint — see tests/hermetic.mjs`,
    ),
  );
};

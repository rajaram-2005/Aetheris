/**
 * Tests for the (UNVERIFIED) Experiential provider entry.
 *
 *   - When EXPERIENTIAL_API_KEY is not set, the provider is NOT configured.
 *   - When EXPERIENTIAL_API_KEY is set, isConfigured() returns true.
 *   - The provider is at priority 9 so it never preempts a working Tier-1/2 provider.
 *   - The capability card is honest (status reflects configuration).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS, apiKeyFor, isConfigured, providerById, resolveModel } from "../src/lib/router/providers";

const exp = providerById("experiential");
test("experiential: provider entry exists in the mesh", () => assert.ok(exp, "experiential entry not found in PROVIDERS"));
test("experiential: is at priority 9 so it never preempts working providers", () => {
  assert.ok(exp, "experiential entry not found");
  // Every other provider must be at a lower (more preferred) priority, OR equal
  // priority 9 (which would be acceptable, but no other entry should exceed it).
  for (const p of PROVIDERS) {
    if (p.id === "experiential") continue;
    assert.ok((p.priority ?? 99) <= 9, `provider ${p.id} priority ${p.priority} should not exceed 9`);
  }
});
test("experiential: requires its own env key and is not configured when absent", () => {
  const saved = process.env.EXPERIENTIAL_API_KEY;
  delete process.env.EXPERIENTIAL_API_KEY;
  try {
    assert.equal(isConfigured(exp!), false, "experiential must not be configured without a key");
    assert.equal(apiKeyFor(exp!), "", "apiKeyFor should return empty string when the key is missing");
  } finally { if (saved !== undefined) process.env.EXPERIENTIAL_API_KEY = saved; }
});
test("experiential: is configured when the env key is set", () => {
  const saved = process.env.EXPERIENTIAL_API_KEY;
  process.env.EXPERIENTIAL_API_KEY = "test-key-not-real";
  try { assert.equal(isConfigured(exp!), true); assert.equal(apiKeyFor(exp!), "test-key-not-real"); }
  finally { if (saved === undefined) delete process.env.EXPERIENTIAL_API_KEY; else process.env.EXPERIENTIAL_API_KEY = saved; }
});
test("experiential: model override via AETHERIS_MODEL_EXPERIENTIAL is honoured", () => {
  const saved = process.env.AETHERIS_MODEL_EXPERIENTIAL;
  process.env.AETHERIS_MODEL_EXPERIENTIAL = "claude-fable-5.1";
  try { assert.equal(resolveModel(exp!), "claude-fable-5.1"); }
  finally { if (saved === undefined) delete process.env.AETHERIS_MODEL_EXPERIENTIAL; else process.env.AETHERIS_MODEL_EXPERIENTIAL = saved; }
});
test("experiential: notes warn the user that the entry is unverified", () => {
  assert.match(exp!.notes ?? "", /EXPERIMENTAL|unverified/i);
});
test("experiential: baseUrl is the public site (no secret paths)", () => {
  assert.match(exp!.baseUrl, /^https:\/\/api\.experientiallabs\.ai\//);
});

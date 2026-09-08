/**
 * Tests for the Model Arena engine.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runArena, arenaProviderList } from "../src/core/arena/compare";
import { PROVIDERS } from "@/lib/router/providers";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-ar-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("arena: returns one row per provider in PROVIDERS", async () => {
  const dir = freshEnv();
  try {
    const r = await runArena("Hello");
    assert.equal(r.total, PROVIDERS.length);
  } finally { cleanup(dir); }
});

test("arena: with no API keys configured, keyless providers may still succeed; key-required providers are not_configured", async () => {
  const dir = freshEnv();
  try {
    // Clear all provider env keys to be sure.
    for (const p of PROVIDERS) delete process.env[p.envKey];
    const r = await runArena("Hello");
    // Every key-required provider must be not_configured.
    for (const row of r.rows) {
      if (!row.configured) {
        assert.equal(row.status, "not_configured");
        assert.ok(row.error);
      }
    }
    // The configured-keyless providers (e.g. pollinations, llm7)
    // can be ok or error depending on network state; the test
    // only asserts that the configured ones have a non-empty
    // status field.
    for (const row of r.rows) {
      assert.ok(["ok", "error", "not_configured"].includes(row.status));
    }
  } finally { cleanup(dir); }
});

test("arena: not_configured rows include the missing env key in the error", async () => {
  const dir = freshEnv();
  try {
    for (const p of PROVIDERS) delete process.env[p.envKey];
    const r = await runArena("Hello");
    const nc = r.rows.find((row) => row.status === "not_configured");
    assert.ok(nc);
    assert.ok(nc.error);
    assert.ok(nc.error.includes("set "));
  } finally { cleanup(dir); }
});

test("arena: providerIds filter narrows the list", async () => {
  const dir = freshEnv();
  try {
    const r = await runArena("Hello", { providerIds: ["groq", "ollama"] });
    assert.equal(r.total, 2);
    for (const row of r.rows) {
      assert.ok(["groq", "ollama"].includes(row.providerId));
    }
  } finally { cleanup(dir); }
});

test("arena: unknown providerIds are filtered out", async () => {
  const dir = freshEnv();
  try {
    const r = await runArena("Hello", { providerIds: ["groq", "nope-not-a-real-provider"] });
    assert.equal(r.total, 1);
    assert.equal(r.rows[0]!.providerId, "groq");
  } finally { cleanup(dir); }
});

test("arena: rows are sorted by providerId", async () => {
  const dir = freshEnv();
  try {
    const r = await runArena("Hello");
    for (let i = 1; i < r.rows.length; i++) {
      assert.ok(r.rows[i - 1]!.providerId.localeCompare(r.rows[i]!.providerId) <= 0);
    }
  } finally { cleanup(dir); }
});

test("arena: best is null when nothing succeeded", async () => {
  const dir = freshEnv();
  try {
    for (const p of PROVIDERS) delete process.env[p.envKey];
    const r = await runArena("Hello");
    assert.equal(r.best, null);
  } finally { cleanup(dir); }
});

test("arena: arenaProviderList returns one row per provider with costClass + locality", () => {
  const list = arenaProviderList();
  assert.equal(list.length, PROVIDERS.length);
  for (const p of list) {
    assert.ok(p.id);
    assert.ok(p.name);
    assert.equal(typeof p.costClass, "string");
    assert.ok(["local", "remote"].includes(p.locality));
    assert.equal(typeof p.configured, "boolean");
  }
});

test("arena: result has total = rows.length", async () => {
  const dir = freshEnv();
  try {
    const r = await runArena("Hello");
    assert.equal(r.total, r.rows.length);
    assert.equal(r.succeeded + r.failed, r.total);
  } finally { cleanup(dir); }
});

test("arena: each row has the required fields for the page", async () => {
  const dir = freshEnv();
  try {
    const r = await runArena("Hello");
    for (const row of r.rows) {
      assert.ok(row.providerId);
      assert.ok(row.providerName);
      assert.ok(row.model);
      assert.equal(typeof row.configured, "boolean");
      assert.ok(["ok", "error", "not_configured"].includes(row.status));
      assert.equal(typeof row.latencyMs, "number");
      assert.equal(typeof row.costClass, "string");
    }
  } finally { cleanup(dir); }
});

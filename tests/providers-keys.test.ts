import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Fresh data dir BEFORE the store module loads (tsx keeps requires in statement order).
const dir = mkdtempSync(path.join(tmpdir(), "aeth-keys-"));
process.env.AETHERIS_DATA_DIR = dir;

import { runtimeKeyFor, setRuntimeKey, resetRuntimeKeyCacheForTests } from "../src/lib/router/runtimeKeys";
import { apiKeyFor, isConfigured, providerById, providerKey, providerKeySource } from "../src/lib/router/providers";
import { maskKey } from "../src/lib/router/router";

test("provider keys: no key anywhere → unconfigured; .env fallback works", () => {
  const groq = providerById("groq")!;
  assert.equal(providerKey(groq), undefined);
  assert.equal(providerKeySource(groq), undefined);
  assert.equal(isConfigured(groq), false);
  assert.equal(apiKeyFor(groq), "", "non-keyless provider without a key sends nothing");
  try {
    process.env.GROQ_API_KEY = "gsk_env-abcdef123456";
    assert.equal(providerKey(groq), "gsk_env-abcdef123456");
    assert.equal(providerKeySource(groq), "env");
    assert.equal(isConfigured(groq), true);
    assert.equal(apiKeyFor(groq), "gsk_env-abcdef123456");
  } finally {
    delete process.env.GROQ_API_KEY;
  }
});

test("provider keys: app runtime key overrides .env and removes cleanly", () => {
  const groq = providerById("groq")!;
  try {
    process.env.GROQ_API_KEY = "gsk_env-abcdef123456";
    setRuntimeKey("GROQ_API_KEY", "gsk_app-zzzyyyxxx111");
    assert.equal(providerKey(groq), "gsk_app-zzzyyyxxx111", "runtime key wins over .env");
    assert.equal(providerKeySource(groq), "app");
    assert.equal(apiKeyFor(groq), "gsk_app-zzzyyyxxx111");
    assert.equal(isConfigured(groq), true);

    setRuntimeKey("GROQ_API_KEY", "");
    assert.equal(providerKey(groq), "gsk_env-abcdef123456", "removing the app key falls back to .env");
    assert.equal(providerKeySource(groq), "env");
  } finally {
    delete process.env.GROQ_API_KEY;
    setRuntimeKey("GROQ_API_KEY", "");
  }
});

test("provider keys: persisted on disk, reloaded after cache reset", () => {
  const file = path.join(dir, "runtime_keys.json");
  assert.equal(existsSync(file), false, "no file before any key is stored");
  setRuntimeKey("GEMINI_API_KEY", "AIza-demo-key-0001");
  assert.ok(existsSync(file), "file created after storing a key");
  const onDisk = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  assert.equal(onDisk.GEMINI_API_KEY, "AIza-demo-key-0001");
  resetRuntimeKeyCacheForTests(); // simulates a fresh module instance / restart
  assert.equal(runtimeKeyFor("GEMINI_API_KEY"), "AIza-demo-key-0001", "key survives a cache reset (restart)");
  setRuntimeKey("GEMINI_API_KEY", "");
  assert.equal(existsSync(file), false, "file removed when the last key is deleted");
});

test("provider keys: keyless providers stay usable and send an app key when one is stored", () => {
  const llm = providerById("llm7")!;
  assert.equal(llm.keyless, true);
  assert.equal(isConfigured(llm), true, "keyless providers are always configured");
  assert.equal(apiKeyFor(llm), "anonymous");
  setRuntimeKey(llm.envKey, "llm-app-key-123");
  assert.equal(providerKeySource(llm), "app");
  assert.equal(apiKeyFor(llm), "llm-app-key-123", "a stored key is sent instead of the anonymous placeholder");
  setRuntimeKey(llm.envKey, "");
  assert.equal(apiKeyFor(llm), "anonymous");
});

test("router maskKey never leaks a full key", () => {
  assert.equal(maskKey(undefined), null);
  assert.equal(maskKey("ab"), "ab…");
  assert.equal(maskKey("sk-very-long-secret-value-1234567890"), "sk-ve…7890");
  assert.ok(!maskKey("sk-very-long-secret-value-1234567890")!.includes("very-long"));
});

test("cleanup", () => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

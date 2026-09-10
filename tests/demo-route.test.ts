/**
 * Smoke test for the /api/demo route.
 *
 * Boots a real NextRequest against a freshly-mkdtemp data dir, with the
 * DEMO env var flipped on. The route should:
 *   - Return enabled=true and seeded=true.
 *   - Be idempotent (a second call returns seeded=true, created=false).
 *   - Populate the store with chats / projects / twins / diagnostic-history.
 *
 * The route file is loaded directly so we don't need a full Next server.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Each subtest gets a fresh data dir + DEMO env so it can stand alone.
function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-demo-api-"));
  process.env.AETHERIS_DATA_DIR = dir;
  process.env.AETHERIS_DEMO = "1";
  return dir;
}

function cleanup(dir: string) {
  delete process.env.AETHERIS_DEMO;
  delete process.env.AETHERIS_DEMO_PROVIDER;
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("api/demo: GET seeds + reports enabled when AETHERIS_DEMO=1", async () => {
  const dir = freshEnv();
  try {
    // Re-import the route after the env is set so module-level reads are
    // correct on the first call.
    const { GET } = await import("../src/app/api/demo/route");
    const r = await GET();
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.enabled, true);
    assert.equal(j.seeded, true);
    assert.equal(j.uid, "demo-user");
    assert.equal(j.created, true, "first call should report created=true");
    assert.equal(j.pinnedProvider, "groq");
  } finally {
    cleanup(dir);
  }
});

test("api/demo: GET is idempotent on a second call", async () => {
  const dir = freshEnv();
  try {
    const { GET } = await import("../src/app/api/demo/route");
    await GET();
    const r2 = await GET();
    const j2 = await r2.json();
    assert.equal(j2.enabled, true);
    assert.equal(j2.seeded, true);
    assert.equal(j2.created, false, "second call should report created=false");
  } finally {
    cleanup(dir);
  }
});

test("api/demo: GET reports enabled=false when AETHERIS_DEMO is unset", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-demo-api-"));
  process.env.AETHERIS_DATA_DIR = dir;
  delete process.env.AETHERIS_DEMO;
  try {
    const { GET } = await import("../src/app/api/demo/route");
    const r = await GET();
    const j = await r.json();
    assert.equal(j.enabled, false);
    assert.equal(j.seeded, false);
    assert.equal(j.pinnedProvider, null);
    assert.equal(j.created, false);
  } finally {
    cleanup(dir);
  }
});

test("api/demo: AETHERIS_DEMO_PROVIDER is reflected in pinnedProvider", async () => {
  const dir = freshEnv();
  process.env.AETHERIS_DEMO_PROVIDER = "cerebras";
  try {
    const { GET } = await import("../src/app/api/demo/route");
    const r = await GET();
    const j = await r.json();
    assert.equal(j.pinnedProvider, "cerebras");
  } finally {
    cleanup(dir);
  }
});

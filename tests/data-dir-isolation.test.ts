/**
 * Data-directory isolation for the two SQLite-backed stores.
 *
 * Why this file exists
 * --------------------
 * `AETHERIS_DATA_DIR` is configuration, and the test suite configures it *per test*: every file here
 * points it at a fresh `mkdtemp` directory so that no test can observe another test's data. That only
 * works if a store resolves the variable when it is **used**.
 *
 * `src/core/observability/events.ts` and `src/core/knowledge/fabric.ts` both used to read it once, at
 * module load, into a top-level `const`. Whatever the environment held at import time was then frozen
 * for the life of the process, so setting `AETHERIS_DATA_DIR` afterwards silently did nothing: every
 * test process — and every test file — wrote into the same `<repo>/data/*.sqlite`.
 *
 * That is invisible when the suite runs serially, because `traceReport(uid, { sinceMs })` filters on
 * timestamp and every other file's events are older than the window. It is *not* invisible on a
 * GitHub runner. There `node --test` runs test files in parallel (concurrency follows the CPU count:
 * 4 CPUs, three files at once), and a concurrently-running file's events land inside the window:
 *
 *     not ok - trace: per-group totalMs is the sum of step ms
 *       Expected values to be strictly equal: 340 !== 300
 *
 * `npm test` failed there and passed locally for exactly this reason. Both stores now resolve the
 * directory per call, which is also what `src/lib/store.ts` and `src/lib/router/runtimeKeys.ts`
 * already did — these two were the outliers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clear, loadPersisted, record } from "../src/core/observability/events";
import { traceReport } from "../src/core/observability/trace";
import { addFact } from "../src/core/knowledge/fabric";

const fresh = (prefix: string) => mkdtempSync(path.join(tmpdir(), prefix));

/** Point AETHERIS_DATA_DIR at `dir` for the duration of `fn`, then restore it exactly. */
function withDataDir<T>(dir: string | undefined, fn: () => T): T {
  const previous = process.env.AETHERIS_DATA_DIR;
  try {
    if (dir === undefined) delete process.env.AETHERIS_DATA_DIR;
    else process.env.AETHERIS_DATA_DIR = dir;
    return fn();
  } finally {
    if (previous === undefined) delete process.env.AETHERIS_DATA_DIR;
    else process.env.AETHERIS_DATA_DIR = previous;
  }
}

test("telemetry: the durable log is created under the configured AETHERIS_DATA_DIR", () => {
  const a = fresh("aeth-iso-events-a-");
  try {
    withDataDir(a, () => {
      clear();
      record({ type: "tool", uid: "u-iso", capability: "tool:iso.probe", ok: true, ms: 40 });
      assert.ok(
        existsSync(path.join(a, "telemetry.sqlite")),
        "the durable event log must be created inside the configured AETHERIS_DATA_DIR — reading the variable at import time instead sends every process's telemetry into one shared store",
      );
    });
  } finally {
    rmSync(a, { recursive: true, force: true });
  }
});

test("telemetry: a data dir that has never been used restores no events", () => {
  // This is the exact mechanism that failed CI. A fresh process starts with an empty in-memory
  // buffer, so its first read calls loadPersisted() and pulls the durable log's tail in. When every
  // process shares one log, a parallel test file's events are pulled into this report.
  const a = fresh("aeth-iso-events-a-");
  const b = fresh("aeth-iso-events-b-");
  try {
    withDataDir(a, () => {
      clear();
      record({ type: "agent", uid: "u-iso", capability: "agent:Prime.chat", ok: true, ms: 100 });
    });
    withDataDir(b, () => {
      clear();
      assert.equal(loadPersisted(), 0, "an unused data dir has nothing persisted");
      assert.equal(
        traceReport("u-iso", { sinceMs: 0 }).totalMs,
        0,
        "events written under one AETHERIS_DATA_DIR must not be visible from another",
      );
    });
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("knowledge: the fabric database is created under the configured AETHERIS_DATA_DIR", async () => {
  const a = fresh("aeth-iso-fabric-a-");
  try {
    await withDataDir(a, async () => {
      await addFact({
        uid: "u-iso",
        text: "Aetheris stores knowledge under the configured data directory.",
        provenance: { kind: "user", confidence: 1 },
      });
      assert.ok(
        existsSync(path.join(a, "knowledge.sqlite")),
        "the knowledge fabric must open its database inside the configured AETHERIS_DATA_DIR — a module-load-time read makes every process share one knowledge store",
      );
    });
  } finally {
    rmSync(a, { recursive: true, force: true });
  }
});

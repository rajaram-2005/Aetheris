/**
 * Tests for the Sandboxed Terminal.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runTerminal } from "../src/core/automation/terminal";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function freshEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "aeth-term-"));
  process.env.AETHERIS_DATA_DIR = dir;
  return dir;
}
function cleanup(dir: string) {
  delete process.env.AETHERIS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}

test("terminal: empty command is rejected by policy", async () => {
  const dir = freshEnv();
  try {
    const r = await runTerminal({ uid: "u-empty", command: "" });
    assert.equal(r.policyOk, false);
    assert.equal(r.policyReason, "empty command");
  } finally { cleanup(dir); }
});

test("terminal: binary not in allowlist is rejected by policy", async () => {
  const dir = freshEnv();
  try {
    const r = await runTerminal({ uid: "u-bad", command: "weirdtool --x" });
    assert.equal(r.policyOk, false);
    assert.match(r.policyReason ?? "", /not in the allowlist|not allowed|binary/i);
  } finally { cleanup(dir); }
});

test("terminal: path traversal is rejected by policy", async () => {
  const dir = freshEnv();
  try {
    const r = await runTerminal({ uid: "u-trav", command: "cat /etc/passwd" });
    assert.equal(r.policyOk, false);
  } finally { cleanup(dir); }
});

test("terminal: pwd runs in a fresh sandbox and returns a path", async () => {
  const dir = freshEnv();
  try {
    const r = await runTerminal({ uid: "u-pwd", command: "pwd" });
    assert.equal(r.policyOk, true);
    assert.equal(r.ok, true);
    assert.match(r.stdout, /\//);
  } finally { cleanup(dir); }
});

test("terminal: result includes the binary, command, capability, and ranAt", async () => {
  const dir = freshEnv();
  try {
    const r = await runTerminal({ uid: "u-shape", command: "pwd" });
    assert.equal(r.binary, "pwd");
    assert.equal(r.command, "pwd");
    assert.equal(r.capability, "tool:terminal.run");
    assert.ok(typeof r.ranAt === "number");
  } finally { cleanup(dir); }
});

test("terminal: result includes fsChanges array (possibly empty)", async () => {
  const dir = freshEnv();
  try {
    const r = await runTerminal({ uid: "u-fs", command: "pwd" });
    assert.ok(Array.isArray(r.fsChanges));
  } finally { cleanup(dir); }
});

test("terminal: exit code is captured for non-zero exit", async () => {
  const dir = freshEnv();
  try {
    const r = await runTerminal({ uid: "u-exit", command: "false" });
    assert.equal(r.ok, false);
    assert.notEqual(r.exitCode, 0);
  } finally { cleanup(dir); }
});

test("terminal: true returns exit 0", async () => {
  const dir = freshEnv();
  try {
    const r = await runTerminal({ uid: "u-true", command: "true" });
    assert.equal(r.ok, true);
    assert.equal(r.exitCode, 0);
  } finally { cleanup(dir); }
});

test("terminal: cat to a missing file has non-zero exit", async () => {
  const dir = freshEnv();
  try {
    const r = await runTerminal({ uid: "u-cat", command: "cat nope.txt" });
    assert.equal(r.ok, false);
    assert.notEqual(r.exitCode, 0);
  } finally { cleanup(dir); }
});

test("terminal: per-uid attribution is preserved in the result", async () => {
  const dir = freshEnv();
  try {
    const r = await runTerminal({ uid: "u-specific", command: "pwd" });
    assert.equal(r.command, "pwd");
    assert.equal(r.capability, "tool:terminal.run");
  } finally { cleanup(dir); }
});

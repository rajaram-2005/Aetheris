/**
 * RAVANA workspace backends: the filesystem default is unchanged; the Blob backend
 * (hosted/Vercel path) is exercised against a stub fetch — hermetic, no network.
 */
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  TraversalError, isBlobWorkspace, normalizeRel, workspaceRead, workspaceRemove, workspaceStatus, workspaceWrite,
} from "../src/lib/workspace";
import { __setBlobFetchForTests, blobPublicUrl } from "../src/lib/blob";

const prevWorkspace = process.env.AETHERIS_WORKSPACE;
const prevToken = process.env.BLOB_READ_WRITE_TOKEN;
const prevDataDir = process.env.AETHERIS_DATA_DIR;

type Call = { url: string; init?: RequestInit };
let calls: Call[];
let handler: (url: string, init?: RequestInit) => { ok: boolean; status: number; body: string };

const okText = (body: string) => ({ ok: true, status: 200, body });
const notFound = () => ({ ok: false, status: 404, body: "not found" });

beforeEach(() => {
  calls = [];
  handler = () => okText("");
  __setBlobFetchForTests(async (url, init) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return { ok: r.ok, status: r.status, text: async () => r.body } as unknown as Response;
  });
  process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-ws-"));
  delete process.env.AETHERIS_WORKSPACE;
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

afterEach(() => {
  __setBlobFetchForTests(null);
  if (prevWorkspace === undefined) delete process.env.AETHERIS_WORKSPACE; else process.env.AETHERIS_WORKSPACE = prevWorkspace;
  if (prevToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = prevToken;
  if (prevDataDir === undefined) delete process.env.AETHERIS_DATA_DIR; else process.env.AETHERIS_DATA_DIR = prevDataDir;
});

const TOKEN = "vercel_blob_rw_store123_secret";

test("workspace: files backend round-trips nested paths", async () => {
  assert.equal(isBlobWorkspace(), false);
  await workspaceWrite("u1", "notes/a.txt", "hello");
  assert.equal(await workspaceRead("u1", "notes/a.txt"), "hello");
  await assert.rejects(workspaceRead("u1", "missing.txt"));
  await workspaceRemove("u1", "notes/a.txt");
  await assert.rejects(workspaceRead("u1", "notes/a.txt"));
  const st = await workspaceStatus("u1");
  assert.equal(st.backend, "files");
  assert.equal(st.reachable, true);
});

test("workspace: traversal is refused on both backends without touching storage", async () => {
  for (const rel of ["../x.txt", "a/../../x.txt", "/abs.txt", "", "a//..//b"]) {
    assert.throws(() => normalizeRel(rel), TraversalError);
    await assert.rejects(workspaceWrite("u1", rel, "x"), TraversalError);
    await assert.rejects(workspaceRead("u1", rel), TraversalError);
  }
  assert.equal(calls.length, 0);
  process.env.AETHERIS_WORKSPACE = "blob";
  process.env.BLOB_READ_WRITE_TOKEN = TOKEN;
  await assert.rejects(workspaceWrite("u1", "../x.txt", "x"), TraversalError);
  await assert.rejects(workspaceRead("u1", "../x.txt"), TraversalError);
  assert.equal(calls.length, 0);
});

test("workspace: blob backend PUTs and GETs the right URLs with auth", async () => {
  process.env.AETHERIS_WORKSPACE = "blob";
  process.env.BLOB_READ_WRITE_TOKEN = TOKEN;
  assert.equal(isBlobWorkspace(), true);

  await workspaceWrite("u1", "notes/a.txt", "hello blob");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://blob.vercel-storage.com/ravana-workspace/u1/notes/a.txt");
  assert.equal(calls[0].init?.method, "PUT");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(headers["x-add-random-suffix"], "0");
  assert.equal(calls[0].init?.body, "hello blob");

  handler = () => okText("hello blob");
  assert.equal(await workspaceRead("u1", "notes/a.txt"), "hello blob");
  assert.equal(calls[1].url, "https://store123.public.blob.vercel-storage.com/ravana-workspace/u1/notes/a.txt");

  await workspaceRemove("u1", "notes/a.txt");
  assert.equal(calls[2].url, "https://blob.vercel-storage.com/delete");
  assert.equal(calls[2].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), { urls: ["https://store123.public.blob.vercel-storage.com/ravana-workspace/u1/notes/a.txt"] });
});

test("workspace: blob backend surfaces 404s, failures and missing config clearly", async () => {
  process.env.AETHERIS_WORKSPACE = "blob";
  process.env.BLOB_READ_WRITE_TOKEN = TOKEN;
  handler = () => notFound();
  await assert.rejects(workspaceRead("u1", "gone.txt"), /not found/);

  handler = () => ({ ok: false, status: 500, body: "boom" });
  await assert.rejects(workspaceWrite("u1", "a.txt", "x"), /blob upload failed \(500: boom\)/);

  delete process.env.BLOB_READ_WRITE_TOKEN;
  await assert.rejects(workspaceWrite("u1", "a.txt", "x"), /BLOB_READ_WRITE_TOKEN/);
  const st = await workspaceStatus("u1");
  assert.equal(st.backend, "blob");
  assert.equal(st.reachable, false);
  assert.match(st.reason ?? "", /BLOB_READ_WRITE_TOKEN/);

  process.env.BLOB_READ_WRITE_TOKEN = "not-a-real-token";
  assert.throws(() => blobPublicUrl("x.txt"), /unexpected shape/);
});

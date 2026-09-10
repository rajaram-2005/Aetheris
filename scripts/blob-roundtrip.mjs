#!/usr/bin/env node
/**
 * Staging validation for the Vercel Blob workspace backend (Phase 5): round-trips a scratch
 * file through the same REST calls src/lib/blob.ts makes (PUT → GET → DELETE) and prints the
 * exact failure if the protocol has drifted. Run with a real token — never in CI:
 *
 *   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... node scripts/blob-roundtrip.mjs
 */
const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
if (!token) {
  console.error("FAIL: set BLOB_READ_WRITE_TOKEN first (Vercel → Storage → Blob → .env.local).");
  process.exit(1);
}
const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(token);
if (!m) {
  console.error("FAIL: token has an unexpected shape (expected vercel_blob_rw_<storeId>_…).");
  process.exit(1);
}
const storeId = m[1];
const key = `__smoke__/${Date.now()}.txt`;
const body = `aetheris blob smoke ${new Date().toISOString()}`;
const fail = (step, res, text) => {
  console.error(`FAIL at ${step}: HTTP ${res.status} ${text.slice(0, 300)}`);
  process.exit(1);
};

// 1) upload
let res = await fetch(`https://blob.vercel-storage.com/${key}`, {
  method: "PUT",
  headers: {
    authorization: `Bearer ${token}`,
    "x-api-version": "7",
    "x-add-random-suffix": "0",
    "x-content-type": "text/plain; charset=utf-8",
    "x-cache-control-max-age": "0",
  },
  body,
});
if (!res.ok) fail("PUT", res, await res.text());
const url = `https://${storeId}.public.blob.vercel-storage.com/${key}`;
console.log(`PUT ok → ${url}`);

// 2) download
res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
if (!res.ok) fail("GET", res, await res.text());
const back = await res.text();
if (back !== body) {
  console.error(`FAIL at GET: body mismatch (got ${JSON.stringify(back.slice(0, 80))})`);
  process.exit(1);
}
console.log("GET ok (body matches)");

// 3) delete
res = await fetch("https://blob.vercel-storage.com/delete", {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "x-api-version": "7", "content-type": "application/json" },
  body: JSON.stringify({ urls: [url] }),
});
if (!res.ok) fail("DELETE", res, await res.text());
console.log("DELETE ok");
console.log("PASS: blob round-trip works — the workspace blob backend is live-validated.");

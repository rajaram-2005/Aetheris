/**
 * End-to-end: start the *real* embedded Aetheris server exactly the way the desktop app does, and
 * verify it behaves like a desktop instance.
 *
 * This is the strongest check in the repo for the desktop path — it spawns the Next.js standalone
 * bundle through `startLocalServer` (the same function `desktop/src/main.ts` calls), with the same
 * environment, and then makes real HTTP requests to it:
 *
 *   - `/api/health` and `/api/version` answer and report `runtime: "desktop"`,
 *   - the loopback `Host` guard rejects a forged public host name (DNS-rebinding defence),
 *   - the app UI really is served from the loopback origin, and that origin is stable across
 *     restarts (which is what keeps the session cookie alive between launches).
 *
 * It needs `desktop/resources/server`, produced by `npm run desktop:build` (or
 * `AETHERIS_STANDALONE=1 npm run build && npm run desktop:prepare`). When that directory is absent
 * the test skips with a reason rather than passing vacuously — CI runs it after the build step.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { startLocalServer, type LocalServer } from "../desktop/src/lib/local-server";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SERVER_DIR = path.join(ROOT, "desktop", "resources", "server");
const BUILD_INFO = path.join(SERVER_DIR, "aetheris-desktop-build.json");

/** One raw HTTP/1.1 request so the Host header can be forged (fetch refuses to send one). */
function rawStatus(port: number, hostHeader: string, pathName = "/api/health"): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1", () => {
      sock.write(`GET ${pathName} HTTP/1.1\r\nHost: ${hostHeader}\r\nConnection: close\r\n\r\n`);
    });
    let buf = "";
    sock.on("data", (c) => {
      buf += c.toString();
    });
    sock.on("error", reject);
    sock.on("close", () => {
      const m = /^HTTP\/1\.[01] (\d{3})/.exec(buf);
      if (!m) reject(new Error(`no status line in response: ${buf.slice(0, 80)}`));
      else resolve(Number(m[1]));
    });
  });
}

const skipReason = !fs.existsSync(path.join(SERVER_DIR, "server.js"))
  ? "desktop/resources/server is not built — run `npm run desktop:build` (or `AETHERIS_STANDALONE=1 npm run build && npm run desktop:prepare`)"
  : false;

test("embedded server (e2e): the standalone bundle boots on loopback and behaves like a desktop instance", { skip: skipReason }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-e2e-"));
  const logs: string[] = [];
  let srv: LocalServer | null = null;
  t.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  try {
    srv = await startLocalServer({
      serverDir: SERVER_DIR,
      execPath: process.execPath, // node here, the Electron binary in the packaged app
      dataDir,
      preferredPort: 17890,
      healthTimeoutMs: 120_000,
      inheritedEnv: { ...process.env, NODE_OPTIONS: "--inspect", GROQ_API_KEY: "gsk_must-not-leak" },
      onLog: (l) => logs.push(l),
    });

    assert.match(srv.url, /^http:\/\/127\.0\.0\.1:\d+$/, srv.url);
    assert.equal(srv.state, "ready");
    assert.ok(typeof srv.pid === "number" && srv.pid > 0, `pid ${String(srv.pid)}`);

    // 1. Health + version: the routes the desktop shell polls before it shows the app.
    const health = await fetch(`${srv.url}/api/health`).then((r) => r.json() as Promise<Record<string, unknown>>);
    assert.equal(health.ok, true);
    assert.equal(health.service, "aetheris-one");
    assert.equal(health.runtime, "desktop", "the server knows it is the embedded desktop instance");
    assert.equal(health.data_dir, "writable");

    const version = await fetch(`${srv.url}/api/version`).then((r) => r.json() as Promise<Record<string, unknown>>);
    assert.equal(version.runtime, "desktop");
    assert.equal(version.scheme, "calver");
    assert.equal(version.cadence, "monthly");
    assert.equal(version.version, fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim(), "serves the released version");

    // 2. The app itself is served from the loopback origin.
    const page = await fetch(`${srv.url}/`, { headers: { host: `127.0.0.1:${srv.port}` } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes("Aetheris"), "the UI is really served, not an error page");

    // 3. DNS-rebinding defence: a request that claims a public Host header is refused.
    //    This cannot be checked with fetch — undici treats `Host` as a forbidden header name and
    //    silently drops it — so the request is written to the socket by hand.
    assert.equal(await rawStatus(srv.port, `127.0.0.1:${srv.port}`), 200, "the loopback Host is accepted");
    assert.equal(await rawStatus(srv.port, "aetheris.evil.example"), 403, "a forged public Host header must be rejected");

    // 4. The embedded build metadata records what shipped.
    if (fs.existsSync(BUILD_INFO)) {
      const info = JSON.parse(fs.readFileSync(BUILD_INFO, "utf8")) as { version: string; node: string };
      assert.ok(/^\d{4}\.\d{1,2}\.\d{1,3}$/.test(info.version), `build metadata version ${info.version}`);
    }

    assert.ok(logs.some((l) => l.includes("embedded server ready")), logs.slice(-3).join("|"));

    // 5. Restart on the same preferred port → the same origin, so the session cookie survives.
    const firstPort = srv.port;
    await srv.stop();
    assert.equal(srv.state, "stopped");
    srv = null;
    const again = await startLocalServer({
      serverDir: SERVER_DIR,
      execPath: process.execPath,
      dataDir,
      preferredPort: firstPort,
      healthTimeoutMs: 120_000,
      onLog: (l) => logs.push(l),
    });
    try {
      assert.equal(again.port, firstPort, "the loopback origin is stable across launches");
      const health2 = await fetch(`${again.url}/api/health`).then((r) => r.json() as Promise<Record<string, unknown>>);
      assert.equal(health2.ok, true);
    } finally {
      await again.stop();
    }
    srv = null;
  } finally {
    if (srv) await srv.stop();
  }
});

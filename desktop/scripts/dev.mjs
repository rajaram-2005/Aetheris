#!/usr/bin/env node
/**
 * Desktop dev loop: `npm run desktop:dev`
 *
 * Starts `next dev` (port 3000, or $PORT), waits for `/api/health`, then opens Electron in
 * **remote** mode pointed at that dev server — so you get hot reload and the real desktop shell
 * (tray, IPC, update check, log) without rebuilding the standalone bundle every time.
 *
 * Set AETHERIS_DESKTOP_SKIP_WEB=1 to reuse an already-running dev server.
 */
import { spawn } from "node:child_process";
import path from "node:path";

const DESKTOP = path.resolve(new URL("..", import.meta.url).pathname);
const ROOT = path.resolve(DESKTOP, "..");
const PORT = Number(process.env.PORT ?? 3000);
const URL = process.env.AETHERIS_DESKTOP_SERVER ?? `http://127.0.0.1:${PORT}`;

const log = (msg) => console.log(`[desktop:dev] ${msg}`);

async function healthy(url, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url.replace(/\/+$/, "")}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

let web = null;
const shutdown = () => {
  if (web && !web.killed) web.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (process.env.AETHERIS_DESKTOP_SKIP_WEB !== "1") {
  log(`starting next dev on ${URL}`);
  web = spawn("npm", ["run", "dev"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
} else {
  log(`reusing an existing server at ${URL}`);
}

if (!(await healthy(URL))) {
  console.error(`[desktop:dev] ${URL}/api/health never answered — is the dev server running?`);
  shutdown();
}
log("server is healthy; compiling the desktop shell");

const compile = spawn("npm", ["run", "compile"], { cwd: DESKTOP, stdio: "inherit", shell: process.platform === "win32" });
await new Promise((resolve) => compile.on("close", resolve));

log(`launching Electron against ${URL}`);
const electron = spawn("npx", ["electron", "."], {
  cwd: DESKTOP,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    AETHERIS_DESKTOP_SERVER: URL,
    AETHERIS_DESKTOP_MODE: "remote",
    AETHERIS_DESKTOP_DEV: "1",
  },
});
electron.on("close", (code) => {
  log(`electron exited (${String(code)})`);
  shutdown();
});

#!/usr/bin/env node
/**
 * Full desktop build: `npm run desktop:build`
 *
 *   1. AETHERIS_STANDALONE=1 next build   → .next/standalone (the embeddable server)
 *   2. desktop/scripts/prepare-app.mjs    → desktop/resources/server
 *   3. electron-builder --dir             → desktop/release/{mac,linux,win}-unpacked (no installer)
 *
 * Step 3 produces an *unpacked* app, which is the fastest way to smoke-test a real build locally.
 * `npm run desktop:dist` goes all the way to signed installer artefacts (.dmg / .AppImage / .deb /
 * .rpm / .exe) — that needs the matching OS (macOS for .dmg) and lives in .github/workflows/release-desktop.yml.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath: `new URL(…).pathname` is `/C:/…` on Windows, which path.resolve mangles.
const TOOLS = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const ROOT = path.resolve(TOOLS, "..");
const DESKTOP = path.join(ROOT, "desktop");
const shell = process.platform === "win32";

function run(cmd, args, cwd, env) {
  console.log(`\n$ ${cmd} ${args.join(" ")}  (cwd ${cwd})`);
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env }, shell });
  if (res.status !== 0) {
    console.error(`[desktop:build] \`${cmd} ${args.join(" ")}\` failed with code ${String(res.status)}`);
    process.exit(res.status ?? 1);
  }
}

const npm = shell ? "npm.cmd" : "npm";
run(npm, ["run", "build"], ROOT, { AETHERIS_STANDALONE: "1", NEXT_TELEMETRY_DISABLED: "1" });
run(process.execPath, [path.join(DESKTOP, "scripts", "prepare-app.mjs")], ROOT, {});
run(npm, ["run", "compile"], DESKTOP, {});
run("npx", ["electron-builder", "--dir"], DESKTOP, {});
console.log("\n[desktop:build] done — unpacked app in desktop/release/");

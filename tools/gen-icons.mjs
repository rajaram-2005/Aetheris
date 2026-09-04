#!/usr/bin/env node
/**
 * Generate the desktop app icons from `public/icon.svg` (the same mark the web app uses).
 *
 *   npm run icons
 *
 * Writes:
 *   desktop/buildResources/icon.png        1024×1024 — the single source for every platform icon:
 *                                                    electron-builder derives the .icns (mac) and
 *                                                    .ico (win) from it and uses it directly on Linux
 *   desktop/buildResources/trayTemplate.png 18×18 black+alpha — the macOS menu-bar template image
 *   desktop/buildResources/tray.png         32×32 coloured — Windows/Linux tray
 *
 * Dev-only: `sharp` and `png-to-ico` are root devDependencies and are not used at runtime.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "desktop", "buildResources");
const SRC = path.join(ROOT, "public", "icon.svg");

const svg = fs.readFileSync(SRC);
fs.mkdirSync(OUT, { recursive: true });

// Dynamic import so the script fails with a clear message if the dev deps are missing.
const sharp = (await import("sharp")).default;

const base = sharp(svg, { density: 384 });
await base.resize(1024, 1024).png().toFile(path.join(OUT, "icon.png"));
await base.resize(32, 32).png().toFile(path.join(OUT, "tray.png"));

// macOS menu-bar icons must be black + alpha; the system tints them for light/dark mode.
const trayBuffer = await base.resize(18, 18).toBuffer();
const flat = await sharp(trayBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { data, info } = flat;
for (let i = 0; i < data.length; i += 4) {
  const luminance = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
  data[i] = 0;
  data[i + 1] = 0;
  data[i + 2] = 0;
  data[i + 3] = Math.round(data[i + 3] * (0.35 + 0.65 * luminance));
}
await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png()
  .toFile(path.join(OUT, "trayTemplate.png"));

// No .ico is committed: electron-builder derives one from buildResources/icon.png on Windows
// runners (and .icns from the same file on macOS), so the repo stays small.

for (const f of fs.readdirSync(OUT).sort()) {
  const size = fs.statSync(path.join(OUT, f)).size;
  console.log(`[icons] desktop/buildResources/${f} (${(size / 1024).toFixed(1)} kB)`);
}

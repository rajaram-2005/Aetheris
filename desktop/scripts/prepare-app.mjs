#!/usr/bin/env node
/**
 * Assemble `desktop/resources/server` — the embedded Aetheris server that ships inside the app.
 *
 * Input:  `<repo>/.next/standalone` (produced by `AETHERIS_STANDALONE=1 next build`),
 *         plus `.next/static` and `public/`, which Next's standalone output does not copy.
 * Output: `desktop/resources/server/{server.js,.next/**,node_modules/**,public/**,package.json}`
 *
 * Nothing is bundled or transpiled here: this is a copy, so the server that runs inside the app is
 * byte-identical to the one `npm start` would run.
 */
import fs from "node:fs";
import path from "node:path";

const DESKTOP = path.resolve(new URL("..", import.meta.url).pathname);
const ROOT = path.resolve(DESKTOP, "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");
const OUT = path.join(DESKTOP, "resources", "server");

/**
 * Never shipped inside the app. `data/` is the important one: the build can create it in the
 * project root (the JSON stores fall back to `process.cwd()/data`), and it may hold accounts and
 * telemetry from the machine that ran the build — a packaged app must start empty and write to the
 * user's own data dir.
 */
const SKIP = new Set(["data", "cache", "npm-debug.log", ".env", ".env.local"]);

/**
 * Nothing here may be pruned "because it is only a build dependency": Next.js `require`s
 * `typescript/lib/typescript/required-packages` at *runtime* to load `next.config.ts`, so the
 * TypeScript package must ship inside the app. Verified by tests/desktop.embedded.test.ts, which
 * boots this exact bundle.
 */

/**
 * `sharp` ships a prebuilt libvips per platform (~18 MB each). Keep only the one that matches the
 * machine doing the packaging — which is also the machine whose installers we are producing.
 */
function isForeignSharpPlatform(name) {
  const m = /^sharp-(libvips-)?(linux|darwin|win32)(musl)?-(x64|arm64|armv7|ia32)$/.exec(name);
  if (!m) return false;
  const [, , os, musl, arch] = m;
  const wantMusl = Boolean(musl);
  // glibc runtimes report a glibc version; musl does not report one at all.
  const report = typeof process.report?.getReport === "function" ? process.report.getReport() : undefined;
  const header = report?.header ?? {};
  const isMusl = process.platform === "linux" && !header?.glibcVersionRuntime;
  return os !== process.platform || arch !== process.arch || wantMusl !== isMusl;
}

/** Recursive copy that counts each file exactly once. */
function copyDir(from, to, stats, prune = false) {
  fs.mkdirSync(to, { recursive: true });
  const inNodeModules = prune || path.basename(from) === "node_modules";
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    // `@img/sharp-libvips-linuxmusl-x64` etc. live under a scope directory, so the platform check
    // has to look at the entry's own name once we are inside `node_modules/@img`.
    if (inNodeModules && isForeignSharpPlatform(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      // A scope directory (`@img`) is not itself a package: descend into it still pruning.
      const isScope = entry.name.startsWith("@") && !path.basename(path.dirname(from)).startsWith("@");
      copyDir(src, dst, stats, inNodeModules && (isScope || !entry.name.startsWith("@")));
      continue;
    }
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(src);
      try {
        fs.symlinkSync(target, dst);
        continue;
      } catch {
        /* fall through to a real copy when symlinks are not permitted */
      }
    }
    fs.copyFileSync(src, dst);
    stats.bytes += fs.statSync(src).size;
    stats.files += 1;
  }
}

function human(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function prepare() {
  if (!fs.existsSync(path.join(STANDALONE, "server.js"))) {
    console.error(
      [
        `[prepare-app] ${path.join(STANDALONE, "server.js")} is missing.`,
        "",
        "Build the server first (from the repository root):",
        "    AETHERIS_STANDALONE=1 npm run build",
        "",
        "or just run `npm run desktop:build`, which does the build for you.",
      ].join("\n"),
    );
    return 1;
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  const stats = { files: 0, bytes: 0 };
  copyDir(STANDALONE, OUT, stats);

  // Next does not copy these into standalone; the server needs both at runtime.
  const staticSrc = path.join(ROOT, ".next", "static");
  if (fs.existsSync(staticSrc)) copyDir(staticSrc, path.join(OUT, ".next", "static"), stats);
  const publicSrc = path.join(ROOT, "public");
  if (fs.existsSync(publicSrc)) copyDir(publicSrc, path.join(OUT, "public"), stats);

  // Record what we shipped so the app (and the release notes) can be honest about it.
  const version = JSON.parse(fs.readFileSync(path.join(DESKTOP, "package.json"), "utf8")).version;
  fs.writeFileSync(
    path.join(OUT, "aetheris-desktop-build.json"),
    `${JSON.stringify({ version, preparedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch }, null, 2)}\n`,
  );

  console.log(`[prepare-app] ${OUT} ← ${stats.files} files, ${human(stats.bytes)}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(prepare());
}

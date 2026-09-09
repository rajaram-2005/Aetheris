/**
 * Dependency health, and the CI gates that keep it.
 *
 * Both dependency trees were audited on 2026-09-09 and brought to zero advisories:
 *
 *   root    3 → 0    postcss 8.4.31 (high, pinned exactly by next@15.5.25) was overridden to ^8.5.28,
 *                    which also clears the moderate advisory against `next` itself, because that
 *                    advisory is only next's dependency on the vulnerable postcss. sharp went
 *                    0.33.5 → 0.35.4 (high). Neither change moved Next.js off 15.x.
 *   desktop 14 → 0   electron 33.4.11 → 44.3.0 and electron-builder 25 → 26.15.3. All 14 advisories
 *                    (one critical, in `tar`) lived in those two devDependency trees; `tar` had no
 *                    same-major fix at all, so the electron-builder major was the only route to it.
 *
 * Two upgrades were inspected and deliberately NOT taken:
 *
 *   next 15.5.x → 16.x   A framework major: React 19.2, Turbopack as the default bundler, and a
 *                        different caching model. The advisories against 15.5.x are entirely its
 *                        pinned postcss, which the override already resolves, so the major buys
 *                        nothing security-wise and risks every route in src/app. Revisit on its own.
 *   `npm audit fix --force`   Would have performed exactly the two majors above, unreviewed.
 *
 * This file is the ratchet. It fails if an override is dropped, if a tree drifts back onto a version
 * with known advisories, or if one of the CI gates that enforce the above is quietly removed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const json = <T,>(p: string) => JSON.parse(read(p)) as T;

/** The advisory-free floor for each tree. Bumping these numbers up is fine; down is a regression. */
const MIN_POSTCSS = "8.5.28";
const MIN_SHARP = "0.35.4";
const MIN_ELECTRON = "44.3.0";
const MIN_ELECTRON_BUILDER = "26.15.3";

/** Compare dotted versions numerically, ignoring any prerelease suffix. */
function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^[\^~>=<\s]*/, "").split("-")[0].split(".").map(Number);
  const pb = b.replace(/^[\^~>=<\s]*/, "").split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const rootPkg = json<{
  version: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  overrides?: Record<string, string>;
}>("package.json");
const desktopPkg = json<{ version: string; devDependencies: Record<string, string> }>("desktop/package.json");

test("dependencies: the postcss override is present and at or above the fixed release", () => {
  const override = rootPkg.overrides?.postcss;
  assert.ok(override, "root package.json must keep the postcss override — next@15 pins 8.4.31 exactly, which is vulnerable");
  assert.ok(cmpVersion(override, MIN_POSTCSS) >= 0, `postcss override ${override} is below the fixed ${MIN_POSTCSS}`);

  // The override only helps if the lockfile actually resolved it.
  const lock = json<{ packages: Record<string, { version?: string }> }>("package-lock.json");
  const resolved = lock.packages["node_modules/postcss"]?.version;
  assert.ok(resolved, "postcss is in the lockfile");
  assert.ok(cmpVersion(resolved, MIN_POSTCSS) >= 0, `the lockfile resolved postcss ${resolved}, below ${MIN_POSTCSS}`);
  assert.equal(rootPkg.dependencies.next.startsWith("^15."), true, "Next.js stays on 15.x — the 16.x major was inspected and deferred, see the header of this file");
});

test("dependencies: sharp is at or above the release that fixes the libvips/libheif advisories", () => {
  assert.ok(cmpVersion(rootPkg.devDependencies.sharp, MIN_SHARP) >= 0, `sharp ${rootPkg.devDependencies.sharp} is below ${MIN_SHARP}`);
  // sharp is only used by tools/gen-icons.mjs, which says so itself; nothing may import it at runtime.
  const tool = read("tools/gen-icons.mjs");
  assert.match(tool, /Dev-only/, "gen-icons.mjs still documents sharp as a dev-only dependency");
  const runtimeUsers = ["src", "next.config.ts"].flatMap((p) => {
    const full = path.join(ROOT, p);
    const files = fs.statSync(full).isDirectory()
      ? fs.readdirSync(full, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name)).map((e) => path.join(e.parentPath ?? e.path, e.name))
      : [full];
    return files.filter((f) => /from ["']sharp["']|require\(["']sharp["']\)/.test(fs.readFileSync(f, "utf8")));
  });
  assert.deepEqual(runtimeUsers, [], "sharp must not be imported from application code — Next.js would then need it in production");
});

test("dependencies: the desktop tree is off the Electron and electron-builder lines with advisories", () => {
  assert.ok(cmpVersion(desktopPkg.devDependencies.electron, MIN_ELECTRON) >= 0, `electron ${desktopPkg.devDependencies.electron} is below ${MIN_ELECTRON}`);
  assert.ok(
    cmpVersion(desktopPkg.devDependencies["electron-builder"], MIN_ELECTRON_BUILDER) >= 0,
    `electron-builder ${desktopPkg.devDependencies["electron-builder"]} is below ${MIN_ELECTRON_BUILDER}`,
  );

  const lock = json<{ packages: Record<string, { version?: string }> }>("desktop/package-lock.json");
  const electron = lock.packages["node_modules/electron"]?.version;
  const builder = lock.packages["node_modules/electron-builder"]?.version;
  assert.ok(electron && cmpVersion(electron, MIN_ELECTRON) >= 0, `the lockfile resolved electron ${electron}`);
  assert.ok(builder && cmpVersion(builder, MIN_ELECTRON_BUILDER) >= 0, `the lockfile resolved electron-builder ${builder}`);
  // The critical advisory was `tar`, reachable only through the electron-builder tree.
  const tars = Object.entries(lock.packages).filter(([k]) => k.endsWith("node_modules/tar")).map(([, v]) => v.version ?? "");
  assert.ok(tars.length > 0, "tar is still in the desktop tree (node-gyp needs it)");
  for (const v of tars) assert.ok(cmpVersion(v, "7.5.21") >= 0, `tar ${v} is below 7.5.21, the first release clear of GHSA-r292-9mhp-454m`);
});

test("dependencies: the two versions are coherent everywhere the release tooling reads them", () => {
  // VERSION is the source of truth; tools/bump-version.mjs copies it. tests/desktop.test.ts already
  // asserts the copy, so this only checks the desktop app did not drift during the dependency work.
  assert.equal(read("VERSION").trim(), rootPkg.version, "root package.json matches VERSION");
  assert.equal(desktopPkg.version, rootPkg.version, "desktop package.json matches VERSION");
});

// --------------------------------------------------------------------------- the CI gates themselves

test("ci: the production build is mandatory and may not warn", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /npm run build/, "the build runs in CI");
  assert.match(ci, /set -o pipefail/, "the build step pipes into tee, so pipefail is what makes a failed build fail the job");
  assert.match(ci, /Compiled with warnings|Critical dependency/, "warnings are gated, not tolerated");
  assert.doesNotMatch(ci, /continue-on-error/, "no step may be allowed to fail");
  assert.doesNotMatch(ci, /ignoreTypescriptErrors|typescript:\s*\{\s*ignoreBuildErrors/, "type checking is never disabled");
});

test("ci: both dependency trees are audited on every push", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /npm audit --audit-level=high/, "the audit ratchet is in CI");
  assert.equal(ci.match(/npm audit --audit-level=high/g)?.length, 2, "both the web tree and the desktop tree are audited");
  assert.match(ci, /working-directory: desktop\s*\n\s*run: npm audit/, "one of the two audits runs against desktop/");
});

test("ci: the Electron major is validated by running the binary, not only by typechecking it", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /desktop-runtime/, "there is a job that runs the desktop app");
  assert.match(ci, /xvfb-run/, "under a real X server");
  assert.match(ci, /npm run smoke/, "running the smoke entry");
  assert.doesNotMatch(ci, /ELECTRON_SKIP_BINARY_DOWNLOAD[\s\S]{0,200}npm run smoke/, "the smoke job must install the real binary");

  // The compiled main process is executed by tests/desktop.main.test.ts, which skips itself when
  // desktop/dist is missing — so CI has to emit it, or that test never runs on main.
  assert.match(ci, /npm run compile/, "CI compiles the desktop app so the main-process test can execute it");

  const pkg = json<{ scripts: Record<string, string> }>("desktop/package.json");
  assert.equal(pkg.scripts.smoke, "npm run compile && electron dist/smoke.js", "the smoke script compiles then runs the smoke entry");
  assert.ok(fs.existsSync(path.join(ROOT, "desktop/src/smoke.ts")), "desktop/src/smoke.ts exists");
  // The smoke entry must exercise the shipped security configuration, not a relaxed one.
  const smoke = read("desktop/src/smoke.ts");
  for (const pref of ["contextIsolation: true", "nodeIntegration: false", "sandbox: true", "webSecurity: true"]) {
    assert.ok(smoke.includes(pref), `smoke.ts must keep ${pref} — it is only worth running if it matches production`);
  }
  assert.match(smoke, /preload\.js/, "smoke.ts loads the real preload");
  assert.match(smoke, /renderer isolation broken/, "smoke.ts asserts that Node is unreachable from the page");
});

test("next.config: the standalone bundle still traces the WASM core that wasmffmpeg.ts resolves from disk", () => {
  // wasmffmpeg.ts resolves @ffmpeg/core by walking node_modules rather than through the bundler, so the
  // dependency tracer cannot see it. This include is what puts it in the desktop app's standalone
  // output; dropping it would make frame sampling silently unavailable in the packaged app.
  const cfg = read("next.config.ts");
  assert.match(cfg, /outputFileTracingIncludes/, "the tracing include is still configured");
  assert.match(cfg, /@ffmpeg\/core\/dist\/umd/, "and it still covers the UMD core");
  assert.match(cfg, /AETHERIS_STANDALONE/, "gated on the standalone flag, so `next start` is unaffected");
});

/**
 * Production contracts that previously drifted:
 *   - Next 15 App Router searchParams is a required Promise (never Record, never optional)
 *   - wasmffmpeg must not use webpack-visible createRequire / require.resolve
 *   - Command palette API/route entries must exist on disk
 *   - Theme tokens --fg and --dim must be defined
 *   - App Router failure surfaces must exist
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { firstSearchParam } from "../src/lib/search-params";
import { wasmFfmpegAvailable, wasmFfmpegReason } from "../src/core/multimodal/wasmffmpeg";

const ROOT = path.join(__dirname, "..");

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

/** Drop block comments so we can forbid APIs without matching the prose that names them. */
function withoutBlockComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

test("firstSearchParam: string, array, empty, missing", () => {
  assert.equal(firstSearchParam("rvn_1"), "rvn_1");
  assert.equal(firstSearchParam(["rvn_1", "rvn_2"]), "rvn_1");
  assert.equal(firstSearchParam("  rvn_1  "), "rvn_1");
  assert.equal(firstSearchParam(""), undefined);
  assert.equal(firstSearchParam("   "), undefined);
  assert.equal(firstSearchParam([]), undefined);
  assert.equal(firstSearchParam(undefined), undefined);
  assert.equal(firstSearchParam(["", " rvn_2 "]), "rvn_2");
});

test("pages: searchParams is a required Next.js 15 Promise, never a Record union", () => {
  const pages = walk(path.join(ROOT, "src", "app")).filter((f) => f.endsWith(`${path.sep}page.tsx`));
  assert.ok(pages.length > 10, `expected many pages, got ${pages.length}`);
  const offenders: string[] = [];
  for (const file of pages) {
    const src = readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    if (!/\bsearchParams\b/.test(src)) continue;
    if (src.includes("useSearchParams")) continue;
    if (/searchParams\?:/.test(src)) offenders.push(`${rel}: optional searchParams`);
    if (/searchParams\s*:\s*Record</.test(src)) offenders.push(`${rel}: Record searchParams`);
    if (/searchParams\s*:\s*Promise<Record</.test(src)) offenders.push(`${rel}: Promise<Record> searchParams`);
    // Record vs Promise union — not `|` inside a typed object like `string | string[]`.
    if (/searchParams\s*[?:]?\s*:\s*Record<[^;]+>\s*\|/.test(src)) offenders.push(`${rel}: Record| union searchParams`);
    if (/searchParams\s*[?:]?\s*:\s*Promise<[^;]+>\s*\|\s*Record/.test(src)) offenders.push(`${rel}: Promise|Record union searchParams`);
    if (/export default async function/.test(src) && /searchParams/.test(src)) {
      if (!/searchParams:\s*Promise</.test(src)) offenders.push(`${rel}: searchParams is not Promise`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("wasmffmpeg: source does not use webpack-visible createRequire/resolve", () => {
  const raw = readFileSync(path.join(ROOT, "src/core/multimodal/wasmffmpeg.ts"), "utf8");
  const src = withoutBlockComments(raw);
  assert.doesNotMatch(src, /createRequire\s*\(/);
  assert.doesNotMatch(src, /require\.resolve\s*\(/);
  assert.doesNotMatch(src, /from\s+["']node:module["']/);
  assert.doesNotMatch(src, /from\s+["']module["']/);
  assert.match(src, /findCoreDir/);
  const nextConfig = readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
  assert.match(nextConfig, /serverExternalPackages:\s*\["@ffmpeg\/core"\]/);
});

test("wasmffmpeg: availability probe does not throw", () => {
  const ok = wasmFfmpegAvailable();
  assert.equal(typeof ok, "boolean");
  if (!ok) {
    const reason = wasmFfmpegReason();
    assert.equal(typeof reason, "string");
    assert.ok((reason ?? "").length > 0);
  }
});

test("command palette routes and APIs point at files that exist", () => {
  const src = readFileSync(path.join(ROOT, "src/components/CommandPalette.tsx"), "utf8");
  assert.doesNotMatch(src, /\/api\/mesh/);
  assert.doesNotMatch(src, /\/api\/capabilities\/\$\{/);
  assert.match(src, /\/api\/providers/);
  assert.match(src, /\/api\/capabilities\?id=/);

  const paths = [...src.matchAll(/path:\s*"(\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(paths.includes("/episodes"));
  assert.ok(paths.includes("/api/providers"));
  assert.ok(paths.includes("/api/v1/ravana/episodes"));

  const missing: string[] = [];
  for (const p of paths) {
    if (p.startsWith("/docs")) {
      const docsCatch = path.join(ROOT, "src/app/docs/[...slug]/page.tsx");
      const docsIndex = path.join(ROOT, "src/app/docs/page.tsx");
      if (!existsSync(docsCatch) && !existsSync(docsIndex)) missing.push(p);
      continue;
    }
    if (p.startsWith("/api/")) {
      const file = path.join(ROOT, "src/app", p, "route.ts");
      if (!existsSync(file)) missing.push(p);
      continue;
    }
    const page = path.join(ROOT, "src/app", p === "/" ? "page.tsx" : `${p.slice(1)}/page.tsx`);
    if (!existsSync(page)) missing.push(p);
  }
  assert.deepEqual(missing, []);
});

test("theme tokens --fg and --dim are defined on :root", () => {
  const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
  const root = css.slice(0, css.indexOf("}") + 1);
  assert.match(root, /--fg\s*:/);
  assert.match(root, /--dim\s*:/);
  assert.match(css, /prefers-reduced-motion/);
});

test("App Router error and not-found surfaces exist", () => {
  const errorSrc = readFileSync(path.join(ROOT, "src/app/error.tsx"), "utf8");
  const notFoundSrc = readFileSync(path.join(ROOT, "src/app/not-found.tsx"), "utf8");
  assert.match(errorSrc, /"use client"/);
  assert.match(errorSrc, /PHASE FAILED/);
  assert.match(errorSrc, /System state/);
  assert.doesNotMatch(errorSrc, /error\.stack/);
  assert.match(notFoundSrc, /This route does not exist/);
});

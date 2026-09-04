#!/usr/bin/env node
/**
 * Aetheris release tooling — CalVer, monthly cadence.
 *
 * `VERSION` at the repository root is the single source of truth. This script computes the next
 * version and then writes it into every place that shows a version to a human or to a package
 * manager (root + desktop package.json, the PWA manifest, the docs badge).
 *
 * Usage:
 *   node tools/bump-version.mjs              # next monthly release (YYYY.M.1, or a patch if the
 *                                            # current version is already from this month)
 *   node tools/bump-version.mjs --patch      # force a patch bump inside the current month
 *   node tools/bump-version.mjs --set 2027.3.1
 *   node tools/bump-version.mjs --dry-run    # print what would change, write nothing
 *
 * Run through tsx (`npm run version:bump`) so the CalVer implementation is imported straight from
 * `desktop/src/lib/calver.ts` — one implementation, used by the app and by the release process.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { formatCalVer, isCalVer, nextCalVer, parseCalVer } from "../desktop/src/lib/calver";

export const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

/** Every file that carries the version, with the pattern that finds it. `$1` is kept. */
export const VERSION_TARGETS = [
  { file: "VERSION", pattern: /^.*\n?/m, render: (v) => `${v}\n`, required: true },
  { file: "package.json", pattern: /("version":\s*")[^"]*(")/, render: (v) => `$1${v}$2` },
  { file: "desktop/package.json", pattern: /("version":\s*")[^"]*(")/, render: (v) => `$1${v}$2` },
  { file: "public/manifest.webmanifest", pattern: /("version":\s*")[^"]*(")/, render: (v) => `$1${v}$2` },
];

export function readVersion(root = ROOT) {
  const raw = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
  if (!isCalVer(raw)) throw new Error(`VERSION holds "${raw}", which is not a valid CalVer (expected YYYY.M.P)`);
  return raw;
}

/** Which target files exist and still contain their marker. Missing markers are reported, not guessed. */
export function resolveTargets(targets = VERSION_TARGETS, root = ROOT) {
  return targets.map((t) => {
    const abs = path.join(root, t.file);
    const exists = fs.existsSync(abs);
    const text = exists ? fs.readFileSync(abs, "utf8") : "";
    return { ...t, abs, exists, text, matches: exists && t.pattern.test(text) };
  });
}

/** Replace the version in one file's text. Returns null when the marker is absent. */
export function replaceVersion(text, pattern, render, version) {
  if (!pattern.test(text)) return null;
  return text.replace(pattern, render(version));
}

/**
 * Compute the next version.
 *   mode "monthly" — the ordinary "every 1 month" bump (new month → .1, same month → patch+1)
 *   mode "patch"   — always patch+1
 *   mode "set"     — use `explicit` verbatim (validated)
 */
export function computeNext(current, mode, explicit, now = new Date()) {
  if (mode === "set") {
    const v = explicit ? parseCalVer(explicit) : null;
    if (!v) throw new Error(`--set expects a CalVer like 2027.3.1 (got "${explicit ?? ""}")`);
    return formatCalVer(v);
  }
  if (mode === "patch") {
    const cur = parseCalVer(current);
    if (!cur) throw new Error(`current version "${current}" is not a valid CalVer`);
    return formatCalVer({ ...cur, patch: cur.patch + 1 });
  }
  return formatCalVer(nextCalVer(current, now));
}

/** Write `version` into every target. Idempotent: running it twice changes nothing the second time. */
export function syncVersion(version, opts = {}) {
  const root = opts.root ?? ROOT;
  const targets = resolveTargets(opts.targets ?? VERSION_TARGETS, root);
  const written = [];
  const missing = [];
  for (const t of targets) {
    if (!t.exists) {
      if (t.required) missing.push(t.file);
      continue;
    }
    const next = replaceVersion(t.text, t.pattern, t.render, version);
    if (next === null) {
      missing.push(`${t.file} (version marker not found)`);
      continue;
    }
    const changed = next !== t.text;
    if (changed && !opts.dryRun) fs.writeFileSync(t.abs, next);
    written.push({ file: t.file, changed });
  }
  return { version, written, missing };
}

/** The tag of the most recent release, or null in a repo without tags. */
export function lastTag(root = ROOT) {
  try {
    const out = execFileSync("git", ["describe", "--tags", "--abbrev=0"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function argFlag(args, name) {
  return args.includes(name);
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export function main(argv) {
  const args = argv.slice(2);
  const dryRun = argFlag(args, "--dry-run");
  const explicit = argValue(args, "--set");
  const mode = explicit ? "set" : argFlag(args, "--patch") ? "patch" : "monthly";

  const current = readVersion();
  const next = computeNext(current, mode, explicit);
  const report = syncVersion(next, { dryRun });

  const verb = dryRun ? "would write" : "wrote";
  console.log(`${dryRun ? "[dry-run] " : ""}version ${current} → ${next} (${mode})`);
  for (const w of report.written) console.log(`  ${verb} ${w.file}${w.changed ? "" : " (unchanged)"}`);
  for (const m of report.missing) console.warn(`  ! ${m}`);
  if (report.missing.length) return 1;
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}

#!/usr/bin/env node
/**
 * CHANGELOG generator for the monthly release cadence.
 *
 * Inserts a `## <version> — <date>` section directly under the header marker, listing every commit
 * since the previous tag. It never rewrites existing entries, and running it twice for the same
 * version replaces that version's section rather than duplicating it.
 *
 * Usage:
 *   node tools/changelog.mjs                 # entry for the version in VERSION
 *   node tools/changelog.mjs --version 2026.10.1 --date 2026-10-01
 *   node tools/changelog.mjs --dry-run       # print the entry, change nothing
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { isCalVer } from "../desktop/src/lib/calver";
import { lastTag, readVersion, ROOT } from "./bump-version.mjs";

export const HEADER = "<!-- CHANGELOG: new entries go directly below this line, newest first. -->";
export const CHANGELOG_FILE = "CHANGELOG.md";

export function headerIndex(doc) {
  return doc.indexOf(HEADER);
}

/** git log between the previous tag and HEAD, as `{ subject, body }` records. */
export function commitsSince(tag, root = ROOT) {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  let out;
  try {
    out = execFileSync("git", ["log", "--no-merges", "--pretty=format:%s%x1f%b%x1e", range], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  return out
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject = "", ...rest] = entry.split("\x1f");
      return { subject: subject.trim(), body: rest.join("\x1f").trim() };
    })
    .filter((c) => c.subject);
}

/** Group commits by their conventional-commit area (`area: subject` → `area`). */
export function groupCommits(commits) {
  const groups = new Map();
  for (const c of commits) {
    const m = /^([a-z0-9][a-z0-9/_-]{0,24}):\s*(.+)$/i.exec(c.subject);
    const key = m ? m[1].toLowerCase() : "other";
    const text = m ? m[2] : c.subject;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(text);
  }
  return groups;
}

export const SECTION_ORDER = ["desktop", "release", "ci", "feat", "fix", "perf", "docs", "test", "refactor", "chore", "other"];

/** Render one release section. Deterministic: same inputs → same text. */
export function buildEntry({ version, date, commits }) {
  if (!isCalVer(version)) throw new Error(`not a CalVer: ${version}`);
  const lines = [`## ${version} — ${date}`, ""];
  if (!commits.length) {
    lines.push(`Monthly release. No commit-level changes recorded since the previous tag — see the diff at`, `\`git diff v${version}\`.`, "");
    return lines.join("\n");
  }
  const groups = groupCommits(commits);
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a);
    const ib = SECTION_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  for (const key of keys) {
    lines.push(`### ${key}`, "");
    for (const subject of groups.get(key)) lines.push(`- ${subject}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Remove an existing section for the same version so re-runs replace instead of duplicate. */
export function removeSection(doc, version) {
  const start = doc.indexOf(`## ${version} — `);
  if (start === -1) return doc;
  const after = doc.slice(start);
  const next = after.search(/\n## (?!#)/);
  const end = next === -1 ? doc.length : start + next + 1;
  return `${doc.slice(0, start)}${doc.slice(end)}`.replace(/\n{3,}/g, "\n\n");
}

/** Insert `entry` right under the header marker. Throws if the marker is missing (fail loudly). */
export function insertEntry(doc, entry) {
  const at = headerIndex(doc);
  if (at === -1) throw new Error(`CHANGELOG.md is missing the marker line:\n${HEADER}`);
  const head = doc.slice(0, at + HEADER.length);
  const tail = doc.slice(at + HEADER.length).replace(/^\n+/, "");
  return `${head}\n\n${entry.replace(/\n+$/, "")}\n\n---\n\n${tail}`;
}

export function main(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const i = args.indexOf("--version");
  const version = i >= 0 ? args[i + 1] : readVersion();
  const j = args.indexOf("--date");
  const date = j >= 0 ? args[j + 1] : new Date().toISOString().slice(0, 10);
  if (!isCalVer(version)) {
    console.error(`not a CalVer: ${version}`);
    return 1;
  }
  const file = path.join(ROOT, CHANGELOG_FILE);
  const doc = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : `# Changelog\n\n${HEADER}\n`;
  const commits = commitsSince(lastTag());
  const entry = buildEntry({ version, date, commits });
  if (dryRun) {
    console.log(entry);
    console.log(`(${commits.length} commits since ${lastTag() ?? "the first commit"})`);
    return 0;
  }
  const next = insertEntry(removeSection(doc, version), entry);
  fs.writeFileSync(file, next);
  console.log(`CHANGELOG.md: ${version} — ${date} (${commits.length} commits)`);
  return 0;
}

// pathToFileURL(argv[1]): on Windows `file://${argv[1]}` never equals import.meta.url.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main(process.argv));
}

#!/usr/bin/env node
/**
 * Print the CHANGELOG section for one release — used as the GitHub Release body.
 *
 *   node tools/release-notes.mjs                 # section for the version in VERSION
 *   node tools/release-notes.mjs --version 2026.10.1
 *   node tools/release-notes.mjs --file out.md   # also write it to a file (for body_path)
 *
 * Exits 1 when the section is missing, so a release can never go out with an empty body.
 */
import fs from "node:fs";
import path from "node:path";

import { isCalVer } from "../desktop/src/lib/calver";
import { readVersion, ROOT } from "./bump-version.mjs";
import { CHANGELOG_FILE } from "./changelog.mjs";

/** The `## <version> — <date>` section, without the trailing `---` separator. Null if absent. */
export function extractSection(doc, version) {
  const marker = `## ${version} — `;
  const start = doc.indexOf(marker);
  if (start === -1) return null;
  const rest = doc.slice(start);
  const next = rest.search(/\n## (?!#)/);
  const body = next === -1 ? rest : rest.slice(0, next + 1);
  return body.replace(/\n---\s*$/g, "").replace(/\s+$/, "");
}

export function main(argv) {
  const args = argv.slice(2);
  const i = args.indexOf("--version");
  const version = i >= 0 ? args[i + 1] : readVersion();
  if (!isCalVer(version)) {
    console.error(`not a CalVer: ${version}`);
    return 1;
  }
  const file = path.join(ROOT, CHANGELOG_FILE);
  if (!fs.existsSync(file)) {
    console.error(`${CHANGELOG_FILE} does not exist`);
    return 1;
  }
  const section = extractSection(fs.readFileSync(file, "utf8"), version);
  if (!section) {
    console.error(`CHANGELOG.md has no "## ${version} — " section (run tools/changelog.mjs first)`);
    return 1;
  }
  const j = args.indexOf("--file");
  if (j >= 0) fs.writeFileSync(args[j + 1], `${section}\n`);
  process.stdout.write(`${section}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}

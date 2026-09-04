/**
 * Ambient declarations for the plain-JavaScript release tools in `tools/`.
 *
 * They are `.mjs` so `node` can run them directly in CI without a build step, and they are always
 * executed through `tsx` (which resolves the TypeScript they import). `allowJs` is off in the root
 * tsconfig, so TypeScript has no inferred types for them — these declarations give the test suite
 * just enough to be checked, and every function they declare is exercised by `tests/desktop.test.ts`.
 */
declare module "*/tools/bump-version.mjs" {
  export type VersionTarget = { file: string; pattern: RegExp; render: (v: string) => string; required?: boolean };
  export const ROOT: string;
  export const VERSION_TARGETS: VersionTarget[];
  export function readVersion(root?: string): string;
  export function resolveTargets(targets?: VersionTarget[], root?: string): (VersionTarget & { abs: string; exists: boolean; text: string; matches: boolean })[];
  export function replaceVersion(text: string, pattern: RegExp, render: (v: string) => string, version: string): string | null;
  export function computeNext(current: string, mode: "monthly" | "patch" | "set", explicit?: string, now?: Date): string;
  export function syncVersion(version: string, opts?: { root?: string; targets?: VersionTarget[]; dryRun?: boolean }): { version: string; written: { file: string; changed: boolean }[]; missing: string[] };
  export function lastTag(root?: string): string | null;
  export function main(argv: string[]): number;
}

declare module "*/tools/changelog.mjs" {
  export const HEADER: string;
  export const CHANGELOG_FILE: string;
  export function headerIndex(doc: string): number;
  export function commitsSince(tag: string | null, root?: string): { subject: string; body: string }[];
  export function groupCommits(commits: { subject: string; body: string }[]): Map<string, string[]>;
  export const SECTION_ORDER: string[];
  export function buildEntry(opts: { version: string; date: string; commits: { subject: string; body: string }[] }): string;
  export function removeSection(doc: string, version: string): string;
  export function insertEntry(doc: string, entry: string): string;
  export function main(argv: string[]): number;
}

declare module "*/tools/release-notes.mjs" {
  export function extractSection(doc: string, version: string): string | null;
  export function main(argv: string[]): number;
}

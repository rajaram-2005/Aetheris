/**
 * CalVer for Aetheris — the project ships a new version **every month**.
 *
 * Scheme: `YYYY.M.P`
 *   YYYY  release year
 *   M     release month, 1-12, **not** zero padded (npm/semver treat `2026.09.1` as the
 *         invalid leading-zero form `2026.9.1`, and electron-builder rejects it)
 *   P     patch inside the month, starts at 1
 *
 * So the monthly cadence is: 2026.9.1 → 2026.10.1 → 2026.11.1 → 2026.12.1 → 2027.1.1
 * Hot-fixes inside a month bump the patch: 2026.9.1 → 2026.9.2.
 *
 * These functions are pure (no clock, no fs) so they are fully covered by `tests/desktop.test.ts`.
 */

export type CalVer = { year: number; month: number; patch: number };

export const CALVER_RE = /^(\d{4})\.(\d{1,2})\.(\d{1,3})$/;

/** Parse `2026.9.1` → { year: 2026, month: 9, patch: 1 }. Returns null for anything else. */
export function parseCalVer(input: string): CalVer | null {
  const m = CALVER_RE.exec(input.trim());
  if (!m) return null;
  const [, year, month, patch] = m;
  const v: CalVer = { year: Number(year), month: Number(month), patch: Number(patch) };
  if (v.month < 1 || v.month > 12 || v.patch < 1) return null;
  if (String(v.month) !== month || String(v.patch) !== patch) return null; // reject 2026.09.1 / 2026.9.01
  return v;
}

export function formatCalVer(v: CalVer): string {
  return `${v.year}.${v.month}.${v.patch}`;
}

/** Is this string a valid CalVer for this project? */
export function isCalVer(input: string): boolean {
  return parseCalVer(input) !== null;
}

/** The CalVer that a release made at `now` would start at: first build of that month. */
export function calVerForDate(now: Date): CalVer {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, patch: 1 };
}

/**
 * The next release for a monthly cadence.
 *
 * - No previous version (or an unparseable one) → the first release of `now`'s month.
 * - Previous release was in an **earlier month** → `YYYY.M.1` of the current month
 *   (this is the ordinary "every 1 month" bump; it rolls the year over in January).
 * - Previous release was **this month** → the next patch, `YYYY.M.P+1` (hot-fix).
 * - Previous release is dated in the **future** (clock skew / restored tag) → keep that
 *   month and bump its patch, so versions never go backwards.
 */
export function nextCalVer(previous: string | null | undefined, now: Date): CalVer {
  const prev = previous ? parseCalVer(previous) : null;
  const cur = calVerForDate(now);
  if (!prev) return cur;
  const prevRank = prev.year * 12 + prev.month;
  const curRank = cur.year * 12 + cur.month;
  if (prevRank < curRank) return cur;
  return { year: prev.year, month: prev.month, patch: prev.patch + 1 };
}

/** -1 if a<b, 0 if equal, 1 if a>b. Throws on invalid input — callers validate first. */
export function compareCalVer(a: string, b: string): number {
  const va = parseCalVer(a);
  const vb = parseCalVer(b);
  if (!va) throw new Error(`invalid calver: ${a}`);
  if (!vb) throw new Error(`invalid calver: ${b}`);
  if (va.year !== vb.year) return va.year < vb.year ? -1 : 1;
  if (va.month !== vb.month) return va.month < vb.month ? -1 : 1;
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;
  return 0;
}

/** Is `candidate` strictly newer than `current`? Invalid input is never newer (fails safe). */
export function isNewerThan(candidate: string, current: string): boolean {
  if (!isCalVer(candidate) || !isCalVer(current)) return false;
  return compareCalVer(candidate, current) > 0;
}

/** `v2026.9.1`, `2026.9.1` and ` release-2026.9.1 ` all normalise to `2026.9.1`. */
export function normalizeTag(tag: string): string | null {
  const m = /(\d{4}\.\d{1,2}\.\d{1,3})/.exec(tag);
  if (!m) return null;
  const parsed = parseCalVer(m[1]);
  return parsed ? formatCalVer(parsed) : null;
}

/** Release date line for CHANGELOG entries, e.g. `2026-09-04`. */
export function releaseDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

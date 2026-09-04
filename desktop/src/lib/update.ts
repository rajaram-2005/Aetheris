/**
 * Update checking for the desktop app.
 *
 * Aetheris releases on a monthly CalVer cadence (`2026.9.1`, `2026.10.1`, …). The app asks GitHub
 * for the latest release of `rajaram-2005/Aetheris`, normalises the tag to CalVer and compares.
 * There is **no** silent auto-install: the user is told a new version exists and given a download
 * link for their platform. (Self-hosted instances can point `AETHERIS_UPDATE_FEED` at any URL that
 * returns the same `{ tag_name, name, body, assets }` shape, or disable checks entirely.)
 *
 * `fetch` is injected so the whole flow is covered by tests without egress.
 */
import { isNewerThan, normalizeTag, parseCalVer } from "./calver";

export const DEFAULT_REPO = { owner: "rajaram-2005", repo: "Aetheris" } as const;
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${DEFAULT_REPO.owner}/${DEFAULT_REPO.repo}/releases/latest`;

export type UpdateAsset = { name: string; url: string; size: number };

export type ReleaseInfo = {
  tag: string;
  version: string | null;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string | null;
  prerelease: boolean;
  assets: UpdateAsset[];
};

export type UpdateStatus =
  | { state: "up_to_date"; current: string; latest?: string }
  | { state: "update_available"; current: string; latest: string; release: ReleaseInfo; asset: UpdateAsset | null }
  | { state: "unavailable"; current: string; reason: string };

export type UpdateCheckResult = UpdateStatus;

type GitHubRelease = {
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  html_url?: string;
  published_at?: string | null;
  prerelease?: boolean;
  assets?: { name?: string; browser_download_url?: string; size?: number }[];
};

/** Parse the GitHub "latest release" payload. Returns null when the shape is wrong. */
export function parseRelease(raw: unknown): ReleaseInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as GitHubRelease;
  if (typeof r.tag_name !== "string" || !r.tag_name) return null;
  const assets: UpdateAsset[] = Array.isArray(r.assets)
    ? r.assets
        .filter((a): a is { name: string; browser_download_url: string; size?: number } => typeof a?.name === "string" && typeof a?.browser_download_url === "string")
        .map((a) => ({ name: a.name, url: a.browser_download_url, size: typeof a.size === "number" ? a.size : 0 }))
    : [];
  return {
    tag: r.tag_name,
    version: normalizeTag(r.tag_name),
    name: r.name ?? r.tag_name,
    body: r.body ?? "",
    htmlUrl: r.html_url ?? `https://github.com/${DEFAULT_REPO.owner}/${DEFAULT_REPO.repo}/releases`,
    publishedAt: r.published_at ?? null,
    prerelease: r.prerelease === true,
    assets,
  };
}

export type Platform = "darwin" | "linux" | "win32";

/** Pick the installer for this OS/arch out of a release's assets. */
export function pickAsset(assets: UpdateAsset[], platform: Platform, arch: string): UpdateAsset | null {
  if (!assets.length) return null;
  const a = arch.startsWith("arm") ? "arm64" : arch === "ia32" ? "x86" : "x64";
  const matches = (name: string, pats: string[]) => pats.some((p) => name.toLowerCase().includes(p));
  const archOk = (name: string) => matches(name, [a, a === "x64" ? "x86_64" : a === "arm64" ? "aarch64" : a]) || (!matches(name, ["arm64", "aarch64", "x86_64", "x64", "ia32", "x86"]) && a === "x64");
  const byPlatform: Record<Platform, string[][]> = {
    darwin: [["dmg"], ["zip", "mac"]],
    linux: [["appimage"], ["deb"], ["rpm"], ["tar.gz", "linux"]],
    win32: [["setup.exe", "nsis"], ["exe"], ["zip", "win"]],
  };
  for (const tier of byPlatform[platform]) {
    const hit = assets.find((x) => matches(x.name, tier) && archOk(x.name));
    if (hit) return hit;
  }
  return null;
}

/** Compare the running version with the newest release and choose the right download. */
export function evaluateRelease(currentVersion: string, raw: unknown, platform: Platform, arch: string): UpdateCheckResult {
  const release = parseRelease(raw);
  if (!release) return { state: "unavailable", current: currentVersion, reason: "the release feed did not return a recognisable payload" };
  const latest = release.version;
  if (!latest) {
    return { state: "unavailable", current: currentVersion, reason: `release tag "${release.tag}" is not a CalVer (expected YYYY.M.P)` };
  }
  if (!parseCalVer(currentVersion)) {
    return { state: "unavailable", current: currentVersion, reason: `running version "${currentVersion}" is not a CalVer; update manually from ${release.htmlUrl}` };
  }
  if (!isNewerThan(latest, currentVersion)) {
    return { state: "up_to_date", current: currentVersion, latest };
  }
  return {
    state: "update_available",
    current: currentVersion,
    latest,
    release,
    asset: pickAsset(release.assets, platform, arch),
  };
}

/** Network call. Never throws — a failed check is `unavailable`, never a crash. */
export async function checkForUpdates(opts: {
  currentVersion: string;
  platform: Platform;
  arch: string;
  feedUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<UpdateCheckResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = opts.feedUrl && opts.feedUrl.startsWith("http") ? opts.feedUrl : LATEST_RELEASE_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: "application/vnd.github+json", "user-agent": `aetheris-desktop/${opts.currentVersion}` },
    });
    if (res.status === 404) return { state: "unavailable", current: opts.currentVersion, reason: "no releases published yet" };
    if (!res.ok) return { state: "unavailable", current: opts.currentVersion, reason: `release feed returned HTTP ${res.status}` };
    return evaluateRelease(opts.currentVersion, await res.json(), opts.platform, opts.arch);
  } catch (e) {
    return { state: "unavailable", current: opts.currentVersion, reason: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Navigation policy for the desktop window.
 *
 * Links that belong to Aetheris navigate inside the window. Everything else — provider docs, a
 * GitHub issue, a link inside an AI answer — opens in the user's real browser, so the app can never
 * be talked into rendering an arbitrary site inside a shell that holds the user's session.
 *
 * The current URL has to be passed in on every call. Capturing it once at window-creation time is a
 * bug: the window starts on `about:blank` (origin `null`) and then loads the server, so a captured
 * origin would reject every in-app navigation. `tests/desktop.main.test.ts` covers both halves.
 */

export type NavigationContext = {
  /** What the window is showing right now (`webContents.getURL()`), `""` before the first load. */
  currentUrl: string;
  /** The Aetheris origin for this session: the embedded server's URL, or the remote server's. */
  allowedOrigin: string | null;
};

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function protocolOf(url: string): string | null {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}

/**
 * Is `url` the app's own boot shell (served from disk over file://)?
 *
 * Checked by protocol, not by origin: `new URL("file:///x").origin` is the string "null" for any
 * file URL, so an origin comparison would never match and the boot shell would be treated as a
 * foreign site.
 */
export function isBootShell(url: string): boolean {
  return protocolOf(url) === "file:";
}

export function isAllowedNavigation(target: string, ctx: NavigationContext): boolean {
  if (protocolOf(target) === null) return false; // not an absolute URL we understand → refuse
  if (isBootShell(target)) return true;
  const targetOrigin = originOf(target);
  if (ctx.allowedOrigin && targetOrigin === originOf(ctx.allowedOrigin)) return true;
  const currentOrigin = ctx.currentUrl ? originOf(ctx.currentUrl) : null;
  return currentOrigin !== null && currentOrigin !== "null" && targetOrigin === currentOrigin;
}

/** Only real web pages may leave the app; this stops `shell.openExternal("file:///…")` and friends. */
export function isExternallyOpenable(url: string): boolean {
  const o = originOf(url);
  return o === null ? false : url.startsWith("https:") || url.startsWith("http:");
}

/**
 * Normalise the path out of an `aetheris://` deep link.
 *
 * A link is attacker-controlled (any web page can trigger one), so the result is reduced to
 * something that can only be a path on the app's own origin: protocol-relative (`//evil.com`),
 * backslash, absolute-URL, control-character and over-long forms are all rejected, and the value is
 * decoded once so a `%2F%2Fevil.com` cannot slip through as a host.
 *
 * The supported form is `aetheris://open?path=/docs/chat`. The path-only form
 * (`aetheris://docs/chat`) is rejected: "docs" would be the host there, so honouring it would mean
 * guessing at what the caller meant.
 *
 * The query string is split by hand rather than with `new URL(...)`: `aetheris` is not a "special"
 * scheme, so WHATWG parsing puts everything after `aetheris:` into `pathname` (and percent-encodes
 * the slashes), which mangles `aetheris://open?path=/docs/chat`.
 */
export function deepLinkPath(raw: string): string | null {
  const m = /^aetheris:(\/\/[^/?#]*)?([^?#]*)(?:\?([^#]*))?/.exec(raw.trim());
  if (!m) return null;
  const query = m[3] ?? "";
  let candidate: string | null = null;
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    if (pair.slice(0, eq) !== "path") continue;
    try {
      candidate = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
    } catch {
      return null; // malformed percent-encoding
    }
    break;
  }
  if (candidate === null) {
    // Only the `?path=` form is accepted. `aetheris://docs/chat` is ambiguous — "docs" parses as
    // the host and "/chat" as the path — and silently navigating somewhere other than what the
    // caller wrote is worse than not navigating at all.
    return null;
  }
  if (!candidate || candidate.length > 500) return null;
  if (!candidate.startsWith("/")) return null; // "//evil.com" also starts with "/", hence the next check
  if (candidate.startsWith("//")) return null;
  if (candidate.includes("\\") || /[\u0000-\u001f\u007f]/.test(candidate)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return null; // "https:…" must never survive
  return candidate.replace(/\/+$/, "") || "/";
}

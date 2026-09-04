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

/**
 * Settings for the desktop app. Persisted as JSON in Electron's userData dir:
 *   macOS   ~/Library/Application Support/Aetheris/settings.json
 *   Linux   ~/.config/Aetheris/settings.json
 *   Windows %APPDATA%/Aetheris/settings.json
 *
 * The app is **hybrid**: `mode: "local"` runs the embedded Next.js server on loopback;
 * `mode: "remote"` is a thin client for any Aetheris server you trust.
 *
 * `sanitizeSettings` is the only way untrusted input (a corrupt file, an IPC payload) becomes
 * state — it drops unknown keys, rejects bad values and always returns a complete object.
 */

export type DesktopMode = "local" | "remote";

export type DesktopSettings = {
  mode: DesktopMode;
  /** Used when mode === "remote". Must be http(s) and must answer /api/health before it is saved. */
  serverUrl: string;
  /** Loopback port the embedded server prefers. Stable across launches so the cookie origin is stable. */
  preferredPort: number;
  /** Embedded-server data dir; defaults to <userData>/data (computed by the caller). */
  dataDir: string | null;
  bounds: { x: number | null; y: number | null; width: number; height: number };
  openDevTools: boolean;
  hardwareAcceleration: boolean;
  /** Minutes between background update checks; 0 disables them. */
  updateCheckIntervalMinutes: number;
};

export const DEFAULT_PORT = 17890;
export const MIN_PORT = 1024;
export const MAX_PORT = 65535;

export function defaultSettings(userDataDir: string): DesktopSettings {
  return {
    mode: "local",
    serverUrl: "",
    preferredPort: DEFAULT_PORT,
    dataDir: joinDir(userDataDir, "data"),
    bounds: { x: null, y: null, width: 1280, height: 840 },
    openDevTools: false,
    hardwareAcceleration: true,
    updateCheckIntervalMinutes: 60,
  };
}

function joinDir(base: string, child: string): string {
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return base.replace(/[\\/]+$/, "") + sep + child;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

/** Normalise a user-typed server URL: trim, strip trailing slash, require http/https. "" if invalid. */
export function normalizeServerUrl(input: unknown): string {
  if (typeof input !== "string") return "";
  const raw = input.trim();
  if (!raw) return "";
  let u: URL;
  try {
    u = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  if (!u.hostname) return "";
  const origin = `${u.protocol}//${u.host}`;
  return u.pathname && u.pathname !== "/" ? `${origin}${u.pathname.replace(/\/+$/, "")}` : origin;
}

/** Turn anything read from disk or IPC into a valid, complete settings object. */
export function sanitizeSettings(input: unknown, userDataDir: string): DesktopSettings {
  const base = defaultSettings(userDataDir);
  if (!input || typeof input !== "object") return base;
  const raw = input as Record<string, unknown>;

  const mode: DesktopMode = raw.mode === "remote" ? "remote" : "local";

  let port = typeof raw.preferredPort === "number" ? Math.trunc(raw.preferredPort) : base.preferredPort;
  if (!Number.isFinite(port) || port < MIN_PORT || port > MAX_PORT) port = base.preferredPort;

  const boundsRaw = (raw.bounds && typeof raw.bounds === "object" ? raw.bounds : {}) as Record<string, unknown>;
  const dim = (v: unknown, fallback: number, min: number) => {
    const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback;
    return Math.min(8192, Math.max(min, n));
  };
  const coord = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);

  const interval =
    typeof raw.updateCheckIntervalMinutes === "number" && Number.isFinite(raw.updateCheckIntervalMinutes)
      ? Math.min(1440, Math.max(0, Math.trunc(raw.updateCheckIntervalMinutes)))
      : base.updateCheckIntervalMinutes;

  return {
    mode,
    serverUrl: normalizeServerUrl(raw.serverUrl),
    preferredPort: port,
    dataDir: typeof raw.dataDir === "string" && raw.dataDir.trim() ? raw.dataDir.trim() : base.dataDir,
    bounds: {
      x: coord(boundsRaw.x),
      y: coord(boundsRaw.y),
      width: dim(boundsRaw.width, base.bounds.width, 480),
      height: dim(boundsRaw.height, base.bounds.height, 360),
    },
    openDevTools: raw.openDevTools === true,
    hardwareAcceleration: raw.hardwareAcceleration !== false,
    updateCheckIntervalMinutes: interval,
  };
}

/** What the Settings UI is allowed to change; everything else is main-process owned. */
export type SettingsPatch = Partial<Pick<DesktopSettings, "mode" | "serverUrl" | "preferredPort" | "dataDir" | "openDevTools" | "hardwareAcceleration" | "updateCheckIntervalMinutes">>;

export function applyPatch(current: DesktopSettings, patch: SettingsPatch, userDataDir: string): DesktopSettings {
  return sanitizeSettings({ ...current, ...patch }, userDataDir);
}

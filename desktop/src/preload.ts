/**
 * Preload — the only bridge between the untrusted renderer and the main process.
 *
 * `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`: the page gets exactly the
 * functions exposed here and nothing else. The same preload runs for the boot shell (file://) and
 * for the Aetheris app origin, so the app UI can render "running in the desktop app" affordances
 * via `window.aetherisDesktop`.
 */
import { contextBridge, ipcRenderer } from "electron";

export type DesktopApi = {
  /** App + embedded-server version info. */
  info(): Promise<{ appVersion: string; electron: string; chrome: string; node: string; platform: string; arch: string; mode: string; serverUrl: string | null }>;
  settings(): Promise<unknown>;
  setSettings(patch: Record<string, unknown>): Promise<unknown>;
  /** Re-run the current mode (restart the embedded server, or reload the remote URL). */
  restart(): Promise<void>;
  serverStatus(): Promise<{ state: string; url: string | null; port: number | null; error: string | null }>;
  /** Validate a candidate remote URL against its /api/health before saving it. */
  probe(url: string): Promise<{ ok: boolean; status?: number; error?: string; version?: string }>;
  checkForUpdates(): Promise<unknown>;
  openExternal(url: string): Promise<void>;
  logs(): Promise<{ path: string; lines: string[] }>;
  showItemInFolder(path: string): Promise<void>;
  openDataDir(): Promise<void>;
  onState(cb: (state: unknown) => void): () => void;
};

const api: DesktopApi = {
  info: () => ipcRenderer.invoke("aetheris:info"),
  settings: () => ipcRenderer.invoke("aetheris:settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("aetheris:settings:set", patch),
  restart: () => ipcRenderer.invoke("aetheris:restart"),
  serverStatus: () => ipcRenderer.invoke("aetheris:server:status"),
  probe: (url) => ipcRenderer.invoke("aetheris:server:probe", url),
  checkForUpdates: () => ipcRenderer.invoke("aetheris:updates:check"),
  openExternal: (url) => ipcRenderer.invoke("aetheris:open-external", url),
  logs: () => ipcRenderer.invoke("aetheris:logs"),
  showItemInFolder: (p) => ipcRenderer.invoke("aetheris:reveal", p),
  openDataDir: () => ipcRenderer.invoke("aetheris:open-data-dir"),
  onState: (cb) => {
    const listener = (_e: unknown, state: unknown) => cb(state);
    ipcRenderer.on("aetheris:state", listener);
    return () => ipcRenderer.removeListener("aetheris:state", listener);
  },
};

contextBridge.exposeInMainWorld("aetherisDesktop", api);

/** Version marker for the app UI; injected only for loopback/remote Aetheris origins by main. */
contextBridge.exposeInMainWorld("aetherisDesktopVersion", process.env.AETHERIS_DESKTOP_VERSION ?? "dev");

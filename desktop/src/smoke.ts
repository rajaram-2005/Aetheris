/**
 * Desktop smoke test — run the real Electron binary, with the real preload, and prove the security
 * guarantees the app depends on still hold.
 *
 * Why this exists
 * ---------------
 * `npm run typecheck` and `npm run compile` validate the Electron shell against the *type* surface of a
 * major version. They cannot tell you whether the binary actually boots, whether a sandboxed preload
 * still runs, whether `contextBridge` still exposes exactly what it should, or whether renderer
 * isolation still holds. Those are runtime properties, and they are the ones that change between
 * Electron majors — which is why upgrading Electron on the strength of a typecheck alone is a blind
 * upgrade. This file turns it into a gated one: CI runs it on every push under `xvfb-run`, so an
 * Electron bump that breaks the shell, the bridge or the sandbox fails the build instead of a release.
 *
 * What it asserts, in the renderer, with production `webPreferences`:
 *   1. Electron boots and a BrowserWindow can be created.
 *   2. The real `preload.js` runs under `sandbox: true` and `contextBridge` exposes
 *      `window.aetherisDesktop` with its full documented surface.
 *   3. An `ipcRenderer.invoke` round-trip works (`aetheris:info` → main → back), and the reported
 *      Electron version is the one this binary was built from.
 *   4. Isolation still holds: the renderer has no `require`, no `process`, no `Buffer`, no `global`,
 *      and nothing from Node's builtins. A regression here is a privilege escalation, not a bug.
 *
 * Exit code 0 on success, 1 with the failed assertions printed on failure.
 */
import { app, BrowserWindow, ipcMain } from "electron";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** Every function the preload promises the renderer. Keep in sync with preload.ts's DesktopApi. */
const EXPECTED_API = [
  "info", "settings", "setSettings", "restart", "serverStatus", "probe",
  "checkForUpdates", "openExternal", "logs", "showItemInFolder", "openDataDir", "onState",
];

/** The renderer-side checks. Runs in the page, so it sees exactly what untrusted content would see. */
const RENDERER_PROBE = `(() => {
  const out = { failures: [], api: [], info: null, leaks: {} };
  const api = window.aetherisDesktop;
  if (!api) { out.failures.push("window.aetherisDesktop is not exposed — the preload did not run"); return out; }
  out.api = Object.keys(api).sort();
  // Node must not be reachable from the page: contextIsolation + sandbox + nodeIntegration:false.
  out.leaks.require = typeof window.require !== "undefined" || typeof require !== "undefined";
  out.leaks.process = typeof window.process !== "undefined" || typeof process !== "undefined";
  out.leaks.Buffer = typeof window.Buffer !== "undefined" || typeof Buffer !== "undefined";
  out.leaks.global = typeof window.global !== "undefined";
  out.leaks.module = typeof window.module !== "undefined" || typeof module !== "undefined";
  out.leaks.electronInternals = typeof window.electron !== "undefined";
  return out;
})()`;

async function main(): Promise<number> {
  const failures: string[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-smoke-"));
  const page = path.join(dir, "index.html");
  fs.writeFileSync(page, "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><p>aetheris desktop smoke</p></body></html>");

  // The same channel the real shell serves, so the IPC round-trip is the production one.
  ipcMain.handle("aetheris:info", () => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node ?? "",
    platform: process.platform,
    arch: process.arch,
    mode: "smoke",
    serverUrl: null,
  }));

  await app.whenReady();

  const win = new BrowserWindow({
    show: false,
    // Identical to createWindow() in main.ts: this smoke test is only worth anything if it exercises
    // the configuration the shipped app actually uses.
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
    },
  });

  try {
    // (1) Electron boots, a sandboxed window can be created, and a page loads. `loadFile` rejects if
    //     the load fails, so resolving at all is the assertion.
    await win.loadFile(page);

    const probe = (await win.webContents.executeJavaScript(RENDERER_PROBE)) as {
      failures: string[];
      api: string[];
      leaks: Record<string, boolean>;
    };
    failures.push(...probe.failures);

    // (2) the bridge exposes the documented surface — no more, no less
    const missing = EXPECTED_API.filter((k) => !probe.api.includes(k));
    if (missing.length) failures.push(`preload API is missing: ${missing.join(", ")}`);
    const extra = probe.api.filter((k) => !EXPECTED_API.includes(k));
    if (extra.length) failures.push(`preload API exposes undocumented members: ${extra.join(", ")}`);

    // (3) a real invoke round-trip through the sandboxed preload
    const info = (await win.webContents.executeJavaScript("window.aetherisDesktop.info()")) as { electron?: string; mode?: string };
    if (!info || typeof info !== "object") failures.push("ipcRenderer.invoke('aetheris:info') returned nothing");
    else {
      if (info.electron !== process.versions.electron) {
        failures.push(`IPC reported electron ${String(info.electron)} but this binary is ${process.versions.electron}`);
      }
      if (info.mode !== "smoke") failures.push("the IPC handler that answered was not the one registered here");
    }

    // (4) renderer isolation
    for (const [name, leaked] of Object.entries(probe.leaks)) {
      if (leaked) failures.push(`renderer isolation broken: "${name}" is reachable from the page`);
    }
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    process.stdout.write(`AETHERIS DESKTOP SMOKE: FAIL (${failures.length})\n`);
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
    return 1;
  }
  process.stdout.write(
    `AETHERIS DESKTOP SMOKE: PASS — electron ${process.versions.electron}, chromium ${process.versions.chrome}, ` +
    `preload bridge ${EXPECTED_API.length} members, ipc round-trip ok, renderer isolated\n`,
  );
  return 0;
}

// A smoke test that hangs is a failed smoke test.
const watchdog = setTimeout(() => {
  process.stdout.write("AETHERIS DESKTOP SMOKE: FAIL — timed out after 60s\n");
  app.exit(1);
}, 60_000);
watchdog.unref?.();

main()
  .then((code) => app.exit(code))
  .catch((e: unknown) => {
    process.stdout.write(`AETHERIS DESKTOP SMOKE: FAIL — ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    app.exit(1);
  });

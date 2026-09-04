/**
 * Aetheris One — desktop main process.
 *
 * Two run modes (app menu → Connection settings…, or the tray):
 *
 *   local   the app starts the embedded Next.js server (the standalone build shipped in
 *           `resources/server`) as a child process on 127.0.0.1 and loads it in the window.
 *           Everything works offline; data lives in Electron's userData dir.
 *   remote  a thin client: the window loads an Aetheris server you chose (LAN box, your VPS,
 *           a colleague's instance). Nothing is started locally.
 *
 * All decision logic lives in `src/lib/*` and is unit-tested by `tests/desktop.test.ts`; this file
 * is deliberately thin glue over Electron.
 */
import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell, type MenuItemConstructorOptions } from "electron";
import * as fs from "fs";
import * as path from "path";

import { createLogger, fileSink, formatLine, logFileName, type Logger } from "./lib/logging";
import { isServerDirReady, probeHealth, serverNotBuiltMessage, startLocalServer, type LocalServer } from "./lib/local-server";
import { applyPatch, defaultSettings, normalizeServerUrl, sanitizeSettings, type DesktopSettings, type SettingsPatch } from "./lib/settings";
import { deepLinkPath, isAllowedNavigation, isExternallyOpenable } from "./lib/navigation";
import { checkForUpdates, type UpdateCheckResult } from "./lib/update";

const APP_NAME = "Aetheris";
const PROTOCOL = "aetheris";
const isDev = !app.isPackaged;
const APP_VERSION: string = (() => {
  try {
    return (JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/** Directory holding the embedded server: `resources/server` next to the app in prod, `desktop/resources/server` in dev. */
function serverDir(): string {
  if (isDev) return path.join(__dirname, "..", "resources", "server");
  return path.join(process.resourcesPath, "server");
}

let log: Logger = createLogger({ maxEntries: 500, echoToConsole: true });
let settings: DesktopSettings = defaultSettings(app.getPath("userData"));
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: LocalServer | null = null;
let booting = false;
let updateTimer: NodeJS.Timeout | null = null;
let lastUpdate: UpdateCheckResult | null = null;
let deepLinkPath_: string | null = null;

type ViewState =
  | { view: "booting"; mode: DesktopSettings["mode"] }
  | { view: "ready"; mode: DesktopSettings["mode"]; url: string }
  | { view: "error"; mode: DesktopSettings["mode"]; error: string; hint?: string }
  | { view: "connect" };
let state: ViewState = { view: "booting", mode: "local" };

// --------------------------------------------------------------------------- paths & settings

function loadSettings() {
  const file = path.join(app.getPath("userData"), "settings.json");
  let raw: unknown = null;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    raw = null;
  }
  settings = sanitizeSettings(raw, app.getPath("userData"));
  // Dev/automation overrides (see desktop/scripts/dev.mjs); they are never persisted.
  const envMode = process.env.AETHERIS_DESKTOP_MODE;
  const envServer = normalizeServerUrl(process.env.AETHERIS_DESKTOP_SERVER ?? "");
  if (envMode === "remote" || envMode === "local") settings.mode = envMode;
  if (envServer) settings.serverUrl = envServer;
  if (process.env.AETHERIS_DESKTOP_DEV === "1") settings.openDevTools = true;
}

function saveSettings() {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(path.join(app.getPath("userData"), "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
  } catch (e) {
    log.error(`could not save settings: ${(e as Error).message}`);
  }
}

function dataDir(): string {
  return settings.dataDir ?? path.join(app.getPath("userData"), "data");
}

function initLogger() {
  const dir = path.join(app.getPath("userData"), "logs");
  log = createLogger({
    maxEntries: 1000,
    echoToConsole: true,
    sink: fileSink(path.join(dir, logFileName(new Date().toISOString())), fs, dir),
  });
}

// --------------------------------------------------------------------------- window

function createWindow() {
  const { bounds } = settings;
  win = new BrowserWindow({
    title: `${APP_NAME} One`,
    width: bounds.width,
    height: bounds.height,
    x: bounds.x ?? undefined,
    y: bounds.y ?? undefined,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: "#0b0d12",
    show: false,
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
    },
  });

  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
  });
  const persistBounds = () => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    settings.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
    saveSettings();
  };
  win.on("close", persistBounds);
  win.on("resized", persistBounds);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternallyOpenable(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    // The current URL is read here, on every navigation — see lib/navigation.ts.
    if (!isAllowedNavigation(url, { currentUrl: win?.webContents.getURL() ?? "", allowedOrigin: allowedOrigin() })) {
      event.preventDefault();
      if (isExternallyOpenable(url)) void shell.openExternal(url);
    }
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted */) return;
    log.error(`page failed to load: ${url} (${code} ${desc})`);
    setState({ view: "error", mode: settings.mode, error: `The page did not load: ${desc} (${code})`, hint: settings.mode === "remote" ? "Check the address on the connection screen (app menu → Connection settings…)." : undefined });
  });

  if (settings.openDevTools) win.webContents.openDevTools({ mode: "detach" });
  showBoot();
}

function allowedOrigin(): string | null {
  if (server) return server.url;
  if (settings.mode === "remote" && settings.serverUrl) return normalizeServerUrl(settings.serverUrl);
  return null;
}

// --------------------------------------------------------------------------- boot flow

function showBoot() {
  if (!win || win.isDestroyed()) return;
  void win.loadFile(path.join(__dirname, "..", "src", "renderer", "boot.html"));
}

function setState(next: ViewState) {
  state = next;
  if (win && !win.isDestroyed()) win.webContents.send("aetheris:state", publicState());
}

function publicState() {
  return {
    view: state.view,
    mode: settings.mode,
    appVersion: APP_VERSION,
    serverUrl: server?.url ?? (settings.mode === "remote" ? settings.serverUrl || null : null),
    error: state.view === "error" ? state.error : null,
    hint: state.view === "error" ? state.hint ?? null : null,
    serverReady: isServerDirReady(serverDir()),
    update: lastUpdate,
    platform: process.platform,
    arch: process.arch,
  };
}

async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  log.info("stopping the embedded server");
  try {
    await s.stop();
  } catch (e) {
    log.warn(`embedded server stop failed: ${(e as Error).message}`);
  }
}

/** The one place that decides what the window shows. */
async function boot() {
  if (booting) return;
  booting = true;
  setState({ view: "booting", mode: settings.mode });
  showBoot();
  try {
    if (settings.mode === "remote") {
      const url = normalizeServerUrl(settings.serverUrl);
      if (!url) {
        setState({ view: "connect" });
        return;
      }
      log.info(`connecting to remote Aetheris at ${url}`);
      const health = await probeHealth(url, fetch, 6000);
      if (!health.ok) {
        setState({
          view: "error",
          mode: "remote",
          error: `Could not reach ${url}${health.status ? ` (HTTP ${health.status})` : ""}${health.error ? ` — ${health.error}` : ""}`,
          hint: "Is the server running? Use app menu → Connection settings… to change the address.",
        });
        return;
      }
      if (!win || win.isDestroyed()) return;
      const target = deepLinkPath_ ? `${url.replace(/\/+$/, "")}${deepLinkPath_}` : url;
      deepLinkPath_ = null;
      await win.loadURL(target);
      setState({ view: "ready", mode: "remote", url });
      return;
    }

    await stopServer();
    if (!isServerDirReady(serverDir())) {
      setState({ view: "error", mode: "local", error: serverNotBuiltMessage(serverDir()) });
      return;
    }
    log.info(`starting the embedded server from ${serverDir()}`);
    server = await startLocalServer({
      serverDir: serverDir(),
      execPath: process.execPath,
      dataDir: dataDir(),
      preferredPort: settings.preferredPort,
      inheritedEnv: process.env,
      onLog: (line) => log.info(line),
    });
    if (!win || win.isDestroyed()) return;
    await win.loadURL(server.url);
    setState({ view: "ready", mode: "local", url: server.url });
    if (deepLinkPath_) {
      const p = deepLinkPath_;
      deepLinkPath_ = null;
      void win.loadURL(`${server.url}${p}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`boot failed: ${msg}`);
    setState({ view: "error", mode: settings.mode, error: msg });
  } finally {
    booting = false;
  }
}

// --------------------------------------------------------------------------- menu & tray

function buildMenu() {
  const isMac = process.platform === "darwin";
  // One app menu: `role: "appMenu"` already provides About/Services/Hide/Quit under the app name, so
  // adding a second menu with the same label would put two "Aetheris" menus in the bar on macOS.
  const appMenu: MenuItemConstructorOptions = {
    label: APP_NAME,
    submenu: [
      ...(isMac ? ([{ role: "about" }, { type: "separator" }] as MenuItemConstructorOptions[]) : []),
      { label: settings.mode === "local" ? "Restart embedded server" : "Reconnect to server", click: () => void boot() },
      { label: "Connection settings…", click: () => showConnectionScreen() },
      {
        label: settings.mode === "local" ? "Switch to a remote server…" : "Switch to the embedded server",
        click: () => {
          if (settings.mode === "local") {
            showConnectionScreen();
          } else {
            settings.mode = "local";
            saveSettings();
            void boot();
          }
        },
      },
      { type: "separator" },
      { label: "Check for updates…", click: () => void runUpdateCheck(true) },
      { label: "Open log", click: () => void openLog() },
      { label: "Open data folder", click: () => void shell.openPath(dataDir()) },
      ...(isMac ? ([{ type: "separator" }, { role: "quit" }] as MenuItemConstructorOptions[]) : []),
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [appMenu] : []),
    // Role submenus need an explicit label or they render as an empty menu title.
    ...(isMac ? [] : ([{ label: "File", submenu: [{ role: "quit" }] }] as MenuItemConstructorOptions[])),
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, ...(isMac ? ([{ type: "separator" }, { role: "front" }] as MenuItemConstructorOptions[]) : ([{ role: "close" }] as MenuItemConstructorOptions[]))] },
    ...(!isMac ? [appMenu] : []),
    {
      label: "Help",
      submenu: [
        { label: "Documentation", click: () => void shell.openExternal("https://github.com/rajaram-2005/Aetheris#readme") },
        { label: "Report an issue", click: () => void shell.openExternal("https://github.com/rajaram-2005/Aetheris/issues") },
        { label: `Version ${APP_VERSION}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function buildTray() {
  const iconPath = path.join(
    isDev ? path.join(__dirname, "..") : process.resourcesPath,
    "buildResources",
    process.platform === "darwin" ? "trayTemplate.png" : "icon.png",
  );
  if (!fs.existsSync(iconPath)) return; // tray is a nice-to-have; never block startup on it
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) return;
  if (process.platform === "darwin") image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip(`${APP_NAME} One ${APP_VERSION}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Show ${APP_NAME}`, click: () => showWindow() },
      { type: "separator" },
      {
        label: settings.mode === "local" ? "Restart embedded server" : "Reconnect",
        click: () => void boot(),
      },
      { label: "Connection settings…", click: () => showConnectionScreen() },
      { label: "Check for updates…", click: () => void runUpdateCheck(true) },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
  tray.on("click", () => showWindow());
}

/** Replace the window contents with the boot shell on its connection screen. */
function showConnectionScreen() {
  setState({ view: "connect" });
  showBoot();
}

function showWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    void boot();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// --------------------------------------------------------------------------- updates

type MessageBoxOptions = Parameters<typeof dialog.showMessageBox>[0];

/** `dialog.showMessageBox` is overloaded on the parent window; this picks the right overload. */
async function messageBox(options: MessageBoxOptions): Promise<number> {
  const parent = win && !win.isDestroyed() ? win : null;
  const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  return result.response;
}

async function runUpdateCheck(interactive: boolean): Promise<UpdateCheckResult> {
  lastUpdate = await checkForUpdates({
    currentVersion: APP_VERSION,
    platform: process.platform as "darwin" | "linux" | "win32",
    arch: process.arch,
    feedUrl: process.env.AETHERIS_UPDATE_FEED,
  });
  setState(state); // re-broadcast with the fresh `update` field
  if (interactive) {
    if (lastUpdate.state === "update_available") {
      const { latest, release, asset } = lastUpdate;
      const response = await messageBox({
        type: "info",
        title: `${APP_NAME} ${latest} is available`,
        message: `You are on ${APP_VERSION}. ${APP_NAME} ships a new version every month.`,
        detail: `${release.name}\n\n${(release.body || "").slice(0, 600)}`,
        buttons: [asset ? "Download" : "Open release page", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) await shell.openExternal(asset ? asset.url : release.htmlUrl);
    } else if (lastUpdate.state === "up_to_date") {
      await messageBox({
        type: "info",
        title: "Up to date",
        message: `${APP_NAME} ${APP_VERSION} is the latest release.`,
        detail: "A new version is published at the start of every month.",
        buttons: ["OK"],
      });
    } else {
      await messageBox({
        type: "warning",
        title: "Update check failed",
        message: "Could not check for updates.",
        detail: lastUpdate.reason,
        buttons: ["OK"],
      });
    }
  } else if (lastUpdate.state === "update_available") {
    log.info(`update available: ${APP_VERSION} → ${lastUpdate.latest}`);
  }
  return lastUpdate;
}

function scheduleUpdateChecks() {
  if (updateTimer) clearInterval(updateTimer);
  const minutes = settings.updateCheckIntervalMinutes;
  if (minutes <= 0) return;
  updateTimer = setInterval(() => void runUpdateCheck(false), minutes * 60_000);
  updateTimer.unref?.();
}

// --------------------------------------------------------------------------- ipc

function openLog() {
  const dir = path.join(app.getPath("userData"), "logs");
  const file = path.join(dir, logFileName(new Date().toISOString()));
  if (fs.existsSync(file)) void shell.openPath(file);
  else void shell.openPath(dir);
}

function registerIpc() {
  ipcMain.handle("aetheris:info", () => ({
    appVersion: APP_VERSION,
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node ?? "",
    platform: process.platform,
    arch: process.arch,
    mode: settings.mode,
    serverUrl: server?.url ?? (settings.mode === "remote" ? settings.serverUrl : null),
    dataDir: dataDir(),
    logDir: path.join(app.getPath("userData"), "logs"),
  }));

  ipcMain.handle("aetheris:settings:get", () => ({ ...settings, dataDir: dataDir() }));

  ipcMain.handle("aetheris:settings:set", async (_e, patch: SettingsPatch) => {
    const next = applyPatch(settings, patch ?? {}, app.getPath("userData"));
    const modeChanged = next.mode !== settings.mode;
    const portChanged = next.preferredPort !== settings.preferredPort;
    const urlChanged = next.serverUrl !== settings.serverUrl;
    settings = next;
    saveSettings();
    buildMenu();
    scheduleUpdateChecks();
    if (modeChanged || urlChanged) await boot();
    else if (portChanged && settings.mode === "local") await boot();
    return { ...settings, dataDir: dataDir() };
  });

  ipcMain.handle("aetheris:restart", async () => {
    await boot();
    return publicState();
  });

  ipcMain.handle("aetheris:server:status", () => ({
    state: server?.state ?? (settings.mode === "remote" ? "remote" : "stopped"),
    url: server?.url ?? (settings.mode === "remote" ? settings.serverUrl : null),
    port: server?.port ?? null,
    error: server?.lastError ?? null,
  }));

  ipcMain.handle("aetheris:server:probe", async (_e, url: unknown) => {
    const target = normalizeServerUrl(url);
    if (!target) return { ok: false, error: "Enter an http:// or https:// address" };
    const health = await probeHealth(target, fetch, 6000);
    const body = (health.body ?? {}) as { service?: string; version?: string };
    return { ok: health.ok, status: health.status, error: health.error, version: body.version, service: body.service };
  });

  ipcMain.handle("aetheris:updates:check", () => runUpdateCheck(false));
  ipcMain.handle("aetheris:logs", () => ({
    path: path.join(app.getPath("userData"), "logs", logFileName(new Date().toISOString())),
    lines: log.tail(200).map(formatLine),
  }));
  ipcMain.handle("aetheris:reveal", (_e, p: unknown) => {
    if (typeof p === "string" && p) shell.showItemInFolder(p);
  });
  ipcMain.handle("aetheris:open-data-dir", () => shell.openPath(dataDir()));
  ipcMain.handle("aetheris:open-external", (_e, url: unknown) => {
    if (typeof url === "string" && isExternallyOpenable(url)) void shell.openExternal(url);
  });
}

// --------------------------------------------------------------------------- lifecycle

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    showWindow();
    const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    if (link) handleDeepLink(link);
  });

  initLogger();
  loadSettings();
  if (!settings.hardwareAcceleration) app.disableHardwareAcceleration();
  if (process.platform !== "darwin") app.setAppUserModelId("io.aetheris.one");
  if (process.defaultApp) {
    if (process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.whenReady().then(() => {
    registerIpc();
    buildMenu();
    buildTray();
    createWindow();
    const link = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    if (link) handleDeepLink(link);
    void boot();
    scheduleUpdateChecks();
    setTimeout(() => void runUpdateCheck(false), 15_000).unref?.();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        void boot();
      } else {
        showWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (!server) return;
    event.preventDefault();
    const s = server;
    server = null;
    void s
      .stop()
      .catch((e) => log.warn(`stop on quit failed: ${(e as Error).message}`))
      .finally(() => app.exit(0));
  });
}

function handleDeepLink(raw: string) {
  const clean = deepLinkPath(raw);
  if (!clean) {
    log.warn(`ignored an unsafe deep link: ${redactForLog(raw)}`);
    return;
  }
  deepLinkPath_ = clean;
  if (state.view === "ready" && win && !win.isDestroyed()) {
    const base = server?.url ?? (settings.mode === "remote" ? normalizeServerUrl(settings.serverUrl) : null);
    if (base) {
      deepLinkPath_ = null;
      void win.loadURL(`${base.replace(/\/+$/, "")}${clean}`);
    }
  }
}

/** Deep links can carry anything; keep the log free of both secrets and control characters. */
function redactForLog(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);
}

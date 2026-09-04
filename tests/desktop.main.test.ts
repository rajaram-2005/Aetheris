/**
 * The desktop main process, executed.
 *
 * `desktop/dist/main.js` is the compiled Electron main process. It cannot run here (no Electron
 * binary, no display), but almost all of it is ordinary Node code that talks to the `electron`
 * module — so this test puts a recording stub of that module into the require cache and then
 * `require`s the real `main.js`. What runs is the shipped code path: the single-instance lock, the
 * BrowserWindow options, the IPC handlers, the remote-mode boot flow, the settings round-trip and
 * the menu/tray construction.
 *
 * It is skipped if `desktop/dist` has not been compiled (`cd desktop && npm run compile`), which
 * `npm run desktop:build` does anyway.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { isAllowedNavigation, isExternallyOpenable, originOf } from "../desktop/src/lib/navigation";
import { buildServerEnv, readEnvFile } from "../desktop/src/lib/local-server";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const MAIN = path.join(ROOT, "desktop", "dist", "main.js");
const PRELOAD = path.join(ROOT, "desktop", "dist", "preload.js");
// Resolve from desktop/dist so `electron` (a desktop-only devDependency) is found.
const require_ = createRequire(MAIN);

const skip = fs.existsSync(MAIN) ? false : "desktop/dist is not compiled — run `cd desktop && npm run compile`";

// --------------------------------------------------------------------------- navigation policy

test("navigation policy: in-app links stay, everything else leaves via the system browser", () => {
  const server = { currentUrl: "http://127.0.0.1:17890/docs", allowedOrigin: "http://127.0.0.1:17890" };
  assert.equal(isAllowedNavigation("http://127.0.0.1:17890/docs/chat", server), true);
  assert.equal(isAllowedNavigation("http://127.0.0.1:17890/", server), true);
  assert.equal(isAllowedNavigation("file:///app/desktop/src/renderer/boot.html", server), true, "the boot shell");
  assert.equal(isAllowedNavigation("https://docs.groq.com/x", server), false, "a provider doc opens externally");
  assert.equal(isAllowedNavigation("http://169.254.1.1/", server), false);
  assert.equal(isAllowedNavigation("not a url", server), false);

  // The bug this guards against: the window starts on about:blank and only later loads the server,
  // so an origin captured at creation time ("null") must not be what we compare against.
  const justCreated = { currentUrl: "about:blank", allowedOrigin: "http://127.0.0.1:17890" };
  assert.equal(isAllowedNavigation("http://127.0.0.1:17890/docs", justCreated), true, "the allowed origin carries it");
  const blank = { currentUrl: "", allowedOrigin: null };
  assert.equal(isAllowedNavigation("http://127.0.0.1:17890/", blank), false, "nothing is allowed before boot");
  assert.equal(originOf("nonsense"), null);

  assert.equal(isExternallyOpenable("https://example.com"), true);
  assert.equal(isExternallyOpenable("http://example.com"), true);
  assert.equal(isExternallyOpenable("file:///etc/passwd"), false, "file: must never be handed to the OS");
  assert.equal(isExternallyOpenable("javascript:alert(1)"), false);
  assert.equal(isExternallyOpenable("aetheris://open"), false);
});

// --------------------------------------------------------------------------- .env.local

test("embedded server: keys in <dataDir>/.env.local reach the child and cannot un-loopback it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-env-"));
  fs.writeFileSync(
    path.join(dir, ".env.local"),
    [
      "# my keys",
      "GROQ_API_KEY=gsk_plaintext",
      'OPENAI_API_KEY="sk-quoted"',
      "  SPACED_KEY = value  ",
      "OLLAMA_BASE_URL=http://127.0.0.1:11434",
      "",
      "not a line",
      "=novalue",
      "1BAD=no",
      'SINGLE=\'sq\'',
    ].join("\n"),
  );
  const parsed = readEnvFile(path.join(dir, ".env.local"));
  assert.equal(parsed.GROQ_API_KEY, "gsk_plaintext");
  assert.equal(parsed.OPENAI_API_KEY, "sk-quoted", "double quotes stripped");
  assert.equal(parsed.SINGLE, "sq", "single quotes stripped");
  assert.equal(parsed.SPACED_KEY, "value");
  assert.equal(parsed.OLLAMA_BASE_URL, "http://127.0.0.1:11434");
  assert.equal(parsed["1BAD"], undefined, "invalid identifier rejected");
  assert.equal(Object.keys(parsed).length, 5, `parsed ${JSON.stringify(parsed)}`);
  assert.deepEqual(readEnvFile(path.join(dir, "missing.env")), {}, "a missing file is not an error");

  const env = buildServerEnv({
    dataDir: dir,
    port: 17890,
    inheritedEnv: { NODE_ENV: "production", GROQ_API_KEY: "from-parent" },
    version: "2026.9.1",
    envFile: parsed,
  });
  assert.equal(env.GROQ_API_KEY, "gsk_plaintext", "the user's file wins over the inherited env");
  assert.equal(env.HOSTNAME, "127.0.0.1", "the file cannot rebind the server");
  assert.equal(env.AETHERIS_DESKTOP, "1");
  assert.equal(env.NODE_ENV, "production");

  // …and a hostile file cannot turn the loopback guard or the desktop flag off
  fs.writeFileSync(path.join(dir, ".env.local"), "HOSTNAME=0.0.0.0\nAETHERIS_DESKTOP=0\nNODE_ENV=development\nPORT=80\n");
  const hostile = buildServerEnv({ dataDir: dir, port: 17890, version: "2026.9.1", envFile: readEnvFile(path.join(dir, ".env.local")) });
  assert.equal(hostile.HOSTNAME, "127.0.0.1");
  assert.equal(hostile.AETHERIS_DESKTOP, "1");
  assert.equal(hostile.NODE_ENV, "production");
  assert.equal(hostile.PORT, "17890");
  fs.rmSync(dir, { recursive: true, force: true });
});

// --------------------------------------------------------------------------- main process

type Stub = ReturnType<typeof makeElectronStub>;

function makeElectronStub(userData: string) {
  const calls: Record<string, unknown[]> = {
    loadURL: [],
    loadFile: [],
    openExternal: [],
    showItemInFolder: [],
    openPath: [],
    preventDefault: [],
  };
  const ipcHandlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>();
  const env: Record<string, unknown> = {};

  class BrowserWindow {
    static instances: BrowserWindow[] = [];
    opts: Record<string, any>;
    webContents = {
      getURL: () => (calls.loadURL.at(-1) as string) ?? (calls.loadFile.at(-1) as string) ?? "",
      setWindowOpenHandler: (fn: (d: { url: string }) => unknown) => {
        env.windowOpenHandler = fn;
      },
      on: (ev: string, fn: (...a: unknown[]) => void) => {
        ((env[`wc:${ev}`] as ((...a: unknown[]) => void)[]) ??= []).push(fn);
      },
      send: (ch: string, payload: unknown) => {
        ((env.sent as unknown[]) ??= []).push({ ch, payload });
      },
      loadURL: async (u: string) => {
        calls.loadURL.push(u);
      },
      loadFile: async (f: string) => {
        calls.loadFile.push(f);
      },
      openDevTools: () => {},
    };
    constructor(opts: Record<string, any>) {
      this.opts = opts;
      BrowserWindow.instances.push(this);
    }
    // BrowserWindow proxies both loaders to its webContents (they are documented on both).
    loadURL(u: string) {
      return this.webContents.loadURL(u);
    }
    loadFile(f: string) {
      return this.webContents.loadFile(f);
    }
    once(ev: string, fn: () => void) {
      if (ev === "ready-to-show") fn();
    }
    on() {}
    show() {}
    focus() {}
    restore() {}
    close() {}
    isDestroyed() {
      return false;
    }
    isMinimized() {
      return false;
    }
    getBounds() {
      return { x: 1, y: 2, width: 1280, height: 840 };
    }
    static getAllWindows() {
      return BrowserWindow.instances;
    }
  }

  const app = {
    isPackaged: false,
    userData,
    getPath: (k: string) => (k === "userData" ? userData : os.tmpdir()),
    setName: () => {},
    setAppUserModelId: () => {},
    setAsDefaultProtocolClient: (...a: unknown[]) => {
      calls.protocol = a;
    },
    disableHardwareAcceleration: () => {
      env.hwAccelerated = false;
    },
    requestSingleInstanceLock: () => true,
    whenReady: async () => undefined,
    quit: () => {
      env.quit = true;
    },
    exit: () => {
      env.exit = true;
    },
    on: (ev: string, fn: (...a: unknown[]) => void) => {
      ((env[`app:${ev}`] as ((...a: unknown[]) => void)[]) ??= []).push(fn);
    },
  };

  const electron = {
    app,
    BrowserWindow,
    ipcMain: {
      handle: (ch: string, fn: (e: unknown, ...args: unknown[]) => unknown) => ipcHandlers.set(ch, fn),
    },
    Menu: {
      buildFromTemplate: (t: unknown[]) => ({ template: t }),
      setApplicationMenu: (m: unknown) => {
        env.menu = m;
      },
    },
    Tray: class {
      constructor(icon: unknown) {
        env.trayIcon = icon;
      }
      setToolTip() {}
      setContextMenu() {}
      on() {}
    },
    dialog: {
      showMessageBox: async (..._a: unknown[]) => ({ response: 1, checkboxChecked: false }),
    },
    shell: {
      openExternal: async (u: string) => {
        calls.openExternal.push(u);
      },
      showItemInFolder: (p: string) => {
        calls.showItemInFolder.push(p);
      },
      openPath: async (p: string) => {
        calls.openPath.push(p);
      },
    },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true, setTemplateImage: () => {} }) },
  };

  return { electron, calls, ipcHandlers, env, BrowserWindow };
}

test("main process: boots, wires every IPC channel, and boots the remote server for real", { skip }, async (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-main-"));

  // A real Aetheris-shaped server for the app to connect to.
  const web = http.createServer((req, res) => {
    const body = JSON.stringify({ ok: true, service: "aetheris-one", version: "2026.9.1", runtime: "server" });
    res.writeHead(req.url === "/api/health" ? 200 : 404, { "content-type": "application/json" });
    res.end(body);
  });
  await new Promise<void>((r) => web.listen(0, "127.0.0.1", () => r()));
  const serverUrl = `http://127.0.0.1:${(web.address() as { port: number }).port}`;

  t.after(() => {
    web.close();
    delete process.env.AETHERIS_DESKTOP_MODE;
    delete process.env.AETHERIS_DESKTOP_SERVER;
    fs.rmSync(userData, { recursive: true, force: true });
  });

  const stub: Stub = makeElectronStub(userData);
  const electronPath = require_.resolve("electron");
  require_.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: stub.electron } as never;

  process.env.AETHERIS_DESKTOP_MODE = "remote";
  process.env.AETHERIS_DESKTOP_SERVER = serverUrl;
  require_(MAIN);
  const flush = async (n = 12) => {
    for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
  };
  await flush();

  // 1. Every channel the preload exposes has a handler on the other side.
  const expected = [
    "aetheris:info",
    "aetheris:settings:get",
    "aetheris:settings:set",
    "aetheris:restart",
    "aetheris:server:status",
    "aetheris:server:probe",
    "aetheris:updates:check",
    "aetheris:logs",
    "aetheris:reveal",
    "aetheris:open-data-dir",
    "aetheris:open-external",
  ];
  for (const ch of expected) assert.ok(stub.ipcHandlers.has(ch), `${ch} is handled`);

  // 2. The renderer is locked down and its preload really exists.
  const win = stub.BrowserWindow.instances[0];
  assert.ok(win, "a window was created");
  const wp = win.opts.webPreferences;
  assert.equal(wp.contextIsolation, true);
  assert.equal(wp.nodeIntegration, false);
  assert.equal(wp.sandbox, true);
  assert.equal(wp.preload, PRELOAD, "the preload path resolves to a compiled file");
  assert.ok(fs.existsSync(PRELOAD), "preload.js was compiled");

  // 3. Remote mode: it probed /api/health and loaded the server, not an error screen.
  assert.ok(stub.calls.loadFile.some((f) => String(f).endsWith("boot.html")), "the boot shell is shown first");
  assert.deepEqual(stub.calls.loadURL, [serverUrl], `loadURL calls: ${JSON.stringify(stub.calls.loadURL)}`);
  const info = (await stub.ipcHandlers.get("aetheris:info")!(null)) as Record<string, string>;
  assert.equal(info.mode, "remote");
  assert.equal(info.serverUrl, serverUrl);
  assert.match(info.appVersion, /^\d{4}\.\d{1,2}\.\d{1,3}$/, `app version ${info.appVersion}`);
  const status = (await stub.ipcHandlers.get("aetheris:server:status")!(null)) as { state: string; url: string };
  assert.equal(status.url, serverUrl);

  // 4. The probe handler validates a candidate address against a real server.
  const good = (await stub.ipcHandlers.get("aetheris:server:probe")!(null, serverUrl)) as { ok: boolean; version?: string };
  assert.equal(good.ok, true);
  const bad = (await stub.ipcHandlers.get("aetheris:server:probe")!(null, "javascript:alert(1)")) as { ok: boolean; error: string };
  assert.equal(bad.ok, false);
  assert.match(bad.error, /http/);

  // 5. Settings round-trip: a patch is sanitised and persisted. Pointing the app at a host that
  //    does not resolve must be *reported*, not silently loaded — so boot() runs and ends in the
  //    error view, and the window is left alone.
  const before = stub.calls.loadURL.length;
  const saved = (await stub.ipcHandlers.get("aetheris:settings:set")!(null, {
    mode: "remote",
    serverUrl: "  https://ai.example.invalid/base/  ",
    preferredPort: 99999,
    evil: "dropped",
  })) as Record<string, unknown>;
  await flush(40);
  assert.equal(saved.serverUrl, "https://ai.example.invalid/base", "normalised");
  assert.equal(saved.preferredPort, 17890, "out-of-range port fell back to the default");
  assert.equal(saved.evil, undefined, "unknown keys are dropped");
  assert.equal(stub.calls.loadURL.length, before, "an unreachable server is not loaded into the window");
  const onDisk = JSON.parse(fs.readFileSync(path.join(userData, "settings.json"), "utf8")) as { serverUrl: string };
  assert.equal(onDisk.serverUrl, "https://ai.example.invalid/base", "persisted");
  const errState = (stub.env.sent as { ch: string; payload: { view: string; error: string | null } }[]).at(-1)!.payload;
  assert.equal(errState.view, "error", "the shell is told to show the error view");
  assert.ok(errState.error && errState.error.includes("ai.example.invalid"), errState.error ?? "no error text");

  // 6. Switching back to the reachable server reconnects and reloads it.
  await stub.ipcHandlers.get("aetheris:settings:set")!(null, { mode: "remote", serverUrl });
  await flush(40);
  assert.ok(stub.calls.loadURL.length > before, "a reachable server is loaded");
  assert.equal(stub.calls.loadURL.at(-1), serverUrl);
  await stub.ipcHandlers.get("aetheris:restart")!(null);
  await flush(40);
  assert.equal(stub.calls.loadURL.at(-1), serverUrl, "restart reloads the same origin");

  // 7. openExternal only ever gets real web URLs.
  await stub.ipcHandlers.get("aetheris:open-external")!(null, "https://github.com/rajaram-2005/Aetheris");
  await stub.ipcHandlers.get("aetheris:open-external")!(null, "file:///etc/passwd");
  await stub.ipcHandlers.get("aetheris:open-external")!(null, "javascript:alert(1)");
  await stub.ipcHandlers.get("aetheris:open-external")!(null, 42);
  assert.deepEqual(stub.calls.openExternal, ["https://github.com/rajaram-2005/Aetheris"]);

  // 8. A window.open to a foreign origin is denied and handed to the browser.
  const handler = stub.env.windowOpenHandler as (d: { url: string }) => { action: string };
  assert.deepEqual(handler({ url: "https://docs.groq.com" }), { action: "deny" });
  assert.equal(stub.calls.openExternal.at(-1), "https://docs.groq.com");
  const denied = stub.calls.openExternal.length;
  handler({ url: "file:///etc/passwd" });
  assert.equal(stub.calls.openExternal.length, denied, "file: is not handed to the OS");

  // 9. The update check degrades instead of throwing when there is no egress.
  const update = (await stub.ipcHandlers.get("aetheris:updates:check")!(null)) as { state: string };
  assert.ok(["unavailable", "up_to_date", "update_available"].includes(update.state), update.state);

  // 10. Logs and the log handler agree on a path inside userData.
  const logs = (await stub.ipcHandlers.get("aetheris:logs")!(null)) as { path: string; lines: string[] };
  assert.ok(logs.path.startsWith(userData), logs.path);
  assert.ok(Array.isArray(logs.lines));
  assert.ok(logs.lines.every((l) => !/gsk_|api_key=/i.test(l)), "no credential-shaped line in the log");

  // 11. The application menu was built.
  assert.ok(stub.env.menu, "a menu was set");
  web.close();
});

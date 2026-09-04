/**
 * The embedded Aetheris server.
 *
 * The desktop app ships the Next.js **standalone** build (`node scripts/prepare-app.mjs` copies it
 * into the app's resources as `server/`). In `local` mode the main process starts it as a child
 * process using Electron's own Node runtime (`ELECTRON_RUN_AS_NODE=1`) — no separate Node install
 * is required on the user's machine.
 *
 * Security properties, all deliberate:
 *   - binds to `127.0.0.1` only (`HOSTNAME=127.0.0.1`); never reachable from the LAN,
 *   - empty-ish environment: only the keys we choose are forwarded, provider keys stay in the
 *     user's own env file if they put one in the data dir,
 *   - the child's cwd is the server dir so relative paths stay inside the bundle,
 *   - the app tells the server it is the desktop client (`AETHERIS_DESKTOP=1`), which switches on
 *     the loopback Host allow-list in `src/middleware.ts` (defence against DNS-rebinding).
 *
 * Everything here is either a pure function or takes its side effects as parameters, so
 * `tests/desktop.test.ts` exercises the real code paths without Electron.
 */
import * as net from "net";
import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import * as path from "path";
import * as fs from "fs";

export type LocalServerState = "stopped" | "starting" | "ready" | "error";

export type StartOptions = {
  /** Directory that contains the standalone build (`server.js`, `.next/`, `node_modules/`). */
  serverDir: string;
  /** Absolute path to the node-compatible executable (the Electron binary in production). */
  execPath: string;
  /** Writable directory for JSON stores + knowledge.sqlite. */
  dataDir: string;
  preferredPort: number;
  /** Env vars from the user (e.g. GROQ_API_KEY) that are allowed through to the server. */
  inheritedEnv?: NodeJS.ProcessEnv;
  /** Where stdout/stderr lines are written. */
  onLog?: (line: string) => void;
  /** Test seam: replace the spawner. */
  spawnImpl?: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcessLike;
  /** Test seam: replace the port probe. */
  probeImpl?: (port: number) => Promise<boolean>;
  /** How long to wait for `/api/health` before declaring the start a failure. */
  healthTimeoutMs?: number;
};

export type ChildProcessLike = {
  pid?: number;
  killed: boolean;
  stdout: { on(ev: "data", cb: (chunk: Buffer | string) => void): void } | null;
  stderr: { on(ev: "data", cb: (chunk: Buffer | string) => void): void } | null;
  on(ev: "error" | "exit", cb: (...args: never[]) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
};

export type LocalServer = {
  url: string;
  port: number;
  pid?: number;
  stop(): Promise<void>;
  readonly state: LocalServerState;
  lastError?: string;
};

/** Keys from the parent env that may reach the embedded server. Anything else is dropped. */
export const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "OLLAMA_BASE_URL",
  "OPENAI_BASE_URL",
];

/** Provider keys are only forwarded when the user opted in with AETHERIS_DESKTOP_FORWARD_KEYS=1. */
const KEY_PATTERN = /(_API_KEY|_TOKEN|_SECRET|_ACCESS_KEY)$/;

/** Build the environment for the child process. Never mutates the parent env. */
export function buildServerEnv(opts: {
  dataDir: string;
  port: number;
  host?: string;
  inheritedEnv?: NodeJS.ProcessEnv;
  version: string;
}): NodeJS.ProcessEnv {
  const host = opts.host ?? "127.0.0.1";
  const parent: Record<string, string | undefined> = opts.inheritedEnv ?? {};
  // A near-empty base: the child must not inherit a stray NODE_OPTIONS, NODE_ENV=development,
  // npm_* lifecycle junk or a parent's AETHERIS_* override.
  const env: Record<string, string | undefined> = {};
  for (const key of ENV_ALLOWLIST) {
    const v = parent[key];
    if (typeof v === "string" && v) env[key] = v;
  }
  if (parent.AETHERIS_DESKTOP_FORWARD_KEYS === "1") {
    for (const [k, v] of Object.entries(parent)) {
      if (typeof v === "string" && KEY_PATTERN.test(k) && !k.startsWith("AETHERIS_ADMIN")) env[k] = v;
    }
  }
  env.NODE_ENV = "production";
  env.HOSTNAME = host;
  env.PORT = String(opts.port);
  env.AETHERIS_DATA_DIR = opts.dataDir;
  env.AETHERIS_KNOWLEDGE_DB = path.join(opts.dataDir, "knowledge.sqlite");
  env.AETHERIS_DESKTOP = "1";
  env.AETHERIS_DESKTOP_VERSION = opts.version;
  env.NEXT_TELEMETRY_DISABLED = "1";
  env.AETHERIS_SCHEDULER = parent.AETHERIS_SCHEDULER ?? "1";
  // NODE_OPTIONS is never copied: a parent's --inspect/--require must not reach the embedded server.
  // Cast: NODE_ENV is required by @types/node's ProcessEnv and is set above; the rest is optional.
  return env as NodeJS.ProcessEnv;
}

/** True when `serverDir` looks like a usable Next.js standalone build. */
export function isServerDirReady(serverDir: string): boolean {
  try {
    return fs.statSync(path.join(serverDir, "server.js")).isFile();
  } catch {
    return false;
  }
}

export function serverNotBuiltMessage(serverDir: string): string {
  return [
    "The embedded Aetheris server is not built yet.",
    `Expected ${path.join(serverDir, "server.js")}.`,
    "",
    "From the repository root run:",
    "    npm run desktop:build",
    "",
    "That runs `next build` with AETHERIS_STANDALONE=1, copies the standalone output into",
    "desktop/resources/server, and then packages the app. For day-to-day work on the UI use",
    "`npm run desktop:dev` instead, which points the window at `npm run dev` on port 3000.",
  ].join("\n");
}

/** Is something already listening on this loopback port? */
export function isPortInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(true));
    srv.once("listening", () => srv.close(() => resolve(false)));
    srv.listen(port, host);
  });
}

/**
 * Pick a loopback port: the preferred one when free (so the cookie origin is stable across
 * launches and the user can bookmark it), otherwise the next free port upward, wrapping once.
 * Returns null when nothing is free.
 */
export async function pickPort(
  preferred: number,
  probe: (port: number) => Promise<boolean> = isPortInUse,
  attempts = 40,
): Promise<number | null> {
  if (!(await probe(preferred))) return preferred;
  for (let i = 1; i < attempts; i++) {
    const port = 1024 + ((preferred - 1024 + i) % (65535 - 1024));
    if (!(await probe(port))) return port;
  }
  return null;
}

export type HealthResult = { ok: boolean; status?: number; body?: unknown; error?: string };

/** One `GET /api/health` probe. `fetchImpl` is injectable so tests do not touch the network. */
export async function probeHealth(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2000,
): Promise<HealthResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/health`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON body is still a valid probe result */
    }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Poll `/api/health` until it answers 200 or the budget runs out. */
export async function waitUntilHealthy(
  baseUrl: string,
  opts: { timeoutMs?: number; intervalMs?: number; fetchImpl?: typeof fetch; onTick?: (attempt: number, r: HealthResult) => void } = {},
): Promise<HealthResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 300;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let last: HealthResult = { ok: false, error: "not started" };
  for (;;) {
    attempt += 1;
    last = await probeHealth(baseUrl, fetchImpl);
    opts.onTick?.(attempt, last);
    if (last.ok) return last;
    if (Date.now() >= deadline) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Spawn + supervise the embedded server. Resolves once it is healthy. */
export async function startLocalServer(opts: StartOptions): Promise<LocalServer> {
  if (!isServerDirReady(opts.serverDir)) throw new Error(serverNotBuiltMessage(opts.serverDir));
  fs.mkdirSync(opts.dataDir, { recursive: true });

  const probe = opts.probeImpl ?? isPortInUse;
  const port = await pickPort(opts.preferredPort, probe);
  if (port === null) throw new Error(`no free loopback port near ${opts.preferredPort}`);

  const version = process.env.AETHERIS_DESKTOP_VERSION ?? "0.0.0";
  const env = buildServerEnv({ dataDir: opts.dataDir, port, inheritedEnv: opts.inheritedEnv ?? process.env, version });
  const doSpawn = opts.spawnImpl ?? ((cmd: string, args: string[], so: SpawnOptions) => spawn(cmd, args, so) as unknown as ChildProcessLike);

  const child = doSpawn(
    opts.execPath,
    [path.join(opts.serverDir, "server.js")],
    {
      cwd: opts.serverDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  /** Mutable box: the exit/error handlers and the health poll run on different ticks. */
  const sup: { state: LocalServerState; lastError?: string } = { state: "starting" };
  const pipe = (stream: ChildProcessLike["stdout"], tag: string) => {
    if (!stream) return;
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) opts.onLog?.(`[server:${tag}] ${line}`);
    });
  };
  pipe(child.stdout, "out");
  pipe(child.stderr, "err");
  child.on("exit", (...args: never[]) => {
    const [code] = args as unknown as [number | null];
    if (sup.state !== "stopped") {
      sup.state = "error";
      sup.lastError = `embedded server exited unexpectedly (code ${String(code)})`;
      opts.onLog?.(`[desktop] ${sup.lastError}`);
    }
  });
  child.on("error", (...args: never[]) => {
    const [err] = args as unknown as [Error];
    sup.state = "error";
    sup.lastError = `could not start the embedded server: ${err?.message ?? String(err)}`;
    opts.onLog?.(`[desktop] ${sup.lastError}`);
  });

  const url = `http://127.0.0.1:${port}`;
  const health = await waitUntilHealthy(url, {
    timeoutMs: opts.healthTimeoutMs ?? 90_000,
    onTick: (attempt, r) => {
      // every ~1.5 s while starting: enough to see progress in the log, not enough to flood it
      if (r.error && sup.state === "starting" && (attempt === 1 || attempt % 5 === 0)) {
        opts.onLog?.(`[desktop] waiting for embedded server (attempt ${attempt})… ${r.error}`);
      }
    },
  });

  if (!health.ok) {
    const reason =
      sup.state === "error" && sup.lastError ? sup.lastError : `embedded server did not become healthy: ${health.error ?? `HTTP ${health.status}`}`;
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    sup.state = "error";
    throw new Error(reason);
  }

  sup.state = "ready";
  opts.onLog?.(`[desktop] embedded server ready at ${url} (pid ${String(child.pid ?? "?")})`);

  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = new Promise<void>((resolve) => {
      if (sup.state === "stopped" || child.killed) {
        sup.state = "stopped";
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        sup.state = "stopped";
        resolve();
      }, 4000);
      child.on("exit", () => {
        clearTimeout(timer);
        sup.state = "stopped";
        resolve();
      });
      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(timer);
        sup.state = "stopped";
        resolve();
      }
    });
    return stopping;
  };

  return {
    url,
    port,
    pid: child.pid,
    stop,
    get state() {
      return sup.state;
    },
    get lastError() {
      return sup.lastError;
    },
  };
}

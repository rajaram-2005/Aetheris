/**
 * Desktop app + monthly release pipeline.
 *
 * Covers the logic that the Electron shell and the release process are built on: CalVer, the
 * version-sync and changelog tools, desktop settings, the embedded-server supervisor, update
 * checking, log redaction — plus the repo-level invariants that keep a release coherent
 * (one version everywhere, a monthly workflow, packaging targets for all three OSes).
 *
 * `desktop.embedded.test.ts` adds the end-to-end run of the real embedded Next.js server; it skips
 * itself when the standalone build has not been produced.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  CALVER_RE,
  calVerForDate,
  compareCalVer,
  formatCalVer,
  isCalVer,
  isNewerThan,
  nextCalVer,
  normalizeTag,
  parseCalVer,
  releaseDate,
} from "../desktop/src/lib/calver";
import { DEFAULT_PORT, applyPatch, defaultSettings, normalizeServerUrl, sanitizeSettings } from "../desktop/src/lib/settings";
import {
  ENV_ALLOWLIST,
  buildServerEnv,
  isPortInUse,
  isServerDirReady,
  pickPort,
  probeHealth,
  serverNotBuiltMessage,
  startLocalServer,
  waitUntilHealthy,
  type ChildProcessLike,
} from "../desktop/src/lib/local-server";
import { LATEST_RELEASE_URL, checkForUpdates, evaluateRelease, parseRelease, pickAsset } from "../desktop/src/lib/update";
import { createLogger, fileSink, formatLine, logFileName, redact } from "../desktop/src/lib/logging";
import { isLoopbackHost } from "../src/lib/loopback";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const json = (p: string) => JSON.parse(read(p)) as Record<string, unknown>;

// --------------------------------------------------------------------------- CalVer

test("calver: parses YYYY.M.P, rejects padded/invalid forms", () => {
  assert.deepEqual(parseCalVer("2026.9.1"), { year: 2026, month: 9, patch: 1 });
  assert.deepEqual(parseCalVer(" 2027.12.34 "), { year: 2027, month: 12, patch: 34 });
  assert.equal(formatCalVer({ year: 2026, month: 9, patch: 1 }), "2026.9.1");
  assert.ok(isCalVer("2026.9.1"));
  for (const bad of ["2026.09.1", "2026.9.0", "2026.13.1", "2026.0.1", "1.2.3", "v2026", "", "0.1.0", "2026.9.1.4", "26.9.1"]) {
    assert.equal(parseCalVer(bad), null, bad);
    assert.equal(isCalVer(bad), false, bad);
  }
  assert.ok(CALVER_RE.test("2026.9.1"));
});

test("calver: the monthly cadence — new month resets the patch, same month bumps it", () => {
  const at = (iso: string) => new Date(iso);
  // the ordinary "every 1 month" bump
  assert.equal(formatCalVer(nextCalVer("2026.9.1", at("2026-10-01T00:00:00Z"))), "2026.10.1");
  assert.equal(formatCalVer(nextCalVer("2026.9.3", at("2026-10-05T12:00:00Z"))), "2026.10.1", "patch resets in a new month");
  assert.equal(formatCalVer(nextCalVer("2026.11.2", at("2026-12-01T00:00:00Z"))), "2026.12.1");
  assert.equal(formatCalVer(nextCalVer("2026.12.1", at("2027-01-01T00:00:00Z"))), "2027.1.1", "year rolls over in January");
  // a hot-fix inside the same month
  assert.equal(formatCalVer(nextCalVer("2026.9.1", at("2026-09-20T00:00:00Z"))), "2026.9.2");
  assert.equal(formatCalVer(nextCalVer("2026.9.9", at("2026-09-21T00:00:00Z"))), "2026.9.10");
  // first ever release, and unparseable history
  assert.equal(formatCalVer(nextCalVer(null, at("2026-09-04T00:00:00Z"))), "2026.9.1");
  assert.equal(formatCalVer(nextCalVer("0.1.0", at("2026-09-04T00:00:00Z"))), "2026.9.1", "legacy semver history is ignored");
  // clock skew: never go backwards
  assert.equal(formatCalVer(nextCalVer("2026.12.2", at("2026-09-04T00:00:00Z"))), "2026.12.3");
  // a whole year of monthly bumps is strictly increasing
  let v = "2026.9.1";
  const seen: string[] = [v];
  for (let i = 1; i <= 16; i++) {
    const d = new Date(Date.UTC(2026, 8 + i, 1));
    v = formatCalVer(nextCalVer(v, d));
    seen.push(v);
  }
  assert.deepEqual(seen.slice(0, 5), ["2026.9.1", "2026.10.1", "2026.11.1", "2026.12.1", "2027.1.1"]);
  for (let i = 1; i < seen.length; i++) assert.ok(isNewerThan(seen[i], seen[i - 1]), `${seen[i]} > ${seen[i - 1]}`);
});

test("calver: compare, isNewerThan and tag normalisation", () => {
  assert.equal(compareCalVer("2026.9.1", "2026.9.1"), 0);
  assert.equal(compareCalVer("2026.9.1", "2026.10.1"), -1, "month is numeric, not lexicographic");
  assert.equal(compareCalVer("2026.10.1", "2027.1.1"), -1);
  assert.equal(compareCalVer("2026.9.10", "2026.9.9"), 1);
  assert.throws(() => compareCalVer("nope", "2026.9.1"), /invalid calver/);
  assert.ok(isNewerThan("2026.10.1", "2026.9.1"));
  assert.equal(isNewerThan("2026.9.1", "2026.10.1"), false);
  assert.equal(isNewerThan("garbage", "2026.9.1"), false, "invalid input fails safe");
  assert.equal(normalizeTag("v2026.9.1"), "2026.9.1");
  assert.equal(normalizeTag(" release-2026.10.2 "), "2026.10.2");
  assert.equal(normalizeTag("v2026.09.1"), null, "padded months are not valid tags");
  assert.equal(normalizeTag("v1.2.3"), null);
  assert.equal(calVerForDate(new Date("2026-09-04T23:59:59Z")).month, 9);
  assert.equal(releaseDate(new Date("2026-09-04T23:59:59Z")), "2026-09-04");
});

// --------------------------------------------------------------------------- release tools

test("release tools: computeNext matches the app's CalVer and --set/--patch behave", async () => {
  const { computeNext, replaceVersion, syncVersion, readVersion, VERSION_TARGETS } = await import("../tools/bump-version.mjs");
  const now = new Date("2026-10-01T00:00:00Z");
  assert.equal(computeNext("2026.9.1", "monthly", undefined, now), "2026.10.1");
  assert.equal(computeNext("2026.10.1", "monthly", undefined, now), "2026.10.2", "same month → patch");
  assert.equal(computeNext("2026.9.1", "patch", undefined, now), "2026.9.2");
  assert.equal(computeNext("2026.9.1", "set", "2030.1.7", now), "2030.1.7");
  assert.throws(() => computeNext("2026.9.1", "set", "nope", now), /CalVer/);

  const text = '{\n  "version": "0.1.0",\n  "name": "x"\n}\n';
  const pattern = /("version":\s*")[^"]*(")/;
  const render = (v: string) => `$1${v}$2`;
  assert.equal(replaceVersion(text, pattern, render, "2026.10.1"), '{\n  "version": "2026.10.1",\n  "name": "x"\n}\n');
  assert.equal(replaceVersion("no marker here", pattern, render, "2026.10.1"), null);
  assert.equal(replaceVersion(replaceVersion(text, pattern, render, "2026.10.1")!, pattern, render, "2026.10.1"), replaceVersion(text, pattern, render, "2026.10.1"), "idempotent");

  // syncVersion against a throwaway tree
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-ver-"));
  fs.writeFileSync(path.join(tmp, "VERSION"), "2026.9.1\n");
  fs.writeFileSync(path.join(tmp, "package.json"), text);
  fs.mkdirSync(path.join(tmp, "desktop"));
  fs.writeFileSync(path.join(tmp, "desktop/package.json"), text);
  fs.mkdirSync(path.join(tmp, "public"));
  fs.writeFileSync(path.join(tmp, "public/manifest.webmanifest"), '{ "version": "0.1.0" }');
  const rep = syncVersion("2026.10.1", { root: tmp });
  assert.deepEqual(rep.missing, []);
  assert.equal(rep.written.every((w: { changed: boolean }) => w.changed), true);
  assert.equal(fs.readFileSync(path.join(tmp, "VERSION"), "utf8"), "2026.10.1\n");
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8")).version, "2026.10.1");
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, "desktop/package.json"), "utf8")).version, "2026.10.1");
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, "public/manifest.webmanifest"), "utf8")).version, "2026.10.1");
  const again = syncVersion("2026.10.1", { root: tmp });
  assert.equal(again.written.some((w: { changed: boolean }) => w.changed), false, "second run changes nothing");
  // a missing marker is reported, not silently skipped
  fs.writeFileSync(path.join(tmp, "public/manifest.webmanifest"), "{}");
  const broken = syncVersion("2026.11.1", { root: tmp });
  assert.deepEqual(broken.missing, ["public/manifest.webmanifest (version marker not found)"]);
  fs.rmSync(tmp, { recursive: true, force: true });

  assert.equal(readVersion(), read("VERSION").trim(), "VERSION is readable and valid");
  assert.ok(VERSION_TARGETS.length >= 4);
});

test("release tools: `npm run version:bump -- --dry-run` runs the real CLI and reports the monthly bump", () => {
  const out = execFileSync("npx", ["tsx", "tools/bump-version.mjs", "--dry-run"], { cwd: ROOT, encoding: "utf8" });
  const current = read("VERSION").trim();
  const expected = formatCalVer(nextCalVer(current, new Date()));
  assert.ok(out.includes(`version ${current} → ${expected} (monthly)`), out);
  assert.ok(out.includes("[dry-run]"), out);
  assert.ok(out.includes("would write VERSION"), out);
  assert.equal(read("VERSION").trim(), current, "dry-run wrote nothing");
});

test("changelog: entries are grouped, deterministic and inserted under the marker", async () => {
  const { HEADER, buildEntry, groupCommits, insertEntry, removeSection, headerIndex, commitsSince } = await import("../tools/changelog.mjs");
  const commits = [
    { subject: "desktop: tray icon", body: "" },
    { subject: "desktop: deep links", body: "" },
    { subject: "fix: rate limit window", body: "" },
    { subject: "unprefixed change", body: "" },
  ];
  const groups = groupCommits(commits);
  assert.deepEqual([...groups.keys()].sort(), ["desktop", "fix", "other"]);
  assert.deepEqual(groups.get("desktop"), ["tray icon", "deep links"]);

  const entry = buildEntry({ version: "2026.10.1", date: "2026-10-01", commits });
  assert.ok(entry.startsWith("## 2026.10.1 — 2026-10-01"));
  assert.ok(entry.includes("- tray icon") && entry.includes("- rate limit window") && entry.includes("- unprefixed change"));
  assert.ok(entry.indexOf("### desktop") < entry.indexOf("### fix"), "sections follow SECTION_ORDER");
  assert.equal(entry, buildEntry({ version: "2026.10.1", date: "2026-10-01", commits }), "deterministic");
  assert.ok(buildEntry({ version: "2026.10.1", date: "2026-10-01", commits: [] }).includes("Monthly release"));
  assert.throws(() => buildEntry({ version: "nope", date: "2026-10-01", commits: [] }), /CalVer/);

  const doc = `# Changelog\n\nintro\n\n${HEADER}\n\n## 2026.9.1 — 2026-09-04\n\n- old\n`;
  const updated = insertEntry(doc, entry);
  assert.ok(headerIndex(updated) > -1);
  assert.ok(updated.indexOf("## 2026.10.1") < updated.indexOf("## 2026.9.1"), "newest first");
  assert.ok(updated.includes("- old"), "history preserved");
  const replaced = insertEntry(removeSection(updated, "2026.10.1"), entry);
  assert.equal((replaced.match(/## 2026\.10\.1/g) ?? []).length, 1, "re-run replaces, never duplicates");
  assert.throws(() => insertEntry("# no marker", entry), /marker/);

  // the real repo history is readable (no tag yet → all commits)
  const real = commitsSince(null);
  assert.ok(Array.isArray(real));
  assert.ok(real.every((c: { subject: string }) => typeof c.subject === "string" && c.subject.length > 0));
});

test("changelog: `npm run changelog -- --dry-run` renders an entry for the current VERSION", () => {
  const out = execFileSync("npx", ["tsx", "tools/changelog.mjs", "--dry-run"], { cwd: ROOT, encoding: "utf8" });
  assert.ok(out.includes(`## ${read("VERSION").trim()} — `), out);
  assert.ok(/commits since/.test(out), out);
});

// --------------------------------------------------------------------------- desktop settings

test("desktop settings: defaults, sanitising hostile input, URL normalisation", () => {
  const ud = "/tmp/Aetheris";
  const d = defaultSettings(ud);
  assert.equal(d.mode, "local");
  assert.equal(d.preferredPort, DEFAULT_PORT);
  assert.equal(d.dataDir, "/tmp/Aetheris/data");
  assert.deepEqual(sanitizeSettings(null, ud), d);
  assert.deepEqual(sanitizeSettings("nonsense", ud), d);
  assert.deepEqual(sanitizeSettings({}, ud), d);

  const s = sanitizeSettings(
    {
      mode: "remote",
      serverUrl: "  https://ai.example.com/base/  ",
      preferredPort: 4242,
      dataDir: "/srv/aetheris",
      bounds: { x: -5, y: 10, width: 200, height: 99999 },
      openDevTools: true,
      hardwareAcceleration: false,
      updateCheckIntervalMinutes: 5000,
      evil: "ignored",
    },
    ud,
  );
  assert.equal(s.mode, "remote");
  assert.equal(s.serverUrl, "https://ai.example.com/base");
  assert.equal(s.preferredPort, 4242);
  assert.equal(s.dataDir, "/srv/aetheris");
  assert.equal(s.bounds.width, 480, "clamped to the minimum");
  assert.equal(s.bounds.height, 8192, "clamped to the maximum");
  assert.equal(s.openDevTools, true);
  assert.equal(s.hardwareAcceleration, false);
  assert.equal(s.updateCheckIntervalMinutes, 1440, "clamped to a day");
  assert.equal((s as Record<string, unknown>).evil, undefined, "unknown keys are dropped");

  // invalid values fall back rather than throw
  const bad = sanitizeSettings({ mode: "sideways", serverUrl: "javascript:alert(1)", preferredPort: 80, bounds: "nope" }, ud);
  assert.equal(bad.mode, "local");
  assert.equal(bad.serverUrl, "");
  assert.equal(bad.preferredPort, DEFAULT_PORT);
  assert.deepEqual(bad.bounds, d.bounds);

  assert.equal(normalizeServerUrl("https://x.example.com/"), "https://x.example.com");
  assert.equal(normalizeServerUrl("x.example.com"), "https://x.example.com", "https by default");
  assert.equal(normalizeServerUrl("http://192.168.1.20:3000/a/b/"), "http://192.168.1.20:3000/a/b");
  assert.equal(normalizeServerUrl("file:///etc/passwd"), "");
  assert.equal(normalizeServerUrl("ftp://x"), "");
  assert.equal(normalizeServerUrl(""), "");
  assert.equal(normalizeServerUrl(42), "");
  assert.equal(normalizeServerUrl("   "), "");

  const patched = applyPatch(d, { mode: "remote", serverUrl: "https://y.example.com" }, ud);
  assert.equal(patched.mode, "remote");
  assert.equal(patched.preferredPort, DEFAULT_PORT, "untouched fields survive");
});

// --------------------------------------------------------------------------- embedded server

test("embedded server: the child env is minimal, loopback-only and leaks no keys by default", () => {
  const parent: NodeJS.ProcessEnv = {
    PATH: "/usr/bin",
    HOME: "/home/u",
    NODE_OPTIONS: "--inspect",
    NODE_ENV: "development",
    npm_lifecycle_event: "dev",
    GROQ_API_KEY: "gsk_supersecret",
    AETHERIS_ADMIN_KEY: "admin-secret",
    AETHERIS_DATA_DIR: "/somewhere/else",
  };
  const env = buildServerEnv({ dataDir: "/data/aetheris", port: 17890, inheritedEnv: parent, version: "2026.9.1" });
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.HOSTNAME, "127.0.0.1", "loopback only");
  assert.equal(env.PORT, "17890");
  assert.equal(env.AETHERIS_DATA_DIR, "/data/aetheris");
  assert.equal(env.AETHERIS_KNOWLEDGE_DB, path.join("/data/aetheris", "knowledge.sqlite"));
  assert.equal(env.AETHERIS_DESKTOP, "1", "turns on the middleware loopback guard");
  assert.equal(env.AETHERIS_DESKTOP_VERSION, "2026.9.1");
  assert.equal(env.NEXT_TELEMETRY_DISABLED, "1");
  assert.equal(env.NODE_OPTIONS, undefined, "a parent's --inspect must not leak");
  assert.equal(env.npm_lifecycle_event, undefined);
  assert.equal(env.GROQ_API_KEY, undefined, "keys are not forwarded by default");
  assert.equal(env.AETHERIS_ADMIN_KEY, undefined);
  assert.equal(env.PATH, "/usr/bin");
  assert.ok(ENV_ALLOWLIST.includes("HTTPS_PROXY"));
  assert.equal(parent.NODE_ENV, "development", "the parent env is not mutated");

  const opted = buildServerEnv({ dataDir: "/d", port: 1, inheritedEnv: { ...parent, AETHERIS_DESKTOP_FORWARD_KEYS: "1" }, version: "1.1.1" });
  assert.equal(opted.GROQ_API_KEY, "gsk_supersecret", "opt-in forwards provider keys");
  assert.equal(opted.AETHERIS_ADMIN_KEY, undefined, "admin credentials are never forwarded");
});

test("embedded server: port selection avoids listeners that are really there", async () => {
  const blocker = net.createServer();
  await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", () => r()));
  const busy = (blocker.address() as net.AddressInfo).port;
  assert.equal(await isPortInUse(busy), true);
  assert.equal(await pickPort(busy), busy + 1, "falls through to the next free port");

  let freePort = 0;
  const other = net.createServer();
  await new Promise<void>((r) => other.listen(0, "127.0.0.1", () => r()));
  freePort = (other.address() as net.AddressInfo).port;
  other.close();
  assert.equal(await isPortInUse(freePort), false);
  assert.equal(await pickPort(freePort), freePort, "the preferred port wins when free");

  assert.equal(await pickPort(1234, async () => true, 5), null, "gives up when everything is taken");
  blocker.close();
});

test("embedded server: health probing and the wait loop", async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "aetheris-one", version: "2026.9.1" }));
    } else {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
    }
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as net.AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  const ok = await probeHealth(url);
  assert.equal(ok.ok, true);
  assert.equal((ok.body as { version: string }).version, "2026.9.1");
  const bad = await probeHealth(`${url}/nope`);
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 503);
  const refused = await probeHealth("http://127.0.0.1:1", undefined, 800);
  assert.equal(refused.ok, false);
  assert.ok(refused.error, "a connection failure is reported, not thrown");

  let calls = 0;
  const flaky: typeof fetch = async (input, init) => {
    calls += 1;
    if (calls < 3) throw new Error("ECONNREFUSED");
    return fetch(input as string, init);
  };
  const healed = await waitUntilHealthy(url, { fetchImpl: flaky, intervalMs: 5, timeoutMs: 5000 });
  assert.equal(healed.ok, true);
  assert.ok(calls >= 3, `polled ${calls} times`);

  const never: typeof fetch = async () => {
    throw new Error("nope");
  };
  const gaveUp = await waitUntilHealthy(url, { fetchImpl: never, intervalMs: 5, timeoutMs: 60 });
  assert.equal(gaveUp.ok, false);
  srv.close();
});

test("embedded server: refuses to start without a build, then spawns, waits, supervises and stops a real child", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-srv-"));
  assert.equal(isServerDirReady(tmp), false);
  assert.match(serverNotBuiltMessage(tmp), /not built yet/);
  await assert.rejects(
    () => startLocalServer({ serverDir: tmp, execPath: process.execPath, dataDir: path.join(tmp, "data"), preferredPort: 17890 }),
    /not built yet/,
  );

  // A real child process that behaves like the standalone server: reads the env we pass, serves
  // /api/health on the port we chose, dies on SIGTERM. This exercises the actual spawn path.
  fs.writeFileSync(
    path.join(tmp, "server.js"),
    [
      'const http = require("node:http");',
      'const srv = http.createServer((req, res) => {',
      '  if (req.url !== "/api/health") { res.writeHead(404); res.end(); return; }',
      '  res.writeHead(200, { "content-type": "application/json" });',
      '  res.end(JSON.stringify({ ok: true, service: "aetheris-one", version: process.env.AETHERIS_DESKTOP_VERSION, runtime: process.env.AETHERIS_DESKTOP === "1" ? "desktop" : "server", host: process.env.HOSTNAME, dataDir: process.env.AETHERIS_DATA_DIR, nodeOptions: process.env.NODE_OPTIONS ?? null }));',
      "});",
      'srv.listen(Number(process.env.PORT), process.env.HOSTNAME, () => console.log("listening"));',
      'process.on("SIGTERM", () => { console.log("terminating"); process.exit(0); });',
      "",
    ].join("\n"),
  );

  // Occupy the preferred port with a real listener so port selection has something to avoid.
  const blocker = net.createServer();
  await new Promise<void>((r) => blocker.listen(17890, "127.0.0.1", () => r()));

  const logs: string[] = [];
  const srv = await startLocalServer({
    serverDir: tmp,
    execPath: process.execPath,
    dataDir: path.join(tmp, "data"),
    preferredPort: 17890,
    healthTimeoutMs: 20_000,
    inheritedEnv: { NODE_ENV: "development", PATH: process.env.PATH ?? "/usr/bin", NODE_OPTIONS: "--inspect", GROQ_API_KEY: "gsk_secret" },
    onLog: (l) => logs.push(l),
  });

  assert.notEqual(srv.port, 17890, "walked past the occupied preferred port");
  assert.equal(srv.url, `http://127.0.0.1:${srv.port}`);
  assert.equal(srv.state, "ready");
  assert.ok(typeof srv.pid === "number" && srv.pid > 0, `pid ${String(srv.pid)}`);

  // The child really received the environment we built, and none of the things we withheld.
  const health = await probeHealth(srv.url);
  assert.equal(health.ok, true);
  const body = health.body as { version: string | null; runtime: string; host: string; dataDir: string; nodeOptions: string | null };
  assert.equal(body.runtime, "desktop");
  assert.equal(body.host, "127.0.0.1", "the child was told to bind loopback only");
  assert.equal(body.dataDir, path.join(tmp, "data"));
  assert.equal(body.nodeOptions, null, "NODE_OPTIONS did not leak into the child");

  assert.ok(logs.some((l) => l.includes("embedded server ready")), logs.join("|"));
  await srv.stop();
  assert.equal(srv.state, "stopped");
  const after = await probeHealth(srv.url, fetch, 1000);
  assert.equal(after.ok, false, "the port is closed once stopped");

  blocker.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("embedded server: <dataDir>/.env.local is injected into the child the app really spawns", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-envfile-"));
  const dataDir = path.join(tmp, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, ".env.local"), "GROQ_API_KEY=gsk_from-user-file\nMARKER_VALUE=aetheris-env-ok\n");

  // The child writes the environment it actually received into the data dir, then exits; the
  // health wait fails on purpose (nothing listens), which is fine — we only care about the env.
  fs.writeFileSync(
    path.join(tmp, "server.js"),
    `require("node:fs").writeFileSync(require("node:path").join(process.env.AETHERIS_DATA_DIR, "env.json"), JSON.stringify(process.env));\nsetInterval(() => {}, 1000);\n`,
  );

  const logs: string[] = [];
  await assert.rejects(
    () =>
      startLocalServer({
        serverDir: tmp,
        execPath: process.execPath,
        dataDir,
        preferredPort: 17899,
        healthTimeoutMs: 3000,
        inheritedEnv: { NODE_ENV: "production", PATH: process.env.PATH ?? "/usr/bin", GROQ_API_KEY: "gsk_from-parent" },
        onLog: (l) => logs.push(l),
      }),
    /did not become healthy/,
  );

  const received = JSON.parse(fs.readFileSync(path.join(dataDir, "env.json"), "utf8")) as Record<string, string>;
  assert.equal(received.GROQ_API_KEY, "gsk_from-user-file", "the user's file beats the inherited environment");
  assert.equal(received.MARKER_VALUE, "aetheris-env-ok");
  assert.equal(received.AETHERIS_DATA_DIR, dataDir);
  assert.equal(received.HOSTNAME, "127.0.0.1");
  // the log names the keys it loaded, without printing any value
  const loadLine = logs.find((l) => l.includes(".env.local"));
  assert.ok(loadLine, logs.join("|"));
  assert.ok(loadLine!.includes("GROQ_API_KEY"), loadLine);
  assert.equal(loadLine!.includes("gsk_from-user-file"), false, "values are never logged");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// --------------------------------------------------------------------------- updates

const RELEASE = {
  tag_name: "v2026.10.1",
  name: "Aetheris 2026.10.1",
  body: "Monthly release.",
  html_url: "https://github.com/rajaram-2005/Aetheris/releases/tag/v2026.10.1",
  published_at: "2026-10-01T04:00:00Z",
  prerelease: false,
  assets: [
    { name: "Aetheris-2026.10.1-mac-arm64.dmg", browser_download_url: "https://x/mac-arm64.dmg", size: 1 },
    { name: "Aetheris-2026.10.1-mac-x64.dmg", browser_download_url: "https://x/mac-x64.dmg", size: 1 },
    { name: "Aetheris-2026.10.1-linux-x86_64.AppImage", browser_download_url: "https://x/linux.AppImage", size: 1 },
    { name: "Aetheris-2026.10.1-linux-arm64.deb", browser_download_url: "https://x/linux-arm64.deb", size: 1 },
    { name: "Aetheris-2026.10.1-win-x64-setup.exe", browser_download_url: "https://x/win.exe", size: 1 },
  ],
};

test("updates: release parsing, per-platform asset choice and version comparison", () => {
  const rel = parseRelease(RELEASE)!;
  assert.equal(rel.version, "2026.10.1");
  assert.equal(rel.assets.length, 5);
  assert.equal(parseRelease(null), null);
  assert.equal(parseRelease({}), null);
  assert.equal(parseRelease({ tag_name: "" }), null);
  assert.equal(parseRelease({ tag_name: "v1.2", assets: [{ name: "x" }] })!.assets.length, 0, "assets without URLs are dropped");

  assert.equal(pickAsset(rel.assets, "darwin", "arm64")!.name, "Aetheris-2026.10.1-mac-arm64.dmg");
  assert.equal(pickAsset(rel.assets, "darwin", "x64")!.name, "Aetheris-2026.10.1-mac-x64.dmg");
  assert.equal(pickAsset(rel.assets, "linux", "x64")!.name, "Aetheris-2026.10.1-linux-x86_64.AppImage");
  assert.equal(pickAsset(rel.assets, "linux", "arm64")!.name, "Aetheris-2026.10.1-linux-arm64.deb");
  assert.equal(pickAsset(rel.assets, "win32", "x64")!.name, "Aetheris-2026.10.1-win-x64-setup.exe");
  assert.equal(pickAsset([], "linux", "x64"), null);

  const newer = evaluateRelease("2026.9.1", RELEASE, "linux", "x64");
  assert.equal(newer.state, "update_available");
  if (newer.state === "update_available") {
    assert.equal(newer.latest, "2026.10.1");
    assert.equal(newer.asset!.url, "https://x/linux.AppImage");
  }
  assert.equal(evaluateRelease("2026.10.1", RELEASE, "linux", "x64").state, "up_to_date");
  assert.equal(evaluateRelease("2026.11.1", RELEASE, "linux", "x64").state, "up_to_date", "ahead of the feed is fine");
  const badTag = evaluateRelease("2026.9.1", { ...RELEASE, tag_name: "v1.0" }, "linux", "x64");
  assert.equal(badTag.state, "unavailable");
  if (badTag.state === "unavailable") assert.match(badTag.reason, /not a CalVer/);
  const devBuild = evaluateRelease("0.0.0", RELEASE, "linux", "x64");
  assert.equal(devBuild.state, "unavailable", "a dev build cannot compare itself");
  assert.ok(LATEST_RELEASE_URL.includes("rajaram-2005/Aetheris"));
});

test("updates: a failed check degrades to `unavailable` instead of throwing", async () => {
  const ok: typeof fetch = async () => new Response(JSON.stringify(RELEASE), { status: 200, headers: { "content-type": "application/json" } });
  const r = await checkForUpdates({ currentVersion: "2026.9.1", platform: "darwin", arch: "arm64", fetchImpl: ok });
  assert.equal(r.state, "update_available");
  if (r.state === "update_available") assert.equal(r.asset!.name, "Aetheris-2026.10.1-mac-arm64.dmg");

  const boom: typeof fetch = async () => {
    throw new Error("ENOTFOUND api.github.com");
  };
  const failed = await checkForUpdates({ currentVersion: "2026.9.1", platform: "linux", arch: "x64", fetchImpl: boom });
  assert.equal(failed.state, "unavailable");

  const notFound: typeof fetch = async () => new Response("nope", { status: 404 });
  const none = await checkForUpdates({ currentVersion: "2026.9.1", platform: "linux", arch: "x64", fetchImpl: notFound });
  assert.equal(none.state, "unavailable");
  if (none.state === "unavailable") assert.match(none.reason, /no releases/);

  const serverError: typeof fetch = async () => new Response("boom", { status: 500 });
  const err = await checkForUpdates({ currentVersion: "2026.9.1", platform: "win32", arch: "x64", fetchImpl: serverError });
  assert.equal(err.state, "unavailable");
});

// --------------------------------------------------------------------------- logging

test("logging: credentials are redacted, the ring is bounded, the sink gets every line", () => {
  assert.equal(redact("nothing to hide here"), "nothing to hide here");
  assert.equal(redact("key=sk-abc123def456").includes("sk-abc123def456"), false);
  assert.equal(redact("GROQ_API_KEY: ghp_0123456789abcdefghij").includes("0123456789abcdefghij"), false);
  assert.equal(redact("Authorization: Bearer ya29.a0AfH6SMBxLONGTOKENVALUE123456").includes("ya29.a0AfH6SMBxLONGTOKENVALUE123456"), false);
  assert.equal(redact("password=hunter2").includes("hunter2"), false);
  assert.match(redact("api_key=ABCDEF0123456789ABCDEF0123456789"), /\[redacted\]/);
  assert.ok(redact("the server is on http://127.0.0.1:17890").includes("127.0.0.1:17890"), "ordinary text survives");
  assert.ok(redact("https://aetheris.example.com/api/health answered in 42ms").includes("aetheris.example.com"), "URLs survive");
  const bearer = redact("Authorization: Bearer ya29.a0AfH6SMBxLONGTOKENVALUE123456");
  assert.ok(bearer.startsWith("Authorization: "), bearer);
  assert.equal(bearer.includes("a0AfH6SMBxLONGTOKENVALUE123456"), false, "the token itself is gone");
  assert.equal(redact("token: xoxb-1234567890-abcdefgh").includes("1234567890"), false);

  const written: string[] = [];
  const log = createLogger({ maxEntries: 3, sink: { append: (t) => written.push(t), now: () => "2026-09-04T00:00:00.000Z" } });
  log.info("one");
  log.warn("two");
  log.error("three");
  log.info("four");
  assert.deepEqual(log.tail().map((e) => e.text), ["two", "three", "four"], "ring keeps the newest");
  assert.equal(written.length, 4, "the file sink gets everything");
  assert.equal(written[0], "2026-09-04T00:00:00.000Z INFO  one");
  assert.match(formatLine({ time: "t", level: "error", text: "x" }), /^t ERROR x$/);
  assert.equal(logFileName("2026-09-04T13:00:00.000Z"), "aetheris-2026-09-04.log");

  // the file sink creates its directory and never throws
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-log-"));
  const file = path.join(dir, "nested", "aetheris-2026-09-04.log");
  const sink = fileSink(file, fs, path.join(dir, "nested"));
  sink.append("hello");
  sink.append("world\n");
  assert.equal(fs.readFileSync(file, "utf8"), "hello\nworld\n");
  // an unwritable target must be swallowed, not thrown (and must not hang on a weird fs)
  const blocked = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-log-ro-"));
  fs.chmodSync(blocked, 0o500);
  const quiet = fileSink(path.join(blocked, "no", "aetheris.log"), fs, path.join(blocked, "no"));
  quiet.append("must not throw");
  fs.chmodSync(blocked, 0o700);
  fs.rmSync(blocked, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

// --------------------------------------------------------------------------- repo invariants

test("capability registry: the desktop app is listed, and the embedded server is honest about this process", async () => {
  const { getCapability, searchCapabilities, registrySummary } = await import("../src/core/capabilities/registry");
  const { bootCapabilities } = await import("../src/core/capabilities/sources");
  bootCapabilities();

  const app = await getCapability("desktop:app");
  assert.ok(app, "desktop:app is registered");
  assert.equal(app!.status, "implemented");
  assert.equal(app!.category, "system");

  // This test process is *not* the embedded server, so the honest status is not_available; the same
  // entry reads implemented when AETHERIS_DESKTOP=1, which tests/desktop.embedded.test.ts sets.
  const embedded = await getCapability("desktop:embedded-server");
  assert.ok(embedded, "desktop:embedded-server is registered");
  assert.equal(embedded!.status, process.env.AETHERIS_DESKTOP === "1" ? "implemented" : "not_available");
  assert.equal(embedded!.locality, "local");

  // …and the search surface honours that: a not_available entry never ranks as an answer.
  const found = await searchCapabilities({ q: "desktop app electron" });
  assert.ok(found.some((c) => c.id === "desktop:app"), "the app is discoverable by search");
  if (process.env.AETHERIS_DESKTOP !== "1") {
    assert.equal(found.some((c) => c.id === "desktop:embedded-server"), false, "not_available scores 0 in search");
  }
  const summary = await registrySummary();
  assert.ok(summary.total > 380, `registry holds ${summary.total} capabilities`);
});

test("release coherence: one version everywhere, and the API reports it", async () => {
  const version = read("VERSION").trim();
  assert.ok(isCalVer(version), `VERSION must be CalVer, got "${version}"`);
  assert.equal(json("package.json").version, version, "package.json");
  assert.equal(json("desktop/package.json").version, version, "desktop/package.json");
  assert.equal(json("public/manifest.webmanifest").version, version, "web manifest");
  const { VERSION: runtimeVersion } = await import("../src/lib/version");
  assert.equal(runtimeVersion, version, "the running app reports the same version");
  assert.ok(read("CHANGELOG.md").includes(`## ${version} —`), "CHANGELOG has an entry for the current version");
  assert.ok(read("src/app/api/version/route.ts").includes("VERSION"), "/api/version is wired to the same constant");
});

test("desktop packaging: installers for macOS, Linux and Windows, server bundled as a resource", () => {
  const pkg = json("desktop/package.json") as { main: string; build: Record<string, any> };
  assert.equal(pkg.main, "dist/main.js");
  const b = pkg.build;
  assert.equal(b.appId, "io.aetheris.one");
  assert.equal(b.productName, "Aetheris");
  const macTargets = (b.mac.target as { target: string }[]).map((t) => t.target);
  const linuxTargets = (b.linux.target as { target: string }[]).map((t) => t.target);
  const winTargets = (b.win.target as { target: string }[]).map((t) => t.target);
  assert.ok(macTargets.includes("dmg") && macTargets.includes("zip"));
  assert.ok(linuxTargets.includes("AppImage") && linuxTargets.includes("deb") && linuxTargets.includes("rpm"));
  assert.ok(winTargets.includes("nsis") && winTargets.includes("zip"));
  assert.ok(b.mac.target.some((t: { arch: string[] }) => t.arch.includes("arm64")), "Apple silicon");
  assert.ok(b.extraResources.some((r: { to: string }) => r.to === "server"), "the standalone server ships inside the app");
  assert.ok(b.files.includes("dist/**/*") && b.files.includes("src/renderer/**/*"));
  assert.equal(b.publish[0].provider, "github");
  assert.ok(fs.existsSync(path.join(ROOT, "desktop/buildResources/icon.png")), "icon committed");
  assert.ok(fs.existsSync(path.join(ROOT, "desktop/buildResources/trayTemplate.png")), "macOS tray template committed");

  // Every path the packaging config points at must exist, or the runner finds out mid-release.
  for (const icon of [b.mac.icon, b.linux.icon, b.win.icon]) {
    assert.ok(fs.existsSync(path.join(ROOT, "desktop", icon)), `${icon} exists`);
  }
  for (const plist of [b.mac.entitlements, b.mac.entitlementsInherit]) {
    assert.ok(fs.existsSync(path.join(ROOT, "desktop", plist)), `${plist} exists`);
    assert.ok(read(path.join("desktop", plist)).includes("<plist"), `${plist} is a plist`);
  }
  for (const res of b.extraResources as { from: string }[]) {
    assert.ok(res.from.length > 0, "extraResources entries name a source directory");
  }
  // buildResources/icon.png is what electron-builder derives the .icns and .ico from — it must be big enough.
  const png = fs.readFileSync(path.join(ROOT, "desktop/buildResources/icon.png"));
  const width = png.readUInt32BE(16);
  assert.ok(width >= 512, `icon.png is ${width}px wide; electron-builder needs at least 512`);
});

test("desktop packaging: deb/rpm carry the metadata electron-builder's FpmTarget requires", () => {
  // The ubuntu leg of `release-desktop` builds `.deb` and `.rpm` through electron-builder's
  // FpmTarget, which throws *before* packaging unless the app package.json carries a `homepage`
  // and an `author.email` (app-builder-lib/src/targets/FpmTarget.ts → computeFpmMetaInfoOptions).
  // `homepage` was once missing from desktop/package.json, so both deb arch builds died with
  // "Please specify project homepage … #Metadata-homepage" while the AppImage targets passed.
  // Pin the required metadata so the next regression fails `npm test` in CI (which runs on
  // ubuntu) instead of a release runner mid-package.
  const pkg = json("desktop/package.json") as {
    homepage?: unknown;
    author?: { name?: unknown; email?: unknown };
    description?: unknown;
    name?: unknown;
    version?: unknown;
  };
  assert.equal(typeof pkg.homepage, "string", "homepage (FpmTarget: project homepage)");
  assert.ok((pkg.homepage as string).length > 0, "homepage is not empty");
  assert.ok(
    pkg.author && typeof pkg.author.email === "string" && pkg.author.email.length > 0,
    "author.email (FpmTarget: deb/rpm maintainer)",
  );
  assert.ok(typeof pkg.description === "string" && pkg.description.length > 0, "description (deb description)");
  assert.ok(typeof pkg.name === "string" && pkg.name.length > 0, "name (deb/rpm package name)");
  assert.ok(typeof pkg.version === "string" && pkg.version.length > 0, "version (deb/rpm package version)");
});

test("release notes: the GitHub Release body is that version's CHANGELOG section only", async () => {
  const { extractSection } = await import("../tools/release-notes.mjs");
  const doc = [
    "# Changelog",
    "",
    "<!-- CHANGELOG: new entries go directly below this line, newest first. -->",
    "",
    "## 2026.10.1 — 2026-10-01",
    "",
    "### desktop",
    "",
    "- tray icon",
    "",
    "---",
    "",
    "## 2026.9.1 — 2026-09-04",
    "",
    "- first release",
    "",
  ].join("\n");
  const section = extractSection(doc, "2026.10.1");
  assert.ok(section, "the section exists");
  assert.ok(section!.startsWith("## 2026.10.1 — 2026-10-01"));
  assert.ok(section!.includes("- tray icon"));
  assert.equal(section!.includes("2026.9.1"), false, "older releases stay out of the body");
  assert.equal(section!.includes("---"), false, "the separator is stripped");
  assert.ok(extractSection(doc, "2026.9.1")!.includes("- first release"));
  assert.equal(extractSection(doc, "2030.1.1"), null);

  // …and it works against the real CHANGELOG for the version in VERSION
  const out = execFileSync("npx", ["tsx", "tools/release-notes.mjs"], { cwd: ROOT, encoding: "utf8" });
  assert.ok(out.startsWith(`## ${read("VERSION").trim()} — `), out.slice(0, 80));
});

test("release workflow: a monthly schedule that bumps, tags and publishes; a per-OS desktop build", () => {
  const wf = read(".github/workflows/release.yml");
  assert.match(wf, /schedule:/);
  assert.match(wf, /cron: "30 3 1 \* \*"/, "runs on the 1st of every month");
  assert.match(wf, /workflow_dispatch/);
  assert.match(wf, /tools\/bump-version\.mjs/);
  assert.match(wf, /tools\/changelog\.mjs/);
  assert.match(wf, /tools\/release-notes\.mjs/);
  assert.match(wf, /softprops\/action-gh-release/);
  assert.match(wf, /body_path: RELEASE_NOTES\.md/, "the release body is that version's section");
  assert.match(wf, /contents: write/, "needs permission to push a tag and create a release");
  assert.match(wf, /git tag/, "tags the release");
  assert.match(wf, /refusing to re-release/, "never re-publishes the same version");
  for (const runner of ["macos-latest", "ubuntu-latest", "windows-latest"]) assert.ok(wf.includes(runner), `desktop matrix runs on ${runner}`);
  assert.match(wf, /ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci/, "the verify job does not download Electron");
  // The publish job pushes a new commit; the desktop legs must build *that*, not the pre-bump sha.
  assert.match(
    wf,
    /ref: v\$\{\{ needs\.publish\.outputs\.version \}\}/,
    "the desktop legs check out the release commit, so the installers carry the released version",
  );

  const action = read(".github/actions/build-desktop/action.yml");
  assert.match(action, /using: composite/);
  assert.match(action, /AETHERIS_STANDALONE: "1"/, "builds the embeddable server");
  assert.match(action, /electron-builder --publish never/);
  // desktop/dist is git-ignored and desktop/package.json declares `main: dist/main.js`, so packaging
  // without compiling dies with `Application entry file "dist/main.js" … does not exist`.
  assert.match(action, /npm run compile/, "the Electron shell is compiled before electron-builder");
  assert.ok(
    action.indexOf("npm run compile") < action.indexOf("electron-builder --publish never"),
    "and compiled *before* the package step",
  );
  assert.equal(
    /actions\/cache@/.test(action),
    false,
    "no hand-written cache paths — setup-node's `cache: npm` knows each runner's cache dir",
  );
  assert.match(action, /cache: npm/, "the npm cache is restored through setup-node");

  const dw = read(".github/workflows/release-desktop.yml");
  assert.match(dw, /workflow_dispatch/);
  for (const runner of ["macos-latest", "ubuntu-latest", "windows-latest"]) assert.ok(dw.includes(runner), runner);
  assert.match(dw, /build-desktop/, "shares the same build steps as the monthly release");
  // windows-latest runs `run:` steps in pwsh, where `set -euo pipefail` is not a command.
  assert.match(dw, /shell: bash/, "the version step pins bash, so it works on windows-latest too");

  // Both release workflows must call the composite action by its real path, not a stale one.
  assert.match(wf, /uses: \.\/\.github\/actions\/build-desktop/, "release.yml calls the action by path");
  assert.match(dw, /uses: \.\/\.github\/actions\/build-desktop/, "release-desktop.yml calls the action by path");

  // The CI workflow typechecks the Electron shell with the real electron types installed; without
  // that step desktop/src/main.ts silently drops out of every check (the root program excludes desktop/).
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /working-directory: desktop/, "the desktop project is verified in CI, not just excluded from the root tsc program");
  assert.match(ci, /ELECTRON_SKIP_BINARY_DOWNLOAD/, "CI installs Electron's types without downloading the binary");
  assert.match(ci, /npm run typecheck/, "the desktop app is typechecked");

  // The workflows live in .github/ now — nothing is stashed in ci/ anymore.
  for (const stale of ["ci/release.yml", "ci/release-desktop.yml", "ci/github-actions-ci.yml"]) {
    assert.equal(fs.existsSync(path.join(ROOT, stale)), false, `${stale} is gone; .github/workflows is the live location`);
  }

  const sh = read("tools/release.sh");
  assert.match(sh, /set -euo pipefail/);
  assert.match(sh, /working tree is dirty/, "refuses to release a dirty tree");
  assert.match(sh, /git tag -a "v\$version"/);
  assert.ok(read("ci/README.md").includes("release.yml"), "ci/README documents where the workflows live");
});

test("desktop guard: loopback host detection accepts only 127.0.0.1/localhost/::1", () => {
  for (const ok of ["127.0.0.1", "127.0.0.1:17890", "localhost", "localhost:3000", "[::1]", "[::1]:3000", "LOCALHOST:80"]) {
    assert.equal(isLoopbackHost(ok), true, ok);
  }
  for (const bad of ["evil.example", "127.0.0.1.evil.example", "10.0.0.5", "[::2]", "", null, undefined, "attacker.com:17890"]) {
    assert.equal(isLoopbackHost(bad as string | null | undefined), false, String(bad));
  }
  assert.ok(read("src/middleware.ts").includes("AETHERIS_DESKTOP"), "the middleware enforces it for embedded instances");
});

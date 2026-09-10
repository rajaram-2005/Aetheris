/**
 * Hosted deployment guardrails: vercel.json stays valid (crons point at real routes) and every
 * server-sent-events route declares the streaming ceiling (maxDuration) on the nodejs runtime.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...routeFiles(p));
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

test("vercel.json: crons point at real routes, functions point at real files", () => {
  const cfg = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
    crons?: { path: string; schedule: string }[];
    functions?: Record<string, { maxDuration?: number }>;
  };
  assert.ok(Array.isArray(cfg.crons) && cfg.crons.length > 0, "expected at least one cron");
  for (const c of cfg.crons!) {
    assert.match(c.schedule, /^(\S+ ){4}\S+$/, `bad cron schedule: ${c.schedule}`);
    const file = path.join(ROOT, "src/app", c.path.slice(1), "route.ts");
    assert.ok(existsSync(file), `cron path ${c.path} has no route file`);
    const src = readFileSync(file, "utf8");
    assert.match(src, /CRON_SECRET/, `${c.path} must check an authorization secret`);
    assert.match(src, /export const maxDuration = \d+/, `${c.path} must declare maxDuration`);
  }
  for (const [fn, conf] of Object.entries(cfg.functions ?? {})) {
    assert.ok(existsSync(path.join(ROOT, fn)), `functions entry ${fn} has no file`);
    assert.ok((conf.maxDuration ?? 0) > 0, `${fn} must declare maxDuration`);
  }
});

test("every SSE route declares maxDuration on the nodejs runtime", () => {
  const files = routeFiles(path.join(ROOT, "src/app/api"));
  const sse = files.filter((f) => readFileSync(f, "utf8").includes("text/event-stream"));
  assert.ok(sse.length >= 10, `expected the SSE routes, found ${sse.length}`);
  for (const f of sse) {
    const src = readFileSync(f, "utf8");
    const rel = path.relative(ROOT, f);
    assert.match(src, /export const maxDuration = \d+/, `${rel} must declare maxDuration (streaming ceiling)`);
    assert.match(src, /export const runtime = "nodejs"/, `${rel} must pin the nodejs runtime`);
  }
});
